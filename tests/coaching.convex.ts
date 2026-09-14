/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import agent from "@convex-dev/agent/test";
import rateLimiter from "@convex-dev/rate-limiter/test";
import schema from "../convex/schema";
import { api, internal, components } from "../convex/_generated/api";
import { record, sampleFeedback } from "./fixtures";
import { projectPdf } from "./pdfFixture";

const modelState = vi.hoisted(() => ({
  prompts: [] as unknown[],
  fail: false,
}));
vi.mock("convex/server", async (original) => ({
  ...(await original<typeof import("convex/server")>()),
  getServiceToken: async () => "synthetic-token",
}));
vi.mock("@convex-dev/ai-sdk-provider", async () => {
  const { mockModel } = await import("@convex-dev/agent");
  return {
    convexGateway: () => {
      const model = mockModel({
        content: [
          {
            type: "text",
            text: "The Launch notes describe a team result. What part did you personally own?",
          },
        ],
      });
      const generate = model.doGenerate.bind(model);
      model.doGenerate = async (args) => {
        modelState.prompts.push(args.prompt);
        if (modelState.fail) throw new Error("synthetic model outage");
        return generate(args);
      };
      return model;
    },
  };
});

const modules = import.meta.glob("../convex/**/*.ts");
async function setup() {
  const t = convexTest(schema, modules);
  agent.register(t);
  rateLimiter.register(t);
  const { alice, bob, sessionId } = await t.run(async (ctx) => {
    const alice = await ctx.db.insert("users", { username: "alice" });
    const bob = await ctx.db.insert("users", { username: "bob" });
    const attempt = {
      ...record(),
      config: {
        mode: "coached" as const,
        role: "Designer",
        background: "",
        jobDescription: "Product design role",
      },
      reasoningBackend: "api" as const,
      feedbackBackend: "api" as const,
    };
    attempt.endedAt = new Date().toISOString();
    attempt.feedback = sampleFeedback(attempt);
    const sessionId = await ctx.db.insert("sessions", {
      ownerId: alice,
      requestId: "synthetic",
      record: attempt,
      fragmentCount: 1,
      transcriptBytes: 20,
      expiresAt: Date.now(),
      feedbackState: "ready",
    });
    await ctx.db.patch(sessionId, { record: { ...attempt, id: sessionId } });
    await ctx.db.insert("fragments", {
      sessionId,
      fragment: {
        event_id: "speech",
        speaker: "user",
        delta: "I planned the rollout.",
        start_ms: 0,
        end_ms: 1000,
      },
    });
    return { alice, bob, sessionId };
  });
  const a = t.withIdentity({ subject: alice });
  const b = t.withIdentity({ subject: bob });
  const claim = async () =>
    t.run(async (ctx) => {
      const chat = (await ctx.db
        .query("coaching")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
        .unique())!;
      return {
        sessionId,
        messageId: chat.activeMessageId!,
        revision: chat.revision,
      };
    });
  return { t, a, b, sessionId, claim };
}
beforeEach(() => {
  vi.useFakeTimers();
  modelState.prompts = [];
  modelState.fail = false;
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("private story coaching", () => {
  it("rejects unauthenticated and cross-owner reads, messages, drafts, and attachments", async () => {
    const { t, a, b, sessionId } = await setup();
    await expect(t.query(api.coaching.get, { sessionId })).rejects.toThrow(
      "Sign in",
    );
    for (const operation of [
      () => b.query(api.coaching.get, { sessionId }),
      () => b.mutation(api.coaching.send, { sessionId, text: "hello" }),
      () => b.mutation(api.coaching.saveDraft, { sessionId, draft: "stolen" }),
      () =>
        b.mutation(api.coaching.addNotes, {
          sessionId,
          name: "Notes",
          text: "stolen",
        }),
      () =>
        b.action(api.projectFiles.uploadPdf, {
          sessionId,
          name: "Project.pdf",
          bytes: projectPdf(),
        }),
    ])
      await expect(operation()).rejects.toThrow("Session not found");
    await a.mutation(api.coaching.addNotes, {
      sessionId,
      name: "Launch",
      text: "Private notes",
    });
    const sourceId = await t.run(
      async (ctx) => (await ctx.db.query("projectSources").first())!._id,
    );
    await expect(
      b.mutation(api.coaching.removeSource, { sourceId }),
    ).rejects.toThrow("Session not found");
  });

  it("uses the Agent thread with feedback, transcript, sources, and conversation history", async () => {
    const { a, sessionId, claim } = await setup();
    const original = await a.query(api.sessions.get, { id: sessionId });
    await a.mutation(api.coaching.addNotes, {
      sessionId,
      name: "Launch",
      text: "Team result: 20 percent fewer tickets.",
    });
    await a.mutation(api.coaching.send, {
      sessionId,
      text: "Help explain my contribution.",
    });
    expect((await a.query(api.coaching.get, { sessionId })).pending).toBe(true);
    await expect(
      a.mutation(api.coaching.send, { sessionId, text: "duplicate" }),
    ).rejects.toThrow("Wait");
    await a.action(internal.coach.respond, await claim());
    const first = await a.query(api.coaching.get, { sessionId });
    expect(first.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(first.pending).toBe(false);
    expect(first.canRetry).toBe(false);
    await a.mutation(api.coaching.send, {
      sessionId,
      text: "I personally planned the rollout.",
    });
    await a.action(internal.coach.respond, await claim());
    const prompt = JSON.stringify(modelState.prompts.at(-1));
    expect(prompt).toContain("I planned the rollout.");
    expect(prompt).toContain(original.feedback!.summary);
    expect(prompt).toContain("20 percent fewer tickets");
    expect(prompt).toContain("What part did you personally own?");
    expect(
      (await a.query(api.coaching.get, { sessionId })).messages,
    ).toHaveLength(4);
    expect(
      (await a.query(api.sessions.get, { id: sessionId })).feedback,
    ).toEqual(original.feedback);
  });

  it("recovers a failed or timed-out reply without duplicating the user's message", async () => {
    const { a, sessionId, claim } = await setup();
    await a.mutation(api.coaching.send, { sessionId, text: "Help me" });
    const oldClaim = await claim();
    modelState.fail = true;
    await a.action(internal.coach.respond, oldClaim);
    expect((await a.query(api.coaching.get, { sessionId })).canRetry).toBe(
      true,
    );
    await a.mutation(api.coaching.retry, { sessionId });
    await a.mutation(internal.coaching.finish, {
      ...oldClaim,
      text: "Stale reply",
    });
    expect((await a.query(api.coaching.get, { sessionId })).pending).toBe(true);
    modelState.fail = false;
    await a.action(internal.coach.respond, await claim());
    const state = await a.query(api.coaching.get, { sessionId });
    expect(state.messages).toHaveLength(2);
    expect(state.messages.some((m) => m.text === "Stale reply")).toBe(false);
    await a.mutation(api.coaching.send, {
      sessionId,
      text: "Another question",
    });
    await a.mutation(internal.coaching.expireReply, await claim());
    expect((await a.query(api.coaching.get, { sessionId })).error).toContain(
      "too long",
    );
  });

  it("extracts uploaded PDFs and deletes storage, sources, thread, and draft with the attempt", async () => {
    const { t, a, sessionId, claim } = await setup();
    await a.action(api.projectFiles.uploadPdf, {
      sessionId,
      name: "Launch.pdf",
      bytes: projectPdf(),
    });
    await a.mutation(api.coaching.saveDraft, {
      sessionId,
      draft: "My practice outline",
    });
    await a.mutation(api.coaching.send, {
      sessionId,
      text: "Help with this PDF",
    });
    const pending = await claim();
    const { storageId, threadId } = await t.run(async (ctx) => ({
      storageId: (await ctx.db.query("projectSources").first())!.storageId!,
      threadId: (await ctx.db.query("coaching").first())!.threadId,
    }));
    expect(
      (await a.query(api.coaching.get, { sessionId })).sources[0].text,
    ).toContain("[Page 1]");
    await a.mutation(api.sessions.remove, { id: sessionId });
    await a.mutation(internal.coaching.finish, {
      ...pending,
      text: "Late reply must not return",
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("coaching").first()).toBeNull();
      expect(await ctx.db.query("projectSources").first()).toBeNull();
      expect(await ctx.storage.get(storageId)).toBeNull();
    });
    expect(
      await t.query(components.agent.threads.getThread, { threadId }),
    ).toBeNull();
    await expect(a.query(api.coaching.get, { sessionId })).rejects.toThrow(
      "Session not found",
    );
  });

  it("bounds source count, message size, draft size, and requires reviewed attempts", async () => {
    const { t, a, sessionId } = await setup();
    await expect(
      a.mutation(api.coaching.send, { sessionId, text: "x".repeat(4001) }),
    ).rejects.toThrow("4,000");
    await expect(
      a.mutation(api.coaching.saveDraft, {
        sessionId,
        draft: "x".repeat(8001),
      }),
    ).rejects.toThrow("8,000");
    for (let i = 0; i < 3; i++)
      await a.mutation(api.coaching.addNotes, {
        sessionId,
        name: `Notes ${i}`,
        text: "Context",
      });
    await expect(
      a.mutation(api.coaching.addNotes, {
        sessionId,
        name: "Overflow",
        text: "Context",
      }),
    ).rejects.toThrow("three");
    await t.run(async (ctx) => {
      const s = (await ctx.db.get(sessionId))!;
      await ctx.db.patch(sessionId, {
        record: { ...s.record, feedback: undefined },
      });
    });
    await expect(
      a.mutation(api.coaching.send, { sessionId, text: "Too early" }),
    ).rejects.toThrow("Get feedback");
  });
});
