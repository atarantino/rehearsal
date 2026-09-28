import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import schema from "./schema";
export const record = internalMutation({
  args: {
    ownerId: v.id("users"),
    liveId: v.string(),
    state: v.union(
      v.literal("pending"),
      v.literal("closed"),
      v.literal("failed"),
    ),
    errorCode: v.optional(v.string()),
    providerSeconds: v.optional(v.number()),
    attempt: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("providerClosures")
      .withIndex("by_liveId", (q) => q.eq("liveId", args.liveId))
      .unique();
    const seconds = args.providerSeconds;
    const providerSeconds =
      typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
        ? Math.max(old?.providerSeconds ?? 0, seconds)
        : old?.providerSeconds;
    const fields = {
      ownerId: args.ownerId,
      liveId: args.liveId,
      state:
        old?.state === "closed"
          ? ("closed" as const)
          : old?.state === "failed" && args.state === "pending"
            ? ("failed" as const)
            : args.state,
      attempts: (old?.attempts ?? 0) + (args.attempt ? 1 : 0),
      updatedAt: Date.now(),
      providerSeconds,
      errorCode: old?.state === "closed" ? undefined : args.errorCode,
    };
    if (old) await ctx.db.patch(old._id, fields);
    else await ctx.db.insert("providerClosures", fields);
    return null;
  },
});
export const failures = internalQuery({
  args: {},
  returns: v.array(schema.doc("providerClosures")),
  handler: (ctx) =>
    ctx.db
      .query("providerClosures")
      .withIndex("by_state", (q) => q.eq("state", "failed"))
      .order("desc")
      .take(100),
});

// Retained with the usage reservation even when the user deletes the session.
export const start = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    state: v.union(
      v.literal("pending"),
      v.literal("created"),
      v.literal("failed"),
      v.literal("unknown"),
    ),
    requestId: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    liveId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const reservation = await ctx.db
      .query("voiceReservations")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (reservation && reservation.providerStartState !== "created")
      await ctx.db.patch(reservation._id, {
        providerStartState: args.state,
        providerRequestId: args.requestId ?? reservation.providerRequestId,
        providerErrorCode: args.errorCode ?? reservation.providerErrorCode,
        providerLiveId: args.liveId ?? reservation.providerLiveId,
      });
    return null;
  },
});
