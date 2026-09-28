import { feedbackInput } from "../server/prompts";
import type { PracticeSession } from "./types";

export function bytePrefix(text: string, bytes: number) {
  const encoded = new TextEncoder().encode(text);
  if (encoded.length <= bytes) return text;
  // Decode only complete code points; every returned quote stays a verbatim prefix.
  let end = bytes;
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end--;
  return new TextDecoder().decode(encoded.subarray(0, end));
}
function turns<T extends { text: string }>(input: T[], bytes: number): T[] {
  const selected: T[] = [];
  for (const turn of input) {
    if (bytes <= 0 || selected.length >= 40) break;
    const text = bytePrefix(turn.text, bytes);
    if (text) selected.push({ ...turn, text });
    bytes -= new TextEncoder().encode(text).length;
  }
  return selected;
}
// First preserve all current speech and reduce optional reference material.
// Only if that still fails counting do we review explicit verbatim excerpts.
export function feedbackAlternatives(
  s: PracticeSession,
  previous?: PracticeSession,
) {
  const full = feedbackInput(s, previous);
  const context = {
    mode: s.config.mode,
    role: s.config.role,
    jobDescription: bytePrefix(s.config.jobDescription, 2000),
    background: bytePrefix(s.config.background, 2000),
    resumeText: bytePrefix(s.config.resumeText ?? "", 2000),
  };
  const reduced = {
    ...full,
    context,
    previous: full.previous
      ? {
          question: full.previous.question,
          transcript: turns(full.previous.transcript, 4000),
        }
      : null,
    inputCoverage:
      "Current transcript is complete. Optional references and prior-attempt speech may be excerpted; compare only the supplied evidence.",
  };
  return [
    reduced,
    {
      ...reduced,
      context: { mode: s.config.mode, role: bytePrefix(s.config.role, 200) },
      question: bytePrefix(s.question, 1000),
      transcript: turns(full.transcript, 4000),
      candidateQuestionsTranscript: turns(
        full.candidateQuestionsTranscript,
        1000,
      ),
      previous: null,
      inputCoverage:
        "Only the leading verbatim transcript excerpts are supplied. Assess only these excerpts, never assume missing speech did not occur, and do not compare attempts. This is not a review of the full interview.",
    },
  ] as const;
}
