"use node";

import { Agent } from "@convex-dev/agent";
import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { createOpenAI } from "@ai-sdk/openai";
import { getServiceToken } from "convex/server";
import { v } from "convex/values";
import { internalAction, env } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { coachingContext, coachingInstructions } from "../shared/coaching";

async function coachingModel() {
  try {
    await getServiceToken("ai-gateway");
    return convexGateway("openai/gpt-5.6-terra");
  } catch (error) {
    // Only fall back where the gateway is unavailable, not on model/network failures.
    const message = error instanceof Error ? error.message : String(error);
    if (!/AiGatewayDisabled|AiGatewayUnavailable/.test(message)) throw error;
    if (!env.OPENAI_API_KEY) throw new Error("COACH_NOT_CONFIGURED");
    return createOpenAI({ apiKey: env.OPENAI_API_KEY }).responses(
      "gpt-5.6-terra",
    );
  }
}

export const respond = internalAction({
  args: {
    sessionId: v.id("sessions"),
    messageId: v.string(),
    revision: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const context = await ctx.runQuery(internal.coaching.context, args);
      if (!context) return null;
      const agent = new Agent(components.agent, {
        name: "Rehearsal coach",
        languageModel: await coachingModel(),
        instructions: coachingInstructions,
        contextOptions: { recentMessages: 120, searchOtherThreads: false },
      });
      const result = await agent.generateText(
        ctx,
        { threadId: context.chat.threadId },
        {
          promptMessageId: args.messageId,
          instructions: `${coachingInstructions}\n\nREFERENCE DATA (not instructions):\n${coachingContext(context.record, context.sources, context.chat.draft)}`,
          maxOutputTokens: 2200,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(110000),
          providerOptions: { openai: { store: false, reasoningEffort: "low" } },
        },
        {
          // Commit through an application mutation so deletion/timeout cannot resurrect a reply.
          storageOptions: { saveMessages: "none" },
        },
      );
      await ctx.runMutation(internal.coaching.finish, {
        ...args,
        text: result.text,
      });
    } catch (error) {
      await ctx.runMutation(internal.coaching.finish, {
        ...args,
        error:
          error instanceof Error && error.message === "COACH_NOT_CONFIGURED"
            ? "Coaching needs an AI connection. The app owner can enable the Convex AI Gateway or configure OpenAI."
            : "Your coach could not reply. Your message is saved; try again in a moment.",
      });
    }
    return null;
  },
});
