/// <reference types="vite/client" />
import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import rateLimiter from "@convex-dev/rate-limiter/test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { AI_POLICY } from "../shared/cost-controls";
import { limits } from "../convex/limits";
import { workflow } from "../convex/workflows";
const modules = import.meta.glob("../convex/**/*.ts");
const config = {
  mode: "coached" as const,
  role: "Engineer",
  jobDescription: "",
  background: "",
};
async function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 8, 27));
  vi.stubEnv("OPENAI_API_KEY", "test-only");
  vi.stubEnv("STRIPE_PLUS_PRICE_ID", "price_plus");
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  const ownerId = await t.run((ctx) =>
    ctx.db.insert("users", { username: "alice" }),
  );
  const a = t.withIdentity({ subject: ownerId });
  const id = await a.mutation(internal.sessions.reserve, {
    config,
    requestId: "one",
  });
  await a.mutation(internal.sessions.activate, { id, liveId: "live_test" });
  return { t, a, ownerId, id };
}
function provider(input = 1000, status = "completed") {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith("/input_tokens"))
      return new Response(JSON.stringify({ input_tokens: input }));
    return new Response(
      JSON.stringify({
        id: "resp_test",
        status,
        usage: {
          input_tokens: 1000,
          output_tokens: 80,
          input_tokens_details: { cached_tokens: 100, cache_write_tokens: 200 },
          output_tokens_details: { reasoning_tokens: 30 },
        },
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  question: "What changed because of your decision?",
                }),
              },
            ],
          },
        ],
      }),
      { headers: { "x-request-id": "req_test" } },
    );
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("counts the same model, instructions, input, and schema before generating, recording provider usage", async () => {
  const { t, a, ownerId, id } = await setup();
  const fetch = provider();
  const result = await a.action(api.voice.delegate, { id, delegationId: "d1" });
  expect(result).toContain("What changed");
  expect(fetch).toHaveBeenCalledTimes(2);
  const count = JSON.parse(
    (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
  );
  const request = JSON.parse(
    (fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body as string,
  );
  for (const key of ["model", "input", "instructions", "text"])
    expect(request[key]).toEqual(count[key]);
  expect(request.max_output_tokens).toBe(AI_POLICY.delegation.output);
  expect(request.service_tier).toBe("default");
  expect(await t.query(internal.aiUsage.recent, { ownerId })).toMatchObject([
    {
      state: "completed",
      inputTokens: 1000,
      cachedInputTokens: 100,
      outputTokens: 80,
      reasoningTokens: 30,
      responseId: "resp_test",
      requestId: "req_test",
    },
  ]);
  await a.action(api.voice.delegate, { id, delegationId: "d1" });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("rejects oversized inputs before generation and fails closed when counting fails", async () => {
  const { t, a, ownerId, id } = await setup();
  const fetch = provider(AI_POLICY.delegation.input + 1);
  await expect(
    a.action(api.voice.delegate, { id, delegationId: "big" }),
  ).rejects.toThrow("exceed the processing limit");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await t.query(internal.aiUsage.recent, { ownerId })).toMatchObject([
    { state: "rejected", errorCode: "input_budget_exceeded" },
  ]);
  fetch.mockResolvedValue(new Response(JSON.stringify({ input_tokens: null })));
  await expect(
    a.action(api.voice.delegate, { id, delegationId: "invalid" }),
  ).rejects.toThrow("verify the request size");
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("admits only one concurrent duplicate and bounds calls including failed attempts", async () => {
  const { t, a, ownerId, id } = await setup();
  const claims = await Promise.all(
    [1, 2].map(() =>
      t.mutation(internal.aiUsage.begin, {
        ownerId,
        sessionId: id,
        operation: "delegation",
        delegationId: "same",
      }),
    ),
  );
  expect(claims.filter((c) => c.fresh)).toHaveLength(1);
  const fetch = provider();
  for (let n = 0; n < 5; n++)
    await a.action(api.voice.delegate, { id, delegationId: `d${n}` });
  await expect(
    a.action(api.voice.delegate, { id, delegationId: "overflow" }),
  ).rejects.toThrow("allowance reached");
  expect(fetch).toHaveBeenCalledTimes(10);
});
it("rejects other owners and calls after closure without contacting OpenAI", async () => {
  const { t, a, id } = await setup();
  const bob = await t.run((ctx) => ctx.db.insert("users", { username: "bob" }));
  const fetch = provider();
  await expect(
    t
      .withIdentity({ subject: bob })
      .action(api.voice.delegate, { id, delegationId: "x" }),
  ).rejects.toThrow("Session not found");
  await a.mutation(api.sessions.finalize, {
    id,
    confirmed: true,
    reason: "done",
  });
  await expect(
    a.action(api.voice.delegate, { id, delegationId: "y" }),
  ).rejects.toThrow("ended");
  expect(fetch).not.toHaveBeenCalled();
});
it("retains usage for incomplete output and reserves uncertain requests without replaying them", async () => {
  const { t, a, ownerId, id } = await setup();
  provider(1000, "incomplete");
  await expect(
    a.action(api.voice.delegate, { id, delegationId: "short" }),
  ).rejects.toThrow("did not finish");
  expect(await t.query(internal.aiUsage.recent, { ownerId })).toMatchObject([
    { state: "failed", outputTokens: 80, errorCode: "incomplete_output" },
  ]);
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith("/input_tokens"))
      return new Response(JSON.stringify({ input_tokens: 100 }));
    throw new Error("response lost");
  });
  vi.stubGlobal("fetch", fetch);
  await expect(
    a.action(api.voice.delegate, { id, delegationId: "lost" }),
  ).rejects.toThrow("response lost");
  await a.action(api.voice.delegate, { id, delegationId: "lost" });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(
    (await t.query(internal.aiUsage.recent, { ownerId })).some(
      (r) => r.state === "unknown",
    ),
  ).toBe(true);
});
it("distinguishes exhausted funding from transient throttling and honors long Retry-After by deferring", async () => {
  const { a, id } = await setup();
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "credit_balance_exhausted",
            message: "private detail",
          },
        }),
        { status: 429 },
      ),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(
    a.action(api.voice.delegate, { id, delegationId: "funding" }),
  ).rejects.toThrow("restore API funding");
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValue(
    new Response(JSON.stringify({ error: { code: "rate_limit_exceeded" } }), {
      status: 429,
      headers: { "retry-after": "30" },
    }),
  );
  await expect(
    a.action(api.voice.delegate, { id, delegationId: "rate" }),
  ).rejects.toThrow("30 seconds");
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("recovers delayed transcript fragments until feedback starts", async () => {
  const { t, a, id } = await setup();
  await a.mutation(api.sessions.finalize, {
    id,
    confirmed: true,
    reason: "done",
  });
  vi.setSystemTime(Date.now() + 60001);
  const fragment = {
    event_id: "late",
    speaker: "user" as const,
    delta: "I owned the rollout.",
    start_ms: 0,
    end_ms: 100,
  };
  await a.mutation(api.sessions.append, { id, fragments: [fragment] });
  expect(
    await t.run((ctx) => ctx.db.query("fragments").collect()),
  ).toHaveLength(1);
  await t.run((ctx) => ctx.db.patch(id, { feedbackState: "running" }));
  await expect(
    a.mutation(api.sessions.append, {
      id,
      fragments: [{ ...fragment, event_id: "locked" }],
    }),
  ).rejects.toThrow();
});
it("enforces period feedback admission atomically and preserves it through deletion", async () => {
  const { t, a, ownerId, id } = await setup();
  const feedbackClaim = Date.now();
  await t.run((ctx) =>
    ctx.db.patch(id, {
      feedbackState: "running",
      feedbackStartedAt: feedbackClaim,
    }),
  );
  const args = {
    ownerId,
    sessionId: id,
    operation: "feedback" as const,
    feedbackClaim,
  };
  async function admit() {
    const request = await t.mutation(internal.aiUsage.begin, args);
    return t.mutation(internal.aiUsage.admitTokens, {
      id: request.id,
      inputTokens: 100,
    });
  }
  for (let n = 0; n < 9; n++) await admit();
  const results = await Promise.allSettled([admit(), admit()]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  await expect(admit()).rejects.toThrow("processing limit");
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
    feedbackAttempts: 1,
  });
  await t.mutation(internal.sessions.markClosed, { id, reason: "done" });
  await a.mutation(api.sessions.remove, { id });
  const period = await t.run((ctx) => ctx.db.query("usagePeriods").first());
  expect(period?.feedbackCalls).toBe(10);
});
it("Free preparation exhaustion cannot consume the paid pool", async () => {
  const { t, a, ownerId } = await setup();
  vi.spyOn(workflow, "start").mockResolvedValue("wf" as never);
  await t.run((ctx) =>
    limits.limit(ctx, "globalFreeResearch", { count: 20, throws: true }),
  );
  await expect(
    a.mutation(api.preparation.create, {
      url: "https://example.com/job",
      requestId: "free",
    }),
  ).rejects.toThrow();
  await t.run((ctx) =>
    ctx.db.insert("billingAccounts", {
      ownerId,
      status: "active",
      priceId: "price_plus",
      periodStart: Date.now() - 1000,
      periodEnd: Date.now() + 86400000,
      cancelAtPeriodEnd: false,
      syncRevision: 0,
    }),
  );
  await expect(
    a.mutation(api.preparation.create, {
      url: "https://example.com/job",
      requestId: "paid",
    }),
  ).resolves.toBeTruthy();
});
it("keeps exhausted provider cleanup visible and never regresses confirmed closure", async () => {
  const { t, a, ownerId, id } = await setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 503 })),
  );
  await a.action(api.voice.close, { id });
  await t.action(internal.voice.expire, { id, attempt: 4 });
  expect(await t.query(internal.providerCleanup.failures, {})).toMatchObject([
    { liveId: "live_test", state: "failed", attempts: 2 },
  ]);
  await t.mutation(internal.providerCleanup.record, {
    ownerId,
    liveId: "live_test",
    state: "closed",
    providerSeconds: 12,
  });
  await t.mutation(internal.providerCleanup.record, {
    ownerId,
    liveId: "live_test",
    state: "pending",
    providerSeconds: 10,
  });
  expect(await t.query(internal.providerCleanup.failures, {})).toEqual([]);
  expect(
    await t.run((ctx) => ctx.db.query("providerClosures").first()),
  ).toMatchObject({ state: "closed", providerSeconds: 12 });
});

it("reserves the Free dollar budget before generation without consuming paid capacity", async () => {
  const { t, a, ownerId, id } = await setup();
  await t.run((ctx) =>
    limits.limit(ctx, "globalFreeAiSpend", { count: 1_000_000, throws: true }),
  );
  const fetch = provider();
  await expect(
    a.action(api.voice.delegate, { id, delegationId: "free-spend" }),
  ).rejects.toThrow("shared capacity");
  expect(fetch).toHaveBeenCalledTimes(1);
  await t.run((ctx) =>
    ctx.db.insert("billingAccounts", {
      ownerId,
      status: "active",
      priceId: "price_plus",
      periodStart: Date.now() - 1000,
      periodEnd: Date.now() + 86400000,
      cancelAtPeriodEnd: false,
      syncRevision: 0,
    }),
  );
  await expect(
    a.action(api.voice.delegate, { id, delegationId: "paid-spend" }),
  ).resolves.toContain("What changed");
  expect(fetch).toHaveBeenCalledTimes(3);
  const requests = await t.query(internal.aiUsage.recent, { ownerId });
  expect(requests.find((r) => r.state === "completed")).toMatchObject({
    reservedCostMicros: 1000 * 2.5 + 1024 * 12,
    cacheWriteTokens: 200,
  });
});

it("keeps a full interview duration after activation without extending it on repeated activation", async () => {
  const { t, id } = await setup();
  const original = await t.run((ctx) => ctx.db.get(id));
  vi.setSystemTime(Date.now() + 45000);
  await t.action(internal.voice.expire, { id });
  expect(
    (await t.run((ctx) => ctx.db.get(id)))?.record.endedAt,
  ).toBeUndefined();
  await t.mutation(internal.sessions.activate, { id, liveId: "live_test" });
  expect((await t.run((ctx) => ctx.db.get(id)))?.expiresAt).toBe(
    original?.expiresAt,
  );
});

it("retains ambiguous startup outcomes and provider IDs after session deletion", async () => {
  const { t, a, id } = await setup();
  await t.mutation(internal.providerCleanup.start, {
    sessionId: id,
    state: "unknown",
    errorCode: "startup_outcome_unknown",
  });
  await t.mutation(internal.providerCleanup.start, {
    sessionId: id,
    state: "created",
    liveId: "live_test",
    requestId: "req_start",
  });
  await t.mutation(internal.providerCleanup.start, {
    sessionId: id,
    state: "unknown",
    errorCode: "activation_failed",
  });
  await t.mutation(internal.sessions.markClosed, { id, reason: "done" });
  await a.mutation(api.sessions.remove, { id });
  expect(
    await t.run((ctx) => ctx.db.query("voiceReservations").first()),
  ).toMatchObject({
    providerStartState: "created",
    providerLiveId: "live_test",
    providerRequestId: "req_start",
  });
});

it("keeps a paid generation's HTTP 500 outcome unknown without replay", async () => {
  const { t, a, ownerId, id } = await setup();
  const fetch = provider();
  fetch.mockImplementation(async (url) =>
    url.endsWith("/input_tokens")
      ? new Response(JSON.stringify({ input_tokens: 1000 }))
      : new Response(JSON.stringify({ error: { code: "server_error" } }), {
          status: 500,
        }),
  );
  await expect(
    a.action(api.voice.delegate, { id, delegationId: "ambiguous" }),
  ).rejects.toThrow("HTTP 500");
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(await t.query(internal.aiUsage.recent, { ownerId })).toMatchObject([
    { state: "unknown", reservedCostMicros: 14788, errorCode: "server_error" },
  ]);
});

it.each(["globalFreeAiSpend", "globalFreeFeedback"] as const)(
  "capacity denials at %s preserve review attempts and recover tomorrow",
  async (limiter) => {
    const { t, a, ownerId, id } = await setup();
    vi.setSystemTime(Date.now() + 10000);
    await t.mutation(internal.sessions.markClosed, { id, reason: "done" });
    await t.run((ctx) =>
      limits.limit(ctx, limiter, {
        count: limiter === "globalFreeAiSpend" ? 1_000_000 : 60,
        throws: true,
      }),
    );
    for (let n = 0; n < 3; n++) {
      const claim = await a.mutation(internal.sessions.claimFeedback, { id });
      const request = await t.mutation(internal.aiUsage.begin, {
        ownerId,
        sessionId: id,
        operation: "feedback",
        feedbackClaim: claim!,
      });
      await expect(
        t.mutation(internal.aiUsage.admitTokens, {
          id: request.id,
          inputTokens: 100,
        }),
      ).rejects.toThrow("shared capacity");
      await t.mutation(internal.sessions.saveFeedback, {
        id,
        claim: claim!,
        error: "capacity",
      });
    }
    expect((await t.run((ctx) => ctx.db.get(id)))?.feedbackAttempts ?? 0).toBe(
      0,
    );
    expect(
      (await t.run((ctx) => ctx.db.query("usagePeriods").first()))
        ?.feedbackCalls ?? 0,
    ).toBe(0);
    vi.setSystemTime(Date.now() + 86400000);
    const claim = await a.mutation(internal.sessions.claimFeedback, { id });
    const request = await t.mutation(internal.aiUsage.begin, {
      ownerId,
      sessionId: id,
      operation: "feedback",
      feedbackClaim: claim!,
    });
    await t.mutation(internal.aiUsage.admitTokens, {
      id: request.id,
      inputTokens: 100,
    });
    expect((await t.run((ctx) => ctx.db.get(id)))?.feedbackAttempts).toBe(1);
  },
);
it("rejects stale feedback claims before reserving paid capacity", async () => {
  const { t, ownerId, id } = await setup();
  await t.run((ctx) =>
    ctx.db.patch(id, { feedbackState: "running", feedbackStartedAt: 100 }),
  );
  const request = await t.mutation(internal.aiUsage.begin, {
    ownerId,
    sessionId: id,
    operation: "feedback",
    feedbackClaim: 100,
  });
  await t.run((ctx) => ctx.db.patch(id, { feedbackStartedAt: 101 }));
  await expect(
    t.mutation(internal.aiUsage.admitTokens, {
      id: request.id,
      inputTokens: 100,
    }),
  ).rejects.toThrow("no longer running");
  await expect(
    t.mutation(internal.aiUsage.begin, {
      ownerId,
      sessionId: id,
      operation: "feedback",
    }),
  ).rejects.toThrow("no longer running");
  expect((await t.run((ctx) => ctx.db.get(id)))?.feedbackAttempts ?? 0).toBe(0);
});
it("recognizes confirmed normal completion after provider closure without changing settled usage", async () => {
  const { t, a, id } = await setup();
  vi.setSystemTime(Date.now() + 10000);
  await t.mutation(internal.sessions.markClosed, {
    id,
    reason: "provider_closed",
  });
  const before = await t.run((ctx) => ctx.db.get(id));
  await a.mutation(api.sessions.finalize, {
    id,
    confirmed: true,
    reason: "close_requested",
  });
  const after = await t.run((ctx) => ctx.db.get(id));
  expect(after?.record).toMatchObject({
    status: "completed",
    closeReason: "close_requested",
    endedAt: before?.record.endedAt,
  });
  expect(after?.record.seconds).toEqual(before?.record.seconds);
});
it("retains a provider startup request ID when a later failure supplies no metadata", async () => {
  const { t, id } = await setup();
  await t.mutation(internal.providerCleanup.start, {
    sessionId: id,
    state: "unknown",
    requestId: "req_start",
    errorCode: "lost",
  });
  await t.mutation(internal.providerCleanup.start, {
    sessionId: id,
    state: "unknown",
  });
  expect(
    await t.run((ctx) => ctx.db.query("voiceReservations").first()),
  ).toMatchObject({
    providerRequestId: "req_start",
    providerErrorCode: "lost",
  });
});
it("recounts reduced preparation inputs, preserves size errors, and blocks unchanged retries", async () => {
  const { t, a, ownerId } = await setup();
  const id = await t.run((ctx) =>
    ctx.db.insert("opportunities", {
      ownerId,
      requestId: "large",
      input: "text ".repeat(3600),
      kind: "email",
      status: "reading",
      sources: [],
      receivedAt: Date.now(),
      attachments: [
        {
          id: "a",
          filename: "job.txt",
          status: "imported",
          text: "job ".repeat(3000),
          contentType: "text/plain",
          size: 12000,
        },
      ],
    }),
  );
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string);
    if (url.endsWith("/input_tokens"))
      return new Response(
        JSON.stringify({
          input_tokens: body.input.length > 10000 ? 13000 : 2000,
        }),
      );
    return new Response(
      JSON.stringify({
        id: "response",
        status: "completed",
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  role: "Engineer",
                  company: "Example",
                  interviewDate: null,
                  preparation: [],
                  jobUrl: null,
                }),
              },
            ],
          },
        ],
      }),
    );
  });
  vi.stubGlobal("fetch", fetch);
  await t.action(internal.research.extract, { id });
  expect(fetch).toHaveBeenCalledTimes(3);
  const counted = JSON.parse(fetch.mock.calls[1][1]!.body as string);
  const generated = JSON.parse(fetch.mock.calls[2][1]!.body as string);
  expect(generated.input).toBe(counted.input);
  expect(JSON.parse(generated.input).inputCoverage).toContain("excerpts");
  fetch.mockImplementation(
    async () => new Response(JSON.stringify({ input_tokens: 13000 })),
  );
  await expect(t.action(internal.research.extract, { id })).rejects.toThrow(
    "exceed the processing limit",
  );
  await t.mutation(internal.preparation.fail, { id });
  expect(await t.query(internal.preparation.load, { id })).toMatchObject({
    status: "failed",
    inputTooLarge: true,
    error: expect.stringContaining("Remove attachments"),
  });
  await expect(a.mutation(api.preparation.retry, { id })).rejects.toThrow(
    "did not use an allowance",
  );
  expect(
    (await t.run((ctx) => ctx.db.query("usagePeriods").first()))
      ?.preparationsUsed ?? 0,
  ).toBe(0);
  await a.mutation(api.preparation.removeAttachment, { id, attachmentId: "a" });
  expect(
    (await t.query(internal.preparation.load, { id })).inputTooLarge,
  ).toBeUndefined();
});

it("labels transcript excerpt feedback and charges only the admitted generation", async () => {
  const { sampleFeedback } = await import("./fixtures");
  const { t, a, ownerId, id } = await setup();
  await a.mutation(api.sessions.append, {
    id,
    fragments: [
      {
        event_id: "answer",
        speaker: "user",
        delta: "I led the launch. We shipped on time.",
        start_ms: 0,
        end_ms: 1000,
      },
    ],
  });
  vi.setSystemTime(Date.now() + 10000);
  await t.mutation(internal.sessions.markClosed, { id, reason: "done" });
  const original = await a.query(internal.sessions.full, { id });
  let counts = 0;
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith("/input_tokens"))
      return new Response(
        JSON.stringify({ input_tokens: ++counts < 3 ? 13000 : 3000 }),
      );
    return new Response(
      JSON.stringify({
        id: "response",
        status: "completed",
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify(sampleFeedback(original)),
              },
            ],
          },
        ],
      }),
    );
  });
  vi.stubGlobal("fetch", fetch);
  const result = await a.action(api.voice.review, { id });
  expect(result.feedback?.summary).toContain(
    "covers selected transcript excerpts",
  );
  expect(result.fragments).toEqual(original.fragments);
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(JSON.parse(fetch.mock.calls[3][1]!.body as string).input).toBe(
    JSON.parse(fetch.mock.calls[2][1]!.body as string).input,
  );
  expect(await t.query(internal.aiUsage.recent, { ownerId })).toMatchObject([
    { inputVariant: 2, state: "completed" },
  ]);
  expect((await t.run((ctx) => ctx.db.get(id)))?.feedbackAttempts).toBe(1);
});
