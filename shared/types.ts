import { z } from "zod";
export const configSchema = z.object({
  mode: z.enum(["mock", "coached"]),
  role: z.string().trim().min(1, "Enter a target role.").max(200),
  jobDescription: z.string().max(15000).default(""),
  background: z.string().max(15000).default(""),
  previousId: z.string().min(1).max(100).optional(),
  opportunityId: z.string().min(1).max(100).optional(),
  startingQuestion: z.string().max(1000).optional(),
  relation: z.enum(["retry", "next"]).optional(),
});
export type SessionConfig = z.infer<typeof configSchema>;
export const fragmentSchema = z
  .object({
    event_id: z.string().min(1).max(200),
    speaker: z.enum(["user", "assistant"]),
    delta: z.string().max(20000),
    start_ms: z.number().nonnegative().finite(),
    end_ms: z.number().nonnegative().finite(),
  })
  .refine((v) => v.end_ms >= v.start_ms);
export type Fragment = z.infer<typeof fragmentSchema>;
export const evidenceSchema = z.object({
  title: z.string(),
  quote: z.string(),
  detail: z.string(),
});
export const feedbackSchema = z.object({
  summary: z.string(),
  insufficientEvidence: z.boolean(),
  strengths: z.array(evidenceSchema).max(3),
  improvements: z.array(evidenceSchema).max(2),
  outline: z.array(z.object({ label: z.string(), text: z.string() })).max(6),
  missingDetails: z.array(z.string()).max(4),
  comparison: z.string().nullable(),
  retryQuestion: z.string().nullable(),
});
export type Feedback = z.infer<typeof feedbackSchema>;
export type PracticeSession = {
  version: 1;
  id: string;
  createdAt: string;
  config: SessionConfig;
  question: string;
  status: "connecting" | "active" | "completed" | "partial";
  fragments: Fragment[];
  liveId?: string;
  endedAt?: string;
  seconds: number;
  usageConfirmed: boolean;
  closeReason?: string;
  feedback?: Feedback;
  feedbackError?: string;
  reasoningBackend?: "api" | "codex";
  feedbackBackend?: "api" | "codex";
  backendError?: string;
  backendUsage: Record<string, { input_tokens: number; output_tokens: number }>;
};
export type SessionSummary = Pick<
  PracticeSession,
  "id" | "createdAt" | "config" | "status" | "question" | "seconds"
> & { hasFeedback: boolean };
export const questions = [
  "Tell me about yourself and the experience you would bring to this role.",
  "Tell me about a time you took ownership of a difficult problem.",
  "Describe a disagreement with a colleague. How did you work through it?",
  "Tell me about something that did not go to plan. What did you learn?",
  "Describe a time you had to make a decision with incomplete information.",
  "Tell me about a result you are proud of. What was your contribution?",
];
export function speakerText(
  fragments: Fragment[],
  speaker: Fragment["speaker"],
) {
  return [...fragments]
    .filter((f) => f.speaker === speaker)
    .sort((a, b) => a.start_ms - b.start_ms)
    .map((f) => f.delta)
    .join("");
}
export function mergeFragments(old: Fragment[], incoming: Fragment[]) {
  const ids = new Set(old.map((f) => f.event_id));
  return [
    ...old,
    ...incoming.filter((f) => {
      if (ids.has(f.event_id)) return false;
      ids.add(f.event_id);
      return true;
    }),
  ];
}
export function questionFor(config: SessionConfig, previous?: PracticeSession) {
  if (previous && config.relation === "retry")
    return previous.config.mode === "mock"
      ? previous.feedback?.retryQuestion || previous.question
      : previous.question;
  if (previous && config.relation === "next")
    return questions[
      (questions.indexOf(previous.question) + 1) % questions.length
    ];
  return questions[0];
}
export const maxSeconds = (mode: SessionConfig["mode"]) =>
  mode === "mock" ? 1200 : 300;
