import { v, ConvexError } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  record as recordV,
  config as configV,
  fragment as fragmentV,
  feedback as feedbackV,
} from "./validators";
import {
  configSchema,
  fragmentSchema,
  maxSeconds,
  questions,
  type PracticeSession,
} from "../shared/types";
import { requireUser } from "./users";
import { limits } from "./limits";
export async function owned(ctx: QueryCtx | MutationCtx, id: Id<"sessions">) {
  const user = await requireUser(ctx);
  const s = await ctx.db.get(id);
  if (!s || s.ownerId !== user._id) throw new ConvexError("Session not found.");
  return s;
}
export async function hydrated(
  ctx: QueryCtx | MutationCtx,
  s: Doc<"sessions">,
) {
  const rows = await ctx.db
    .query("fragments")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", s._id))
    .take(6000);
  return { ...s.record, fragments: rows.map((r) => r.fragment) };
}
export const list = query({
  args: {},
  returns: v.array(recordV),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return (
      await ctx.db
        .query("sessions")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", user._id))
        .order("desc")
        .take(50)
    ).map((s) => s.record);
  },
});
export const get = query({
  args: { id: v.id("sessions") },
  returns: recordV,
  handler: async (ctx, { id }) => hydrated(ctx, await owned(ctx, id)),
});
export const reserve = internalMutation({
  args: { config: configV, requestId: v.string() },
  returns: v.id("sessions"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    configSchema.parse(args.config);
    if (args.requestId.length > 100) throw new ConvexError("Invalid request.");
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_ownerId_and_requestId", (q) =>
        q.eq("ownerId", user._id).eq("requestId", args.requestId),
      )
      .unique();
    if (existing)
      throw new ConvexError(
        "This start request was already used. Start a new attempt.",
      );
    await limits.limit(ctx, "voice", { key: user._id, throws: true });
    await limits.limit(ctx, "globalVoice", { throws: true });
    const recent = await ctx.db
      .query("sessions")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .take(10);
    if (
      recent.some(
        (s) =>
          (s.record.status === "active" || s.record.status === "connecting") &&
          s.expiresAt > Date.now(),
      )
    )
      throw new ConvexError(
        "End your active interview before starting another.",
      );
    let config = args.config;
    let question = config.startingQuestion || questions[0];
    if (config.opportunityId) {
      const o = await ctx.db.get(config.opportunityId);
      if (!o || o.ownerId !== user._id || !o.brief || o.status !== "ready")
        throw new ConvexError("Choose a ready preparation brief.");
      if (
        config.startingQuestion &&
        !o.brief.questions.includes(config.startingQuestion)
      )
        throw new ConvexError("Choose a question from this brief.");
      config = {
        ...config,
        role: o.brief.role,
        jobDescription: JSON.stringify(o.brief).slice(0, 15000),
      };
      question = config.startingQuestion || o.brief.questions[0];
    }
    if (config.previousId) {
      const prevId = ctx.db.normalizeId("sessions", config.previousId);
      if (!prevId) throw new ConvexError("Previous session not found.");
      const prev = await owned(ctx, prevId);
      if (config.relation === "retry")
        question = prev.record.feedback?.retryQuestion || prev.record.question;
      else
        question =
          questions[
            (questions.indexOf(prev.record.question) + 1) % questions.length
          ];
    }
    const now = Date.now();
    const id = await ctx.db.insert("sessions", {
      ownerId: user._id,
      requestId: args.requestId,
      expiresAt: now + (maxSeconds(config.mode) + 45) * 1000,
      fragmentCount: 0,
      transcriptBytes: 0,
      feedbackState: "idle",
      record: {
        version: 1,
        id: "pending",
        createdAt: new Date(now).toISOString(),
        config,
        question,
        status: "connecting",
        fragments: [],
        seconds: 0,
        usageConfirmed: false,
        reasoningBackend: "api",
        backendUsage: {},
      },
    });
    const s = await ctx.db.get(id);
    await ctx.db.patch(id, { record: { ...s!.record, id } });
    await ctx.scheduler.runAfter(
      (maxSeconds(config.mode) + 30) * 1000,
      internal.voice.expire,
      { id },
    );
    return id;
  },
});
export const load = internalQuery({
  args: { id: v.id("sessions") },
  returns: v.union(schema.doc("sessions"), v.null()),
  handler: (ctx, { id }) => ctx.db.get(id),
});
export const full = internalQuery({
  args: { id: v.id("sessions") },
  returns: recordV,
  handler: async (ctx, { id }) => {
    const s = await ctx.db.get(id);
    if (!s) throw new Error("Session removed.");
    return hydrated(ctx, s);
  },
});
export const activate = internalMutation({
  args: { id: v.id("sessions"), liveId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { id, liveId }) => {
    const s = await ctx.db.get(id);
    if (!s) return false;
    if (s.record.endedAt) {
      await ctx.db.patch(id, { liveId });
      return false;
    }
    await ctx.db.patch(id, {
      liveId,
      record: { ...s.record, status: "active" },
    });
    return true;
  },
});
export const append = mutation({
  args: { id: v.id("sessions"), fragments: v.array(fragmentV) },
  returns: v.null(),
  handler: async (ctx, { id, fragments }) => {
    const s = await owned(ctx, id);
    if (fragments.length > 250)
      throw new ConvexError("Transcript batch too large.");
    if (s.feedbackState === "running" || s.feedbackState === "ready")
      throw new ConvexError("This transcript is already under review.");
    let count = s.fragmentCount,
      bytes = s.transcriptBytes;
    for (const raw of fragments) {
      const f = fragmentSchema.parse(raw);
      if (f.end_ms > maxSeconds(s.record.config.mode) * 1000 + 60000)
        throw new ConvexError("Invalid transcript timing.");
      const duplicate = await ctx.db
        .query("fragments")
        .withIndex("by_sessionId_and_eventId", (q) =>
          q.eq("sessionId", id).eq("fragment.event_id", f.event_id),
        )
        .unique();
      if (duplicate) continue;
      count++;
      bytes += new TextEncoder().encode(f.delta).byteLength;
      if (count > 6000 || bytes > 300000)
        throw new ConvexError(
          "Transcript limit reached. End and review this attempt.",
        );
      await ctx.db.insert("fragments", { sessionId: id, fragment: f });
    }
    await ctx.db.patch(id, { fragmentCount: count, transcriptBytes: bytes });
    return null;
  },
});
export const finalize = mutation({
  args: {
    id: v.id("sessions"),
    confirmed: v.boolean(),
    reason: v.string(),
    seconds: v.optional(v.number()),
  },
  returns: recordV,
  handler: async (ctx, args) => {
    const s = await owned(ctx, args.id);
    if (
      args.seconds !== undefined &&
      (!Number.isFinite(args.seconds) ||
        args.seconds < 0 ||
        args.seconds > maxSeconds(s.record.config.mode) + 90)
    )
      throw new ConvexError("Invalid duration.");
    await ctx.scheduler.runAfter(0, internal.voice.expire, { id: s._id });
    if (!s.record.endedAt) {
      const seconds = Math.min(
        maxSeconds(s.record.config.mode),
        (Date.now() - Date.parse(s.record.createdAt)) / 1000,
      );
      await ctx.db.patch(s._id, {
        record: {
          ...s.record,
          status:
            args.confirmed && args.reason !== "connection_lost"
              ? "completed"
              : "partial",
          endedAt: new Date().toISOString(),
          seconds: args.seconds ?? seconds,
          usageConfirmed: false,
          closeReason: args.reason.slice(0, 100),
        },
      });
    } else if (
      s.record.status === "partial" &&
      s.record.closeReason === "close_requested" &&
      args.reason === "connection_lost" &&
      s.feedbackState === "idle"
    ) {
      // voice.close may win the race to markClosed before the browser reports
      // why it ended. Preserve that failure without rewriting time or usage.
      await ctx.db.patch(s._id, {
        record: { ...s.record, closeReason: "connection_lost" },
      });
    }
    const updated = (await ctx.db.get(s._id))!;
    return hydrated(ctx, updated);
  },
});
export const markClosed = internalMutation({
  args: { id: v.id("sessions"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, reason }) => {
    const s = await ctx.db.get(id);
    if (s && !s.record.endedAt)
      await ctx.db.patch(id, {
        record: {
          ...s.record,
          status: "partial",
          endedAt: new Date().toISOString(),
          seconds: Math.min(
            maxSeconds(s.record.config.mode),
            (Date.now() - Date.parse(s.record.createdAt)) / 1000,
          ),
          closeReason: reason,
        },
      });
    return null;
  },
});
export const claimFeedback = internalMutation({
  args: { id: v.id("sessions") },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { id }) => {
    const s = await owned(ctx, id);
    if (s.record.feedback) return null;
    if (!s.record.endedAt)
      throw new ConvexError("End the interview before requesting feedback.");
    if (
      s.feedbackState === "running" &&
      (s.feedbackStartedAt ?? 0) > Date.now() - 300000
    )
      throw new ConvexError("Feedback is already being prepared.");
    await limits.limit(ctx, "feedback", { key: s.ownerId, throws: true });
    const claim = Date.now();
    await ctx.db.patch(id, {
      feedbackState: "running",
      feedbackStartedAt: claim,
    });
    return claim;
  },
});
export const saveFeedback = internalMutation({
  args: {
    id: v.id("sessions"),
    claim: v.number(),
    feedback: v.optional(feedbackV),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const s = await ctx.db.get(args.id);
    if (s && s.feedbackStartedAt === args.claim)
      await ctx.db.patch(s._id, {
        feedbackState: args.feedback ? "ready" : "failed",
        record: {
          ...s.record,
          ...(args.feedback
            ? {
                feedback: args.feedback,
                feedbackBackend: "api" as const,
                feedbackError: undefined,
              }
            : { feedbackError: args.error ?? "Feedback failed." }),
        },
      });
    return null;
  },
});
export const remove = mutation({
  args: { id: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const s = await owned(ctx, id);
    if (!s.record.endedAt)
      throw new ConvexError("End this session before deleting it.");
    if (s.liveId)
      await ctx.scheduler.runAfter(0, internal.voice.hangupDeleted, {
        liveId: s.liveId,
      });
    await ctx.db.delete(id);
    await ctx.scheduler.runAfter(0, internal.sessions.purgeFragments, { id });
    return null;
  },
});
export const purgeFragments = internalMutation({
  args: { id: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const rows = await ctx.db
      .query("fragments")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", id))
      .take(250);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === 250)
      await ctx.scheduler.runAfter(0, internal.sessions.purgeFragments, { id });
    return null;
  },
});
