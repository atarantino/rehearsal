import { describe, it, expect, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import rateLimiter from "@convex-dev/rate-limiter/test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { publicUrl } from "../shared/preparation";
import { verifyAgentMailWebhook } from "@agentmail/convex";
import { Webhook } from "svix";
import { sampleFeedback } from "./fixtures";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
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
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("voice review recovery", () => {
  async function endedSession() {
    const context = await setup();
    const id = await context.a.mutation(internal.sessions.reserve, {
      config,
      requestId: "review",
    });
    await context.a.mutation(api.sessions.append, {
      id,
      fragments: [fragment],
    });
    await context.a.mutation(api.sessions.finalize, {
      id,
      confirmed: true,
      reason: "done",
      seconds: 1,
    });
    const session = await context.a.query(api.sessions.get, { id });
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    return { ...context, id, session };
  }
  function modelResult(value: unknown) {
    return new Response(
      JSON.stringify({
        output: [
          { content: [{ type: "output_text", text: JSON.stringify(value) }] },
        ],
      }),
    );
  }
  it("returns a safe retryable error after two invalid quotes, preserving the transcript for a successful retry", async () => {
    const { a, b, t, id, session } = await endedSession();
    const good = sampleFeedback(session);
    const bad = {
      ...good,
      strengths: [{ ...good.strengths[0], quote: "Invented private claim" }],
    };
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(modelResult(bad)));
    vi.stubGlobal("fetch", fetchMock);
    await expect(b.action(api.voice.review, { id })).rejects.toThrow(
      "Session not found",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(a.action(api.voice.review, { id })).rejects.toMatchObject({
      data: expect.stringContaining("quote that could not be verified"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const failed = await a.query(api.sessions.get, { id });
    expect(failed.fragments).toEqual(session.fragments);
    expect(failed.feedback).toBeUndefined();
    expect(failed.feedbackError).toContain("quote that could not be verified");
    expect(failed.feedbackError).not.toContain("Invented private claim");
    expect((await t.run((ctx) => ctx.db.get(id)))?.feedbackState).toBe(
      "failed",
    );
    const correction = JSON.parse(fetchMock.mock.calls[1][1].body).instructions;
    expect(correction).toContain("strengths[0].quote");
    expect(
      JSON.parse(JSON.parse(fetchMock.mock.calls[1][1].body).input)
        .rejectedFeedback,
    ).toEqual(bad);
    fetchMock.mockImplementation(() => Promise.resolve(modelResult(good)));
    const result = await a.action(api.voice.review, { id });
    expect(result.feedback).toEqual(good);
    expect(result.feedbackError).toBeUndefined();
    expect(result.fragments).toEqual(session.fragments);
    expect((await t.run((ctx) => ctx.db.get(id)))?.feedbackState).toBe("ready");
    await a.action(api.voice.review, { id });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("repairs a bad first response using a second grounded response", async () => {
    const { a, id, session } = await endedSession();
    const good = sampleFeedback(session);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(modelResult({ ...good, improvements: [] }))
      .mockResolvedValueOnce(modelResult(good));
    vi.stubGlobal("fetch", fetchMock);
    expect((await a.action(api.voice.review, { id })).feedback).toEqual(good);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("hides unexpected provider details while retaining an actionable failure state", async () => {
    const { a, id } = await endedSession();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("secret provider body")),
    );
    await expect(a.action(api.voice.review, { id })).rejects.toMatchObject({
      data: "Feedback could not be completed. Your transcript is saved. Retry feedback.",
    });
    expect((await a.query(api.sessions.get, { id })).feedbackError).toBe(
      "Feedback could not be completed. Your transcript is saved. Retry feedback.",
    );
  });
  it("preserves actionable provider errors", async () => {
    const { a, id } = await endedSession();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 429 })),
    );
    await expect(a.action(api.voice.review, { id })).rejects.toMatchObject({
      data: expect.stringContaining("usage limit"),
    });
    expect((await a.query(api.sessions.get, { id })).feedbackError).toContain(
      "usage limit",
    );
  });
});
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
  it("preserves a connection failure when provider cleanup closed the row first", async () => {
    const { a } = await setup();
    const id = await a.mutation(internal.sessions.reserve, {
      config,
      requestId: "lost",
    });
    await a.mutation(internal.sessions.markClosed, {
      id,
      reason: "close_requested",
    });
    const before = await a.query(api.sessions.get, { id });
    const result = await a.mutation(api.sessions.finalize, {
      id,
      confirmed: false,
      reason: "connection_lost",
    });
    expect(result.status).toBe("partial");
    expect(result.closeReason).toBe("connection_lost");
    expect(result.endedAt).toBe(before.endedAt);
    await a.mutation(api.sessions.finalize, {
      id,
      confirmed: true,
      reason: "close_requested",
    });
    expect((await a.query(api.sessions.get, { id })).closeReason).toBe(
      "connection_lost",
    );
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
describe("preparation efficiency", () => {
  const jobSource = {
    url: "https://convex.dev/jobs",
    title: "Job posting",
    text: "Unique job evidence for preparation.",
  };
  const extracted = {
    role: "Engineer",
    company: "Convex",
    interviewDate: null,
    preparation: [],
    jobUrl: jobSource.url,
    jobSource,
  };
  const brief = {
    role: extracted.role,
    company: extracted.company,
    interviewDate: null,
    preparation: [],
    summary: "Prepare engineering examples.",
    focusAreas: [
      {
        topic: "Engineering",
        why: "Relevant to role",
        sourceUrl: jobSource.url,
      },
    ],
    questions: ["Describe a difficult project."],
    uncertainties: [],
  };
  async function prepared() {
    const context = await setup();
    const id = await context.t.run((ctx) =>
      ctx.db.insert("opportunities", {
        ownerId: context.alice,
        requestId: "prep",
        input: jobSource.url,
        kind: "url",
        status: "ready",
        sources: [jobSource],
        brief,
        receivedAt: 1,
      }),
    );
    return { ...context, id };
  }
  it("returns source links and the brief without research bodies, retaining owner isolation", async () => {
    const { a, b, t, id } = await prepared();
    const rows = await a.query(api.preparation.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].brief).toEqual(brief);
    expect(rows[0].sources).toEqual([
      { url: jobSource.url, title: jobSource.title },
    ]);
    expect((await t.query(internal.preparation.load, { id })).sources).toEqual([
      jobSource,
    ]);
    expect(await b.query(api.preparation.list, {})).toEqual([]);
    await expect(t.query(api.preparation.list, {})).rejects.toThrow("Sign in");
  });
  it("sends job evidence once while preserving extracted details and citation validation", async () => {
    const { t, id } = await prepared();
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            { content: [{ type: "output_text", text: JSON.stringify(brief) }] },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await t.action(internal.research.writeBrief, {
        id,
        extracted,
        sources: [jobSource],
      }),
    ).toEqual(brief);
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    const input = JSON.parse(request.input);
    expect(input.extracted).toEqual({
      role: extracted.role,
      company: extracted.company,
      interviewDate: null,
      preparation: [],
      jobUrl: jobSource.url,
    });
    expect(input.sources).toEqual([jobSource]);
    expect(request.input.split(jobSource.text)).toHaveLength(2);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    ...brief,
                    focusAreas: [
                      {
                        ...brief.focusAreas[0],
                        sourceUrl: "https://convex.dev/unknown",
                      },
                    ],
                  }),
                },
              ],
            },
          ],
        }),
      ),
    );
    await expect(
      t.action(internal.research.writeBrief, {
        id,
        extracted,
        sources: [jobSource],
      }),
    ).rejects.toThrow("Unverified citation");
  });
  it("overlaps two scrapes, retains search order and tolerates a blocked page", async () => {
    const { t, id } = await prepared();
    const urls = [
      "https://convex.dev/one",
      "https://convex.dev/two",
      "https://convex.dev/three",
    ];
    vi.spyOn(FirecrawlClient.prototype, "search").mockResolvedValue({
      web: urls.map((url) => ({
        url,
        title: url,
        description: "Company source",
      })),
    });
    const pending = new Map<
      string,
      {
        resolve: (doc: { markdown: string }) => void;
        reject: (error: Error) => void;
      }
    >();
    let active = 0,
      peak = 0;
    const scrape = vi
      .spyOn(FirecrawlClient.prototype, "scrape")
      .mockImplementation(async (_ctx, url) => {
        active++;
        peak = Math.max(peak, active);
        try {
          return await new Promise<{ markdown: string }>((resolve, reject) => {
            pending.set(url, { resolve, reject });
          });
        } finally {
          active--;
        }
      });
    const result = t.action(internal.research.research, { id, extracted });
    await vi.waitFor(() => expect(scrape).toHaveBeenCalledTimes(2));
    expect(active).toBe(2);
    // Finish in reverse order: output must still follow the search results.
    pending.get(urls[1])!.resolve({ markdown: "Second page" });
    pending.get(urls[0])!.resolve({ markdown: "First page" });
    await vi.waitFor(() => expect(scrape).toHaveBeenCalledTimes(3));
    pending.get(urls[2])!.reject(new Error("Blocked"));
    expect((await result).map((s) => s.url)).toEqual([
      jobSource.url,
      urls[0],
      urls[1],
    ]);
    expect(peak).toBe(2);
  });
  it("normalizes and deduplicates supplemental URLs before fetching and skips private hosts", async () => {
    const { t, id } = await prepared();
    vi.spyOn(FirecrawlClient.prototype, "search").mockResolvedValue({
      web: [
        "https://convex.dev/about#one",
        "https://convex.dev/about#two",
        "https://127.0.0.1",
      ].map((url) => ({ url, title: "About", description: "Company source" })),
    });
    const scrape = vi
      .spyOn(FirecrawlClient.prototype, "scrape")
      .mockResolvedValue({ markdown: "About the company" });
    const sources = await t.action(internal.research.research, {
      id,
      extracted,
    });
    expect(scrape).toHaveBeenCalledTimes(1);
    expect(scrape.mock.calls[0][1]).toBe("https://convex.dev/about");
    expect(sources.map((s) => s.url)).toEqual([
      jobSource.url,
      "https://convex.dev/about",
    ]);
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
