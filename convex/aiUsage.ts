import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import schema from "./schema";
import { AI_MODEL, AI_POLICY, delegationLimit } from "../shared/cost-controls";
import { getEntitlement } from "./entitlements";
import { ensurePeriod } from "./usage";
import { limits } from "./limits";

export const begin = internalMutation({
  args: {
    ownerId: v.id("users"),
    sessionId: v.optional(v.id("sessions")),
    opportunityId: v.optional(v.id("opportunities")),
    delegationId: v.optional(v.string()),
    operation: schema.doc("aiRequests").fields.operation,
  },
  returns: v.object({
    id: v.id("aiRequests"),
    fresh: v.boolean(),
    result: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const entitlement = await getEntitlement(ctx, args.ownerId, now);
    if (args.operation === "delegation" || args.operation === "feedback") {
      const s = args.sessionId ? await ctx.db.get(args.sessionId) : null;
      if (!s || s.ownerId !== args.ownerId)
        throw new ConvexError("Session not found.");
      if (args.operation === "delegation") {
        if (!args.delegationId || args.delegationId.length > 200)
          throw new ConvexError("Invalid delegation.");
        if (
          s.activatedAt === undefined ||
          s.record.endedAt ||
          now >= s.expiresAt
        )
          throw new ConvexError("The interview has ended.");
        const existing = await ctx.db
          .query("aiRequests")
          .withIndex("by_sessionId_and_delegationId", (q) =>
            q.eq("sessionId", s._id).eq("delegationId", args.delegationId),
          )
          .unique();
        if (existing)
          return { id: existing._id, fresh: false, result: existing.result };
        if ((s.delegationCalls ?? 0) >= delegationLimit(s.record.config.mode))
          throw new ConvexError(
            "Live reasoning allowance reached for this interview.",
          );
        const period = await ensurePeriod(ctx, args.ownerId, entitlement);
        if ((period.delegationCalls ?? 0) >= entitlement.voiceMinutes)
          throw new ConvexError(
            "Live reasoning processing limit reached for this period.",
          );
        await ctx.db.patch(period._id, {
          delegationCalls: (period.delegationCalls ?? 0) + 1,
        });
        await ctx.db.patch(s._id, {
          delegationCalls: (s.delegationCalls ?? 0) + 1,
        });
      } else {
        // Bind generation to a claimed review. Each attempt reserves capacity
        // before any network request; timeouts and rejected generations count.
        if (s.feedbackState !== "running")
          throw new ConvexError("Review is not running.");
        const period = await ensurePeriod(ctx, args.ownerId, entitlement);
        if ((period.feedbackCalls ?? 0) >= entitlement.voiceMinutes)
          throw new ConvexError(
            "Written feedback has reached this period's processing limit. Your transcript is saved.",
          );
        await limits.limit(
          ctx,
          entitlement.plan === "free"
            ? "globalFreeFeedback"
            : "globalPaidFeedback",
          { throws: true },
        );
        await ctx.db.patch(period._id, {
          feedbackCalls: (period.feedbackCalls ?? 0) + 1,
        });
      }
    } else {
      const o = args.opportunityId
        ? await ctx.db.get(args.opportunityId)
        : null;
      if (!o || o.ownerId !== args.ownerId)
        throw new ConvexError("Preparation not found.");
    }
    const id = await ctx.db.insert("aiRequests", {
      ...args,
      model: AI_MODEL,
      state: "pending",
    });
    return { id, fresh: true };
  },
});

export const finish = internalMutation({
  args: {
    id: v.id("aiRequests"),
    values: schema
      .doc("aiRequests")
      .pick(
        "state",
        "countedInputTokens",
        "inputTokens",
        "cachedInputTokens",
        "cacheWriteTokens",
        "outputTokens",
        "reasoningTokens",
        "responseId",
        "requestId",
        "errorCode",
        "result",
      ),
  },
  returns: v.null(),
  handler: async (ctx, { id, values }) => {
    const row = await ctx.db.get(id);
    if (row?.state === "pending")
      await ctx.db.patch(id, { ...values, finishedAt: Date.now() });
    return null;
  },
});

// Operator-only: no prompts, transcripts, keys, or provider error bodies.
export const recent = internalQuery({
  args: { ownerId: v.id("users") },
  returns: v.array(schema.doc("aiRequests")),
  handler: (ctx, { ownerId }) =>
    ctx.db
      .query("aiRequests")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(100),
});

// Reserve an upper estimate before sending a paid model request. Cache writes
// use the highest input rate at standard context sizes. Unknown outcomes keep
// this reservation; successful responses retain the actual token categories.
export const admitTokens = internalMutation({
  args: { id: v.id("aiRequests"), inputTokens: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, inputTokens }) => {
    const request = await ctx.db.get(id);
    if (!request || request.state !== "pending")
      throw new ConvexError("AI request is no longer pending.");
    if (request.reservedCostMicros !== undefined)
      throw new ConvexError("AI request was already admitted.");
    const policy = AI_POLICY[request.operation];
    if (
      !Number.isSafeInteger(inputTokens) ||
      inputTokens < 0 ||
      inputTokens > policy.input
    )
      throw new ConvexError("Input token budget exceeded.");
    const cost = Math.ceil(inputTokens * 2.5 + policy.output * 12);
    const entitlement = await getEntitlement(ctx, request.ownerId, Date.now());
    if (entitlement.plan === "free") {
      const allowed = await limits.limit(ctx, "globalFreeAiSpend", {
        count: cost,
      });
      if (!allowed.ok)
        throw new ConvexError(
          "Free processing has reached today's shared capacity. Please try again tomorrow.",
        );
    }
    await ctx.db.patch(id, {
      countedInputTokens: inputTokens,
      reservedCostMicros: cost,
    });
    return null;
  },
});
