/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import rateLimiter from "@convex-dev/rate-limiter/test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { agentmail } from "../convex/email";
import { workflow } from "../convex/workflows";
const modules = import.meta.glob("../convex/**/*.ts");
const address = "shared@agentmail.to";
const aliceToken = "a".repeat(32);
const bobToken = "b".repeat(32);
async function setup() {
  vi.stubEnv("AGENTMAIL_SHARED_INBOX_ID", address);
  vi.stubEnv("AGENTMAIL_API_KEY", "test-only");
  vi.stubEnv("AGENTMAIL_WEBHOOK_SECRET", "test-only");
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  const [alice, bob] = await t.run(async (ctx) => [
    await ctx.db.insert("users", { username: "alice" }),
    await ctx.db.insert("users", { username: "bob" }),
  ]);
  return {
    t,
    alice,
    bob,
    a: t.withIdentity({ subject: alice }),
    b: t.withIdentity({ subject: bob }),
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
const message = (token = aliceToken) => ({
  inbox_id: address,
  message_id: "invitation",
  subject: `Invitation [Rehearsal:${token}]`,
  text: "Please prepare for an interview.",
});
describe("shared email routing", () => {
  it("creates private account routes without provider calls and returns the same route on retries", async () => {
    const { t, a, b } = await setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const first = await a.action(api.email.create, {});
    expect(first).toMatchObject({ address, autoReply: false });
    expect(first.subjectMarker).toMatch(/^\[Rehearsal:[a-f0-9]{32}\]$/);
    expect(await a.action(api.email.create, { autoReply: true })).toEqual(
      first,
    );
    const second = await b.action(api.email.create, { autoReply: true });
    expect(second.address).toBe(address);
    expect(second.subjectMarker).not.toBe(first.subjectMarker);
    expect(second.autoReply).toBe(true);
    expect(await a.query(api.email.inbox, {})).toEqual(first);
    await expect(t.query(api.email.inbox, {})).rejects.toThrow("Sign in");
    await expect(t.action(api.email.create, {})).rejects.toThrow("Sign in");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("isolates shared inbox owners and rejects missing, ambiguous, body-only, and wrong-inbox markers", async () => {
    const { t, a, b } = await setup();
    vi.spyOn(workflow, "start").mockResolvedValue("workflow-test" as never);
    await a.mutation(internal.email.reserve, {
      autoReply: false,
      routingToken: aliceToken,
    });
    await b.mutation(internal.email.reserve, {
      autoReply: false,
      routingToken: bobToken,
    });
    const receive = (mail: ReturnType<typeof message>, eventId: string) =>
      t.mutation(internal.email.received, {
        message: mail,
        thread: {},
        eventId,
      });
    await receive(message(), "alice-first");
    await receive(message(), "alice-first");
    await receive(message(), "alice-redelivery");
    await receive(message(bobToken), "bob-first");
    for (const [index, mail] of [
      {
        ...message(),
        subject: "Invitation",
        text: `[Rehearsal:${aliceToken}]`,
      },
      {
        ...message(),
        subject: `Invitation [Rehearsal:${aliceToken}] [Rehearsal:${bobToken}]`,
      },
      message("c".repeat(32)),
      { ...message(), inbox_id: "other@agentmail.to" },
    ].entries())
      await receive(mail, `invalid-${index}`);
    const aliceRows = await a.query(api.preparation.list, {});
    const bobRows = await b.query(api.preparation.list, {});
    expect(aliceRows).toHaveLength(1);
    expect(bobRows).toHaveLength(1);
    expect(aliceRows[0].inboxRecordId).toBeTruthy();
    expect(aliceRows[0].inboxRecordId).not.toBe(bobRows[0].inboxRecordId);
    await expect(
      b.query(api.preparation.get, { id: aliceRows[0]._id }),
    ).rejects.toThrow("Preparation not found");
    expect(workflow.start).toHaveBeenCalledTimes(2);
  });
  it("preserves dedicated inboxes and resolves notification preferences by account route", async () => {
    const { t, a, b, alice } = await setup();
    vi.spyOn(workflow, "start").mockResolvedValue("workflow-test" as never);
    const reply = vi
      .spyOn(agentmail, "replyToMessage")
      .mockResolvedValue(
        "reply-test" as Awaited<ReturnType<typeof agentmail.replyToMessage>>,
      );
    await t.mutation(internal.email.save, {
      ownerId: alice,
      inboxId: "legacy@agentmail.to",
      autoReply: true,
    });
    expect(await a.action(api.email.create, {})).toEqual({
      address: "legacy@agentmail.to",
      autoReply: true,
    });
    await b.mutation(internal.email.reserve, {
      routingToken: bobToken,
      autoReply: false,
    });
    await t.mutation(internal.email.received, {
      message: {
        ...message(),
        inbox_id: "legacy@agentmail.to",
        subject: "Invitation",
      },
      thread: {},
      eventId: "legacy",
    });
    const [legacy] = await a.query(api.preparation.list, {});
    await t.run(async (ctx) => {
      await ctx.db.patch(legacy._id, { status: "ready" });
    });
    await t.mutation(internal.email.notifyReady, { id: legacy._id });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0][1]).toBe("legacy@agentmail.to");
    await t.mutation(internal.email.notifyReady, { id: legacy._id });
    expect(reply).toHaveBeenCalledTimes(1);
  });
  it("uses the snapshotted account route for shared replies and rejects a mismatched owner", async () => {
    const { t, a, b, alice, bob } = await setup();
    const reply = vi
      .spyOn(agentmail, "replyToMessage")
      .mockResolvedValue(
        "reply-test" as Awaited<ReturnType<typeof agentmail.replyToMessage>>,
      );
    await a.mutation(internal.email.reserve, {
      autoReply: true,
      routingToken: aliceToken,
    });
    await b.mutation(internal.email.reserve, {
      autoReply: false,
      routingToken: bobToken,
    });
    const ids = await t.run(async (ctx) => {
      const ar = await ctx.db
        .query("inboxes")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", alice))
        .unique();
      const br = await ctx.db
        .query("inboxes")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", bob))
        .unique();
      const base = {
        requestId: "notify",
        input: "Invitation",
        kind: "email" as const,
        status: "ready" as const,
        sources: [],
        receivedAt: 1,
        inboxId: address,
        messageId: "message",
      };
      return [
        await ctx.db.insert("opportunities", {
          ...base,
          ownerId: alice,
          inboxRecordId: ar!._id,
        }),
        await ctx.db.insert("opportunities", {
          ...base,
          ownerId: bob,
          inboxRecordId: br!._id,
        }),
        await ctx.db.insert("opportunities", {
          ...base,
          requestId: "mismatch",
          ownerId: bob,
          inboxRecordId: ar!._id,
        }),
      ];
    });
    for (const id of ids) await t.mutation(internal.email.notifyReady, { id });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0][1]).toBe(address);
    expect(reply.mock.calls[0][3].text).toContain(ids[0]);
    expect(reply.mock.calls[0][3].replyAll).toBe(false);
  });
  it("retains over-quota invitations privately and can retry them after an upgrade", async () => {
    const { t, a, b, alice } = await setup();
    vi.spyOn(workflow, "start").mockResolvedValue("workflow-test" as never);
    await a.mutation(internal.email.reserve, {
      autoReply: false,
      routingToken: aliceToken,
    });
    for (let n = 0; n < 4; n++)
      await t.mutation(internal.email.received, {
        message: {
          ...message(),
          message_id: `quota-${n}`,
          attachments: [
            { attachment_id: "guide", filename: "guide.txt", size: 5 },
          ],
        },
        thread: {},
        eventId: `quota-event-${n}`,
      });
    const rows = await a.query(api.preparation.list, {});
    expect(rows).toHaveLength(4);
    const failed = rows.find((row) => row.status === "failed")!;
    expect(failed.error).toContain("Your invitation is saved");
    expect(failed.inboxRecordId).toBeTruthy();
    expect(failed.attachments).toHaveLength(1);
    expect(workflow.start).toHaveBeenCalledTimes(3);
    await t.mutation(internal.email.received, {
      message: { ...message(), message_id: "quota-3" },
      thread: {},
      eventId: "quota-redelivery",
    });
    expect(await a.query(api.preparation.list, {})).toHaveLength(4);
    await expect(
      b.query(api.preparation.get, { id: failed._id }),
    ).rejects.toThrow("Preparation not found");
    await expect(
      a.mutation(api.preparation.retry, { id: failed._id }),
    ).rejects.toThrow();
    vi.stubEnv("STRIPE_PLUS_PRICE_ID", "price_plus");
    const now = new Date();
    await t.run((ctx) =>
      ctx.db.insert("billingAccounts", {
        ownerId: alice,
        priceId: "price_plus",
        status: "active",
        cancelAtPeriodEnd: false,
        syncRevision: 1,
        periodStart: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
        periodEnd: Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
      }),
    );
    await a.mutation(api.preparation.retry, { id: failed._id });
    expect(
      (await a.query(api.preparation.get, { id: failed._id }))?.status,
    ).toBe("queued");
    expect(workflow.start).toHaveBeenCalledTimes(4);
  });
  it("revokes old subject markers without changing route identity or saved preparation ownership", async () => {
    const { t, a, b, alice } = await setup();
    vi.spyOn(workflow, "start").mockResolvedValue("workflow-test" as never);
    const original = await a.mutation(internal.email.reserve, {
      autoReply: false,
      routingToken: aliceToken,
    });
    const bobInbox = await b.mutation(internal.email.reserve, {
      autoReply: false,
      routingToken: bobToken,
    });
    await t.mutation(internal.email.received, {
      message: message(),
      thread: {},
      eventId: "before-rotation",
    });
    const [before] = await a.query(api.preparation.list, {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      t.action(api.email.rotateMarker, {
        expectedMarker: original.subjectMarker!,
      }),
    ).rejects.toThrow("Sign in");
    expect(
      await b.action(api.email.rotateMarker, {
        expectedMarker: original.subjectMarker!,
      }),
    ).toEqual(bobInbox);
    const updated = await a.action(api.email.rotateMarker, {
      expectedMarker: original.subjectMarker!,
    });
    expect(updated.subjectMarker).not.toBe(original.subjectMarker);
    expect(updated).toMatchObject({ address, autoReply: false });
    // Repeated delivery of the same action cannot rotate again or spend more rate limit.
    for (let n = 0; n < 4; n++)
      expect(
        await a.action(api.email.rotateMarker, {
          expectedMarker: original.subjectMarker!,
        }),
      ).toEqual(updated);
    await t.mutation(internal.email.received, {
      message: { ...message(), message_id: "old-marker-after-rotation" },
      thread: {},
      eventId: "old-marker",
    });
    expect(await a.query(api.preparation.list, {})).toHaveLength(1);
    await t.mutation(internal.email.received, {
      message: {
        ...message(),
        message_id: "new-marker",
        subject: `Invitation ${updated.subjectMarker}`,
      },
      thread: {},
      eventId: "new-marker",
    });
    const rows = await a.query(api.preparation.list, {});
    expect(rows).toHaveLength(2);
    expect(
      rows.every(
        (row) =>
          row.ownerId === alice && row.inboxRecordId === before.inboxRecordId,
      ),
    ).toBe(true);
    expect(
      (await a.query(api.preparation.get, { id: before._id }))?.ownerId,
    ).toBe(alice);
    await expect(
      b.query(api.preparation.get, { id: before._id }),
    ).rejects.toThrow("Preparation not found");
    expect(await b.query(api.email.inbox, {})).toEqual(bobInbox);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("does not replace dedicated legacy inboxes or accept malformed markers", async () => {
    const { t, a, alice } = await setup();
    await t.mutation(internal.email.save, {
      ownerId: alice,
      inboxId: "legacy@agentmail.to",
      autoReply: false,
    });
    await expect(
      a.action(api.email.rotateMarker, {
        expectedMarker: `[Rehearsal:${aliceToken}]`,
      }),
    ).rejects.toThrow("does not have a shared email marker");
    await expect(
      a.action(api.email.rotateMarker, { expectedMarker: "invalid" }),
    ).rejects.toThrow("current subject marker");
    expect(await a.query(api.email.inbox, {})).toEqual({
      address: "legacy@agentmail.to",
      autoReply: false,
    });
  });
});
