/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import rateLimiter from "@convex-dev/rate-limiter/test";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { workflow } from "../convex/workflows";
import { consumePreparation } from "../convex/usage";

const modules = import.meta.glob("../convex/**/*.ts");
const usageSummary = makeFunctionReference<
  "query",
  { now: number },
  {
    voiceMinutesUsed: number;
    voiceMinutesReserved: number;
    voiceMinutesLimit: number;
    preparationsUsed: number;
    preparationsLimit: number;
    periodEnd: number;
  }
>("usage:summary");
const config = {
  mode: "coached" as const,
  role: "Designer",
  jobDescription: "",
  background: "",
};
const start = Date.UTC(2026, 8, 15, 12);
async function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(start);
  vi.stubEnv("STRIPE_PLUS_PRICE_ID", "price_plus");
  vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_pro");
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  const ownerId = await t.run((ctx) =>
    ctx.db.insert("users", { username: "alice" }),
  );
  const a = t.withIdentity({ subject: ownerId });
  return { t, ownerId, a };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("subscription allowances", () => {
  it("requires auth and isolates the summary by account", async () => {
    const { t, a } = await setup();
    await expect(t.query(usageSummary, { now: start })).rejects.toThrow(
      "Sign in",
    );
    await a.mutation(internal.sessions.reserve, { config, requestId: "one" });
    const bob = await t.run((ctx) =>
      ctx.db.insert("users", { username: "bob" }),
    );
    expect(
      await t
        .withIdentity({ subject: bob })
        .query(usageSummary, { now: start }),
    ).toMatchObject({ voiceMinutesReserved: 0 });
    expect(await a.query(usageSummary, { now: start })).toMatchObject({
      voiceMinutesReserved: 5,
      voiceMinutesLimit: 10,
      preparationsLimit: 3,
    });
    await expect(a.query(usageSummary, { now: Infinity })).rejects.toThrow(
      "Invalid time",
    );
  });
  it("requires the whole session cap and does not leave rejected reservations", async () => {
    const { t, a } = await setup();
    await expect(
      a.mutation(internal.sessions.reserve, {
        config: { ...config, mode: "mock" },
        requestId: "mock",
      }),
    ).rejects.toThrow("20 available voice minutes");
    expect(
      await t.run((ctx) => ctx.db.query("sessions").take(10)),
    ).toHaveLength(0);
    expect(await a.query(usageSummary, { now: start })).toMatchObject({
      voiceMinutesUsed: 0,
      voiceMinutesReserved: 0,
    });
  });
  it("charges trusted active elapsed time, rounds up, and retains usage across deletion", async () => {
    const { a, t } = await setup();
    const id = await a.mutation(internal.sessions.reserve, {
      config,
      requestId: "one",
    });
    vi.setSystemTime(start + 20000);
    await a.mutation(internal.sessions.activate, { id, liveId: "live_one" });
    vi.setSystemTime(start + 81000);
    const record = await a.mutation(api.sessions.finalize, {
      id,
      seconds: 0,
      confirmed: true,
      reason: "done",
    });
    expect(record.seconds).toBe(61);
    expect(await a.query(usageSummary, { now: start + 81000 })).toMatchObject({
      voiceMinutesUsed: 2,
      voiceMinutesReserved: 0,
    });
    vi.setSystemTime(start + 200000);
    await a.mutation(internal.sessions.markClosed, {
      id,
      reason: "time_limit",
    });
    await a.mutation(api.sessions.finalize, {
      id,
      seconds: 0,
      confirmed: true,
      reason: "done",
    });
    await a.mutation(api.sessions.remove, { id });
    expect(await a.query(usageSummary, { now: start + 200000 })).toMatchObject({
      voiceMinutesUsed: 2,
      voiceMinutesReserved: 0,
    });
    expect(
      await t.run((ctx) => ctx.db.query("voiceReservations").take(10)),
    ).toHaveLength(1);
  });
  it("releases a startup reservation without a charge and rejects late activation", async () => {
    const { a } = await setup();
    const id = await a.mutation(internal.sessions.reserve, {
      config,
      requestId: "startup",
    });
    vi.setSystemTime(start + 70000);
    await a.mutation(internal.sessions.markClosed, {
      id,
      reason: "startup_failed",
    });
    expect(
      await a.mutation(internal.sessions.activate, { id, liveId: "too_late" }),
    ).toBe(false);
    await a.mutation(internal.sessions.markClosed, {
      id,
      reason: "time_limit",
    });
    expect(await a.query(usageSummary, { now: start + 70000 })).toMatchObject({
      voiceMinutesUsed: 0,
      voiceMinutesReserved: 0,
    });
  });
  it("does not charge a provider connection that arrives after startup expiry", async () => {
    const { a } = await setup();
    const id = await a.mutation(internal.sessions.reserve, {
      config,
      requestId: "expired-start",
    });
    vi.setSystemTime(start + 400000);
    expect(
      await a.mutation(internal.sessions.activate, {
        id,
        liveId: "late-provider",
      }),
    ).toBe(false);
    await a.mutation(internal.sessions.markClosed, {
      id,
      reason: "startup_failed",
    });
    expect(await a.query(usageSummary, { now: start + 400000 })).toMatchObject({
      voiceMinutesUsed: 0,
      voiceMinutesReserved: 0,
    });
  });
  it("cannot reset active duration by repeating activation and caps the maximum charge", async () => {
    const { a } = await setup();
    const id = await a.mutation(internal.sessions.reserve, {
      config,
      requestId: "active",
    });
    await a.mutation(internal.sessions.activate, { id, liveId: "live" });
    vi.setSystemTime(start + 90000);
    await a.mutation(internal.sessions.activate, { id, liveId: "live" });
    vi.setSystemTime(start + 600000);
    await a.mutation(internal.sessions.markClosed, {
      id,
      reason: "time_limit",
    });
    expect(await a.query(usageSummary, { now: start + 600000 })).toMatchObject({
      voiceMinutesUsed: 5,
      voiceMinutesReserved: 0,
    });
    expect((await a.query(api.sessions.get, { id })).seconds).toBe(300);
  });
  it("keeps an in-flight reservation charged to the period it started in", async () => {
    const { a } = await setup();
    const before = Date.UTC(2026, 8, 30, 23, 59);
    vi.setSystemTime(before);
    const id = await a.mutation(internal.sessions.reserve, {
      config,
      requestId: "boundary",
    });
    await a.mutation(internal.sessions.activate, { id, liveId: "live" });
    vi.setSystemTime(before + 120000);
    await a.mutation(internal.sessions.markClosed, { id, reason: "done" });
    expect(await a.query(usageSummary, { now: before })).toMatchObject({
      voiceMinutesUsed: 2,
      voiceMinutesReserved: 0,
    });
    expect(await a.query(usageSummary, { now: before + 120000 })).toMatchObject(
      { voiceMinutesUsed: 0, voiceMinutesReserved: 0 },
    );
  });
  it("enforces preparation limits on both create and retry, retaining use after deletion", async () => {
    const { a, t } = await setup();
    vi.spyOn(workflow, "start").mockResolvedValue("workflow-test" as never);
    const id = await a.mutation(api.preparation.create, {
      url: "https://convex.dev/jobs",
      requestId: "one",
    });
    expect(
      await a.mutation(api.preparation.create, {
        url: "https://convex.dev/jobs",
        requestId: "one",
      }),
    ).toBe(id);
    for (let i = 0; i < 2; i++) {
      await t.mutation(internal.preparation.update, { id, status: "failed" });
      await a.mutation(api.preparation.retry, { id });
    }
    await t.mutation(internal.preparation.update, { id, status: "failed" });
    await expect(a.mutation(api.preparation.retry, { id })).rejects.toThrow(
      "preparation allowance",
    );
    await a.mutation(api.preparation.remove, { id });
    await expect(
      a.mutation(api.preparation.create, {
        url: "https://convex.dev/jobs",
        requestId: "two",
      }),
    ).rejects.toThrow("preparation allowance");
    expect(await a.query(usageSummary, { now: start })).toMatchObject({
      preparationsUsed: 3,
    });
    expect(workflow.start).toHaveBeenCalledTimes(3);
  });
  it("retains paid-period usage on upgrade and re-seeds preparation tokens", async () => {
    const { t, a, ownerId } = await setup();
    const account = await t.run((ctx) =>
      ctx.db.insert("billingAccounts", {
        ownerId,
        priceId: "price_plus",
        status: "active",
        cancelAtPeriodEnd: false,
        syncRevision: 0,
        periodStart: start - 1000,
        periodEnd: start + 30 * 86400000,
      }),
    );
    for (let i = 0; i < 15; i++)
      await t.run((ctx) => consumePreparation(ctx, ownerId));
    await expect(
      t.run((ctx) => consumePreparation(ctx, ownerId)),
    ).rejects.toThrow("preparation allowance");
    await t.run((ctx) => ctx.db.patch(account, { priceId: "price_pro" }));
    await t.run((ctx) => consumePreparation(ctx, ownerId));
    expect(await a.query(usageSummary, { now: start })).toMatchObject({
      preparationsUsed: 16,
      preparationsLimit: 40,
      voiceMinutesLimit: 150,
    });
    await t.run((ctx) => ctx.db.patch(account, { priceId: "price_plus" }));
    await expect(
      t.run((ctx) => consumePreparation(ctx, ownerId)),
    ).rejects.toThrow("preparation allowance");
  });
  it("starts a fresh allowance after the billing period rolls over", async () => {
    const { t, a, ownerId } = await setup();
    for (let i = 0; i < 3; i++)
      await t.run((ctx) => consumePreparation(ctx, ownerId));
    const nextMonth = Date.UTC(2026, 9, 1);
    vi.setSystemTime(nextMonth);
    await t.run((ctx) => consumePreparation(ctx, ownerId));
    expect(await a.query(usageSummary, { now: nextMonth })).toMatchObject({
      preparationsUsed: 1,
    });
  });
  it("admits only one concurrent preparation when one allowance remains", async () => {
    const { t, a, ownerId } = await setup();
    vi.spyOn(workflow, "start").mockResolvedValue("workflow-test" as never);
    await t.run((ctx) => consumePreparation(ctx, ownerId));
    await t.run((ctx) => consumePreparation(ctx, ownerId));
    const results = await Promise.allSettled(
      ["first", "second"].map((requestId) =>
        a.mutation(api.preparation.create, {
          url: "https://convex.dev/jobs",
          requestId,
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(await a.query(usageSummary, { now: start })).toMatchObject({
      preparationsUsed: 3,
    });
  });
  it("rolls preparation quota back when workflow startup fails", async () => {
    const { a } = await setup();
    vi.spyOn(workflow, "start").mockRejectedValue(
      new Error("workflow unavailable"),
    );
    await expect(
      a.mutation(api.preparation.create, {
        url: "https://convex.dev/jobs",
        requestId: "failed",
      }),
    ).rejects.toThrow("workflow unavailable");
    expect(await a.query(usageSummary, { now: start })).toMatchObject({
      preparationsUsed: 0,
    });
    vi.mocked(workflow.start).mockResolvedValue("workflow-test" as never);
    await a.mutation(api.preparation.create, {
      url: "https://convex.dev/jobs",
      requestId: "retry",
    });
    expect(await a.query(usageSummary, { now: start })).toMatchObject({
      preparationsUsed: 1,
    });
  });
  it("rejects fabricated feedback on a failed startup with no billed voice usage", async () => {
    const { a, t } = await setup();
    const id = await a.mutation(internal.sessions.reserve, {
      config,
      requestId: "failed-start",
    });
    await a.mutation(internal.sessions.markClosed, {
      id,
      reason: "startup_failed",
    });
    await a.mutation(api.sessions.append, {
      id,
      fragments: [
        {
          event_id: "fabricated",
          speaker: "user",
          delta: "I led a project and achieved results.",
          start_ms: 0,
          end_ms: 30000,
        },
      ],
    });
    await expect(a.action(api.voice.review, { id })).rejects.toThrow(
      "connected interview has recorded voice usage",
    );
    expect(await a.query(usageSummary, { now: start })).toMatchObject({
      voiceMinutesUsed: 0,
    });
    expect(
      (await t.run((ctx) => ctx.db.get(id)))?.feedbackAttempts,
    ).toBeUndefined();
  });
  it("requires a nonzero settled charge even if activation was instantaneous", async () => {
    const { a } = await setup();
    const id = await a.mutation(internal.sessions.reserve, {
      config,
      requestId: "instant",
    });
    await a.mutation(internal.sessions.activate, {
      id,
      liveId: "live-instant",
    });
    await a.mutation(internal.sessions.markClosed, { id, reason: "done" });
    await expect(
      a.mutation(internal.sessions.claimFeedback, { id }),
    ).rejects.toThrow("connected interview has recorded voice usage");
  });
  it("caps shared Free voice exposure per UTC day without blocking paid subscribers", async () => {
    const { t, a, ownerId } = await setup();
    for (let index = 0; index < 40; index++) {
      const user = await t.run((ctx) =>
        ctx.db.insert("users", { username: `free-${index}` }),
      );
      await t
        .withIdentity({ subject: user })
        .mutation(internal.sessions.reserve, {
          config,
          requestId: "free-budget",
        });
    }
    await expect(
      a.mutation(internal.sessions.reserve, {
        config,
        requestId: "over-budget",
      }),
    ).rejects.toThrow("today's shared limit");
    expect(await a.query(usageSummary, { now: start })).toMatchObject({
      voiceMinutesReserved: 0,
    });
    const paid = await t.run((ctx) =>
      ctx.db.insert("billingAccounts", {
        ownerId,
        priceId: "price_plus",
        status: "active",
        cancelAtPeriodEnd: false,
        syncRevision: 0,
        periodStart: start - 1000,
        periodEnd: start + 30 * 86400000,
      }),
    );
    const paidSession = await a.mutation(internal.sessions.reserve, {
      config,
      requestId: "paid",
    });
    await a.mutation(internal.sessions.markClosed, {
      id: paidSession,
      reason: "startup_failed",
    });
    await t.run((ctx) => ctx.db.patch(paid, { status: "canceled" }));
    vi.setSystemTime(start + 86400000);
    await expect(
      a.mutation(internal.sessions.reserve, { config, requestId: "next-day" }),
    ).resolves.toBeTruthy();
  });
  it("failed Free starts cost attempts, not shared minutes, and never paid start capacity", async () => {
    const { t, a, ownerId } = await setup();
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    let providerUp = false;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/live/sessions") && providerUp)
        return new Response(
          JSON.stringify({
            session: { id: `live-${Math.random()}` },
            transport: { sdp: "v=0\r\nm=audio" },
          }),
        );
      if (url.includes("/hangup")) return new Response("{}");
      return new Response("provider unavailable", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const liveStarts = () =>
      fetchMock.mock.calls.filter((c) =>
        String(c[0]).endsWith("/live/sessions"),
      ).length;
    const sdp = "v=0\r\nm=audio";
    // Thirty Free accounts each fail four provider starts: 120 attempts.
    for (let u = 0; u < 30; u++) {
      const user = await t.run((ctx) =>
        ctx.db.insert("users", { username: `free-${u}` }),
      );
      const c = t.withIdentity({ subject: user });
      for (let n = 0; n < 4; n++)
        await expect(
          c.action(api.voice.start, { config, requestId: `f${u}-${n}`, sdp }),
        ).rejects.toThrow("OpenAI could not complete");
      // The fifth attempt is a readable per-account attempt limit; no provider call.
      await expect(
        c.action(api.voice.start, { config, requestId: `f${u}-x`, sdp }),
      ).rejects.toThrow("a few voice sessions a day");
    }
    // Exactly one provider start per admitted attempt; blocked attempts make none.
    expect(liveStarts()).toBe(120);
    // Every failed reservation was released: no shared minutes remain debited.
    const ledger = await t.run((ctx) =>
      ctx.db.query("freeVoiceDays").collect(),
    );
    expect(ledger.map((d) => d.reservedMinutes)).toEqual([0]);
    // The shared Free start budget is now exhausted for a fresh Free account...
    const victim = await t.run((ctx) =>
      ctx.db.insert("users", { username: "victim" }),
    );
    await expect(
      t
        .withIdentity({ subject: victim })
        .action(api.voice.start, { config, requestId: "v", sdp }),
    ).rejects.toThrow("shared start limit");
    expect(liveStarts()).toBe(120);
    // ...while a paid account still starts through its own aggregate budget.
    await t.run((ctx) =>
      ctx.db.insert("billingAccounts", {
        ownerId,
        priceId: "price_plus",
        status: "active",
        cancelAtPeriodEnd: false,
        syncRevision: 0,
        periodStart: start - 1000,
        periodEnd: start + 30 * 86400000,
      }),
    );
    providerUp = true;
    const paid = await a.action(api.voice.start, {
      config,
      requestId: "paid",
      sdp,
    });
    expect(paid.record.status).toBe("active");
    expect(liveStarts()).toBe(121);
    // Paid accounts keep the pre-existing per-account daily start limit.
    await a.action(api.voice.close, { id: paid.record.id as never });
    for (let n = 1; n < 10; n++) {
      const next = await a.action(api.voice.start, {
        config,
        requestId: `paid-${n}`,
        sdp,
      });
      await a.action(api.voice.close, { id: next.record.id as never });
    }
    await expect(
      a.action(api.voice.start, { config, requestId: "paid-11", sdp }),
    ).rejects.toThrow();
    expect(liveStarts()).toBe(130);
  });
  it("releases unused shared Free capacity exactly once to the day it debited, and never for legacy rows", async () => {
    const { t, a } = await setup();
    const day = Date.UTC(2026, 8, 15);
    const nextDay = day + 86400000;
    const ledgerFor = (d: number) =>
      t.run((ctx) =>
        ctx.db
          .query("freeVoiceDays")
          .withIndex("by_day", (q) => q.eq("day", d))
          .unique(),
      );
    // Reserve one minute before midnight UTC; that day's ledger holds 5.
    vi.setSystemTime(nextDay - 60000);
    const id = await a.mutation(internal.sessions.reserve, {
      config,
      requestId: "late",
    });
    expect((await ledgerFor(day))?.reservedMinutes).toBe(5);
    await t.mutation(internal.sessions.activate, { id, liveId: "live-late" });
    // Another Free account starts after midnight, seeding the next day's ledger.
    vi.setSystemTime(nextDay + 10000);
    const other = await t.run((ctx) =>
      ctx.db.insert("users", { username: "other" }),
    );
    const seeded = await t
      .withIdentity({ subject: other })
      .mutation(internal.sessions.reserve, { config, requestId: "seed" });
    expect((await ledgerFor(nextDay))?.reservedMinutes).toBe(5);
    // The late session ends 90 seconds after it began: 2 minutes are charged to
    // the day it started; the next day's ledger is untouched.
    vi.setSystemTime(nextDay + 30000);
    await a.mutation(internal.sessions.markClosed, {
      id,
      reason: "close_requested",
    });
    expect((await ledgerFor(day))?.reservedMinutes).toBe(2);
    expect((await ledgerFor(nextDay))?.reservedMinutes).toBe(5);
    // Repeated settlement paths do not credit again.
    await a.mutation(internal.sessions.markClosed, {
      id,
      reason: "connection_lost",
    });
    await a.mutation(api.sessions.remove, { id });
    expect((await ledgerFor(day))?.reservedMinutes).toBe(2);
    // A reservation predating the ledger has no freeDay and never credits.
    await t.run(async (ctx) => {
      const r = await ctx.db
        .query("voiceReservations")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", seeded))
        .unique();
      await ctx.db.patch(r!._id, { freeDay: undefined });
    });
    await t
      .withIdentity({ subject: other })
      .mutation(internal.sessions.markClosed, {
        id: seeded,
        reason: "startup_failed",
      });
    expect((await ledgerFor(nextDay))?.reservedMinutes).toBe(5);
    // Account quotas are unchanged: the honest session charged 2 minutes.
    expect(await a.query(usageSummary, { now: Date.now() })).toMatchObject({
      voiceMinutesUsed: 2,
      voiceMinutesReserved: 0,
    });
  });
  it("bounds failed feedback retries per interview", async () => {
    const { t, a, ownerId } = await setup();
    const id = await a.mutation(internal.sessions.reserve, {
      config,
      requestId: "feedback",
    });
    await a.mutation(internal.sessions.activate, {
      id,
      liveId: "live-feedback",
    });
    vi.setSystemTime(start + 10000);
    await a.mutation(internal.sessions.markClosed, { id, reason: "done" });
    for (let attempt = 0; attempt < 3; attempt++) {
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
      await a.mutation(internal.sessions.saveFeedback, {
        id,
        claim: claim!,
        error: "test provider failure",
      });
    }
    await expect(
      a.mutation(internal.sessions.claimFeedback, { id }),
    ).rejects.toThrow("three attempts");
  });
});
