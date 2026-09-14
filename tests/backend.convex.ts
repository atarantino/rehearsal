import { describe, it, expect, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import rateLimiter from "@convex-dev/rate-limiter/test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { publicUrl } from "../shared/preparation";
import { verifyAgentMailWebhook } from "@agentmail/convex";
import { Webhook } from "svix";
const modules = import.meta.glob("../convex/**/*.ts");
async function setup() {
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  const [alice, bob] = await t.run(async (ctx) =>
    Promise.all([
      ctx.db.insert("users", { username: "alice" }),
      ctx.db.insert("users", { username: "bob" }),
    ]),
  );
  return {
    t,
    alice,
    bob,
    a: t.withIdentity({ subject: alice }),
    b: t.withIdentity({ subject: bob }),
  };
}
const config = {
  mode: "coached" as const,
  role: "Designer",
  jobDescription: "",
  background: "",
};
const fragment = {
  event_id: "one",
  speaker: "user" as const,
  delta: "I led the rollout.",
  start_ms: 0,
  end_ms: 1000,
};
afterEach(() => vi.useRealTimers());
describe("private practice", () => {
  it("rejects unauthenticated access", async () => {
    const { t } = await setup();
    await expect(t.query(api.sessions.list, {})).rejects.toThrow("Sign in");
    await expect(
      t.mutation(api.preparation.create, {
        url: "https://convex.dev",
        requestId: "x",
      }),
    ).rejects.toThrow("Sign in");
  });
  it("isolates sessions, transcript writes, feedback and retries between two users", async () => {
    const { a, b } = await setup();
    const id = await a.mutation(internal.sessions.reserve, {
      config,
      requestId: "start",
    });
    for (const operation of [
      () => b.query(api.sessions.get, { id }),
      () => b.mutation(api.sessions.append, { id, fragments: [fragment] }),
      () =>
        b.mutation(api.sessions.finalize, {
          id,
          confirmed: true,
          reason: "done",
        }),
      () => b.mutation(internal.sessions.claimFeedback, { id }),
      () => b.mutation(api.sessions.remove, { id }),
      () =>
        b.mutation(internal.sessions.reserve, {
          config: { ...config, previousId: id, relation: "retry" },
          requestId: "retry",
        }),
    ])
      await expect(operation()).rejects.toThrow("Session not found");
    expect(await b.query(api.sessions.list, {})).toEqual([]);
  });
  it("deduplicates transcript events and freezes them during review", async () => {
    const { a, t } = await setup();
    const id = await a.mutation(internal.sessions.reserve, {
      config,
      requestId: "start",
    });
    await a.mutation(api.sessions.append, {
      id,
      fragments: [fragment, fragment],
    });
    await a.mutation(api.sessions.append, { id, fragments: [fragment] });
    expect((await a.query(api.sessions.get, { id })).fragments).toHaveLength(1);
    await a.mutation(api.sessions.finalize, {
      id,
      confirmed: true,
      reason: "done",
      seconds: 1,
    });
    await a.mutation(internal.sessions.claimFeedback, { id });
    await expect(
      a.mutation(api.sessions.append, {
        id,
        fragments: [{ ...fragment, event_id: "two" }],
      }),
    ).rejects.toThrow("under review");
    await expect(
      a.mutation(internal.sessions.claimFeedback, { id }),
    ).rejects.toThrow("already");
  });
  it("does not trust client usage and rejects invalid durations", async () => {
    const { a } = await setup();
    const id = await a.mutation(internal.sessions.reserve, {
      config,
      requestId: "start",
    });
    await expect(
      a.mutation(api.sessions.finalize, {
        id,
        confirmed: true,
        reason: "done",
        seconds: -10,
      }),
    ).rejects.toThrow("Invalid duration");
    const result = await a.mutation(api.sessions.finalize, {
      id,
      confirmed: true,
      reason: "done",
      seconds: 1,
    });
    expect(result.usageConfirmed).toBe(false);
  });
  it("does not reactivate a session canceled during startup", async () => {
    const { a } = await setup();
    const id = await a.mutation(internal.sessions.reserve, {
      config,
      requestId: "late",
    });
    await a.mutation(internal.sessions.markClosed, { id, reason: "canceled" });
    expect(
      await a.mutation(internal.sessions.activate, {
        id,
        liveId: "synthetic-provider-id",
      }),
    ).toBe(false);
    expect((await a.query(api.sessions.get, { id })).status).toBe("partial");
  });
  it("ignores an obsolete feedback worker", async () => {
    const { a } = await setup();
    const id = await a.mutation(internal.sessions.reserve, {
      config,
      requestId: "review",
    });
    await a.mutation(api.sessions.finalize, {
      id,
      confirmed: true,
      reason: "done",
    });
    const claim = await a.mutation(internal.sessions.claimFeedback, { id });
    await a.mutation(internal.sessions.saveFeedback, {
      id,
      claim: claim! - 1,
      error: "stale worker",
    });
    expect(
      (await a.query(api.sessions.get, { id })).feedbackError,
    ).toBeUndefined();
  });
  it("blocks repeated starts and simultaneous active sessions", async () => {
    const { a } = await setup();
    await a.mutation(internal.sessions.reserve, { config, requestId: "same" });
    await expect(
      a.mutation(internal.sessions.reserve, { config, requestId: "same" }),
    ).rejects.toThrow("already used");
    await expect(
      a.mutation(internal.sessions.reserve, { config, requestId: "different" }),
    ).rejects.toThrow("active interview");
  });
  it("checks ownership of preparation references", async () => {
    const { a, t, bob } = await setup();
    const id = await t.run((ctx) =>
      ctx.db.insert("opportunities", {
        ownerId: bob,
        requestId: "prep",
        input: "https://convex.dev",
        kind: "url",
        status: "ready",
        sources: [],
        receivedAt: 1,
      }),
    );
    await expect(a.query(api.preparation.get, { id })).rejects.toThrow(
      "not found",
    );
    await expect(a.mutation(api.preparation.retry, { id })).rejects.toThrow(
      "not found",
    );
    await expect(
      a.mutation(internal.sessions.reserve, {
        config: { ...config, opportunityId: id },
        requestId: "start",
      }),
    ).rejects.toThrow("ready preparation");
  });
  it("deletes transcripts in scheduled batches", async () => {
    vi.useFakeTimers();
    const { a, t } = await setup();
    const id = await a.mutation(internal.sessions.reserve, {
      config,
      requestId: "start",
    });
    await a.mutation(api.sessions.append, { id, fragments: [fragment] });
    await a.mutation(api.sessions.finalize, {
      id,
      confirmed: true,
      reason: "done",
    });
    await a.mutation(api.sessions.remove, { id });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await t.run((ctx) => ctx.db.query("fragments").take(10))).toEqual(
      [],
    );
  });
});
describe("untrusted inputs", () => {
  it("allows public HTTPS and rejects private hosts, IPs and credentials", () => {
    expect(publicUrl("https://convex.dev/jobs#apply")).toBe(
      "https://convex.dev/jobs",
    );
    for (const url of [
      "http://convex.dev",
      "https://127.0.0.1",
      "https://169.254.169.254/latest",
      "https://0x7f000001",
      "https://[::1]",
      "https://user:pass@convex.dev",
      "https://foo.internal",
      "https://convex.dev:8443",
    ])
      expect(() => publicUrl(url)).toThrow();
  });
  it("verifies signatures and rejects tampering and stale deliveries", () => {
    const secret =
      "whsec_" +
      Buffer.from("a-secret-for-testing-only-12345678").toString("base64");
    const wh = new Webhook(secret);
    const body = JSON.stringify({
      event_type: "message.received",
      event_id: "evt",
      message: {},
    });
    const date = new Date();
    const headers = {
      "svix-id": "evt",
      "svix-timestamp": String(Math.floor(date.getTime() / 1000)),
      "svix-signature": wh.sign("evt", date, body),
    };
    expect(verifyAgentMailWebhook(secret, body, headers)).toBeTruthy();
    expect(() => verifyAgentMailWebhook(secret, body + " ", headers)).toThrow();
    const past = new Date(Date.now() - 900000);
    expect(() =>
      verifyAgentMailWebhook(secret, body, {
        ...headers,
        "svix-timestamp": String(Math.floor(past.getTime() / 1000)),
        "svix-signature": wh.sign("evt", past, body),
      }),
    ).toThrow();
  });
});
