import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { cleanEnv, available, allocatePorts } from "../scripts/agent/lib.mjs";
import { syncProject } from "../scripts/agent/backend.mjs";

test("fixture subprocesses cannot inherit live deployment selectors or provider credentials", () => {
  const keys = [
    "CONVEX_DEPLOYMENT",
    "CONVEX_DEPLOY_KEY",
    "CONVEX_SELF_HOSTED_URL",
    "VITE_CONVEX_URL",
    "OPENAI_API_KEY",
    "AGENTMAIL_API_KEY",
    "AUTH_PRIVATE_KEY",
    "QA_BASE_URL",
    "QA_CONVEX",
    "AGENT_PROJECT",
  ];
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const key of keys) process.env[key] = "must-not-inherit";
    const env = cleanEnv({
      CONVEX_AGENT_MODE: "anonymous",
      OPENAI_API_KEY: "fixture",
    });
    for (const key of keys)
      assert.equal(env[key], key === "OPENAI_API_KEY" ? "fixture" : undefined);
    assert.equal(env.CONVEX_AGENT_MODE, "anonymous");
  } finally {
    for (const key of keys)
      before[key] === undefined
        ? delete process.env[key]
        : (process.env[key] = before[key]);
  }
});

test("port selection detects another listener instead of reusing it", async () => {
  const [port] = await allocatePorts(1);
  const server = createServer();
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  try {
    assert.equal(await available(port), false);
  } finally {
    await new Promise((r) => server.close(r));
  }
  assert.equal(await available(port), true);
});

test("isolated backend contains real business code and test-only provider boundaries", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "rehearsal-agent-"));
  try {
    syncProject(dir);
    assert.equal(existsSync(resolve(dir, ".env")), false);
    assert.equal(existsSync(resolve(dir, ".env.local")), false);
    assert.match(
      readFileSync(resolve(dir, "convex/openai.ts"), "utf8"),
      /Test-only provider/,
    );
    assert.equal(
      readFileSync(resolve(dir, "convex/voice.ts"), "utf8"),
      readFileSync("convex/voice.ts", "utf8"),
    );
    assert.equal(
      readFileSync(resolve(dir, "convex/auth.ts"), "utf8"),
      readFileSync("convex/auth.ts", "utf8"),
    );
    writeFileSync(resolve(dir, "convex/stale.ts"), "stale");
    mkdirSync(resolve(dir, ".convex"), { recursive: true });
    writeFileSync(resolve(dir, ".convex/state"), "preserve");
    syncProject(dir);
    assert.equal(existsSync(resolve(dir, "convex/stale.ts")), false);
    assert.equal(
      readFileSync(resolve(dir, ".convex/state"), "utf8"),
      "preserve",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
