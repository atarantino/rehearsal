import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { PLANS, type Plan } from "../shared/plans";

export class PlanLimitError extends ConvexError<{
  code: "PLAN_LIMIT";
  message: string;
}> {
  constructor(message: string) {
    super({ code: "PLAN_LIMIT", message });
  }
}
export function isPlanLimitError(error: unknown): error is PlanLimitError {
  return (
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data &&
    error.data.code === "PLAN_LIMIT"
  );
}
export function validateNow(now: number) {
  if (!Number.isFinite(now) || now < 0 || now > 8640000000000000)
    throw new ConvexError("Invalid time.");
}
export function planForPrice(priceId?: string): Plan {
  if (priceId && priceId === process.env.STRIPE_PLUS_PRICE_ID) return "plus";
  if (priceId && priceId === process.env.STRIPE_PRO_PRICE_ID) return "pro";
  return "free";
}
export function billingConfigured() {
  return Boolean(
    process.env.SITE_URL &&
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_WEBHOOK_SECRET &&
    process.env.STRIPE_PLUS_PRICE_ID &&
    process.env.STRIPE_PRO_PRICE_ID &&
    process.env.STRIPE_PORTAL_CONFIGURATION_ID,
  );
}
export async function getEntitlement(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<"users">,
  now: number,
) {
  validateNow(now);
  const account = await ctx.db
    .query("billingAccounts")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
    .unique();
  const date = new Date(now);
  let periodStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  let periodEnd = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  let plan: Plan = "free";
  // No paid access from redirects, client claims, stale periods, or failed payment.
  if (
    account &&
    (account.status === "active" || account.status === "trialing") &&
    account.periodStart !== undefined &&
    account.periodEnd !== undefined &&
    account.periodStart <= now &&
    account.periodEnd > now
  ) {
    plan = planForPrice(account.priceId);
    if (plan !== "free") {
      periodStart = account.periodStart;
      periodEnd = account.periodEnd;
    }
  }
  return {
    plan,
    periodStart,
    periodEnd,
    voiceMinutes: PLANS[plan].voiceMinutes,
    preparations: PLANS[plan].preparations,
  };
}
