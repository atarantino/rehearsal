import { v } from "convex/values";
export const resumeMode = v.union(
  v.literal("default"),
  v.literal("custom"),
  v.literal("none"),
);
export const brief = v.object({
  company: v.string(),
  role: v.string(),
  interviewDate: v.union(v.string(), v.null()),
  preparation: v.array(v.string()),
  summary: v.string(),
  focusAreas: v.array(
    v.object({ topic: v.string(), why: v.string(), sourceUrl: v.string() }),
  ),
  questions: v.array(v.string()),
  uncertainties: v.array(v.string()),
});
export const config = v.object({
  mode: v.union(v.literal("mock"), v.literal("coached")),
  role: v.string(),
  jobDescription: v.string(),
  background: v.string(),
  preparationBrief: v.optional(brief),
  resumeMode: v.optional(v.union(v.literal("default"), v.literal("none"))),
  resumeText: v.optional(v.string()),
  previousId: v.optional(v.string()),
  relation: v.optional(v.union(v.literal("retry"), v.literal("next"))),
  opportunityId: v.optional(v.id("opportunities")),
  startingQuestion: v.optional(v.string()),
});
export const fragment = v.object({
  event_id: v.string(),
  speaker: v.union(v.literal("user"), v.literal("assistant")),
  delta: v.string(),
  start_ms: v.number(),
  end_ms: v.number(),
});
const evidence = v.object({
  title: v.string(),
  quote: v.string(),
  detail: v.string(),
});
export const feedback = v.object({
  summary: v.string(),
  insufficientEvidence: v.boolean(),
  strengths: v.array(evidence),
  improvements: v.array(evidence),
  outline: v.array(v.object({ label: v.string(), text: v.string() })),
  missingDetails: v.array(v.string()),
  comparison: v.union(v.string(), v.null()),
  retryQuestion: v.union(v.string(), v.null()),
});
export const record = v.object({
  version: v.literal(1),
  id: v.string(),
  createdAt: v.string(),
  config,
  question: v.string(),
  status: v.union(
    v.literal("connecting"),
    v.literal("active"),
    v.literal("completed"),
    v.literal("partial"),
  ),
  fragments: v.array(fragment),
  endedAt: v.optional(v.string()),
  seconds: v.number(),
  usageConfirmed: v.boolean(),
  closeReason: v.optional(v.string()),
  feedback: v.optional(feedback),
  feedbackError: v.optional(v.string()),
  reasoningBackend: v.literal("api"),
  feedbackBackend: v.optional(v.literal("api")),
  backendUsage: v.record(
    v.string(),
    v.object({ input_tokens: v.number(), output_tokens: v.number() }),
  ),
});
export const source = v.object({
  url: v.string(),
  title: v.string(),
  text: v.string(),
});
export const prepStatus = v.union(
  v.literal("queued"),
  v.literal("reading"),
  v.literal("researching"),
  v.literal("writing"),
  v.literal("ready"),
  v.literal("failed"),
);

export const attachment = v.object({
  id: v.string(),
  filename: v.string(),
  contentType: v.string(),
  size: v.number(),
  status: v.union(
    v.literal("pending"),
    v.literal("imported"),
    v.literal("skipped"),
    v.literal("failed"),
  ),
  text: v.optional(v.string()),
  note: v.optional(v.string()),
});
