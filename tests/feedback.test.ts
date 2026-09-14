import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFeedback } from "../shared/feedback.js";
import { feedbackInput } from "../server/prompts.js";
import { record, sampleFeedback } from "./fixtures.js";

function session(text: string) {
  const s = record();
  s.fragments = [
    { event_id: "one", speaker: "user", delta: text, start_ms: 0, end_ms: 100 },
  ];
  return s;
}

test("formatting-only quote differences are restored to exact original evidence", () => {
  const s = session("🙂 I’m proud of the  rollout.\nWe called it “Launch”.");
  const raw = sampleFeedback(s);
  const quote = 'I\'m proud of the rollout. We called it "Launch".';
  raw.strengths[0].quote = quote;
  raw.improvements.forEach((item) => {
    item.quote = quote;
  });
  const result = validateFeedback(raw, s);
  assert.equal(result.strengths[0].quote, s.fragments[0].delta.slice(3));
  assert.equal(result.improvements[0].quote, result.strengths[0].quote);
  assert.equal(raw.strengths[0].quote, quote);
});

test("quote repair still rejects invented wording, numbers, negation and missing punctuation", () => {
  const s = session(
    "I did not lead the launch. We shipped 10 units, then stopped.",
  );
  for (const quote of [
    "I led the launch.",
    "I did lead the launch.",
    "We shipped 100 units",
    "10 units then stopped",
    "We shipped ... then stopped.",
    "   ",
  ]) {
    const raw = sampleFeedback(s);
    raw.strengths[0].quote = quote;
    assert.throws(
      () => validateFeedback(raw, s),
      /quote that could not be verified/,
    );
  }
});

test("feedback input joins token deltas into chronological speaker turns without rewriting speech", () => {
  const s = session("I ");
  s.fragments.push(
    {
      event_id: "three",
      speaker: "assistant",
      delta: "What happened?",
      start_ms: 300,
      end_ms: 400,
    },
    {
      event_id: "two",
      speaker: "user",
      delta: "led the rollout.",
      start_ms: 100,
      end_ms: 200,
    },
    {
      event_id: "four",
      speaker: "user",
      delta: "We shipped.",
      start_ms: 500,
      end_ms: 600,
    },
  );
  const before = structuredClone(s.fragments);
  const input = feedbackInput(s);
  assert.deepEqual(input.transcript, [
    { speaker: "user", text: "I led the rollout." },
    { speaker: "assistant", text: "What happened?" },
    { speaker: "user", text: "We shipped." },
  ]);
  assert.deepEqual(s.fragments, before);
  const raw = sampleFeedback(s);
  raw.strengths[0].quote = "rollout.We shipped";
  assert.throws(
    () => validateFeedback(raw, s),
    /quote that could not be verified/,
  );
});

test("quotes cannot come from assistant speech, setup, resume or a previous attempt", () => {
  const s = session("I led the rollout.");
  s.config.background = "I managed a team.";
  s.config.resumeText = "I built the product.";
  s.config.relation = "retry";
  s.fragments.push({
    event_id: "assistant",
    speaker: "assistant",
    delta: "You saved the project.",
    start_ms: 200,
    end_ms: 300,
  });
  const previous = session("I doubled sales.");
  assert.ok(feedbackInput(s, previous).previous);
  for (const quote of [
    "I managed a team.",
    "I built the product.",
    "You saved the project.",
    "I doubled sales.",
  ]) {
    const raw = sampleFeedback(s);
    raw.strengths[0].quote = quote;
    assert.throws(
      () => validateFeedback(raw, s),
      /quote that could not be verified/,
    );
  }
});
