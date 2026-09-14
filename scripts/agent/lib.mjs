import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const state = resolve(root, ".agent");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function json(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
}
export function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      /^(CONVEX_|VITE_|OPENAI_|FIRECRAWL_|AGENTMAIL_|AUTH_|QA_|E2E_|FIXTURE_|AGENT_PROJECT$|SITE_URL$|PORT$)/.test(
        key,
      )
    )
      delete env[key];
  }
  return { ...env, ...extra };
}
export async function available(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}
export async function allocatePorts(count = 4) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const start = 15000 + Math.floor(Math.random() * 35000);
    const ports = Array.from({ length: count }, (_, i) => start + i);
    if ((await Promise.all(ports.map(available))).every(Boolean)) return ports;
  }
  throw new Error("Could not allocate local ports.");
}
export async function manifest() {
  const path = resolve(state, "worktree.json");
  if (existsSync(path)) {
    const m = JSON.parse(readFileSync(path, "utf8"));
    if (m.root !== root)
      throw new Error(
        "Worktree moved: remove .agent/worktree.json and run agent:setup.",
      );
    return m;
  }
  const [frontend, cloud, site, control] = await allocatePorts();
  const m = {
    version: 1,
    root,
    id: createHash("sha256").update(root).digest("hex").slice(0, 10),
    ports: { frontend, cloud, site, control },
    mode: "convex-fixtures",
  };
  json(path, m);
  return m;
}
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `${command} ${args[0] ?? ""} failed (${signal ?? code}).`,
            ),
          ),
    );
  });
}
export async function waitFor(check, message, timeout = 120000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(300);
  }
  throw new Error(message);
}

export async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  for (let i = 0; i < 30; i++) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await sleep(100);
  }
  child.kill("SIGKILL");
}
