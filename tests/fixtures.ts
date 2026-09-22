import { randomUUID } from "node:crypto";
import { feedbackSections } from "../shared/feedback.js";
import {
  speakerText,
  type PracticeSession,
  type Feedback,
} from "../shared/types.js";
import {
  AppError,
  validateFeedback,
  type Provider,
  type WireEvent,
} from "../server/provider.js";
export function record(): PracticeSession {
  return {
    version: 1,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    config: {
      mode: "coached",
      role: "Product manager",
      jobDescription: "",
      background: "",
    },
    question: "Tell me about a difficult project.",
    status: "completed",
    fragments: [],
    seconds: 30,
    usageConfirmed: true,
    backendUsage: {},
  };
}
export const answer =
  "I led a difficult launch. I spoke with support and changed the rollout. We shipped on time.";
export function sampleFeedback(
  s: PracticeSession,
  previous?: PracticeSession,
): Feedback {
  const sections = feedbackSections(s);
  const text = sections.interview
    .filter((turn) => turn.speaker === "user")
    .map((turn) => turn.text)
    .join("");
  const candidateQuestion = sections.candidateQuestions.find(
    (turn) => turn.speaker === "user",
  );
  return {
    summary:
      s.status === "partial"
        ? "This partial answer shows ownership; make the outcome easier to understand."
        : "You make your contribution clear. Add the decision behind it and the result.",
    insufficientEvidence: false,
    strengths: [
      {
        title: "You identify your contribution",
        quote: text,
        detail: "You describe actions that you personally took.",
      },
    ],
    improvements: [
      {
        title: "Explain the decision",
        quote: text,
        detail:
          "Explain why you changed the rollout and which alternative you considered.",
      },
      {
        title: "Make the result specific",
        quote: text,
        detail:
          "Give the actual outcome and say what you learned. Do not invent a metric.",
      },
    ],
    outline: [
      { label: "Your part", text: "Explain your role in the launch." },
      {
        label: "Your decision",
        text: "Describe speaking with support and changing the rollout.",
      },
    ],
    missingDetails: [
      "What made the launch difficult?",
      "What changed because of your decision?",
    ],
    retryQuestion: null,
    candidateQuestionsFeedback: candidateQuestion
      ? {
          title: "You explored the role",
          quote: candidateQuestion.text,
          detail:
            "Confirm the details that matter to you with the real interviewer.",
        }
      : null,
    comparison: previous
      ? "This attempt makes your actions easier to identify. Explain the outcome next."
      : null,
  };
}
export class FixtureProvider implements Provider {
  controls = new Map<string, (e: WireEvent) => void>();
  creates = 0;
  feedbacks = 0;
  failOnce = new Set<string>();
  available = true;
  ready() {
    return this.available;
  }
  async create() {
    this.creates++;
    return { liveId: `live_fixture_${randomUUID()}`, sdp: "fixture-answer" };
  }
  attach(id: string, onEvent: (e: WireEvent) => void) {
    this.controls.set(id, onEvent);
    return {
      send: (e: WireEvent) => {
        if (e.type === "session.close")
          setTimeout(
            () =>
              onEvent({
                type: "session.closed",
                reason: "close_requested",
                usage: { seconds: 40 },
              }),
            10,
          );
      },
      close: () => {
        this.controls.delete(id);
      },
    };
  }
  async feedback(s: PracticeSession, previous?: PracticeSession) {
    this.feedbacks++;
    if (
      s.config.background === "TEST_FEEDBACK_FAILURE" &&
      !this.failOnce.has(s.id)
    ) {
      this.failOnce.add(s.id);
      throw new AppError("Simulated feedback failure. Retry feedback.", 502);
    }
    return validateFeedback(sampleFeedback(s, previous), s);
  }
}
