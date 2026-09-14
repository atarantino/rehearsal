import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { CodexRunner } from "../server/codex.js";
import { SubscriptionProvider } from "../server/subscription-provider.js";
import { OpenAIProvider } from "../server/provider.js";
import type { PracticeSession } from "../shared/types.js";
dotenv.config({ override: true, quiet: true });
const provider =
  process.env.REASONING_BACKEND === "api"
    ? new OpenAIProvider()
    : new SubscriptionProvider(new CodexRunner(resolve("data/.codex-runs")));
const samples = [
  { name: "short", status: "completed", answer: "I helped the team." },
  {
    name: "vague",
    status: "completed",
    answer:
      "We had a really hard project. Everybody worked really hard, and we did a good job.",
  },
  {
    name: "specific",
    status: "completed",
    answer:
      "I led a customer onboarding redesign. Support tickets showed that people could not find the import step. I interviewed five customers and prototyped two options. We chose the clearer option after usability testing. Support questions about importing fell from twenty per week to eight the following month. I learned to test the labels before adding more help text.",
  },
  {
    name: "incomplete",
    status: "partial",
    answer:
      "I disagreed with the project timeline because we had not tested the migration, and then I",
  },
] as const;
for (const sample of samples) {
  const session: PracticeSession = {
    version: 1,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    config: {
      mode: "coached",
      role: "Product manager",
      jobDescription: "",
      background: "",
    },
    question: "Tell me about a difficult project.",
    status: sample.status,
    fragments: [
      {
        event_id: "q",
        speaker: "assistant",
        delta: "Tell me about a difficult project.",
        start_ms: 0,
        end_ms: 1000,
      },
      {
        event_id: "a",
        speaker: "user",
        delta: sample.answer,
        start_ms: 1200,
        end_ms: 9000,
      },
    ],
    seconds: 10,
    usageConfirmed: true,
    backendUsage: {},
  };
  try {
    const feedback = await provider.feedback(session);
    console.log(JSON.stringify({ sample: sample.name, feedback }, null, 2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : "Evaluation failed.");
    process.exitCode = 1;
    break;
  }
}
console.log(
  "Review suggestions for specificity and factual grounding. Passing quote/number validation alone does not establish coaching quality.",
);
