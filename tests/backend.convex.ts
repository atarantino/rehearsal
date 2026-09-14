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

describe("saved resumes", () => {
  async function opportunity(
    t: Awaited<ReturnType<typeof setup>>["t"],
    ownerId: Awaited<ReturnType<typeof setup>>["alice"],
  ) {
    return t.run((ctx) =>
      ctx.db.insert("opportunities", {
        ownerId,
        requestId: "resume-prep",
        input: "https://convex.dev/jobs",
        kind: "url",
        status: "ready",
        sources: [],
        receivedAt: 1,
        brief: {
          company: "Example",
          role: "Designer",
          interviewDate: null,
          preparation: [],
          summary: "Design role",
          focusAreas: [],
          questions: ["Describe a project."],
          uncertainties: [],
        },
      }),
    );
  }
  it("keeps defaults private and validates text without truncation", async () => {
    const { t, a, b } = await setup();
    await expect(t.query(api.resumes.get, {})).rejects.toThrow("Sign in");
    await expect(
      t.mutation(api.resumes.saveDefault, { text: "secret" }),
    ).rejects.toThrow("Sign in");
    await a.mutation(api.resumes.saveDefault, { text: "My experience" });
    expect((await a.query(api.resumes.get, {})).defaultText).toBe(
      "My experience",
    );
    expect((await b.query(api.resumes.get, {})).defaultText).toBe("");
    for (const text of [" ", "x".repeat(15001)])
      await expect(
        a.mutation(api.resumes.saveDefault, { text }),
      ).rejects.toThrow();
    expect((await a.query(api.resumes.get, {})).defaultText).toBe(
      "My experience",
    );
    await a.mutation(api.resumes.saveDefault, { text: null });
    expect((await a.query(api.resumes.get, {})).defaultText).toBe("");
  });
  it("checks ownership on opportunity reads and all selection writes", async () => {
    const { t, a, b, alice } = await setup();
    const id = await opportunity(t, alice);
    await expect(
      b.query(api.resumes.get, { opportunityId: id }),
    ).rejects.toThrow("not found");
    await expect(
      b.mutation(api.resumes.removeOpportunityResume, { opportunityId: id }),
    ).rejects.toThrow("not found");
    await expect(
      t.mutation(api.resumes.removeOpportunityResume, { opportunityId: id }),
    ).rejects.toThrow("Sign in");
    for (const mode of ["default", "none", "custom"] as const)
      await expect(
        b.mutation(api.resumes.saveOpportunity, {
          opportunityId: id,
          mode,
          text: "foreign resume",
        }),
      ).rejects.toThrow("not found");
    await expect(
      a.mutation(api.resumes.saveOpportunity, {
        opportunityId: id,
        mode: "custom",
        text: " ",
      }),
    ).rejects.toThrow("Paste");
  });
  it("resolves the current default at start, ignores client snapshots, and freezes retry context", async () => {
    const { a } = await setup();
    await a.mutation(api.resumes.saveDefault, { text: "Original experience" });
    const id = await a.mutation(internal.sessions.reserve, {
      config: { ...config, resumeText: "forged", background: "Original notes" },
      requestId: "original",
    });
    expect((await a.query(api.sessions.get, { id })).config.resumeText).toBe(
      "Original experience",
    );
    await a.mutation(api.sessions.finalize, {
      id,
      confirmed: true,
      reason: "done",
    });
    await a.mutation(api.resumes.saveDefault, { text: "New experience" });
    const retryId = await a.mutation(internal.sessions.reserve, {
      config: {
        ...config,
        previousId: id,
        relation: "retry",
        resumeText: "changed",
      },
      requestId: "retry-resume",
    });
    const retry = await a.query(api.sessions.get, { id: retryId });
    expect(retry.config.resumeText).toBe("Original experience");
    expect(retry.config.background).toBe("Original notes");
    await a.mutation(api.sessions.finalize, {
      id: retryId,
      confirmed: true,
      reason: "done",
    });
    const nextId = await a.mutation(internal.sessions.reserve, {
      config: { ...config, previousId: retryId, relation: "next" },
      requestId: "next-resume",
    });
    expect(
      (await a.query(api.sessions.get, { id: nextId })).config.resumeText,
    ).toBe("New experience");
  });
  it("uses independent opportunity overrides and explicit none without changing saved sessions", async () => {
    const { t, a, alice } = await setup();
    const one = await opportunity(t, alice);
    const two = await opportunity(t, alice);
    await a.mutation(api.resumes.saveDefault, { text: "General experience" });
    await a.mutation(api.resumes.saveOpportunity, {
      opportunityId: one,
      mode: "custom",
      text: "Specific experience",
    });
    for (const [opportunityId, expected] of [
      [one, "Specific experience"],
      [two, "General experience"],
    ] as const) {
      const id = await a.mutation(internal.sessions.reserve, {
        config: {
          ...config,
          opportunityId,
          resumeText: "forged",
          resumeMode: "none",
        },
        requestId: opportunityId,
      });
      expect((await a.query(api.sessions.get, { id })).config.resumeText).toBe(
        expected,
      );
      await a.mutation(api.sessions.finalize, {
        id,
        confirmed: true,
        reason: "done",
      });
    }
    await a.mutation(api.resumes.saveOpportunity, {
      opportunityId: one,
      mode: "none",
    });
    expect(
      (await a.query(api.resumes.get, { opportunityId: one })).customText,
    ).toBe("Specific experience");
    const id = await a.mutation(internal.sessions.reserve, {
      config: { ...config, opportunityId: one },
      requestId: "none",
    });
    expect((await a.query(api.sessions.get, { id })).config.resumeText).toBe(
      "",
    );
    await a.mutation(api.sessions.finalize, {
      id,
      confirmed: true,
      reason: "done",
    });
    await a.mutation(api.resumes.saveOpportunity, {
      opportunityId: one,
      mode: "default",
    });
    const newId = await a.mutation(internal.sessions.reserve, {
      config: { ...config, opportunityId: one },
      requestId: "default-again",
    });
    expect(
      (await a.query(api.sessions.get, { id: newId })).config.resumeText,
    ).toBe("General experience");
    expect((await a.query(api.sessions.get, { id })).config.resumeText).toBe(
      "",
    );
  });
  it("supports legacy records and practice without a resume", async () => {
    const { a } = await setup();
    expect(await a.query(api.resumes.get, {})).toEqual({
      mode: "default",
      customText: "",
      defaultText: "",
      opportunityLabel: "",
    });
    await a.mutation(api.resumes.saveDefault, { text: "Experience" });
    const id = await a.mutation(internal.sessions.reserve, {
      config: { ...config, resumeMode: "none" },
      requestId: "no-resume",
    });
    expect((await a.query(api.sessions.get, { id })).config.resumeText).toBe(
      "",
    );
  });
  it("preserves custom text through selection changes and deletes it only explicitly", async () => {
    const { t, a, alice } = await setup();
    const one = await opportunity(t, alice);
    const two = await opportunity(t, alice);
    await a.mutation(api.resumes.saveDefault, { text: "Default experience" });
    for (const opportunityId of [one, two])
      await a.mutation(api.resumes.saveOpportunity, {
        opportunityId,
        mode: "custom",
        text: "Tailored experience",
      });
    const sessionId = await a.mutation(internal.sessions.reserve, {
      config: { ...config, opportunityId: one },
      requestId: "snapshot-before-delete",
    });
    await a.mutation(api.sessions.finalize, {
      id: sessionId,
      confirmed: true,
      reason: "done",
    });
    for (const mode of ["default", "none"] as const) {
      await a.mutation(api.resumes.saveOpportunity, {
        opportunityId: one,
        mode,
      });
      const saved = await a.query(api.resumes.get, { opportunityId: one });
      expect(saved.mode).toBe(mode);
      expect(saved.customText).toBe("Tailored experience");
      await a.mutation(api.resumes.saveOpportunity, {
        opportunityId: one,
        mode: "custom",
        text: saved.customText,
      });
    }
    await a.mutation(api.resumes.removeOpportunityResume, {
      opportunityId: one,
    });
    expect(
      await a.query(api.resumes.get, { opportunityId: one }),
    ).toMatchObject({
      mode: "none",
      customText: "",
      defaultText: "Default experience",
    });
    expect(
      (await a.query(api.resumes.get, { opportunityId: two })).customText,
    ).toBe("Tailored experience");
    expect(
      (await a.query(api.sessions.get, { id: sessionId })).config.resumeText,
    ).toBe("Tailored experience");
    const retry = await a.mutation(internal.sessions.reserve, {
      config: { ...config, previousId: sessionId, relation: "retry" },
      requestId: "retry-after-delete",
    });
    expect(
      (await a.query(api.sessions.get, { id: retry })).config.resumeText,
    ).toBe("Tailored experience");
  });
});
