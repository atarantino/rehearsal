// Pilot guardrails, separate from the purchased voice/preparation allowances.
export const AI_MODEL = "gpt-5.6-terra";
export const AI_POLICY = {
  feedback: { input: 12000, output: 2500 },
  delegation: { input: 6000, output: 1024 },
  extraction: { input: 12000, output: 1000 },
  brief: { input: 20000, output: 2000 },
} as const;
export type AiOperation = keyof typeof AI_POLICY;
export const delegationLimit = (mode: "coached" | "mock") =>
  mode === "mock" ? 20 : 6;
export const delegationFallback =
  "Backend reasoning is unavailable. Continue from the supplied context and conversation, following the interview agenda. Do not repeat an answered question or leave candidate Q&A.";
// Bound the content of a Live append conservatively below its 500-token limit.
export function shortLiveText(text: string) {
  let result = "";
  for (const char of text) {
    if (new TextEncoder().encode(result + char).byteLength > 400) break;
    result += char;
  }
  return result;
}
