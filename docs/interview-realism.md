# Interview realism checks

The mock flow uses the existing `gpt-live-1` connection and `gpt-5.6-terra` delegation. The five-minute focused drill is unchanged. Clock cues use `session.thinking.append`: the initial prompt tells the interviewer to apply them at the next natural conversational boundary. No cue forces a hangup or marks a transcript segment as complete.

The [OpenAI session guide](https://developers.openai.com/api/docs/guides/live-conversations) distinguishes context acknowledgment from model action or playback completion. The [delegation guide](https://developers.openai.com/api/docs/guides/live-delegation) documents quiet thinking context versus instructions that can interrupt speech. Browser/provider-payload tests establish what the application sends, not the model's spoken behavior.

## Automated checks

- Unit tests: missed clock phases, hard-cap suppression, streamed/late handoff fragments, Q&A quote isolation, retry-question rejection, outline metric isolation, legacy feedback, and prepared question progression.
- Convex tests: server-owned brief selection, cross-user refusal, retry snapshot preservation, and correction/retry of feedback that incorrectly quotes Q&A as a behavioral answer.
- Browser tests: duplicate start events, mute/unmute, transport interruption/recovery, cue cleanup on quit, unchanged focused hard cap, and the separate Q&A reflection.

Run `npm run build`, `npm test`, and `npm run test:e2e`.

## Opt-in real-provider check

```sh
npx tsx scripts/evaluate-interview.ts --run
npx tsx scripts/evaluate-interview.ts --run --coached
```

These commands use the configured OpenAI key and incur TTS, Live, and feedback API usage. They generate synthetic candidate speech, use the app's actual prompts/feedback validation, and write a synthetic transcript report to `/tmp/rehearsal-mock-eval.json` or `/tmp/rehearsal-coached-eval.json`. No app accounts or production data are used; no audio is saved. A voice session is capped at 180 seconds. The mock check accelerates clock context to exercise Q&A/closing without waiting 15 minutes.

Inspect the report for:

1. A simulation-framed welcome and understandable agenda.
2. Respect for a seven-second thinking pause, distinguishing a brief acknowledgment from a new question or interruption.
3. A candidate-Q&A handoff after the clock cue and a candid response to unavailable team size/hiring timeline.
4. A natural closing and a separate, quote-grounded candidate-question reflection; the retry question still targets a behavioral answer.

The harness uses a primary WebSocket and synthetic speech. It is a prompt/provider smoke check, not a human listening evaluation, browser/WebRTC transport check, statistical quality benchmark, or proof that a full-length interview will always transition correctly. A transcript-derived Q&A boundary can miss unexpected paraphrases or transcription errors; the feedback prompt also excludes Q&A semantically as a fallback.

## Observed provider behavior (September 22, 2026)

After tightening the initial prompt's clock-transition rule, an accelerated mock run completed with a spoken agenda, no output transcript during a seven-second thinking pause, the recognized Q&A handoff, an explicit acknowledgment that team size and hiring timing were unknown, and a natural close directing the user to End & review. Its generated feedback passed evidence validation and kept the candidate questions in their own reflection. An earlier run ignored the quiet Q&A cue and asked another behavioral follow-up, so the app now explicitly prioritizes the application clock in its initial instructions. This is one successful synthetic run, not a reliability guarantee.

The handoff matcher only accepts explicit, standalone invitations directed at the interviewer. Generic clarifications and embedded quoted examples do not count. Overlapping user fragments that began before the handoff finished remain behavioral evidence. Unexpected transcription errors, quoted invitations with sentence-like boundaries, or an interviewer that resumes behavioral questions after handing over can still misclassify a segment; the schema does not claim provider-verified phases.

A separate focused-practice provider run retained the single-question flow and responded to the thinking pause with “Sure, take your time.” It did not change topics during the pause. Its feedback passed evidence validation. Neither run is a hard latency benchmark.
