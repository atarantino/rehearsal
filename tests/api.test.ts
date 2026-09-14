import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { SessionStore } from "../server/store.js";
import { FixtureProvider, answer } from "./fixtures.js";
test("complete API flow: origin guards, exclusivity, transcripts, closure, feedback retry, history and deletion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rehearsal-api-"));
  const store = new SessionStore(dir);
  const provider = new FixtureProvider();
  const port = 14327;
  const { app, shutdown } = createApp(store, provider, port);
  const server = app.listen(port, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${port}`;
  const call = (path: string, body?: unknown, method = "POST") =>
    fetch(`${base}/api${path}`, {
      method,
      headers: { Origin: base, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    const cross = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(cross.status, 403);
    provider.available = false;
    assert.equal(
      (
        await call("/sessions", {
          config: { mode: "coached", role: "Designer" },
          sdp: "test",
        })
      ).status,
      503,
    );
    provider.available = true;
    const response = await call("/sessions", {
      config: {
        mode: "coached",
        role: "Designer",
        background: "TEST_FEEDBACK_FAILURE",
      },
      sdp: "test",
    });
    assert.equal(response.status, 201);
    const { record: s } = await response.json();
    assert.equal(
      (
        await call("/sessions", {
          config: { mode: "mock", role: "Designer" },
          sdp: "test",
        })
      ).status,
      409,
    );
    assert.equal((await call(`/sessions/${s.id}/feedback`, {})).status, 409);
    const fragment = {
      event_id: "first",
      speaker: "user",
      delta: answer,
      start_ms: 100,
      end_ms: 900,
    };
    await call(`/sessions/${s.id}/events`, { fragments: [fragment, fragment] });
    const closed = await call(`/sessions/${s.id}/close`, {});
    assert.equal(closed.status, 200);
    const final = await closed.json();
    assert.equal(final.status, "completed");
    assert.equal(final.fragments.length, 1);
    assert.equal(final.seconds, 40);
    assert.equal((await call(`/sessions/${s.id}/feedback`, {})).status, 502);
    assert.ok((await store.get(s.id)).feedbackError);
    const reviewed = await call(`/sessions/${s.id}/feedback`, {});
    assert.equal(reviewed.status, 200);
    assert.ok((await reviewed.json()).feedback);
    assert.equal(provider.creates, 1);
    const retry = await call("/sessions", {
      config: {
        ...s.config,
        previousId: s.id,
        relation: "retry",
        background: "",
      },
      sdp: "test",
    });
    const second = (await retry.json()).record;
    assert.equal(second.question, s.question);
    await call(`/sessions/${second.id}/events`, { fragments: [fragment] });
    await call(`/sessions/${second.id}/close`, {});
    const compared = await (
      await call(`/sessions/${second.id}/feedback`, {})
    ).json();
    assert.ok(compared.feedback.comparison);
    const history = await (await fetch(`${base}/api/sessions`)).json();
    assert.equal(history.length, 2);
    assert.equal(history.filter((v: any) => v.hasFeedback).length, 2);
    await call(`/sessions/${s.id}`, undefined, "DELETE");
    assert.equal((await store.list()).length, 1);
    assert.equal((await fetch(`${base}/api/sessions/${s.id}`)).status, 404);
    assert.equal((await store.get(second.id)).config.previousId, s.id);
  } finally {
    await shutdown();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
