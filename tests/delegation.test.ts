import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { SessionStore } from "../server/store.js";
import { FixtureProvider, answer } from "./fixtures.js";
import type { PracticeSession } from "../shared/types.js";
import type { WireEvent } from "../server/provider.js";
test("live Codex delegation deduplicates requests, uses saved context, and cancels work at close", async () => {
  class DelegationProvider extends FixtureProvider {
    readonly reasoningBackend = "codex" as const;
    sent: WireEvent[] = [];
    calls: PracticeSession[] = [];
    signals: AbortSignal[] = [];
    finish?: (s: string) => void;
    attach(id: string, handler: (e: WireEvent) => void) {
      const base = super.attach(id, handler);
      return {
        ...base,
        send: (e: WireEvent) => {
          this.sent.push(e);
          base.send(e);
        },
      };
    }
    async followup(s: PracticeSession, signal: AbortSignal) {
      this.calls.push(s);
      this.signals.push(signal);
      return new Promise<string>((resolve) => {
        this.finish = resolve;
      });
    }
  }
  const dir = await mkdtemp(join(tmpdir(), "codex-delegation-test-"));
  const provider = new DelegationProvider();
  const store = new SessionStore(dir);
  const port = 14328;
  const { app, shutdown } = createApp(store, provider, port);
  const server = app.listen(port, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${port}`;
  const post = (path: string, body: unknown) =>
    fetch(`${base}/api${path}`, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const until = async (predicate: () => boolean) => {
    for (let i = 0; i < 100 && !predicate(); i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.ok(predicate());
  };
  try {
    const created = await (
      await post("/sessions", {
        config: { mode: "coached", role: "Designer" },
        sdp: "offer",
      })
    ).json();
    const s = created.record;
    const emit = provider.controls.get(s.liveId)!;
    emit({
      type: "session.input_transcript.delta",
      event_id: "u",
      delta: answer,
      start_ms: 0,
      end_ms: 1000,
    });
    const event = {
      type: "session.delegation.created",
      delegation: { id: "d1", target: "client" },
    };
    emit(event);
    emit(event);
    await until(() => provider.calls.length === 1);
    assert.equal(provider.calls[0].fragments[0].delta, answer);
    provider.finish!("What changed because of your decision?");
    await until(() => provider.sent.some((e) => e.delegation_id === "d1"));
    assert.equal(
      provider.sent.filter((e) => e.delegation_id === "d1").length,
      1,
    );
    emit({
      type: "session.delegation.created",
      delegation: { id: "d2", target: "client" },
    });
    await until(() => provider.calls.length === 2);
    await post(`/sessions/${s.id}/close`, {});
    assert.equal(provider.signals[1].aborted, true);
    provider.finish!("This must not reach a closed session.");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(
      provider.sent.filter((e) => e.delegation_id === "d2").length,
      0,
    );
    assert.equal((await store.get(s.id)).reasoningBackend, "codex");
  } finally {
    await shutdown();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
