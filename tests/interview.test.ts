import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mockClockCue,
  candidateQuestionsHandoff,
} from "../shared/interview.js";
import { feedbackSections, validateFeedback } from "../shared/feedback.js";
import { questionFor, questions, type Fragment } from "../shared/types.js";
import { feedbackInput, liveConfig } from "../server/prompts.js";
import { record, sampleFeedback, answer } from "./fixtures.js";

test("clock skips stale phases after suspension and stops at the safety cap", () => {
  assert.equal(mockClockCue(479, -1), undefined);
  assert.equal(mockClockCue(480, -1)?.index, 0);
  assert.equal(mockClockCue(600, 0), undefined);
  assert.equal(mockClockCue(950, -1)?.index, 2);
  assert.equal(mockClockCue(1100, 2)?.index, 3);
  assert.equal(mockClockCue(1200, -1), undefined);
});

function mockWithQuestions() {
  const s = record();
  s.config.mode = "mock";
  const fragments: [Fragment["speaker"], string][] = [
    ["assistant", s.question],
    ["user", answer],
    ["assistant", "Before we wrap up. What questions do you "],
    ["assistant", "have for me?"],
    ["user", "How does the team support its 42 engineers?"],
    ["assistant", "I don't have that information. Ask your real interviewer."],
    ["user", "Thank you."],
  ];
  s.fragments = fragments.map(([speaker, delta], i) => ({
    event_id: String(i),
    speaker,
    delta,
    start_ms: i * 1000,
    end_ms: i * 1000 + 800,
  }));
  return s;
}

test("Q&A is separated from answers by actual speech, including split and late fragments", () => {
  const s = mockWithQuestions();
  s.fragments.reverse();
  const { interview, candidateQuestions } = feedbackSections(s);
  assert.equal(interview.length, 2);
  assert.equal(interview[1].text, answer);
  assert.equal(
    candidateQuestions[0].text,
    "Before we wrap up. " + candidateQuestionsHandoff,
  );
  assert.deepEqual(feedbackInput(s).transcript, interview);
  assert.deepEqual(
    feedbackInput(s).candidateQuestionsTranscript,
    candidateQuestions,
  );
  s.config.mode = "coached";
  assert.equal(feedbackSections(s).candidateQuestions.length, 0);
});

test("candidate questions cannot supply behavioral quotes, retry questions, or outline metrics", () => {
  const s = mockWithQuestions();
  const good = sampleFeedback(s);
  good.retryQuestion = s.question;
  assert.deepEqual(validateFeedback(good, s), good);
  assert.throws(
    () =>
      validateFeedback(
        {
          ...good,
          strengths: [
            {
              ...good.strengths[0],
              quote: "How does the team support its 42 engineers?",
            },
          ],
        },
        s,
      ),
    /quote that could not be verified/,
  );
  assert.throws(
    () =>
      validateFeedback(
        { ...good, retryQuestion: candidateQuestionsHandoff },
        s,
      ),
    /retry question/,
  );
  assert.throws(
    () =>
      validateFeedback(
        {
          ...good,
          outline: [{ label: "Result", text: "I supported 42 engineers." }],
        },
        s,
      ),
    /unsupported number/,
  );
  assert.throws(
    () =>
      validateFeedback(
        {
          ...good,
          candidateQuestionsFeedback: {
            ...good.candidateQuestionsFeedback!,
            quote: answer,
          },
        },
        s,
      ),
    /unverified quote/,
  );
});

test("overlapping answer tails stay behavioral even across streamed handoff fragments", () => {
  const s = mockWithQuestions();
  s.fragments = [
    {
      event_id: "q",
      speaker: "assistant",
      delta: s.question,
      start_ms: 0,
      end_ms: 500,
    },
    {
      event_id: "a",
      speaker: "user",
      delta: "I led the rollout. ",
      start_ms: 700,
      end_ms: 4000,
    },
    {
      event_id: "h1",
      speaker: "assistant",
      delta: "What questions do you ",
      start_ms: 3500,
      end_ms: 3800,
    },
    {
      event_id: "h2",
      speaker: "assistant",
      delta: "have for me?",
      start_ms: 3900,
      end_ms: 4200,
    },
    {
      event_id: "qa",
      speaker: "user",
      delta: "How is onboarding organized?",
      start_ms: 4500,
      end_ms: 5000,
    },
    // Arrives late and overlaps the handoff. It still belongs to the answer.
    {
      event_id: "tail",
      speaker: "user",
      delta: "We shipped safely.",
      start_ms: 3700,
      end_ms: 4400,
    },
  ];
  const sections = feedbackSections(s);
  assert.equal(
    sections.interview[1].text,
    "I led the rollout. We shipped safely.",
  );
  assert.equal(
    sections.candidateQuestions[1].text,
    "How is onboarding organized?",
  );
  const feedback = sampleFeedback(s);
  feedback.strengths[0].quote = "We shipped safely.";
  assert.equal(
    validateFeedback(feedback, s).strengths[0].quote,
    "We shipped safely.",
  );
});

test("handoff variants, user quotations, and legacy no-handoff interviews are handled conservatively", () => {
  const s = mockWithQuestions();
  s.fragments[2].delta = "Do you have any questions for us?";
  s.fragments[3].delta = "";
  assert.equal(feedbackSections(s).interview.length, 2);
  s.fragments[2].delta = "Tell me about another project.";
  s.fragments[4].delta = candidateQuestionsHandoff;
  assert.equal(feedbackSections(s).candidateQuestions.length, 0);
  for (const clarification of [
    "What would you like to know?",
    'An interviewer might ask "What questions do you have for me?"',
    'For example, you could say: "What questions do you have for me?"',
  ]) {
    s.fragments[2].delta = clarification;
    assert.equal(feedbackSections(s).candidateQuestions.length, 0);
  }
});

test("brief questions precede generic fallback and retries preserve the selected question", () => {
  const s = record();
  s.config.preparationBrief = {
    company: "Example",
    role: "Designer",
    interviewDate: null,
    summary: "A role",
    preparation: [],
    focusAreas: [],
    uncertainties: [],
    questions: [
      "Describe a design migration.",
      "Describe your research process.",
    ],
  };
  s.question = s.config.preparationBrief.questions[0];
  assert.equal(questionFor(s.config), s.question);
  assert.equal(questionFor({ ...s.config, relation: "retry" }, s), s.question);
  assert.equal(
    questionFor({ ...s.config, relation: "next" }, s),
    s.config.preparationBrief.questions[1],
  );
  s.question = s.config.preparationBrief.questions[1];
  assert.equal(questionFor({ ...s.config, relation: "next" }, s), questions[0]);
  s.question = questions[0];
  assert.equal(questionFor({ ...s.config, relation: "next" }, s), questions[1]);
  s.config.preparationBrief.questions = [
    questions[0],
    questions[0],
    "Custom question?",
  ];
  assert.equal(
    questionFor({ ...s.config, relation: "next" }, s),
    "Custom question?",
  );
  s.question = "Custom question?";
  assert.equal(questionFor({ ...s.config, relation: "next" }, s), questions[1]);
  s.question = questions[1];
  assert.equal(questionFor({ ...s.config, relation: "next" }, s), questions[2]);
});

test("mock simulation agenda reaches direct and delegated prompts without changing the drill", () => {
  const s = record();
  assert.doesNotMatch(liveConfig(s).instructions, /hand over with exactly/);
  s.config.mode = "mock";
  const c = liveConfig(s);
  for (const prompt of [c.instructions, c.delegation.responses.instructions]) {
    assert.match(prompt, /practice simulation/);
    assert.ok(prompt.includes(candidateQuestionsHandoff));
    assert.match(prompt, /never as a reason to cut off an answer/);
    assert.match(prompt, /do not know/);
  }
});
