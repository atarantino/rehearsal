import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import { SessionStore } from "./store.js";
import { OpenAIProvider } from "./provider.js";
import { CodexRunner } from "./codex.js";
import { SubscriptionProvider } from "./subscription-provider.js";
import { createApp } from "./app.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: resolve(root, ".env"), override: true, quiet: true });
const port = Number(process.env.PORT || 4317);
const store = new SessionStore(resolve(root, "data"));
await store.recover();
const backend = process.env.REASONING_BACKEND || "codex";
if (!["codex", "api"].includes(backend))
  throw new Error("REASONING_BACKEND must be codex or api.");
const provider =
  backend === "codex"
    ? new SubscriptionProvider(
        new CodexRunner(resolve(root, "data/.codex-runs")),
      )
    : new OpenAIProvider();
const { app, shutdown } = createApp(store, provider, port);
if (process.env.NODE_ENV === "production") {
  app.use(express.static(resolve(root, "dist")));
  app.get("/", (_req, res) => res.sendFile(resolve(root, "dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const server = app.listen(port, "127.0.0.1", () =>
  console.log(`Rehearsal is ready at http://localhost:${port}`),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await shutdown();
  server.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
