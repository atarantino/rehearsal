import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import express from "express";
import { createServer } from "vite";
import { createApp } from "../server/app.js";
import { SessionStore } from "../server/store.js";
import { FixtureProvider } from "./fixtures.js";
const dir = await mkdtemp(resolve(tmpdir(), "rehearsal-browser-"));
const port = Number(process.env.E2E_PORT || 4318);
const { app, shutdown } = createApp(
  new SessionStore(dir),
  new FixtureProvider(),
  port,
);
app.use(express.static(resolve(process.env.FIXTURE_DIST || "dist-test")));
// Serve the isolated coaching UI fixture without adding test routes to the app.
const vite = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: "mpa",
});
app.use(vite.middlewares);
const server = app.listen(port, "127.0.0.1");
async function stop() {
  await shutdown();
  await vite.close();
  server.close();
  await rm(dir, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
