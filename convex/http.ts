import { env } from "./_generated/server";
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { agentmail } from "./email";
import { registerRoutes } from "@convex-dev/stripe";

const http = httpRouter();
http.route({
  path: "/agentmail/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (Number(req.headers.get("content-length") ?? 0) > 1000000)
      return new Response("Payload too large", { status: 413 });
    const reader = req.body?.getReader();
    if (!reader) return new Response("Empty body", { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1000000) {
        await reader.cancel();
        return new Response("Payload too large", { status: 413 });
      }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    const bounded = new Request(req.url, {
      method: "POST",
      headers: req.headers,
      body,
    });
    // The component uses runMutation's first two arguments; HTTP actions have no transaction options.
    return agentmail.handleWebhook(
      { runMutation: (ref, ...args) => ctx.runMutation(ref, args[0]) },
      bounded,
    );
  }),
});
registerRoutes(http, components.stripe, {
  webhookPath: "/stripe/webhook",
  apiVersion: "2026-08-26.dahlia",
  onEvent: async (ctx, event) => {
    const live = /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? "");
    if (event.livemode !== live) throw new Error("Stripe event mode mismatch.");
    const object = event.data.object;
    const customer = "customer" in object ? object.customer : undefined;
    const customerId =
      typeof customer === "string"
        ? customer
        : customer && "id" in customer
          ? customer.id
          : event.type.startsWith("customer.") &&
              !event.type.startsWith("customer.subscription.")
            ? "id" in object
              ? object.id
              : undefined
            : undefined;
    if (customerId)
      await ctx.runAction(internal.billing.reconcile, { customerId });
  },
});
registerStaticRoutes(http, components.staticHosting);
export default http;
