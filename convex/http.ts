import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { components } from "./_generated/api";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { agentmail } from "./email";
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
registerStaticRoutes(http, components.staticHosting);
export default http;
