/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import Stripe from "stripe";
import rateLimiter from "@convex-dev/rate-limiter/test";
import schema from "../convex/schema";
import stripeSchema from "../node_modules/@convex-dev/stripe/src/component/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const sdk = vi.hoisted(() => ({
  customerCreate: vi.fn(),
  subscriptionList: vi.fn(),
  checkoutCreate: vi.fn(),
  portalCreate: vi.fn(),
}));
vi.mock("stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("stripe")>();
  return {
    ...actual,
    default: class extends actual.default {
      constructor(...args: ConstructorParameters<typeof actual.default>) {
        super(...args);
        this.customers.create = sdk.customerCreate;
        this.subscriptions.list = sdk.subscriptionList;
        this.checkout.sessions.create = sdk.checkoutCreate;
        this.billingPortal.sessions.create = sdk.portalCreate;
      }
    },
  };
});
const modules = import.meta.glob("../convex/**/*.ts");
const stripeModules = import.meta.glob([
  "../node_modules/@convex-dev/stripe/src/component/**/*.ts",
  "!../node_modules/@convex-dev/stripe/src/component/**/*.test.ts",
]);
const now = Date.UTC(2026, 8, 15, 12);
const cloud = "https://billing-tests.convex.cloud";
const namespace = `rehearsal:${cloud}`;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_local_only");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_local_only");
  vi.stubEnv("STRIPE_PLUS_PRICE_ID", "price_plus");
  vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_pro");
  vi.stubEnv("STRIPE_PORTAL_CONFIGURATION_ID", "bpc_rehearsal");
  vi.stubEnv("SITE_URL", "https://rehearsal.example");
  vi.stubEnv("CONVEX_CLOUD_URL", cloud);
  sdk.subscriptionList.mockResolvedValue({ data: [], has_more: false });
  sdk.customerCreate.mockResolvedValue({
    id: "cus_new",
    metadata: { app: "rehearsal" },
  });
  sdk.checkoutCreate.mockResolvedValue({
    id: "cs_new",
    url: "https://checkout.stripe.com/c/pay/cs_new",
    expires_at: now / 1000 + 86400,
  });
  sdk.portalCreate.mockResolvedValue({
    url: "https://billing.stripe.com/p/session/test",
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
async function setup() {
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  t.registerComponent("stripe", stripeSchema, stripeModules);
  const [alice, bob] = await t.run(async (ctx) =>
    Promise.all([
      ctx.db.insert("users", { username: "alice" }),
      ctx.db.insert("users", { username: "bob" }),
    ]),
  );
  return {
    t,
    alice,
    bob,
    a: t.withIdentity({ subject: alice }),
    b: t.withIdentity({ subject: bob }),
  };
}
async function link(
  t: Awaited<ReturnType<typeof setup>>["t"],
  ownerId: Id<"users">,
  customerId = "cus_alice",
) {
  await t.mutation(internal.billing.linkCustomer, { ownerId, customerId });
  return (await t.mutation(internal.billing.beginSync, { customerId }))!;
}
const paidSnapshot = {
  subscriptionId: "sub_plus",
  priceId: "price_plus",
  status: "active",
  periodStart: now - 1000,
  periodEnd: now + 30 * 86400000,
  cancelAtPeriodEnd: false,
};
function subscription(
  ownerId: Id<"users">,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "sub_plus",
    status: "active",
    created: now / 1000,
    cancel_at_period_end: false,
    metadata: { app: "rehearsal", deployment: namespace, userId: ownerId },
    items: {
      data: [
        {
          price: { id: "price_plus" },
          current_period_start: now / 1000 - 1,
          current_period_end: now / 1000 + 86400,
        },
      ],
    },
    ...overrides,
  };
}

describe("billing authorization and entitlements", () => {
  it("requires authentication before all public billing operations", async () => {
    const { t } = await setup();
    await expect(t.query(api.billing.summary, { now })).rejects.toThrow(
      "Sign in",
    );
    await expect(
      t.action(api.billing.checkout, { plan: "plus" }),
    ).rejects.toThrow("Sign in");
    await expect(t.action(api.billing.portal, {})).rejects.toThrow("Sign in");
    await expect(t.action(api.billing.refresh, {})).rejects.toThrow("Sign in");
    expect(sdk.customerCreate).not.toHaveBeenCalled();
    expect(sdk.subscriptionList).not.toHaveBeenCalled();
    expect(sdk.portalCreate).not.toHaveBeenCalled();
  });
  it("binds billing portal sessions to the authenticated account", async () => {
    const { t, a, b, alice, bob } = await setup();
    await link(t, alice, "cus_alice");
    await link(t, bob, "cus_bob");
    await a.action(api.billing.portal, {});
    await b.action(api.billing.portal, {});
    expect(sdk.portalCreate.mock.calls.map(([args]) => args.customer)).toEqual([
      "cus_alice",
      "cus_bob",
    ]);
    expect(sdk.portalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: "bpc_rehearsal",
        return_url: "https://rehearsal.example/?billing=return",
      }),
    );
  });
  it("refuses to bind another user's customer or replace an existing binding", async () => {
    const { t, alice, bob } = await setup();
    await link(t, alice);
    await expect(link(t, bob)).rejects.toThrow("Customer ownership mismatch");
    await expect(link(t, alice, "cus_other")).rejects.toThrow(
      "Customer already linked",
    );
  });
  it.each(["active", "trialing"])(
    "grants allowlisted paid access for %s subscriptions in the current period",
    async (status) => {
      const { t, a, b, alice } = await setup();
      const claim = await link(t, alice);
      await t.mutation(internal.billing.applySync, {
        id: claim.id,
        revision: claim.revision,
        ...paidSnapshot,
        status,
      });
      expect(await a.query(api.billing.summary, { now })).toMatchObject({
        plan: "plus",
        status,
        testMode: true,
      });
      expect(await b.query(api.billing.summary, { now })).toMatchObject({
        plan: "free",
        status: "none",
      });
    },
  );
  it.each([
    "past_due",
    "unpaid",
    "incomplete",
    "canceled",
    "incomplete_expired",
    "paused",
  ])("does not grant paid access from status %s", async (status) => {
    const { t, a, alice } = await setup();
    const claim = await link(t, alice);
    await t.mutation(internal.billing.applySync, {
      id: claim.id,
      revision: claim.revision,
      ...paidSnapshot,
      status,
    });
    expect(await a.query(api.billing.summary, { now })).toMatchObject({
      plan: "free",
    });
  });
  it("requires allowlisted price IDs and a current period, ignoring checkout state", async () => {
    const { t, a, alice } = await setup();
    const claim = await link(t, alice);
    await t.mutation(internal.billing.applySync, {
      id: claim.id,
      revision: claim.revision,
      ...paidSnapshot,
      priceId: "price_another_app",
    });
    expect(await a.query(api.billing.summary, { now })).toMatchObject({
      plan: "free",
    });
    await t.run((ctx) => ctx.db.patch(claim.id, { priceId: "price_plus" }));
    expect(
      await a.query(api.billing.summary, { now: paidSnapshot.periodEnd }),
    ).toMatchObject({ plan: "free" });
    expect(
      await a.query(api.billing.summary, { now: paidSnapshot.periodStart - 1 }),
    ).toMatchObject({ plan: "free" });
    await t.run((ctx) =>
      ctx.db.patch(claim.id, {
        status: "none",
        checkoutUrl: "https://checkout.stripe.com/success",
      }),
    );
    expect(await a.query(api.billing.summary, { now })).toMatchObject({
      plan: "free",
    });
  });
});

describe("billing synchronization and checkout recovery", () => {
  it("ignores an older sync completion after a newer claim", async () => {
    const { t, a, alice } = await setup();
    const first = await link(t, alice);
    const second = (await t.mutation(internal.billing.beginSync, {
      customerId: "cus_alice",
    }))!;
    await t.mutation(internal.billing.applySync, {
      id: second.id,
      revision: second.revision,
      ...paidSnapshot,
      priceId: "price_pro",
    });
    await t.mutation(internal.billing.applySync, {
      id: first.id,
      revision: first.revision,
      ...paidSnapshot,
    });
    expect(await a.query(api.billing.summary, { now })).toMatchObject({
      plan: "pro",
    });
  });
  it("fences concurrent checkout starts and reuses the token after an uncertain failure", async () => {
    const { t, a, alice } = await setup();
    await link(t, alice);
    const results = await Promise.allSettled([
      a.mutation(internal.billing.claimCheckout, { plan: "plus" }),
      a.mutation(internal.billing.claimCheckout, { plan: "plus" }),
    ]);
    const admitted = results.find((result) => result.status === "fulfilled");
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    if (admitted?.status !== "fulfilled") throw new Error("No checkout claim");
    vi.setSystemTime(now + 61000);
    const recovered = await a.mutation(internal.billing.claimCheckout, {
      plan: "plus",
    });
    expect(recovered.token).toBe(admitted.value.token);
  });
  it("preserves a recovery token after an earlier saved checkout expires", async () => {
    const { t, a, alice } = await setup();
    await link(t, alice);
    const old = await a.mutation(internal.billing.claimCheckout, {
      plan: "plus",
    });
    await a.mutation(internal.billing.saveCheckout, {
      token: old.token,
      sessionId: "cs_expired",
      url: "https://checkout.stripe.com/expired",
      expiresAt: now + 1000,
    });
    vi.setSystemTime(now + 2000);
    const fresh = await a.mutation(internal.billing.claimCheckout, {
      plan: "pro",
    });
    expect(fresh.token).not.toBe(old.token);
    vi.setSystemTime(now + 63000);
    const recovered = await a.mutation(internal.billing.claimCheckout, {
      plan: "pro",
    });
    expect(recovered.token).toBe(fresh.token);
    expect(recovered.plan).toBe("pro");
  });
  it("uses a fresh checkout token when resubscribing after cancellation", async () => {
    const { t, a, alice } = await setup();
    const account = await link(t, alice);
    const initial = await a.mutation(internal.billing.claimCheckout, {
      plan: "plus",
    });
    await a.mutation(internal.billing.saveCheckout, {
      token: initial.token,
      sessionId: "cs_completed",
      url: "https://checkout.stripe.com/completed",
      expiresAt: now + 86400000,
    });
    await t.mutation(internal.billing.applySync, {
      id: account.id,
      revision: account.revision,
      ...paidSnapshot,
    });
    const canceled = (await t.mutation(internal.billing.beginSync, {
      customerId: "cus_alice",
    }))!;
    await t.mutation(internal.billing.applySync, {
      id: canceled.id,
      revision: canceled.revision,
      status: "canceled",
      cancelAtPeriodEnd: false,
    });
    const next = await a.mutation(internal.billing.claimCheckout, {
      plan: "plus",
    });
    expect(next.token).not.toBe(initial.token);
  });
  it("creates checkout using server-owned prices and reuses an unexpired checkout", async () => {
    const { a, alice } = await setup();
    const first = await a.action(api.billing.checkout, { plan: "plus" });
    const second = await a.action(api.billing.checkout, { plan: "plus" });
    expect(first).toEqual(second);
    expect(sdk.checkoutCreate).toHaveBeenCalledTimes(1);
    expect(sdk.customerCreate).toHaveBeenCalledTimes(1);
    expect(sdk.checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_new",
        line_items: [{ price: "price_plus", quantity: 1 }],
        client_reference_id: alice,
        subscription_data: {
          metadata: { app: "rehearsal", userId: alice, deployment: namespace },
        },
        success_url: "https://rehearsal.example/?billing=success",
      }),
      {
        idempotencyKey: expect.stringContaining(
          `${namespace}:checkout:${alice}:`,
        ),
      },
    );
    await expect(
      a.action(api.billing.checkout, { plan: "pro" }),
    ).rejects.toThrow("open checkout for another plan");
    expect(sdk.checkoutCreate).toHaveBeenCalledTimes(1);
  });
  it("sends an existing subscriber to their billing portal", async () => {
    const { t, a, alice } = await setup();
    await link(t, alice);
    sdk.subscriptionList.mockResolvedValue({
      data: [subscription(alice)],
      has_more: false,
    });
    expect(await a.action(api.billing.checkout, { plan: "pro" })).toEqual({
      url: "https://billing.stripe.com/p/session/test",
    });
    expect(sdk.checkoutCreate).not.toHaveBeenCalled();
    expect(sdk.portalCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_alice" }),
    );
  });
  it("ignores subscriptions from other applications, deployments, and users", async () => {
    const { t, a, alice, bob } = await setup();
    await link(t, alice);
    sdk.subscriptionList.mockResolvedValue({
      data: [
        subscription(alice, {
          metadata: {
            app: "statsketball",
            deployment: namespace,
            userId: alice,
          },
        }),
        subscription(alice, {
          metadata: {
            app: "rehearsal",
            deployment: "another-deployment",
            userId: alice,
          },
        }),
        subscription(bob),
      ],
      has_more: false,
    });
    await a.action(api.billing.refresh, {});
    expect(await a.query(api.billing.summary, { now })).toMatchObject({
      plan: "free",
      status: "none",
    });
  });
});

describe("Stripe webhook authentication", () => {
  it("rejects unsigned, invalidly signed, and modified payloads", async () => {
    const { t } = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const payload = JSON.stringify({
      id: "evt_test",
      type: "test.event",
      livemode: false,
      data: { object: { id: "test" } },
    });
    expect(
      (await t.fetch("/stripe/webhook", { method: "POST", body: payload }))
        .status,
    ).toBe(400);
    expect(
      (
        await t.fetch("/stripe/webhook", {
          method: "POST",
          body: payload,
          headers: { "stripe-signature": "invalid" },
        })
      ).status,
    ).toBe(400);
    const stripe = new Stripe("sk_test_local_only");
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: "whsec_local_only",
      timestamp: now / 1000,
    });
    expect(
      (
        await t.fetch("/stripe/webhook", {
          method: "POST",
          body: payload + " ",
          headers: { "stripe-signature": signature },
        })
      ).status,
    ).toBe(400);
    expect(sdk.subscriptionList).not.toHaveBeenCalled();
  });
  it("accepts valid signatures and rejects an event from the wrong Stripe mode", async () => {
    const { t } = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stripe = new Stripe("sk_test_local_only");
    for (const livemode of [false, true]) {
      const payload = JSON.stringify({
        id: "evt_test",
        type: "test.event",
        livemode,
        data: { object: { id: "test" } },
      });
      const signature = stripe.webhooks.generateTestHeaderString({
        payload,
        secret: "whsec_local_only",
        timestamp: now / 1000,
      });
      const response = await t.fetch("/stripe/webhook", {
        method: "POST",
        body: payload,
        headers: { "stripe-signature": signature },
      });
      expect(response.status).toBe(livemode ? 500 : 200);
    }
  });
});
