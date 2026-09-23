import { ConvexError, v } from "convex/values";
import { query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getEntitlement, PlanLimitError } from "./entitlements";
import { requireUser } from "./users";
import { limits } from "./limits";
import { maxSeconds } from "../shared/types";

async function findPeriod(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<"users">,
  periodStart: number,
) {
  return ctx.db
    .query("usagePeriods")
    .withIndex("by_ownerId_and_periodStart", (q) =>
      q.eq("ownerId", ownerId).eq("periodStart", periodStart),
    )
    .unique();
}
async function ensurePeriod(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  entitlement: Awaited<ReturnType<typeof getEntitlement>>,
) {
  const existing = await findPeriod(ctx, ownerId, entitlement.periodStart);
  if (existing) return existing;
  const id = await ctx.db.insert("usagePeriods", {
    ownerId,
    periodStart: entitlement.periodStart,
    periodEnd: entitlement.periodEnd,
    voiceMinutesUsed: 0,
    voiceMinutesReserved: 0,
    preparationsUsed: 0,
  });
  return (await ctx.db.get(id))!;
}

export async function consumePreparation(
  ctx: MutationCtx,
  ownerId: Id<"users">,
) {
  const entitlement = await getEntitlement(ctx, ownerId, Date.now());
  const existing = await findPeriod(ctx, ownerId, entitlement.periodStart);
  const used = existing?.preparationsUsed ?? 0;
  // Check before any writes: email intake catches this error to retain a failed
  // preparation without consuming quota or starting external research.
  if (used >= entitlement.preparations)
    throw new PlanLimitError(
      "Your preparation allowance is used up. Upgrade your plan or wait for the next period.",
    );
  const key = `${ownerId}:${entitlement.periodStart}`;
  const changed = existing?.preparationLimit !== entitlement.preparations;
  if (changed) await limits.reset(ctx, "subscriptionPreparations", { key });
  const result = await limits.limit(ctx, "subscriptionPreparations", {
    key,
    config: {
      kind: "fixed window",
      rate: entitlement.preparations,
      period: entitlement.periodEnd - entitlement.periodStart,
      start: entitlement.periodStart,
    },
    // Re-seed the component on plan changes so upgrades retain prior usage.
    count: changed ? used + 1 : 1,
  });
  if (!result.ok)
    throw new PlanLimitError(
      "Your preparation allowance is used up. Upgrade your plan or wait for the next period.",
    );
  const period = existing ?? (await ensurePeriod(ctx, ownerId, entitlement));
  await ctx.db.patch(period._id, {
    preparationsUsed: used + 1,
    preparationLimit: entitlement.preparations,
    periodEnd: entitlement.periodEnd,
  });
}

export async function reserveVoice(ctx: MutationCtx, session: Doc<"sessions">) {
  const entitlement = await getEntitlement(ctx, session.ownerId, Date.now());
  const existing = await findPeriod(
    ctx,
    session.ownerId,
    entitlement.periodStart,
  );
  const minutes = maxSeconds(session.record.config.mode) / 60;
  if (
    (existing?.voiceMinutesUsed ?? 0) +
      (existing?.voiceMinutesReserved ?? 0) +
      minutes >
    entitlement.voiceMinutes
  )
    throw new PlanLimitError(
      `This interview needs ${minutes} available voice minutes. Choose a shorter interview, upgrade, or wait for your next period.`,
    );
  if (entitlement.plan === "free") {
    // A conservative shared daily budget reserves the full session cap. Unlike
    // the account allowance, unused capacity is not refunded into this safety
    // limit, preventing repeated failed/short sessions from increasing exposure.
    const budget = await limits.limit(ctx, "globalFreeVoiceMinutes", {
      count: minutes,
    });
    if (!budget.ok)
      throw new PlanLimitError(
        "Free voice practice has reached today's shared limit. Try again tomorrow or choose a paid plan.",
      );
  }
  const period =
    existing ?? (await ensurePeriod(ctx, session.ownerId, entitlement));
  // Refundable, idempotently settled reservations need a durable ledger rather
  // than a rate limiter's expiring token balance. Convex OCC serializes the
  // shared period read/write with session creation in this same transaction.
  await ctx.db.patch(period._id, {
    voiceMinutesReserved: period.voiceMinutesReserved + minutes,
    periodEnd: entitlement.periodEnd,
  });
  await ctx.db.insert("voiceReservations", {
    ownerId: session.ownerId,
    sessionId: session._id,
    usagePeriodId: period._id,
    minutes,
  });
}

export function trustedSeconds(session: Doc<"sessions">, now: number) {
  const start =
    session.activatedAt ??
    (session.liveId && session.record.status === "active"
      ? Date.parse(session.record.createdAt)
      : undefined);
  if (start === undefined) return 0;
  const end = session.record.endedAt ? Date.parse(session.record.endedAt) : now;
  return Math.max(
    0,
    Math.min(maxSeconds(session.record.config.mode), (end - start) / 1000),
  );
}
export async function settleVoice(
  ctx: MutationCtx,
  session: Doc<"sessions">,
  now: number,
) {
  const seconds = trustedSeconds(session, now);
  const reservation = await ctx.db
    .query("voiceReservations")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
    .unique();
  if (!reservation || reservation.settledAt !== undefined) return seconds;
  const period = await ctx.db.get(reservation.usagePeriodId);
  if (!period) throw new Error("Voice usage period missing.");
  const chargedMinutes = Math.min(reservation.minutes, Math.ceil(seconds / 60));
  await ctx.db.patch(period._id, {
    voiceMinutesReserved: Math.max(
      0,
      period.voiceMinutesReserved - reservation.minutes,
    ),
    voiceMinutesUsed: period.voiceMinutesUsed + chargedMinutes,
  });
  await ctx.db.patch(reservation._id, { settledAt: now, chargedMinutes });
  return seconds;
}

export async function hasFeedbackUsage(
  ctx: QueryCtx | MutationCtx,
  session: Doc<"sessions">,
) {
  const reservation = await ctx.db
    .query("voiceReservations")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
    .unique();
  if (reservation)
    return (
      session.activatedAt !== undefined &&
      reservation.settledAt !== undefined &&
      (reservation.chargedMinutes ?? 0) > 0
    );
  // Existing interviews predate the usage ledger. A provider ID and positive
  // saved duration preserve review access without treating failed startup as a
  // connected interview. New sessions always have a reservation.
  return (
    !!session.liveId &&
    !!session.record.endedAt &&
    session.record.seconds > 0 &&
    session.record.closeReason !== "startup_failed"
  );
}

export const summary = query({
  args: { now: v.number() },
  returns: v.object({
    voiceMinutesUsed: v.number(),
    voiceMinutesReserved: v.number(),
    voiceMinutesLimit: v.number(),
    preparationsUsed: v.number(),
    preparationsLimit: v.number(),
    periodEnd: v.number(),
  }),
  handler: async (ctx, { now }) => {
    if (!Number.isFinite(now) || now < 0 || now > 8640000000000000)
      throw new ConvexError("Invalid time.");
    const user = await requireUser(ctx);
    const entitlement = await getEntitlement(ctx, user._id, now);
    const period = await findPeriod(ctx, user._id, entitlement.periodStart);
    return {
      voiceMinutesUsed: period?.voiceMinutesUsed ?? 0,
      voiceMinutesReserved: period?.voiceMinutesReserved ?? 0,
      voiceMinutesLimit: entitlement.voiceMinutes,
      preparationsUsed: period?.preparationsUsed ?? 0,
      preparationsLimit: entitlement.preparations,
      periodEnd: entitlement.periodEnd,
    };
  },
});
