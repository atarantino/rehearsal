/** Shared by voice prompts, the browser clock, and transcript review. */
export const candidateQuestionsHandoff = "What questions do you have for me?";

export const mockInterviewInstructions = `This is a practice simulation, not an interview on behalf of an employer. Briefly welcome the candidate and explain the agenda: about 15 minutes, two or three experience areas, then time for their questions. Ask the supplied starting question first. Use the preparation brief's sourced focus areas and the candidate's answers to choose later topics. Acknowledge transitions naturally. Do not read the brief or URLs aloud.
Allow thinking pauses and corrections. A pause is not permission to change topics. If a candidate asks for time, wait. Keep your own questions concise. Use clock updates as context for your NEXT natural turn, never as a reason to cut off an answer. Aim to leave the final three minutes for candidate questions; the 20-minute cap is a safety limit, not a target.
After the experience questions, explicitly hand over with exactly: "${candidateQuestionsHandoff}" Say this only when actually handing over, not in the introduction. Stay in candidate Q&A after that. Answer only from confirmed facts in the supplied preparation brief or job description. Keep uncertainties as unconfirmed. When a fact is absent, say you do not know and suggest asking the real interviewer. Do not infer internal team details, compensation, company policies, or hiring timelines. Do not imply you represent the employer. If there is no company context, help the candidate identify what to ask the real interviewer without inventing an answer.
When the candidate has no more questions, thank them for practicing, close naturally, and invite them to select End & review. Do not invent a hiring decision, promise next steps, coach aloud, or start another interview topic. Wait quietly after closing until they end or ask another question.`;

export const mockOpening =
  "Begin now: welcome the candidate to this practice simulation and briefly explain the agenda (experience questions, then their questions, about 15 minutes). Then ask the supplied starting question as one clear question and wait. Do not read setup or earlier feedback aloud. Do not say the candidate-Q&A handoff yet.";
export const coachedOpening =
  "Begin now: briefly welcome the candidate, then ask the starting question from the reference data. Ask it as one clear question and wait for their answer. Do not read setup or earlier feedback aloud.";

export const mockClockCues = [
  {
    atSeconds: 8 * 60,
    content:
      "Interview clock: about 8 minutes elapsed, 7 minutes left in the planned interview. At the next natural turn, move to a remaining relevant experience area if needed. Leave the final three minutes for the candidate's questions. If already in candidate Q&A or closed, stay there. Do not interrupt speech or a thinking pause.",
  },
  {
    atSeconds: 12 * 60,
    content: `Interview clock: about 12 minutes elapsed, 3 minutes left in the planned interview. After the current answer finishes, hand over with "${candidateQuestionsHandoff}" unless already in candidate Q&A. Do not start another behavioral question. Answer from confirmed supplied facts or admit unknowns. Do not interrupt speech or a thinking pause.`,
  },
  {
    atSeconds: 15 * 60,
    content: `Interview clock: the planned 15 minutes have elapsed; five minutes remain before the safety cap. Finish the current exchange naturally. If candidate Q&A has not happened, offer it now with "${candidateQuestionsHandoff}" after the candidate finishes. Otherwise close when their questions are answered, thank them for practicing and invite End & review. Do not start another behavioral topic or repeat a closing already given.`,
  },
  {
    atSeconds: 18 * 60,
    content:
      "Interview clock: about two minutes remain before the 20-minute safety cap. Finish the current exchange, acknowledge any unanswered question for the real interviewer, and close this practice conversation with thanks and End & review. Do not start new topics, promise hiring next steps, or repeat a closing already given.",
  },
] as const;

// Cues describe elapsed wall time, not model or playback completion. After a
// suspended tab/reconnect, send only the latest relevant cue, never a burst.
export function mockClockCue(elapsedSeconds: number, lastCue: number) {
  if (elapsedSeconds >= 20 * 60) return undefined;
  let index = -1;
  mockClockCues.forEach((cue, i) => {
    if (cue.atSeconds <= elapsedSeconds) index = i;
  });
  return index > lastCue ? { index, ...mockClockCues[index] } : undefined;
}

// The interviewer is instructed to use the exact handoff. Accept common spoken
// variants too. This is transcript-derived segmentation, not a provider phase
// signal: prompts still exclude candidate Q&A if a handoff is paraphrased.
export function isCandidateQuestionsHandoff(text: string) {
  return (
    /\bwhat questions do you have for me\s*\?/i.test(text) ||
    /(?:^|[.!?]\s*|\b)(?:what questions (?:do|would) you (?:have|like to ask)(?: for (?:me|us))?|do you have (?:any )?questions for (?:me|us)|what would you like to (?:ask|know)(?: (?:me|about (?:the role|the team|the company)))?)\s*[?!.]*\s*$/i.test(
      text.trim(),
    )
  );
}
