import { env } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import {
  query,
  action,
  internalQuery,
  internalMutation,
  internalAction,
  type ActionCtx,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { requireUser } from "./users";
import {
  billingConfigured,
  getEntitlement,
  planForPrice,
  validateNow,
} from "./entitlements";
import Stripe from "stripe";
import { limits } from "./limits";

const paidPlan = v.union(v.literal("plus"), v.literal("pro"));
const planV = v.union(v.literal("free"), v.literal("plus"), v.literal("pro"));
const terminal = new Set(["none", "canceled", "incomplete_expired"]);
function stripe() {
  if (!billingConfigured())
    throw new ConvexError("Subscriptions are not configured yet.");
  return new Stripe(env.STRIPE_SECRET_KEY!, {
    apiVersion: "2026-08-26.dahlia",
    maxNetworkRetries: 2,
  });
}
function site() {
  const url = new URL(env.SITE_URL!);
  if (
    url.protocol !== "https:" &&
    url.hostname !== "localhost" &&
    url.hostname !== "127.0.0.1"
  )
    throw new Error("Invalid billing site URL.");
  return url.origin;
}
function namespace() {
  return `rehearsal:${env.CONVEX_CLOUD_URL}`;
}

export const summary = query({
  args: { now: v.number() },
  returns: v.object({
    plan: planV,
    status: v.string(),
    configured: v.boolean(),
    testMode: v.boolean(),
    cancelAtPeriodEnd: v.boolean(),
    periodEnd: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, { now }) => {
    validateNow(now);
    const user = await requireUser(ctx);
    const entitlement = await getEntitlement(ctx, user._id, now);
    const account = await ctx.db
      .query("billingAccounts")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", user._id))
      .unique();
    return {
      plan: entitlement.plan,
      status: account?.status ?? "none",
      configured: billingConfigured(),
      testMode:
        !env.STRIPE_SECRET_KEY?.startsWith("sk_live_") &&
        !env.STRIPE_SECRET_KEY?.startsWith("rk_live_"),
      cancelAtPeriodEnd: account?.cancelAtPeriodEnd ?? false,
      periodEnd: account?.periodEnd ?? null,
    };
  },
});
export const current = internalQuery({
  args: {},
  returns: v.object({
    ownerId: v.id("users"),
    username: v.union(v.string(), v.null()),
    account: v.union(schema.doc("billingAccounts"), v.null()),
  }),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const account = await ctx.db
      .query("billingAccounts")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", user._id))
      .unique();
    return { ownerId: user._id, username: user.username, account };
  },
});
export const linkCustomer = internalMutation({
  args: { ownerId: v.id("users"), customerId: v.string() },
  returns: v.null(),
  handler: async (ctx, { ownerId, customerId }) => {
    if (!(await ctx.db.get(ownerId))) throw new Error("Account missing.");
    const other = await ctx.db
      .query("billingAccounts")
      .withIndex("by_stripeCustomerId", (q) =>
        q.eq("stripeCustomerId", customerId),
      )
      .unique();
    if (other && other.ownerId !== ownerId)
      throw new Error("Customer ownership mismatch.");
    const account = await ctx.db
      .query("billingAccounts")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .unique();
    if (account?.stripeCustomerId && account.stripeCustomerId !== customerId)
      throw new Error("Customer already linked.");
    if (account)
      await ctx.db.patch(account._id, { stripeCustomerId: customerId });
    else
      await ctx.db.insert("billingAccounts", {
        ownerId,
        stripeCustomerId: customerId,
        status: "none",
        cancelAtPeriodEnd: false,
        syncRevision: 0,
      });
    return null;
  },
});
async function customerFor(ctx: ActionCtx): Promise<{
  ownerId: Id<"users">;
  username: string | null;
  account: Doc<"billingAccounts"> | null;
  customerId: string;
}> {
  const state = await ctx.runQuery(internal.billing.current, {});
  if (state.account?.stripeCustomerId)
    return { ...state, customerId: state.account.stripeCustomerId };
  // Namespace idempotency across apps and deployments sharing this Stripe account.
  const customer = await stripe().customers.create(
    {
      name: state.username ?? undefined,
      metadata: {
        userId: state.ownerId,
        app: "rehearsal",
        deployment: namespace(),
      },
    },
    { idempotencyKey: `${namespace()}:customer:${state.ownerId}` },
  );
  await ctx.runMutation(internal.billing.linkCustomer, {
    ownerId: state.ownerId,
    customerId: customer.id,
  });
  await ctx.runMutation(components.stripe.private.handleCustomerCreated, {
    stripeCustomerId: customer.id,
    name: state.username ?? undefined,
    metadata: customer.metadata,
  });
  return { ...state, customerId: customer.id };
}
export const beginSync = internalMutation({
  args: { customerId: v.string() },
  returns: v.union(
    v.object({
      id: v.id("billingAccounts"),
      ownerId: v.id("users"),
      revision: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { customerId }) => {
    const account = await ctx.db
      .query("billingAccounts")
      .withIndex("by_stripeCustomerId", (q) =>
        q.eq("stripeCustomerId", customerId),
      )
      .unique();
    if (!account) return null;
    const revision = account.syncRevision + 1;
    await ctx.db.patch(account._id, { syncRevision: revision });
    return { id: account._id, ownerId: account.ownerId, revision };
  },
});
export const applySync = internalMutation({
  args: {
    id: v.id("billingAccounts"),
    revision: v.number(),
    subscriptionId: v.optional(v.string()),
    priceId: v.optional(v.string()),
    status: v.string(),
    periodStart: v.optional(v.number()),
    periodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.boolean(),
  },
  returns: v.boolean(),
  handler: async (ctx, { id, revision, ...snapshot }) => {
    const account = await ctx.db.get(id);
    if (!account || account.syncRevision !== revision) return false;
    await ctx.db.patch(id, snapshot);
    if (!terminal.has(snapshot.status))
      await ctx.db.patch(id, {
        checkoutToken: undefined,
        checkoutPlan: undefined,
        checkoutSessionId: undefined,
        checkoutUrl: undefined,
        checkoutExpiresAt: undefined,
        checkoutLeaseUntil: undefined,
      });
    return true;
  },
});
export async function reconcileCustomer(
  ctx: ActionCtx,
  customerId: string,
  attempt = 0,
): Promise<void> {
  const claim = await ctx.runMutation(internal.billing.beginSync, {
    customerId,
  });
  if (!claim) return;
  const subscriptions = await stripe().subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  });
  if (subscriptions.has_more)
    throw new Error(
      "Billing history needs reconciliation before accepting more checkouts.",
    );
  const relevant = subscriptions.data.filter(
    (s) =>
      s.metadata.app === "rehearsal" &&
      s.metadata.deployment === namespace() &&
      s.metadata.userId === claim.ownerId,
  );
  const rank = (s: Stripe.Subscription) =>
    s.status === "active"
      ? 0
      : s.status === "trialing"
        ? 1
        : terminal.has(s.status)
          ? 3
          : 2;
  relevant.sort((a, b) => rank(a) - rank(b) || b.created - a.created);
  const sub = relevant[0];
  const item = sub?.items.data[0];
  const applied = await ctx.runMutation(internal.billing.applySync, {
    id: claim.id,
    revision: claim.revision,
    subscriptionId: sub?.id,
    priceId: item?.price.id,
    status: sub?.status ?? "none",
    periodStart: item ? item.current_period_start * 1000 : undefined,
    periodEnd: item ? item.current_period_end * 1000 : undefined,
    cancelAtPeriodEnd: sub?.cancel_at_period_end ?? false,
  });
  if (!applied) {
    if (attempt >= 2)
      throw new Error("Billing changed during refresh. Retry reconciliation.");
    await reconcileCustomer(ctx, customerId, attempt + 1);
  }
}
export const rateLimit = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    await limits.limit(ctx, "billing", {
      key: user._id,
      config: { kind: "token bucket", rate: 10, period: 60000, capacity: 10 },
      throws: true,
    });
    return null;
  },
});
export const refresh = action({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.runMutation(internal.billing.rateLimit, {});
    const { account } = await ctx.runQuery(internal.billing.current, {});
    if (account?.stripeCustomerId)
      await reconcileCustomer(ctx, account.stripeCustomerId);
    return null;
  },
});
export const reconcile = internalAction({
  args: { customerId: v.string() },
  returns: v.null(),
  handler: async (ctx, { customerId }) => {
    await reconcileCustomer(ctx, customerId);
    return null;
  },
});
export const claimCheckout = internalMutation({
  args: { plan: paidPlan },
  returns: v.object({
    token: v.string(),
    url: v.union(v.string(), v.null()),
    sessionId: v.union(v.string(), v.null()),
    plan: paidPlan,
  }),
  handler: async (ctx, { plan }) => {
    const user = await requireUser(ctx);
    const account = await ctx.db
      .query("billingAccounts")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", user._id))
      .unique();
    if (!account?.stripeCustomerId)
      throw new Error("Billing customer missing.");
    if (!terminal.has(account.status))
      throw new ConvexError(
        "Manage your existing subscription before starting another.",
      );
    if (account.checkoutUrl && (account.checkoutExpiresAt ?? 0) > Date.now())
      return {
        token: account.checkoutToken!,
        url: account.checkoutUrl,
        sessionId: account.checkoutSessionId ?? null,
        plan: account.checkoutPlan!,
      };
    if ((account.checkoutLeaseUntil ?? 0) > Date.now())
      throw new ConvexError(
        "Checkout is being prepared. Please try again shortly.",
      );
    // Keep the token after an uncertain failure so Stripe retries cannot duplicate a session.
    const token =
      account.checkoutToken && !account.checkoutSessionId
        ? account.checkoutToken
        : crypto.randomUUID();
    const checkoutPlan =
      account.checkoutToken && !account.checkoutSessionId
        ? (account.checkoutPlan ?? plan)
        : plan;
    await ctx.db.patch(account._id, {
      checkoutToken: token,
      checkoutPlan,
      checkoutLeaseUntil: Date.now() + 60000,
      // Retired sessions must not make an unsaved retry look like a fresh claim.
      checkoutSessionId: undefined,
      checkoutUrl: undefined,
      checkoutExpiresAt: undefined,
    });
    return { token, url: null, sessionId: null, plan: checkoutPlan };
  },
});
export const saveCheckout = internalMutation({
  args: {
    token: v.string(),
    sessionId: v.string(),
    url: v.string(),
    expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const account = await ctx.db
      .query("billingAccounts")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", user._id))
      .unique();
    if (account?.checkoutToken === args.token)
      await ctx.db.patch(account._id, {
        checkoutSessionId: args.sessionId,
        checkoutUrl: args.url,
        checkoutExpiresAt: args.expiresAt,
        checkoutLeaseUntil: undefined,
      });
    return null;
  },
});
async function portalUrl(customerId: string) {
  const session = await stripe().billingPortal.sessions.create({
    customer: customerId,
    configuration: env.STRIPE_PORTAL_CONFIGURATION_ID!,
    return_url: `${site()}/?billing=return`,
  });
  return { url: session.url };
}
export const checkout = action({
  args: { plan: paidPlan },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, { plan }): Promise<{ url: string }> => {
    await ctx.runMutation(internal.billing.rateLimit, {});
    const { customerId, ownerId } = await customerFor(ctx);
    await reconcileCustomer(ctx, customerId);
    const state = await ctx.runQuery(internal.billing.current, {});
    if (state.account && !terminal.has(state.account.status))
      return portalUrl(customerId);
    const claim = await ctx.runMutation(internal.billing.claimCheckout, {
      plan,
    });
    if (claim.url) {
      if (claim.plan !== plan)
        throw new ConvexError(
          "You have an open checkout for another plan. Complete it or wait for it to expire before changing plans.",
        );
      return { url: claim.url };
    }
    if (claim.plan !== plan)
      throw new ConvexError(
        "Please retry your previous plan while its checkout is being recovered.",
      );
    const priceId =
      plan === "plus" ? env.STRIPE_PLUS_PRICE_ID! : env.STRIPE_PRO_PRICE_ID!;
    const session = await stripe().checkout.sessions.create(
      {
        customer: customerId,
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: ownerId,
        metadata: {
          app: "rehearsal",
          userId: ownerId,
          deployment: namespace(),
        },
        subscription_data: {
          metadata: {
            app: "rehearsal",
            userId: ownerId,
            deployment: namespace(),
          },
        },
        success_url: `${site()}/?billing=success`,
        cancel_url: `${site()}/?billing=canceled`,
        allow_promotion_codes: true,
      },
      { idempotencyKey: `${namespace()}:checkout:${ownerId}:${claim.token}` },
    );
    if (!session.url) throw new Error("Stripe returned no checkout URL.");
    await ctx.runMutation(internal.billing.saveCheckout, {
      token: claim.token,
      sessionId: session.id,
      url: session.url,
      expiresAt: session.expires_at * 1000,
    });
    return { url: session.url };
  },
});
export const portal = action({
  args: {},
  returns: v.object({ url: v.string() }),
  handler: async (ctx): Promise<{ url: string }> => {
    await ctx.runMutation(internal.billing.rateLimit, {});
    const { account } = await ctx.runQuery(internal.billing.current, {});
    if (!account?.stripeCustomerId)
      throw new ConvexError("No billing account yet. Choose a plan first.");
    return portalUrl(account.stripeCustomerId);
  },
});
