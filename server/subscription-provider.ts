import { z } from "zod";
import { feedbackSchema, type PracticeSession } from "../shared/types.js";
import { AppError, OpenAIProvider, validateFeedback } from "./provider.js";
import { CodexRunner, CodexError } from "./codex.js";
import { feedbackInstructions, feedbackInput, liveConfig } from "./prompts.js";
const followupSchema = z.object({ suggestion: z.string().min(1).max(1600) });
export class SubscriptionProvider extends OpenAIProvider {
  readonly reasoningBackend = "codex" as const;
  constructor(
    private runner: CodexRunner,
    key?: string,
  ) {
    super(key);
  }
  async checkReasoning() {
    try {
      await this.runner.check();
    } catch (e) {
      throw new AppError(
        e instanceof Error ? e.message : "Codex is unavailable.",
        503,
      );
    }
  }
  protected sessionConfig(s: PracticeSession, previous?: PracticeSession) {
    return { ...liveConfig(s, previous), delegation: { type: "client" } };
  }
  async create(s: PracticeSession, sdp: string, previous?: PracticeSession) {
    await this.checkReasoning();
    return super.create(s, sdp, previous);
  }
  async feedback(s: PracticeSession, previous?: PracticeSession) {
    try {
      const raw = await this.runner.run(
        feedbackSchema,
        feedbackInstructions,
        feedbackInput(s, previous),
      );
      const result = validateFeedback(raw, s);
      if (!previous) result.comparison = null;
      return result;
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(
        e instanceof CodexError
          ? e.message
          : "Codex feedback failed. Your transcript is saved; retry feedback.",
        503,
      );
    }
  }
  async followup(s: PracticeSession, signal: AbortSignal) {
    const result = await this.runner.run(
      followupSchema,
      `Help a warm but probing behavioral interviewer decide what to ask next. The supplied fragments may overlap, contain corrections, or be incomplete. Use the most recent evidence. Return one concise suggested spoken question or clarification, at most 80 words. Do not grade or coach aloud. Never invent the user's experience. For coached mode, stay on the original question, ask no more than two relevant follow-ups, then invite them to click Review answer. For mock mode, cover ownership, decisions, collaboration, setbacks, results and reflection across the conversation. Do not repeat a question already answered. A late result is context for the ongoing conversation, not permission to interrupt or ignore newer user corrections.`,
      feedbackInput(s),
      signal,
      45000,
    );
    return result.suggestion;
  }
}
