// Real Stripe test-mode smoke. Never uses live payment credentials.
// Creates a synthetic dev user/customer, exercises subscriptions, then cancels.
import { spawnSync } from "node:child_process";
import Stripe from "stripe";
const deployment = process.argv
  .find((a) => a.startsWith("--deployment="))
  ?.split("=")[1];
if (deployment !== "quick-starfish-327")
  throw new Error(
    "This smoke only permits the known Rehearsal development deployment.",
  );
function cli(args) {
  const r = spawnSync("npx", ["convex", ...args, "--deployment", deployment], {
    encoding: "utf8",
    maxBuffer: 2e6,
  });
  if (r.status !== 0)
    throw new Error(
      `Convex ${args[0]} ${args[1]} failed: ${r.stderr.replace(/(?:sk|rk|whsec)_[A-Za-z0-9_]+/g, "[redacted]").slice(-500)}`,
    );
  return r.stdout.trim();
}
function env(name) {
  return cli(["env", "get", name]);
}
const key = env("STRIPE_SECRET_KEY");
if (!/^(sk|rk)_test_/.test(key))
  throw new Error("Stripe test credentials required.");
const stripe = new Stripe(key, { apiVersion: "2026-08-26.dahlia" });
let ownerId, subscription, customerId, checkoutId;
function run(name, args = {}, authenticated = true) {
  return JSON.parse(
    cli([
      "run",
      name,
      JSON.stringify(args),
      ...(authenticated
        ? ["--identity", JSON.stringify({ subject: ownerId })]
        : []),
    ]) || "null",
  );
}
function assert(value, message) {
  if (!value) throw new Error(message);
}
async function waitPlan(plan, status) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const state = run("billing:summary", { now: Date.now() });
    if (state.plan === plan && (!status || state.status === status))
      return state;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    `Webhook did not converge to ${plan}/${status ?? "any"} within 45 seconds.`,
  );
}
try {
  ownerId = run(
    "users:createPasskeyUser",
    {
      provider: "passkey",
      providerAccountId: `billing-smoke-${Date.now()}`,
      profile: { username: `billingsmoke${Date.now()}` },
    },
    false,
  );
  const initial = run("billing:summary", { now: Date.now() });
  assert(
    initial.configured && initial.testMode && initial.plan === "free",
    "Expected configured test-mode Free account.",
  );
  const checkout = run("billing:checkout", { plan: "plus" });
  assert(
    new URL(checkout.url).hostname === "checkout.stripe.com",
    "Expected hosted Stripe checkout.",
  );
  const account = JSON.parse(
    cli([
      "run",
      "--inline-query",
      `await ctx.db.query("billingAccounts").withIndex("by_ownerId", q => q.eq("ownerId", ${JSON.stringify(ownerId)})).unique()`,
    ]) || "null",
  );
  const state = { account };
  customerId = state.account.stripeCustomerId;
  checkoutId = state.account.checkoutSessionId;
  const hosted = await stripe.checkout.sessions.retrieve(checkoutId, {
    expand: ["line_items"],
  });
  assert(
    !hosted.livemode &&
      hosted.mode === "subscription" &&
      hosted.line_items.data[0].price.id === env("STRIPE_PLUS_PRICE_ID"),
    "Checkout used wrong mode or price.",
  );
  const again = run("billing:checkout", { plan: "plus" });
  assert(again.url === checkout.url, "Repeated checkout was not reused.");
  await stripe.checkout.sessions.expire(checkoutId);
  checkoutId = undefined;
  console.log(
    "PASS: authenticated hosted test checkout, correct price, duplicate reuse",
  );
  const method = await stripe.paymentMethods.attach("pm_card_visa", {
    customer: customerId,
  });
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: method.id },
  });
  subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: env("STRIPE_PLUS_PRICE_ID") }],
    default_payment_method: method.id,
    metadata: {
      app: "rehearsal",
      deployment: `rehearsal:https://${deployment}.convex.cloud`,
      userId: ownerId,
    },
  });
  assert(
    subscription.status === "active" && !subscription.livemode,
    "Test subscription not active.",
  );
  await waitPlan("plus", "active");
  const usage = run("usage:summary", { now: Date.now() });
  assert(
    usage.voiceMinutesLimit === 60 && usage.preparationsLimit === 15,
    "Plus allowances incorrect.",
  );
  console.log(
    "PASS: real signed Stripe webhook grants Plus and correct usage allowances",
  );
  const portal = run("billing:portal");
  assert(
    new URL(portal.url).hostname === "billing.stripe.com",
    "Expected Stripe portal.",
  );
  const paidCheckout = run("billing:checkout", { plan: "pro" });
  assert(
    new URL(paidCheckout.url).hostname === "billing.stripe.com",
    "Existing subscriber should manage in portal.",
  );
  subscription = await stripe.subscriptions.update(subscription.id, {
    items: [
      { id: subscription.items.data[0].id, price: env("STRIPE_PRO_PRICE_ID") },
    ],
    proration_behavior: "none",
  });
  await waitPlan("pro", "active");
  console.log(
    "PASS: portal creation, duplicate subscription guard, webhook upgrade to Pro",
  );
  await stripe.subscriptions.update(subscription.id, {
    cancel_at_period_end: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 3000));
  run("billing:refresh");
  const ending = run("billing:summary", { now: Date.now() });
  assert(
    ending.plan === "pro" && ending.cancelAtPeriodEnd,
    "Cancellation should retain access until period end.",
  );
  await stripe.subscriptions.cancel(subscription.id);
  subscription = undefined;
  await waitPlan("free", "canceled");
  console.log(
    "PASS: period-end cancellation retains access; terminal cancellation revokes paid access",
  );
  console.log(
    JSON.stringify({
      deployment,
      testMode: true,
      syntheticUser: ownerId,
      customerId,
      liveCharges: 0,
      sentEmails: 0,
    }),
  );
} finally {
  if (subscription)
    await stripe.subscriptions.cancel(subscription.id).catch(() => {});
  if (checkoutId)
    await stripe.checkout.sessions.expire(checkoutId).catch(() => {});
}
