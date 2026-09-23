// Idempotent catalog setup. Reads credentials without printing them.
// node scripts/configure-billing.mjs --deployment=quick-starfish-327 [--live]
// --live must be explicitly requested; default uses Stripe test mode.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Stripe from "stripe";
const live = process.argv.includes("--live");
const deployment = process.argv
  .find((a) => a.startsWith("--deployment="))
  ?.split("=")[1];
if (!deployment || !/^[a-z0-9-]+$/.test(deployment))
  throw new Error("Pass --deployment=<Convex deployment name>.");
const mode = live ? "live" : "test";
let key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  const config = fs.readFileSync(
    path.join(os.homedir(), ".config/stripe/config.toml"),
    "utf8",
  );
  key = config.match(
    new RegExp(`^\\s*${mode}_mode_api_key\\s*=\\s*["']([^"'\\r\\n]+)["']`, "m"),
  )?.[1];
}
if (!key || !new RegExp(`^(sk|rk)_${mode}_`).test(key))
  throw new Error(`A ${mode} Stripe credential is required.`);
const stripe = new Stripe(key, { apiVersion: "2026-08-26.dahlia" });
const account = await stripe.accounts.retrieve();
const metadata = { app: "rehearsal", catalog: "monthly-v2" };
const prices = {},
  products = {};
for (const [plan, amount, minutes, preparations] of [
  ["plus", 1900, 60, 15],
  ["pro", 3900, 150, 40],
]) {
  let product;
  for await (const item of stripe.products.list({ active: true, limit: 100 })) {
    if (
      item.metadata.app === metadata.app &&
      item.metadata.catalog === metadata.catalog &&
      item.metadata.plan === plan
    ) {
      product = item;
      break;
    }
  }
  product ??= await stripe.products.create(
    {
      name: `Rehearsal ${plan === "plus" ? "Plus" : "Pro"}`,
      description: `${minutes} voice minutes and ${preparations} role preparations each billing month. No automatic overages.`,
      metadata: { ...metadata, plan },
    },
    { idempotencyKey: `rehearsal-${plan}-monthly-v2-${mode}` },
  );
  products[plan] = product.id;
  const lookup_key = `rehearsal_${plan}_monthly_v2`;
  const existing = await stripe.prices.list({
    lookup_keys: [lookup_key],
    limit: 1,
  });
  let price = existing.data[0];
  if (
    price &&
    (price.unit_amount !== amount ||
      price.currency !== "usd" ||
      price.product !== product.id ||
      price.recurring?.interval !== "month" ||
      !price.active)
  )
    throw new Error(
      `Existing ${plan} price differs; do not silently replace sold prices.`,
    );
  price ??= await stripe.prices.create(
    {
      product: product.id,
      currency: "usd",
      unit_amount: amount,
      recurring: { interval: "month" },
      nickname: `Rehearsal ${plan === "plus" ? "Plus" : "Pro"} monthly`,
      lookup_key,
      metadata: {
        ...metadata,
        plan,
        voice_minutes: String(minutes),
        preparations: String(preparations),
      },
    },
    { idempotencyKey: lookup_key },
  );
  prices[plan] = price.id;
}
const site = `https://${deployment}.convex.site`;
const portalParams = {
  name: "Rehearsal subscriptions",
  metadata,
  business_profile: { headline: "Manage your Rehearsal plan" },
  default_return_url: `${site}/?billing=return`,
  features: {
    customer_update: { enabled: true, allowed_updates: ["email", "name"] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: {
      enabled: true,
      mode: "at_period_end",
      proration_behavior: "none",
    },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ["price"],
      products: [
        { product: products.plus, prices: [prices.plus] },
        { product: products.pro, prices: [prices.pro] },
      ],
      proration_behavior: "always_invoice",
      schedule_at_period_end: {
        conditions: [{ type: "decreasing_item_amount" }],
      },
    },
  },
};
const portals = await stripe.billingPortal.configurations.list({ limit: 100 });
let portal = portals.data.find(
  (x) =>
    x.metadata?.app === "rehearsal" && x.metadata?.deployment === deployment,
);
portalParams.metadata = { ...metadata, deployment };
portal = portal
  ? await stripe.billingPortal.configurations.update(portal.id, portalParams)
  : await stripe.billingPortal.configurations.create(portalParams, {
      idempotencyKey: `rehearsal-portal-${deployment}-v2`,
    });
const endpointUrl = `${site}/stripe/webhook`;
const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
let webhook = endpoints.data.find((x) => x.url === endpointUrl);
const enabled_events = [
  "checkout.session.completed",
  "customer.created",
  "customer.updated",
  "customer.deleted",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
];
let webhookSecret;
if (!webhook) {
  webhook = await stripe.webhookEndpoints.create(
    {
      url: endpointUrl,
      enabled_events,
      api_version: "2026-08-26.dahlia",
      metadata: { ...metadata, deployment },
    },
    { idempotencyKey: `rehearsal-webhook-${deployment}-v1` },
  );
  webhookSecret = webhook.secret;
} else {
  await stripe.webhookEndpoints.update(webhook.id, {
    enabled_events,
    disabled: false,
  });
}
function env(name, value) {
  const result = spawnSync(
    "npx",
    ["convex", "env", "set", name, "--deployment", deployment],
    { input: value, encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(`Could not set ${name}; value not logged.`);
  console.log(`${name}: configured`);
}
if (!webhookSecret) {
  const current = spawnSync(
    "npx",
    [
      "convex",
      "env",
      "get",
      "STRIPE_WEBHOOK_SECRET",
      "--deployment",
      deployment,
    ],
    { encoding: "utf8" },
  );
  if (current.status !== 0 || !current.stdout.trim())
    throw new Error(
      "Existing webhook signing secret is absent; restore it securely from Stripe before continuing.",
    );
} else env("STRIPE_WEBHOOK_SECRET", webhookSecret);
env("STRIPE_SECRET_KEY", key);
env("STRIPE_PLUS_PRICE_ID", prices.plus);
env("STRIPE_PRO_PRICE_ID", prices.pro);
env("STRIPE_PORTAL_CONFIGURATION_ID", portal.id);
console.log(
  JSON.stringify(
    {
      accountId: account.id,
      mode,
      deployment,
      products,
      prices,
      portalId: portal.id,
      webhookId: webhook.id,
      webhookUrl: endpointUrl,
    },
    null,
    2,
  ),
);
console.log(
  "If using a Stripe CLI key, replace it with a durable scoped deployment key before production; CLI keys expire after 90 days.",
);
