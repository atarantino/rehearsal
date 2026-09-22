import { feedbackSchema, type PracticeSession } from "./types";
import { isCandidateQuestionsHandoff } from "./interview";

export class FeedbackValidationError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = "FeedbackValidationError";
  }
}

// Join streaming deltas without adding spaces or changing speaker order.
export function feedbackTranscript(s: PracticeSession) {
  const turns: { speaker: "user" | "assistant"; text: string }[] = [];
  for (const fragment of [...s.fragments].sort(
    (a, b) => a.start_ms - b.start_ms,
  )) {
    if (!fragment.delta) continue;
    const last = turns.at(-1);
    if (last?.speaker === fragment.speaker) last.text += fragment.delta;
    else turns.push({ speaker: fragment.speaker, text: fragment.delta });
  }
  return turns;
}

export function feedbackSections(s: PracticeSession) {
  const turns = feedbackTranscript(s);
  const boundary =
    s.config.mode === "mock"
      ? turns.findIndex(
          (turn) =>
            turn.speaker === "assistant" &&
            isCandidateQuestionsHandoff(turn.text),
        )
      : -1;
  return {
    interview: boundary < 0 ? turns : turns.slice(0, boundary),
    candidateQuestions: boundary < 0 ? [] : turns.slice(boundary),
  };
}

// Only whitespace and typographic quote marks are equivalent. Keep offsets so
// accepted evidence is always copied from the original, never model wording.
function normalizeQuote(text: string) {
  let normalized = "";
  const starts: number[] = [],
    ends: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const value = /\s/u.test(char)
      ? " "
      : /[‘’]/u.test(char)
        ? "'"
        : /[“”]/u.test(char)
          ? '"'
          : char;
    if (value === " " && normalized.endsWith(" ")) {
      ends[ends.length - 1] = i + 1;
    } else {
      normalized += value;
      starts.push(i);
      ends.push(i + 1);
    }
  }
  return { text: normalized, starts, ends };
}

function originalQuote(quote: string, sources: string[]): string | null {
  if (!quote.trim()) return null;
  // Prefer an exact match anywhere over a formatting-equivalent match.
  for (const source of sources) if (source.includes(quote)) return quote;
  const needle = normalizeQuote(quote.trim()).text;
  for (const source of sources) {
    const normalized = normalizeQuote(source);
    const start = normalized.text.indexOf(needle);
    if (start !== -1)
      return source.slice(
        normalized.starts[start],
        normalized.ends[start + needle.length - 1],
      );
  }
  return null;
}

export function validateFeedback(raw: unknown, s: PracticeSession) {
  const f = feedbackSchema.parse(raw);
  const { interview: transcript, candidateQuestions } = feedbackSections(s);
  const userTurns = transcript
    .filter((turn) => turn.speaker === "user")
    .map((turn) => turn.text);
  const text = userTurns.join(" ");
  if (f.candidateQuestionsFeedback) {
    const quote = originalQuote(
      f.candidateQuestionsFeedback.quote,
      candidateQuestions
        .filter((turn) => turn.speaker === "user")
        .map((turn) => turn.text),
    );
    if (quote === null)
      throw new FeedbackValidationError(
        "The candidate-question reflection contained an unverified quote. Retry feedback.",
        "candidateQuestionsFeedback.quote",
      );
    f.candidateQuestionsFeedback.quote = quote;
  }
  for (const group of ["strengths", "improvements"] as const)
    for (const [index, item] of f[group].entries()) {
      const quote = originalQuote(item.quote, userTurns);
      if (quote === null)
        throw new FeedbackValidationError(
          "The feedback contained a quote that could not be verified. Your transcript is saved. Retry feedback to generate a grounded review.",
          `${group}[${index}].quote`,
        );
      item.quote = quote;
    }
  if (!f.insufficientEvidence && f.improvements.length !== 2)
    throw new FeedbackValidationError(
      "The review was incomplete. Retry feedback.",
      "improvements",
    );
  if (s.config.relation !== "retry") f.comparison = null;
  if (s.config.mode === "coached") f.retryQuestion = null;
  if (f.retryQuestion) {
    const question = originalQuote(
      f.retryQuestion,
      transcript
        .filter((turn) => turn.speaker === "assistant")
        .map((turn) => turn.text),
    );
    if (question === null || isCandidateQuestionsHandoff(question))
      throw new FeedbackValidationError(
        "The suggested retry question could not be verified. Retry feedback.",
        "retryQuestion",
      );
    f.retryQuestion = question;
  }
  if (!userTurns.some((turn) => turn.trim())) {
    f.insufficientEvidence = true;
    f.outline = [];
    f.missingDetails = [];
    f.retryQuestion = null;
  }
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
        throw new FeedbackValidationError(
          "The answer outline included an unsupported number. Retry feedback for a grounded outline.",
          "outline",
        );
  return f;
}
