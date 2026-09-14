import { v, ConvexError, type Infer } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { config, record } from "./validators";
import {
  liveConfig,
  feedbackInput,
  feedbackInstructions,
} from "../server/prompts";
import { feedbackSchema, type PracticeSession } from "../shared/types";
import { validateFeedback } from "../shared/feedback";
import { openaiRequest, structured } from "./openai";
export const status = action({
  args: {},
  returns: v.object({
    configured: v.boolean(),
    reasoningBackend: v.literal("api"),
    firecrawl: v.boolean(),
    agentmail: v.boolean(),
  }),
  handler: async () => ({
    configured: !!process.env.OPENAI_API_KEY,
    reasoningBackend: "api" as const,
    firecrawl: !!process.env.FIRECRAWL_API_KEY,
    agentmail:
      !!process.env.AGENTMAIL_API_KEY && !!process.env.AGENTMAIL_WEBHOOK_SECRET,
  }),
});
export const start = action({
  args: { config, sdp: v.string(), requestId: v.string() },
  returns: v.object({ record, sdp: v.string() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ record: Infer<typeof record>; sdp: string }> => {
    if (
      args.sdp.length > 100000 ||
      !args.sdp.startsWith("v=0") ||
      !args.sdp.includes("m=audio")
    )
      throw new ConvexError("Invalid microphone connection. Retry.");
    const id: Id<"sessions"> = await ctx.runMutation(
      internal.sessions.reserve,
      { config: args.config, requestId: args.requestId },
    );
    let liveId: string | undefined;
    try {
      const s = await ctx.runQuery(internal.sessions.full, { id });
      const previous = s.config.previousId
        ? await ctx
            .runQuery(api.sessions.get, {
              id: s.config.previousId as Id<"sessions">,
            })
            .catch(() => undefined)
        : undefined;
      const data = await openaiRequest("/live/sessions", {
        session: liveConfig(s, previous),
        transport: { type: "webrtc", sdp: args.sdp },
      });
      liveId = data?.session?.id;
      if (!liveId || !data.transport?.sdp)
        throw new Error("Incomplete voice connection.");
      const activated = await ctx.runMutation(internal.sessions.activate, {
        id,
        liveId,
      });
      if (!activated)
        throw new ConvexError(
          "This session was closed before it connected. Start another attempt.",
        );
      return { record: { ...s, status: "active" }, sdp: data.transport.sdp };
    } catch (e) {
      if (liveId)
        await openaiRequest(
          `/live/sessions/${encodeURIComponent(liveId)}/hangup`,
          {},
        ).catch(() => {});
      await ctx.runMutation(internal.sessions.markClosed, {
        id,
        reason: "startup_failed",
      });
      throw e;
    }
  },
});
export const close = action({
  args: { id: v.id("sessions") },
  returns: record,
  handler: async (ctx, { id }): Promise<Infer<typeof record>> => {
    await ctx.runQuery(api.sessions.get, { id });
    const s = await ctx.runQuery(internal.sessions.load, { id });
    if (s?.liveId)
      await openaiRequest(
        `/live/sessions/${encodeURIComponent(s.liveId)}/hangup`,
        {},
      ).catch(async () => {
        await ctx.scheduler.runAfter(1000, internal.voice.expire, { id });
      });
    await ctx.runMutation(internal.sessions.markClosed, {
      id,
      reason: "close_requested",
    });
    return ctx.runQuery(internal.sessions.full, { id });
  },
});
export const expire = internalAction({
  args: { id: v.id("sessions"), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { id, attempt = 0 }) => {
    const s = await ctx.runQuery(internal.sessions.load, { id });
    if (!s) return null;
    if (s.liveId)
      await openaiRequest(
        `/live/sessions/${encodeURIComponent(s.liveId)}/hangup`,
        {},
      ).catch(async () => {
        if (attempt < 2)
          await ctx.scheduler.runAfter(
            5000 * (attempt + 1),
            internal.voice.expire,
            { id, attempt: attempt + 1 },
          );
      });
    await ctx.runMutation(internal.sessions.markClosed, {
      id,
      reason: "time_limit",
    });
    return null;
  },
});
export const review = action({
  args: { id: v.id("sessions") },
  returns: record,
  handler: async (ctx, { id }): Promise<Infer<typeof record>> => {
    const claimed = await ctx.runMutation(internal.sessions.claimFeedback, {
      id,
    });
    if (claimed === null) return ctx.runQuery(api.sessions.get, { id });
    try {
      const s = await ctx.runQuery(internal.sessions.full, { id });
      const previous = s.config.previousId
        ? await ctx
            .runQuery(api.sessions.get, {
              id: s.config.previousId as Id<"sessions">,
            })
            .catch(() => undefined)
        : undefined;
      const input = feedbackInput(s, previous);
      let feedback;
      let validationError = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const raw = await structured(
          feedbackSchema,
          "interview_feedback",
          feedbackInstructions +
            (validationError
              ? "\nYour previous result failed evidence validation: " +
                validationError +
                " Copy short exact quotes from current user speech, preserving punctuation and whitespace. Do not reuse a previous-attempt quote."
              : ""),
          input,
        );
        try {
          feedback = validateFeedback(raw, s);
          break;
        } catch (error) {
          if (attempt === 1) throw error;
          validationError =
            error instanceof Error
              ? error.message
              : "Use only verified evidence.";
        }
      }
      if (!feedback) throw new Error("No grounded feedback.");
      if (!previous) feedback.comparison = null;
      await ctx.runMutation(internal.sessions.saveFeedback, {
        id,
        claim: claimed,
        feedback,
      });
      return ctx.runQuery(api.sessions.get, { id });
    } catch (e) {
      await ctx.runMutation(internal.sessions.saveFeedback, {
        id,
        claim: claimed,
        error: "Feedback could not be completed. Retry feedback.",
      });
      throw e;
    }
  },
});
// Snapshot the provider id before deletion so cleanup does not depend on a retained row.
export const hangupDeleted = internalAction({
  args: { liveId: v.string(), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { liveId, attempt = 0 }) => {
    try {
      await openaiRequest(
        `/live/sessions/${encodeURIComponent(liveId)}/hangup`,
        {},
      );
    } catch {
      if (attempt < 2)
        await ctx.scheduler.runAfter(
          5000 * (attempt + 1),
          internal.voice.hangupDeleted,
          { liveId, attempt: attempt + 1 },
        );
    }
    return null;
  },
});
