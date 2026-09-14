import { ConvexError, v } from "convex/values";
import { createThread, listMessages, saveMessage } from "@convex-dev/agent";
import {
  mutation,
  query,
  internalQuery,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { record as recordV } from "./validators";
import { owned, hydrated } from "./sessions";
import { limits } from "./limits";
import {
  MAX_COACHING_TURNS,
  MAX_DRAFT_TEXT,
  MAX_SOURCES,
  MAX_SOURCE_TEXT,
} from "../shared/coaching";

const sessionArgs = { sessionId: v.id("sessions") };
const sourceV = v.object({
  id: v.string(),
  name: v.string(),
  kind: v.union(v.literal("pdf"), v.literal("notes")),
  text: v.string(),
  pages: v.optional(v.number()),
});
const stateV = v.object({
  messages: v.array(
    v.object({
      id: v.string(),
      role: v.union(v.literal("user"), v.literal("assistant")),
      text: v.string(),
    }),
  ),
  sources: v.array(sourceV),
  draft: v.string(),
  pending: v.boolean(),
  error: v.optional(v.string()),
  canRetry: v.boolean(),
  turns: v.number(),
});

export async function findCoaching(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<"sessions">,
) {
  return ctx.db
    .query("coaching")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .unique();
}
async function sourcesFor(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<"sessions">,
) {
  return ctx.db
    .query("projectSources")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .take(MAX_SOURCES + 1);
}
async function reviewed(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<"sessions">,
) {
  const session = await owned(ctx, sessionId);
  if (!session.record.feedback)
    throw new ConvexError("Get feedback before working on this story.");
  return session;
}
async function ensureCoaching(ctx: MutationCtx, sessionId: Id<"sessions">) {
  const session = await reviewed(ctx, sessionId);
  const existing = await findCoaching(ctx, sessionId);
  if (existing) return existing;
  const threadId = await createThread(ctx, components.agent, {
    userId: session.ownerId,
    title: "Interview story coaching",
  });
  const id = await ctx.db.insert("coaching", {
    sessionId,
    threadId,
    draft: "",
    turns: 0,
    revision: 0,
  });
  return (await ctx.db.get(id))!;
}

export const get = query({
  args: sessionArgs,
  returns: stateV,
  handler: async (ctx, { sessionId }) => {
    await reviewed(ctx, sessionId);
    const chat = await findCoaching(ctx, sessionId);
    const result = chat
      ? await listMessages(ctx, components.agent, {
          threadId: chat.threadId,
          paginationOpts: { cursor: null, numItems: MAX_COACHING_TURNS * 2 },
          statuses: ["success"],
          excludeToolMessages: true,
        })
      : null;
    const messages = (result?.page ?? []).reverse().flatMap((m) => {
      const role = m.message?.role;
      return (role === "user" || role === "assistant") && m.text
        ? [{ id: m._id, role, text: m.text }]
        : [];
    });
    return {
      messages,
      sources: (await sourcesFor(ctx, sessionId)).map((s) => ({
        id: s._id,
        name: s.name,
        kind: s.kind,
        text: s.text,
        ...(s.pages === undefined ? {} : { pages: s.pages }),
      })),
      draft: chat?.draft ?? "",
      pending: !!chat?.activeMessageId,
      ...(chat?.error ? { error: chat.error } : {}),
      canRetry: !!chat?.failedMessageId,
      turns: chat?.turns ?? 0,
    };
  },
});

export const send = mutation({
  args: { ...sessionArgs, text: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId, text }) => {
    if (!text.trim() || text.length > 4000)
      throw new ConvexError("Write a message of 1–4,000 characters.");
    const session = await reviewed(ctx, sessionId);
    const chat = await ensureCoaching(ctx, sessionId);
    if (chat.activeMessageId)
      throw new ConvexError("Wait for your coach to finish replying.");
    if (chat.turns >= MAX_COACHING_TURNS)
      throw new ConvexError(
        "This conversation is full. Practice your draft to start a new attempt.",
      );
    await limits.limit(ctx, "coaching", { key: session.ownerId, throws: true });
    await limits.limit(ctx, "globalCoaching", { throws: true });
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: chat.threadId,
      prompt: text.trim(),
    });
    const revision = chat.revision + 1;
    const jobId = await ctx.scheduler.runAfter(0, internal.coach.respond, {
      sessionId,
      messageId,
      revision,
    });
    await ctx.scheduler.runAfter(150000, internal.coaching.expireReply, {
      sessionId,
      messageId,
      revision,
    });
    await ctx.db.patch(chat._id, {
      activeMessageId: messageId,
      failedMessageId: undefined,
      error: undefined,
      jobId,
      revision,
      turns: chat.turns + 1,
    });
    return null;
  },
});

export const retry = mutation({
  args: sessionArgs,
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    const session = await reviewed(ctx, sessionId);
    const chat = await findCoaching(ctx, sessionId);
    if (!chat?.failedMessageId || chat.activeMessageId)
      throw new ConvexError("There is no failed reply to retry.");
    await limits.limit(ctx, "coaching", { key: session.ownerId, throws: true });
    await limits.limit(ctx, "globalCoaching", { throws: true });
    const messageId = chat.failedMessageId;
    const revision = chat.revision + 1;
    const jobId = await ctx.scheduler.runAfter(0, internal.coach.respond, {
      sessionId,
      messageId,
      revision,
    });
    await ctx.scheduler.runAfter(150000, internal.coaching.expireReply, {
      sessionId,
      messageId,
      revision,
    });
    await ctx.db.patch(chat._id, {
      activeMessageId: messageId,
      failedMessageId: undefined,
      error: undefined,
      jobId,
      revision,
    });
    return null;
  },
});

const replyArgs = {
  ...sessionArgs,
  messageId: v.string(),
  revision: v.number(),
};
export const context = internalQuery({
  args: replyArgs,
  returns: v.union(
    v.object({
      chat: schema.doc("coaching"),
      record: recordV,
      sources: v.array(sourceV),
    }),
    v.null(),
  ),
  handler: async (ctx, { sessionId, messageId, revision }) => {
    const session = await ctx.db.get(sessionId);
    const chat = await findCoaching(ctx, sessionId);
    if (
      !session ||
      !chat ||
      chat.activeMessageId !== messageId ||
      chat.revision !== revision
    )
      return null;
    return {
      chat,
      record: await hydrated(ctx, session),
      sources: (await sourcesFor(ctx, sessionId)).map((s) => ({
        id: s._id,
        name: s.name,
        kind: s.kind,
        text: s.text,
        ...(s.pages === undefined ? {} : { pages: s.pages }),
      })),
    };
  },
});

export const finish = internalMutation({
  args: {
    ...replyArgs,
    text: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { sessionId, messageId, revision, text, error }) => {
    const chat = await findCoaching(ctx, sessionId);
    if (
      !chat ||
      !(await ctx.db.get(sessionId)) ||
      chat.activeMessageId !== messageId ||
      chat.revision !== revision
    )
      return null;
    if (text?.trim())
      await saveMessage(ctx, components.agent, {
        threadId: chat.threadId,
        promptMessageId: messageId,
        message: { role: "assistant", content: text },
        agentName: "Rehearsal coach",
      });
    await ctx.db.patch(chat._id, {
      activeMessageId: undefined,
      jobId: undefined,
      failedMessageId: text?.trim() ? undefined : messageId,
      error: text?.trim()
        ? undefined
        : error || "Your coach could not reply. Try again.",
    });
    return null;
  },
});
export const expireReply = internalMutation({
  args: replyArgs,
  returns: v.null(),
  handler: async (ctx, { sessionId, messageId, revision }) => {
    const chat = await findCoaching(ctx, sessionId);
    if (chat?.activeMessageId === messageId && chat.revision === revision) {
      if (chat.jobId) await ctx.scheduler.cancel(chat.jobId);
      await ctx.db.patch(chat._id, {
        activeMessageId: undefined,
        jobId: undefined,
        failedMessageId: messageId,
        error: "The reply took too long. Your message is saved; try again.",
      });
    }
    return null;
  },
});

export const saveDraft = mutation({
  args: { ...sessionArgs, draft: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId, draft }) => {
    if (draft.length > MAX_DRAFT_TEXT)
      throw new ConvexError("Keep your practice draft under 8,000 characters.");
    const chat = await ensureCoaching(ctx, sessionId);
    await ctx.db.patch(chat._id, { draft });
    return null;
  },
});

async function checkSourceCapacity(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<"sessions">,
) {
  await reviewed(ctx, sessionId);
  if ((await sourcesFor(ctx, sessionId)).length >= MAX_SOURCES)
    throw new ConvexError(
      "Use up to three project materials per attempt. Remove one before adding another.",
    );
  const chat = await findCoaching(ctx, sessionId);
  if (chat?.activeMessageId)
    throw new ConvexError(
      "Wait for the reply before changing project materials.",
    );
}
export const claimUpload = internalMutation({
  args: sessionArgs,
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    await checkSourceCapacity(ctx, sessionId);
    const session = await owned(ctx, sessionId);
    await limits.limit(ctx, "projectUpload", {
      key: session.ownerId,
      throws: true,
    });
    return null;
  },
});
export const attachPdf = internalMutation({
  args: {
    ...sessionArgs,
    name: v.string(),
    text: v.string(),
    pages: v.number(),
    storageId: v.id("_storage"),
  },
  returns: v.null(),
  handler: async (ctx, { sessionId, name, text, pages, storageId }) => {
    await checkSourceCapacity(ctx, sessionId);
    if (!text.trim() || text.length > MAX_SOURCE_TEXT || name.length > 120)
      throw new ConvexError("Project material is too long.");
    await ctx.db.insert("projectSources", {
      sessionId,
      name,
      text,
      pages,
      storageId,
      kind: "pdf",
    });
    return null;
  },
});
export const addNotes = mutation({
  args: { ...sessionArgs, name: v.string(), text: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId, name, text }) => {
    await checkSourceCapacity(ctx, sessionId);
    if (
      !name.trim() ||
      name.length > 120 ||
      !text.trim() ||
      text.length > MAX_SOURCE_TEXT
    )
      throw new ConvexError(
        "Add a title and 1–20,000 characters of project notes.",
      );
    await ctx.db.insert("projectSources", {
      sessionId,
      name: name.trim(),
      text: text.trim(),
      kind: "notes",
    });
    return null;
  },
});
export const removeSource = mutation({
  args: { sourceId: v.id("projectSources") },
  returns: v.null(),
  handler: async (ctx, { sourceId }) => {
    const source = await ctx.db.get(sourceId);
    if (!source) throw new ConvexError("Project material not found.");
    await reviewed(ctx, source.sessionId);
    if ((await findCoaching(ctx, source.sessionId))?.activeMessageId)
      throw new ConvexError(
        "Wait for the reply before changing project materials.",
      );
    if (source.storageId) await ctx.storage.delete(source.storageId);
    await ctx.db.delete(sourceId);
    return null;
  },
});

export async function deleteCoaching(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
) {
  const chat = await findCoaching(ctx, sessionId);
  if (chat) {
    if (chat.jobId) await ctx.scheduler.cancel(chat.jobId);
    await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
      threadId: chat.threadId,
    });
    await ctx.db.delete(chat._id);
  }
  for (const source of await sourcesFor(ctx, sessionId)) {
    if (source.storageId) await ctx.storage.delete(source.storageId);
    await ctx.db.delete(source._id);
  }
}
