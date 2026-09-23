import { v, ConvexError } from "convex/values";
import { AgentMail } from "@agentmail/convex";
import { z } from "zod";
import { query, action, internalMutation, env } from "./_generated/server";
import { api, components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUser } from "./users";
import { limits } from "./limits";
import { enqueue } from "./preparation";
import { isPlanLimitError } from "./entitlements";
import { MAX_ATTACHMENTS } from "../shared/attachments";
import {
  routingTokenFromSubject,
  sharedInboxAddress,
  subjectMarker,
} from "../shared/email-routing";
const inboxView = v.object({
  address: v.string(),
  autoReply: v.boolean(),
  subjectMarker: v.optional(v.string()),
});
function viewInbox(inbox: Doc<"inboxes">) {
  return {
    address: inbox.address,
    autoReply: inbox.autoReply,
    ...(inbox.routingMode === "shared" && inbox.routingToken
      ? { subjectMarker: subjectMarker(inbox.routingToken) }
      : {}),
  };
}
export const agentmail: AgentMail = new AgentMail(components.agentmail, {
  onMessageReceived: internal.email.received,
});
export const inbox = query({
  args: {},
  returns: v.union(inboxView, v.null()),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const i = await ctx.db
      .query("inboxes")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", user._id))
      .unique();
    return i ? viewInbox(i) : null;
  },
});
export const reserve = internalMutation({
  args: { autoReply: v.boolean(), routingToken: v.string() },
  returns: inboxView,
  handler: async (ctx, { autoReply, routingToken }) => {
    const u = await requireUser(ctx);
    const existing = await ctx.db
      .query("inboxes")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", u._id))
      .unique();
    if (existing) return viewInbox(existing);
    const address = sharedInboxAddress(env.AGENTMAIL_SHARED_INBOX_ID);
    if (!address || !env.AGENTMAIL_API_KEY || !env.AGENTMAIL_WEBHOOK_SECRET)
      throw new ConvexError(
        "Email setup is not finished yet. You can paste a job URL in the meantime.",
      );
    if (!/^[a-f0-9]{32}$/.test(routingToken))
      throw new Error("Invalid mail routing token.");
    await limits.limit(ctx, "inbox", { key: u._id, throws: true });
    const collision = await ctx.db
      .query("inboxes")
      .withIndex("by_inboxId_and_routingToken", (q) =>
        q.eq("inboxId", address).eq("routingToken", routingToken),
      )
      .unique();
    if (collision)
      throw new Error("Mail routing token already exists. Try again.");
    await ctx.db.insert("inboxes", {
      ownerId: u._id,
      inboxId: address,
      address,
      autoReply,
      routingMode: "shared",
      routingToken,
    });
    return { address, autoReply, subjectMarker: subjectMarker(routingToken) };
  },
});
export const save = internalMutation({
  args: { ownerId: v.id("users"), inboxId: v.string(), autoReply: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("inboxes")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", args.ownerId))
      .unique();
    if (!old)
      await ctx.db.insert("inboxes", { ...args, address: args.inboxId });
    return null;
  },
});
export const create = action({
  args: { autoReply: v.optional(v.boolean()) },
  returns: inboxView,
  handler: async (
    ctx,
    { autoReply },
  ): Promise<ReturnType<typeof viewInbox>> => {
    const existing = await ctx.runQuery(api.email.inbox, {});
    if (existing) return existing;
    return await ctx.runMutation(internal.email.reserve, {
      autoReply: autoReply ?? false,
      routingToken: crypto.randomUUID().replaceAll("-", ""),
    });
  },
});
export const replaceMarker = internalMutation({
  args: { expectedToken: v.string(), routingToken: v.string() },
  returns: inboxView,
  handler: async (ctx, { expectedToken, routingToken }) => {
    const user = await requireUser(ctx);
    const route = await ctx.db
      .query("inboxes")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", user._id))
      .unique();
    if (!route || route.routingMode !== "shared" || !route.routingToken)
      throw new ConvexError(
        "This account does not have a shared email marker.",
      );
    // Retrying a request must not invalidate the marker it just returned.
    if (route.routingToken !== expectedToken) return viewInbox(route);
    if (!/^[a-f0-9]{32}$/.test(routingToken) || routingToken === expectedToken)
      throw new Error("Invalid replacement mail routing token.");
    await limits.limit(ctx, "inbox", { key: user._id, throws: true });
    const collision = await ctx.db
      .query("inboxes")
      .withIndex("by_inboxId_and_routingToken", (q) =>
        q.eq("inboxId", route.inboxId).eq("routingToken", routingToken),
      )
      .unique();
    if (collision)
      throw new Error("Mail routing token already exists. Try again.");
    await ctx.db.patch(route._id, { routingToken });
    return viewInbox({ ...route, routingToken });
  },
});
export const rotateMarker = action({
  args: { expectedMarker: v.string() },
  returns: inboxView,
  handler: async (
    ctx,
    { expectedMarker },
  ): Promise<ReturnType<typeof viewInbox>> => {
    const expectedToken = routingTokenFromSubject(expectedMarker);
    if (!expectedToken || expectedMarker !== subjectMarker(expectedToken))
      throw new ConvexError(
        "Use the current subject marker shown in your workspace.",
      );
    return ctx.runMutation(internal.email.replaceMarker, {
      expectedToken,
      routingToken: crypto.randomUUID().replaceAll("-", ""),
    });
  },
});
const messageSchema = z.object({
  inbox_id: z.string().max(300),
  message_id: z.string().max(300),
  subject: z.string().max(1000).optional(),
  text: z.string().optional(),
  extracted_text: z.string().optional(),
  labels: z.array(z.string()).optional(),
  attachments: z
    .array(
      z.object({
        attachment_id: z.string().min(1).max(300),
        filename: z.string().optional(),
        content_type: z.string().optional(),
        size: z.number().nonnegative().optional(),
      }),
    )
    .optional(),
});
export const received = internalMutation({
  args: { message: v.any(), thread: v.any(), eventId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const parsed = messageSchema.safeParse(args.message);
    if (!parsed.success) return null;
    const message = parsed.data;
    if (
      message.labels?.some((x) => ["spam", "blocked", "auto-reply"].includes(x))
    )
      return null;
    let inbox: Doc<"inboxes"> | null = null;
    if (
      message.inbox_id === sharedInboxAddress(env.AGENTMAIL_SHARED_INBOX_ID)
    ) {
      const token = routingTokenFromSubject(message.subject);
      if (!token) return null;
      inbox = await ctx.db
        .query("inboxes")
        .withIndex("by_inboxId_and_routingToken", (q) =>
          q.eq("inboxId", message.inbox_id).eq("routingToken", token),
        )
        .unique();
      if (inbox?.routingMode !== "shared") return null;
    } else {
      const matches = await ctx.db
        .query("inboxes")
        .withIndex("by_inboxId", (q) => q.eq("inboxId", message.inbox_id))
        .take(2);
      if (matches.length !== 1 || matches[0].routingMode === "shared")
        return null;
      inbox = matches[0];
    }
    if (!inbox || !(await ctx.db.get(inbox.ownerId))) return null;
    if (
      await ctx.db
        .query("mailEvents")
        .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
        .unique()
    )
      return null;
    const text = message.text || message.extracted_text;
    if (!text && !message.attachments?.length) return null;
    // Existing dedicated routes retain their historical deduplication key.
    const subject =
      inbox.routingMode === "shared" && inbox.routingToken
        ? (message.subject ?? "")
            .replace(subjectMarker(inbox.routingToken), "")
            .trim()
        : message.subject;
    const preparation = {
      ownerId: inbox.ownerId,
      requestId:
        inbox.routingMode === "shared"
          ? `mail:${message.inbox_id}:${message.message_id}`
          : `mail:${message.message_id}`,
      kind: "email" as const,
      input:
        `Subject: ${subject || "Interview invitation"}\n\n${text ?? ""}`.slice(
          0,
          18000,
        ),
      inboxId: message.inbox_id,
      messageId: message.message_id,
      attachments: message.attachments?.slice(0, MAX_ATTACHMENTS).map((a) => ({
        id: a.attachment_id,
        filename: (a.filename || "Unnamed attachment").slice(0, 300),
        contentType: (a.content_type || "").slice(0, 200),
        size: a.size ?? 0,
        status: "pending" as const,
      })),
      omittedAttachmentCount: Math.max(
        0,
        (message.attachments?.length ?? 0) - MAX_ATTACHMENTS,
      ),
    };
    let id: Id<"opportunities">;
    try {
      id = await enqueue(ctx, preparation);
    } catch (error) {
      if (!isPlanLimitError(error)) throw error;
      id = await ctx.db.insert("opportunities", {
        ...preparation,
        status: "failed",
        sources: [],
        receivedAt: Date.now(),
        error: `${error.data.message} Your invitation is saved. Retry preparation when your allowance is available.`,
      });
    }
    await ctx.db.patch(id, { inboxRecordId: inbox._id });
    await ctx.db.insert("mailEvents", { eventId: args.eventId });
    return null;
  },
});
export const notifyReady = internalMutation({
  args: { id: v.id("opportunities") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const o = await ctx.db.get(id);
    if (!o || !o.inboxId || !o.messageId || o.replyId || o.status !== "ready")
      return null;
    const i = o.inboxRecordId
      ? await ctx.db.get(o.inboxRecordId)
      : await ctx.db
          .query("inboxes")
          .withIndex("by_ownerId", (q) => q.eq("ownerId", o.ownerId))
          .unique();
    if (!i?.autoReply || i.ownerId !== o.ownerId || i.inboxId !== o.inboxId)
      return null;
    const replyId = await agentmail.replyToMessage(
      ctx,
      o.inboxId,
      o.messageId,
      {
        text: `Your interview preparation is ready. Open your private Rehearsal workspace to review the brief and practice out loud:\n${env.SITE_URL}/?prep=${id}\n\nSign in with the passkey for your Rehearsal account.`,
        replyAll: false,
        labels: ["auto-reply"],
      },
    );
    await ctx.db.patch(id, { replyId });
    return null;
  },
});
