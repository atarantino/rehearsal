// Opt-in paid provider check with synthetic speech only. No app accounts/data.
// Clock cues are accelerated; this does not prove a full 15-minute WebRTC run.
import dotenv from "dotenv";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { liveConfig } from "../server/prompts.js";
import { OpenAIProvider } from "../server/provider.js";
import {
  mockOpening,
  coachedOpening,
  mockClockCues,
  isCandidateQuestionsHandoff,
} from "../shared/interview.js";
import { feedbackSections } from "../shared/feedback.js";
import type { PracticeSession } from "../shared/types.js";

if (!process.argv.includes("--run")) {
  console.log(
    "Paid voice/TTS/feedback check: npx tsx scripts/evaluate-interview.ts --run [--coached] [--output=/tmp/interview-eval.json]",
  );
  process.exit(0);
}
dotenv.config({ quiet: true });
const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error("OPENAI_API_KEY is required.");
const mode = process.argv.includes("--coached") ? "coached" : "mock";
const output =
  process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) ??
  `/tmp/rehearsal-${mode}-eval.json`;
const s: PracticeSession = {
  version: 1,
  id: randomUUID(),
  createdAt: new Date().toISOString(),
  status: "active",
  question: "Tell me about a migration you owned.",
  config: {
    mode,
    role: "Software engineer",
    background: "",
    jobDescription: "Own reliable service migrations.",
    preparationBrief: {
      company: "Example Company (synthetic)",
      role: "Software engineer",
      summary: "The role involves reliable service migrations.",
      interviewDate: null,
      preparation: [],
      questions: ["Tell me about a migration you owned."],
      focusAreas: [
        {
          topic: "Migration ownership",
          why: "Core responsibility",
          sourceUrl: "https://example.com/job",
        },
      ],
      uncertainties: ["Team size and hiring timeline are unknown."],
    },
  },
  fragments: [],
  seconds: 0,
  usageConfirmed: false,
  backendUsage: {},
};
const phrases = [
  "I led a migration of our onboarding service. Let me think for a moment about the decision I made.",
  "I chose a staged rollout because our support team needed time to learn the new workflow. I checked errors after each stage and paused the release when an import failed. We fixed that issue before expanding access. We completed the migration with no lost customer records. That's the end of my example.",
  "How many engineers are on this team, and when would I hear about a hiring decision?",
  "That's all my questions. Thank you for the practice. I'm ready to finish.",
];
const audio = await Promise.all(
  phrases.map(async (input) => {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input,
        response_format: "pcm",
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(`Synthetic speech HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }),
);
const ws = new WebSocket("wss://api.openai.com/v1/live/sessions", {
  headers: { Authorization: `Bearer ${key}` },
  handshakeTimeout: 15000,
});
let started = false,
  closed = false,
  failure = "",
  lastAssistantAt = 0,
  openedAt = Date.now();
const observations: Record<string, unknown> = {
  mode,
  acceleratedClock: true,
  transport: "websocket",
  audioStored: false,
};
const acknowledgments: string[] = [];
const eventCounts: Record<string, number> = {};
const send = (event: object) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
};
ws.on("error", () => {
  failure = "Voice WebSocket error";
});
ws.on("close", () => {
  closed = true;
});
ws.on("message", (data) => {
  const e = JSON.parse(data.toString());
  eventCounts[e.type] = (eventCounts[e.type] ?? 0) + 1;
  if (e.type === "session.started") {
    started = true;
    openedAt = Date.now();
  }
  if (e.type === "session.closed") {
    s.usageConfirmed = true;
    s.seconds = e.usage?.seconds ?? 0;
    closed = true;
  }
  if (e.type === "error")
    failure = `Provider error: ${e.error?.code ?? "unknown"}`;
  if (e.type === "session.thinking.appended")
    acknowledgments.push(e.client_event_id);
  if (
    e.type === "session.input_transcript.delta" ||
    e.type === "session.output_transcript.delta"
  ) {
    if (e.type === "session.output_transcript.delta")
      lastAssistantAt = Date.now();
    s.fragments.push({
      event_id: e.event_id,
      speaker:
        e.type === "session.input_transcript.delta" ? "user" : "assistant",
      delta: e.delta,
      start_ms: e.start_ms,
      end_ms: e.end_ms,
    });
  }
});
async function until(predicate: () => boolean, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (failure || closed || Date.now() > deadline)
      throw new Error(failure || "Timed out or voice closed early");
    await delay(100);
  }
}
let pcm: Buffer | undefined;
let offset = 0;
// Live's primary WebSocket needs a continuous audio timeline, including silence.
const silence = Buffer.alloc(960);
const feed = setInterval(() => {
  if (!started || closed) return;
  let chunk: Buffer = silence;
  if (pcm) {
    chunk = pcm.subarray(offset, offset + 960);
    offset += 960;
    if (offset >= pcm.length) pcm = undefined;
  }
  send({ type: "session.input_audio.append", audio: chunk.toString("base64") });
}, 20);
const deadline = setTimeout(() => {
  failure = "180-second evaluation cap";
  send({ type: "session.close" });
  ws.close();
}, 180000);
async function speak(index: number) {
  pcm = audio[index];
  offset = 0;
  await until(() => !pcm, 40000);
}
async function responseAfter(time: number) {
  await until(
    () => lastAssistantAt > time && Date.now() - lastAssistantAt > 2000,
  );
}
function cue(index: number) {
  send({
    type: "session.thinking.append",
    event_id: `clock-${index}`,
    delegation_id: null,
    content: mockClockCues[index].content,
  });
}
try {
  observations.stage = "connecting";
  await until(() => ws.readyState === WebSocket.OPEN);
  send({
    type: "session.start",
    session: {
      ...liveConfig(s),
      audio: { format: { type: "audio/pcm", rate: 24000 } },
    },
  });
  observations.stage = "starting";
  await until(() => started);
  observations.stage = "opening";
  const openingAt = Date.now();
  send({
    type: "session.instructions.append",
    event_id: randomUUID(),
    delegation_id: null,
    content: mode === "mock" ? mockOpening : coachedOpening,
  });
  await responseAfter(openingAt);
  observations.opening = s.fragments
    .filter((f) => f.speaker === "assistant")
    .map((f) => f.delta)
    .join("");
  observations.stage = "candidate-answer";
  await speak(0);
  const pauseStart = s.fragments.length;
  await delay(7000);
  observations.speechDuringThinkingPause = s.fragments
    .slice(pauseStart)
    .filter((f) => f.speaker === "assistant")
    .map((f) => f.delta)
    .join("");
  if (mode === "mock") cue(1);
  await speak(1);
  const answerEnd = Date.now();
  await responseAfter(answerEnd);
  if (mode === "mock") {
    observations.stage = "candidate-questions";
    const sections = feedbackSections(s);
    observations.recognizedHandoff = sections.candidateQuestions.length > 0;
    if (!sections.candidateQuestions.length)
      throw new Error("No recognized candidate-Q&A handoff after clock cue");
    await speak(2);
    const questionEnd = Date.now();
    const questionStart = s.fragments.length;
    await responseAfter(questionEnd);
    observations.unknownFactAnswer = s.fragments
      .slice(questionStart)
      .filter((f) => f.speaker === "assistant")
      .map((f) => f.delta)
      .join("");
    cue(2);
    await speak(3);
    const goodbyeEnd = Date.now();
    const goodbyeStart = s.fragments.length;
    await responseAfter(goodbyeEnd);
    observations.closing = s.fragments
      .slice(goodbyeStart)
      .filter((f) => f.speaker === "assistant")
      .map((f) => f.delta)
      .join("");
  }
  s.status = "completed";
  observations.stage = "completed";
} catch (e) {
  s.status = "partial";
  observations.error = e instanceof Error ? e.message : "Evaluation failed";
  process.exitCode = 1;
} finally {
  send({ type: "session.close", event_id: randomUUID() });
  await delay(1500);
  clearInterval(feed);
  clearTimeout(deadline);
  ws.close();
  s.seconds ||= (Date.now() - openedAt) / 1000;
  s.endedAt = new Date().toISOString();
}
try {
  s.feedback = await new OpenAIProvider(key).feedback(s);
  observations.feedbackValidated = true;
} catch (e) {
  observations.feedbackValidated = false;
  observations.feedbackError =
    e instanceof Error ? e.message : "Feedback failed";
  process.exitCode = 1;
}
observations.clockAcknowledgments = acknowledgments;
observations.eventCounts = eventCounts;
await writeFile(output, JSON.stringify({ observations, session: s }, null, 2), {
  mode: 0o600,
});
console.log(JSON.stringify({ observations, output }, null, 2));
