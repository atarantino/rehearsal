import { describe, it, expect, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import { workflow } from "../convex/workflows";
import rateLimiter from "@convex-dev/rate-limiter/test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
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
  async function endedSession(mode: "coached" | "mock" = "coached") {
    const context = await setup();
    const id = await context.a.mutation(internal.sessions.reserve, {
      config: { ...config, mode },
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
  it("stores Q&A reflection separately and retries a response that quotes it as behavioral evidence", async () => {
    const { a, b, id } = await endedSession("mock");
    const qa = [
      {
        ...fragment,
        event_id: "handoff",
        speaker: "assistant" as const,
        delta: "What questions do you have for me?",
        start_ms: 2000,
        end_ms: 3000,
      },
      {
        ...fragment,
        event_id: "question",
        delta: "How is onboarding organized?",
        start_ms: 4000,
        end_ms: 5000,
      },
    ];
    await a.mutation(api.sessions.append, { id, fragments: qa });
    const current = await a.query(api.sessions.get, { id });
    const good = sampleFeedback(current);
    const bad = {
      ...good,
      strengths: [{ ...good.strengths[0], quote: qa[1].delta }],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(modelResult(bad))
      .mockResolvedValueOnce(modelResult(good));
    vi.stubGlobal("fetch", fetchMock);
    const reviewed = await a.action(api.voice.review, { id });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reviewed.feedback?.candidateQuestionsFeedback?.quote).toBe(
      qa[1].delta,
    );
    expect(reviewed.feedback?.strengths[0].quote).toBe(fragment.delta);
    const input = JSON.parse(JSON.parse(fetchMock.mock.calls[0][1].body).input);
    expect(input.transcript).toEqual([
      { speaker: "user", text: fragment.delta },
    ]);
    expect(input.candidateQuestionsTranscript).toHaveLength(2);
    await expect(b.query(api.sessions.get, { id })).rejects.toThrow(
      "Session not found",
    );
  });
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
  it("selects the next saved brief question server-side and preserves it on retry", async () => {
    const { a, b, t, id } = await prepared();
    const preparedQuestions = [
      "Describe a migration.",
      "How did you test the rollout?",
    ];
    await t.mutation(internal.preparation.update, {
      id,
      status: "ready",
      brief: { ...brief, questions: preparedQuestions },
    });
    const first = await a.mutation(internal.sessions.reserve, {
      config: { ...config, opportunityId: id },
      requestId: "next-first",
    });
    await a.mutation(api.sessions.finalize, {
      id: first,
      confirmed: true,
      reason: "done",
    });
    const nextConfig = {
      ...config,
      opportunityId: id,
      previousId: first,
      relation: "next" as const,
    };
    await expect(
      b.mutation(internal.sessions.reserve, {
        config: nextConfig,
        requestId: "wrong-owner-next",
      }),
    ).rejects.toThrow("Session not found");
    const next = await a.mutation(internal.sessions.reserve, {
      config: nextConfig,
      requestId: "next-second",
    });
    const session = await a.query(api.sessions.get, { id: next });
    expect(session.question).toBe(preparedQuestions[1]);
    expect(session.config.startingQuestion).toBe(preparedQuestions[1]);
    await a.mutation(api.sessions.finalize, {
      id: next,
      confirmed: true,
      reason: "done",
    });
    const retry = await a.mutation(internal.sessions.reserve, {
      config: { ...config, previousId: next, relation: "retry" },
      requestId: "next-retry",
    });
    expect((await a.query(api.sessions.get, { id: retry })).question).toBe(
      preparedQuestions[1],
    );
  });
  it("carries a Firecrawl-grounded brief intact into both mock voice contexts and freezes it for retries", async () => {
    const { a, b, t, id } = await prepared();
    const longBrief = {
      ...brief,
      preparation: Array.from(
        { length: 5 },
        (_, i) => `${i}: ${"Prepare an ownership example. ".repeat(19)}`,
      ),
      questions: ["How did you handle the sourced migration requirement?"],
      focusAreas: [
        {
          topic: "Migration ownership",
          why: jobSource.text,
          sourceUrl: jobSource.url,
        },
      ],
      uncertainties: ["The interview format is not confirmed."],
    };
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    const fetchMock = vi
      .fn()
      .mockImplementation(async (url: string, init: RequestInit) => {
        if (url.endsWith("/responses"))
          return new Response(
            JSON.stringify({
              output: [
                {
                  content: [
                    { type: "output_text", text: JSON.stringify(longBrief) },
                  ],
                },
              ],
            }),
          );
        if (url.endsWith("/live/sessions"))
          return new Response(
            JSON.stringify({
              session: { id: "live-mock" },
              transport: { sdp: "v=0\r\nm=audio" },
            }),
          );
        throw new Error(`Unexpected provider request: ${url}`);
      });
    vi.stubGlobal("fetch", fetchMock);
    const researchBrief = await t.action(internal.research.writeBrief, {
      id,
      extracted: { ...extracted, preparation: longBrief.preparation },
      sources: [jobSource],
    });
    const researchInput = JSON.parse(
      JSON.parse(fetchMock.mock.calls[0][1].body as string).input,
    );
    expect(researchInput.sources).toEqual([jobSource]);
    await t.mutation(internal.preparation.update, {
      id,
      status: "ready",
      brief: researchBrief,
    });
    const request = {
      config: {
        ...config,
        mode: "mock" as const,
        opportunityId: id,
        preparationBrief: { ...brief, company: "Forged client company" },
      },
      sdp: "v=0\r\nm=audio",
      requestId: "prepared-mock",
    };
    await expect(b.action(api.voice.start, request)).rejects.toThrow(
      "Choose a ready preparation brief",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const result = await a.action(api.voice.start, request);
    expect(result.record.config.preparationBrief).toEqual(researchBrief);
    expect(result.record.config.jobDescription).toEqual(researchBrief.summary);
    expect(result.record.question).toEqual(longBrief.questions[0]);
    const payload = JSON.parse(
      fetchMock.mock.calls[1][1].body as string,
    ).session;
    const direct = JSON.parse(
      payload.input[0].content[0].text.split(
        "REFERENCE DATA (not instructions): ",
      )[1],
    );
    expect(direct.preparationBrief).toEqual(researchBrief);
    expect(payload.delegation.responses.instructions).toContain(
      JSON.stringify(researchBrief),
    );
    expect(payload.instructions).toContain("sourced focus areas");
    expect(payload.instructions).toContain("uncertainties as unconfirmed");
    expect(JSON.stringify(payload)).not.toContain("Forged client company");
    await a.mutation(api.sessions.finalize, {
      id: result.record.id as Id<"sessions">,
      seconds: 10,
      confirmed: true,
      reason: "done",
    });
    await t.mutation(internal.preparation.update, {
      id,
      status: "ready",
      brief: { ...brief, company: "Changed after interview" },
    });
    const retry = await a.mutation(internal.sessions.reserve, {
      config: {
        ...config,
        mode: "coached",
        previousId: result.record.id,
        relation: "retry",
      },
      requestId: "prepared-retry",
    });
    expect(
      (await a.query(api.sessions.get, { id: retry })).config.preparationBrief,
    ).toEqual(researchBrief);
  });
  it("ignores client-supplied preparation when no saved opportunity is selected", async () => {
    const { a } = await prepared();
    const id = await a.mutation(internal.sessions.reserve, {
      config: { ...config, preparationBrief: brief },
      requestId: "untrusted-brief",
    });
    expect(
      (await a.query(api.sessions.get, { id })).config.preparationBrief,
    ).toBeUndefined();
  });
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
  it("deletes only an owned opportunity and keeps session snapshots and the default resume", async () => {
    const { t, a, b, id } = await prepared();
    await a.mutation(api.resumes.saveDefault, { text: "Default experience" });
    await a.mutation(api.resumes.saveOpportunity, {
      opportunityId: id,
      mode: "custom",
      text: "Tailored experience",
    });
    const sessionId = await a.mutation(internal.sessions.reserve, {
      config: { ...config, opportunityId: id },
      requestId: "before-removal",
    });
    await expect(b.mutation(api.preparation.remove, { id })).rejects.toThrow(
      "not found",
    );
    await expect(t.mutation(api.preparation.remove, { id })).rejects.toThrow(
      "Sign in",
    );
    await a.mutation(api.preparation.remove, { id });
    expect(await a.query(api.preparation.get, { id })).toBeNull();
    expect(await a.query(api.preparation.list, {})).toEqual([]);
    expect((await a.query(api.resumes.get, {})).defaultText).toBe(
      "Default experience",
    );
    expect(await a.query(api.resumes.get, { opportunityId: id })).toMatchObject(
      { mode: "none", customText: "" },
    );
    expect(
      (await a.query(api.sessions.get, { id: sessionId })).config,
    ).toMatchObject({
      preparationBrief: brief,
      resumeText: "Tailored experience",
    });
    await a.mutation(api.preparation.remove, { id });
    await t.mutation(internal.preparation.update, {
      id,
      status: "ready",
      brief,
    });
    expect(await a.query(api.preparation.get, { id })).toBeNull();
  });
  it("cancels a running preparation before deleting its opportunity", async () => {
    const { t, a, id } = await prepared();
    await t.run((ctx) =>
      ctx.db.patch(id, {
        status: "researching",
        workflowId: "running-workflow",
      }),
    );
    const cancel = vi.spyOn(workflow, "cancel").mockResolvedValue(undefined);
    await a.mutation(api.preparation.remove, { id });
    expect(cancel).toHaveBeenCalledWith(expect.anything(), "running-workflow");
    expect(await a.query(api.preparation.get, { id })).toBeNull();
  });
  it("removes an owned prep material, invalidates derived brief content, and preserves other materials", async () => {
    const { t, a, b, id } = await prepared();
    const attachment = {
      id: "guide/1",
      filename: "guide.pdf",
      contentType: "application/pdf",
      size: 12,
      status: "imported" as const,
      text: "Private guide text",
    };
    const other = { ...attachment, id: "other", filename: "other.pdf" };
    await t.run((ctx) =>
      ctx.db.patch(id, {
        attachments: [attachment, other],
        sources: [
          jobSource,
          {
            url: "#attachment-guide%2F1",
            title: attachment.filename,
            text: attachment.text,
          },
        ],
        resumeText: "Saved resume",
        resumeMode: "custom",
      }),
    );
    for (const caller of [b, t]) {
      await expect(
        caller.mutation(api.preparation.removeAttachment, {
          id,
          attachmentId: attachment.id,
        }),
      ).rejects.toThrow();
    }
    await t.run((ctx) => ctx.db.patch(id, { status: "writing" }));
    await expect(
      a.mutation(api.preparation.removeAttachment, {
        id,
        attachmentId: attachment.id,
      }),
    ).rejects.toThrow("Wait for preparation");
    await t.run((ctx) => ctx.db.patch(id, { status: "ready" }));
    await a.mutation(api.preparation.removeAttachment, {
      id,
      attachmentId: attachment.id,
    });
    const changed = await a.query(api.preparation.get, { id });
    expect(changed).toMatchObject({
      attachments: [other],
      sources: [jobSource],
      status: "failed",
      resumeText: "Saved resume",
    });
    expect(changed?.brief).toBeUndefined();
    await expect(
      a.mutation(internal.sessions.reserve, {
        config: { ...config, opportunityId: id },
        requestId: "stale-material",
      }),
    ).rejects.toThrow("ready preparation");
    await a.mutation(api.preparation.removeAttachment, {
      id,
      attachmentId: attachment.id,
    });
    expect((await a.query(api.preparation.get, { id }))?.attachments).toEqual([
      other,
    ]);
  });
  it("keeps the researched job title and employer instead of the email extraction in opportunity labels", async () => {
    const { t, a, id } = await prepared();
    await t.run((ctx) =>
      ctx.db.patch(id, {
        kind: "email",
        input:
          "Fwd: Interview invitation — Engineering team at Recruiting Agency",
      }),
    );
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    const researched = {
      ...brief,
      role: "Senior Software Engineer",
      company: "Convex",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  { type: "output_text", text: JSON.stringify(researched) },
                ],
              },
            ],
          }),
        ),
      ),
    );
    const result = await t.action(internal.research.writeBrief, {
      id,
      extracted: {
        ...extracted,
        role: "Fwd: Interview invitation — Engineering team",
        company: "Recruiting Agency",
        interviewDate: "October 1, 10:00 PT",
        preparation: ["Prepare a project walkthrough."],
      },
      sources: [
        { ...jobSource, text: "Convex is hiring a Senior Software Engineer." },
      ],
    });
    expect(result).toMatchObject({
      role: "Senior Software Engineer",
      company: "Convex",
      interviewDate: "October 1, 10:00 PT",
      preparation: ["Prepare a project walkthrough."],
    });
    await t.mutation(internal.preparation.update, {
      id,
      status: "ready",
      brief: result,
    });
    expect((await a.query(api.preparation.list, {}))[0].brief).toEqual(result);
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
    expect(
      request.text.format.schema.properties.focusAreas.items.properties
        .sourceUrl,
    ).toEqual({ type: "string", enum: [jobSource.url] });
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
    ).rejects.toThrow(/Invalid (input|option)/);
  });
  it("constrains mixed PDF and public citations at generation time and preserves exact attachment anchors", async () => {
    const { t, id } = await prepared();
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    const attachmentSource = {
      url: "#attachment-guide%2Ftechnical%3D",
      title: "Technical prep.pdf",
      text: "Prepare a system design tradeoff example.",
    };
    const output = {
      ...brief,
      focusAreas: [
        {
          topic: "Tradeoffs",
          why: attachmentSource.text,
          sourceUrl: attachmentSource.url,
        },
      ],
    };
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  { type: "output_text", text: JSON.stringify(output) },
                ],
              },
            ],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await t.action(internal.research.writeBrief, {
      id,
      extracted,
      sources: [attachmentSource, jobSource, jobSource],
    });
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(
      request.text.format.schema.properties.focusAreas.items.properties
        .sourceUrl.enum,
    ).toEqual([attachmentSource.url, jobSource.url]);
    expect(result.focusAreas[0].sourceUrl).toBe(attachmentSource.url);
    await expect(
      t.action(internal.research.writeBrief, { id, extracted, sources: [] }),
    ).rejects.toThrow("No verified sources");
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

describe("email prep attachments", () => {
  async function emailPrep() {
    const context = await setup();
    const id = await context.t.run((ctx) =>
      ctx.db.insert("opportunities", {
        ownerId: context.alice,
        requestId: "attachments",
        kind: "email",
        input: "Please prepare from the attached guide.",
        status: "reading",
        sources: [],
        receivedAt: 1,
        inboxId: "private@agentmail.to",
        messageId: "<message/1>",
        attachments: [
          {
            id: "guide/1",
            filename: "study.txt",
            contentType: "text/plain",
            size: 100,
            status: "pending",
          },
          {
            id: "logo",
            filename: "logo.png",
            contentType: "image/png",
            size: 10,
            status: "pending",
          },
          {
            id: "broken",
            filename: "broken.pdf",
            contentType: "application/pdf",
            size: 20,
            status: "pending",
          },
        ],
      }),
    );
    return { ...context, id };
  }
  it("imports via provider-issued URLs, isolates failures, hides raw text in lists and retains imports on retry", async () => {
    const { t, a, b, id } = await emailPrep();
    vi.stubEnv("AGENTMAIL_API_KEY", "test-only");
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(url);
        if (url.startsWith("https://api.agentmail.to/")) {
          expect(init.headers).toEqual({ Authorization: "Bearer test-only" });
          return new Response(
            JSON.stringify({
              download_url: url.endsWith("broken")
                ? "https://files.agentmail.to/broken"
                : "https://files.agentmail.to/guide",
            }),
          );
        }
        expect(init.headers).toBeUndefined();
        return new Response(
          url.endsWith("broken")
            ? "not a PDF"
            : "Study guide: prepare a story about conflict resolution and customer tradeoffs.",
        );
      }),
    );
    await t.action(internal.attachments.importEmail, { id });
    const o = await a.query(api.preparation.get, { id });
    expect(o?.attachments?.map((x) => x.status)).toEqual([
      "imported",
      "skipped",
      "failed",
    ]);
    expect(o?.attachments?.[0].text).toContain("conflict resolution");
    expect(calls[0]).toContain("%3Cmessage%2F1%3E/attachments/guide%2F1");
    expect(calls.some((x) => x.endsWith("logo"))).toBe(false);
    expect(
      (await a.query(api.preparation.list, {}))[0].attachments?.[0],
    ).not.toHaveProperty("text");
    await expect(b.query(api.preparation.get, { id })).rejects.toThrow(
      "Preparation not found",
    );
    calls.length = 0;
    await t.action(internal.attachments.importEmail, { id });
    expect(calls.every((x) => x.endsWith("broken"))).toBe(true);
  });
  it("uses attachment-only sources in extraction and the brief that becomes voice context", async () => {
    const { t, a, id } = await emailPrep();
    const text =
      "Prepare an example of resolving conflict during a product launch.";
    await t.mutation(internal.preparation.update, {
      id,
      status: "reading",
      attachments: [
        {
          id: "guide",
          filename: "study.txt",
          contentType: "text/plain",
          size: 90,
          status: "imported",
          text,
        },
      ],
    });
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    const extracted = {
      role: "Product designer",
      company: "",
      interviewDate: null,
      preparation: [text],
      jobUrl: null,
    };
    const brief = {
      ...extracted,
      summary: text,
      focusAreas: [
        { topic: "Conflict", why: text, sourceUrl: "#attachment-guide" },
      ],
      questions: ["Tell me about conflict during a launch."],
      uncertainties: ["Company is unconfirmed."],
    };
    const inputs: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        inputs.push(JSON.parse(body.input));
        return new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify(
                      inputs.length === 1 ? extracted : brief,
                    ),
                  },
                ],
              },
            ],
          }),
        );
      }),
    );
    const details = await t.action(internal.research.extract, { id });
    expect(inputs[0].attachments).toEqual([{ filename: "study.txt", text }]);
    const sources = await t.action(internal.research.research, {
      id,
      extracted: details,
    });
    expect(sources).toEqual([
      { url: "#attachment-guide", title: "study.txt", text },
    ]);
    const result = await t.action(internal.research.writeBrief, {
      id,
      extracted: details,
      sources,
    });
    expect(inputs[1].sources).toEqual(sources);
    await t.mutation(internal.preparation.update, {
      id,
      status: "ready",
      brief: result,
      sources,
    });
    const session = await a.mutation(internal.sessions.reserve, {
      config: { ...config, mode: "mock", opportunityId: id },
      requestId: "attachment-voice",
    });
    expect(
      (await a.query(api.sessions.get, { id: session })).config.preparationBrief
        ?.preparation,
    ).toEqual([text]);
  });
});

describe("attachment email intake", () => {
  it("accepts attachment-only messages, bounds metadata and deduplicates webhook redelivery", async () => {
    const { t, alice, a } = await setup();
    vi.spyOn(workflow, "start").mockResolvedValue("workflow-test" as never);
    await t.mutation(internal.email.save, {
      ownerId: alice,
      inboxId: "inbox@agentmail.to",
      autoReply: false,
    });
    const message = {
      inbox_id: "inbox@agentmail.to",
      message_id: "message-one",
      subject: "Study guides",
      attachments: Array.from({ length: 12 }, (_, i) => ({
        attachment_id: `file-${i}`,
        filename: `guide-${i}.txt`,
        size: 50,
        content_type: "text/plain",
      })),
    };
    for (const eventId of ["event-one", "event-one", "event-two"])
      await t.mutation(internal.email.received, {
        message,
        thread: {},
        eventId,
      });
    const rows = await a.query(api.preparation.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].attachments).toHaveLength(10);
    expect(rows[0].omittedAttachmentCount).toBe(2);
    expect(rows[0].input).not.toContain("undefined");
    expect(workflow.start).toHaveBeenCalledTimes(1);
    await t.mutation(internal.email.received, {
      message: { ...message, message_id: "spam", labels: ["spam"] },
      thread: {},
      eventId: "spam",
    });
    await t.mutation(internal.email.received, {
      message: { ...message, inbox_id: "unknown@agentmail.to" },
      thread: {},
      eventId: "unknown",
    });
    expect(await a.query(api.preparation.list, {})).toHaveLength(1);
  });
});
