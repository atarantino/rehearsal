import { feedbackSchema, speakerText, type PracticeSession } from "./types";
export function validateFeedback(raw: unknown, s: PracticeSession) {
  const f = feedbackSchema.parse(raw);
  const text = speakerText(s.fragments, "user");
  for (const item of [...f.strengths, ...f.improvements])
    if (!item.quote.trim() || !text.includes(item.quote))
      throw new Error(
        "The feedback contained a quote that could not be verified. Retry feedback to generate a grounded review.",
      );
  if (!f.insufficientEvidence && f.improvements.length !== 2)
    throw new Error("The review was incomplete. Retry feedback.");
  if (s.config.relation !== "retry") f.comparison = null;
  if (s.config.mode === "coached") f.retryQuestion = null;
  if (
    f.retryQuestion &&
    !speakerText(s.fragments, "assistant").includes(f.retryQuestion)
  )
    throw new Error(
      "The suggested retry question could not be verified. Retry feedback.",
    );
  if (s.config.mode === "coached") f.retryQuestion = null;
  const facts = (
    text +
    " " +
    s.config.background +
    " " +
    (s.config.resumeText ?? "")
  ).replace(/(\d+(?:[.,]\d+)*)\s+percent\b/gi, "$1%");
  const numbers = new Set(facts.match(/\b\d+(?:[.,]\d+)*(?:%?)/g) || []);
  for (const part of f.outline)
    for (const number of part.text.match(/\b\d+(?:[.,]\d+)*(?:%?)/g) || [])
      if (!numbers.has(number))
        throw new Error(
          "The answer outline included an unsupported number. Retry feedback for a grounded outline.",
        );
  return f;
}
