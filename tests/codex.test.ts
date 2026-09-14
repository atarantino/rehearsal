import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import {
  CodexRunner,
  codexArgs,
  codexEnvironment,
  executeCodex,
} from "../server/codex.js";
import { SubscriptionProvider } from "../server/subscription-provider.js";
import { record, sampleFeedback, answer } from "./fixtures.js";
test("subscription subprocess removes API credentials and never permits paid or tool fallbacks", () => {
  const env = codexEnvironment({
    OPENAI_API_KEY: "secret",
    OPENAI_BASE_URL: "override",
    CODEX_API_KEY: "secret2",
    CODEX_HOME: "/auth",
    PATH: "/bin",
  });
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.CODEX_API_KEY, undefined);
  assert.equal(env.OPENAI_BASE_URL, undefined);
  assert.equal(env.CODEX_HOME, "/auth");
  const args = codexArgs("/schema", "/result");
  assert.ok(args.includes('forced_login_method="chatgpt"'));
  assert.ok(args.includes("read-only"));
  assert.ok(args.includes("--ignore-user-config"));
  assert.ok(args.includes("--ephemeral"));
  assert.ok(args.includes("shell_tool"));
  assert.ok(!args.some((a) => a.includes("dangerously")));
});
test("Codex runner uses stdin for untrusted text, parses structured output and removes scratch files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-run-test-"));
  try {
    const binary = join(dir, "fixture.cjs");
    await writeFile(
      binary,
      `#!/usr/bin/env node
const fs=require('fs');if(process.argv.includes('login')){console.log('Logged in using ChatGPT');process.exit(0);}let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{const path=process.argv[process.argv.indexOf('--output-last-message')+1];fs.writeFileSync(path,JSON.stringify({ok:input.includes('$(touch bad)')&&!process.env.OPENAI_API_KEY&&!process.env.CODEX_API_KEY}));});`,
      { mode: 0o700 },
    );
    const runner = new CodexRunner(join(dir, "runs"), binary);
    const result = await runner.run(
      z.object({ ok: z.boolean() }),
      "Return a boolean.",
      { text: "$(touch bad)" },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(await readdir(join(dir, "runs")), []);
    assert.ok(!(await readdir(dir)).includes("bad"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("non-ChatGPT authentication is rejected before execution", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-auth-test-"));
  try {
    const binary = join(dir, "fixture.cjs");
    await writeFile(
      binary,
      "#!/usr/bin/env node\nconsole.log('Logged in using an API key');",
      { mode: 0o700 },
    );
    await assert.rejects(
      () => new CodexRunner(join(dir, "runs"), binary).check(),
      /Sign in to Codex with ChatGPT/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("cancel and timeout terminate Codex requests with no fallback", async () => {
  await assert.rejects(
    () =>
      executeCodex(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
        cwd: tmpdir(),
        timeoutMs: 40,
      }),
    /No API fallback/,
  );
  const controller = new AbortController();
  const promise = executeCodex(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    { cwd: tmpdir(), timeoutMs: 10000, signal: controller.signal },
  );
  controller.abort();
  await assert.rejects(() => promise, /cancelled/);
});
test("subscription provider uses Live client delegation and feedback never calls Responses API", async () => {
  const s = record();
  s.fragments = [
    {
      event_id: "u",
      speaker: "user",
      delta: answer,
      start_ms: 0,
      end_ms: 1000,
    },
  ];
  class FakeRunner extends CodexRunner {
    async check() {}
    async run<T>(schema: z.ZodType<T>) {
      return schema.parse(sampleFeedback(s));
    }
  }
  const provider = new SubscriptionProvider(
    new FakeRunner(tmpdir()),
    "synthetic-api-key",
  );
  let requests = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requests++;
    const body = JSON.parse(String(options?.body));
    assert.equal(body.session.model, "gpt-live-1");
    assert.deepEqual(body.session.delegation, { type: "client" });
    return new Response(
      JSON.stringify({
        session: { id: "live_test" },
        transport: { sdp: "answer" },
      }),
      { status: 201 },
    );
  };
  try {
    await provider.create(s, "offer");
    assert.equal(requests, 1);
    const feedback = await provider.feedback(s);
    assert.equal(feedback.improvements.length, 2);
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = original;
  }
});
