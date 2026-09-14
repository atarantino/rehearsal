import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import express from "express";
import { createApp } from "../server/app.js";
import { SessionStore } from "../server/store.js";
import { FixtureProvider } from "./fixtures.js";
const dir = await mkdtemp(resolve(tmpdir(), "rehearsal-browser-"));
const { app, shutdown } = createApp(
  new SessionStore(dir),
  new FixtureProvider(),
  4318,
);
app.use(express.static(resolve("dist")));
const server = app.listen(4318, "127.0.0.1");
async function stop() {
  await shutdown();
  server.close();
  await rm(dir, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
