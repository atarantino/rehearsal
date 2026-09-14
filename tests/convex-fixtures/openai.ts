// Test-only provider. The real voice actions, validation and persistence still run.
import { z } from "zod";
type Fragment = { speaker: string; delta: string };
const question = "Tell me about a difficult project.";
export async function openaiRequest(
  path: string,
  _body?: unknown,
): Promise<any> {
  if (path === "/live/sessions")
    return {
      session: { id: `fixture_${crypto.randomUUID()}` },
      transport: { sdp: "fixture-answer" },
    };
  if (path.endsWith("/hangup")) return null;
  throw new Error(`Unexpected fixture request: ${path}`);
}
export async function structured<T>(
  shape: z.ZodType<T>,
  name: string,
  _instructions: string,
  input: any,
): Promise<T> {
  const details = {
    company: "Acme",
    role: "Product designer",
    interviewDate: null,
    preparation: [],
    jobUrl: null,
  };
  if (name === "opportunity_details") return shape.parse(details);
  if (name === "preparation_brief")
    return shape.parse({
      ...details,
      summary: "Prepare examples of accessible product launches.",
      focusAreas: [
        {
          topic: "Product ownership",
          why: "The role involves leading launches.",
          sourceUrl: input.sources[0].url,
        },
      ],
      questions: [
        question,
        "Tell me about a collaboration.",
        "How did you handle ambiguity?",
      ],
      uncertainties: ["Confirm interview format."],
    });
  if (name !== "interview_feedback")
    throw new Error(`Unexpected fixture schema: ${name}`);
  if (input.context.background === "QA_FAIL_FEEDBACK")
    throw new Error("Fixture feedback unavailable. Retry feedback.");
  const quote = input.fragments
    .filter((f: Fragment) => f.speaker === "user")
    .map((f: Fragment) => f.delta)
    .join("");
  return shape.parse({
    summary:
      "You make your contribution clear. Explain the decision and outcome.",
    insufficientEvidence: !quote,
    strengths: quote
      ? [
          {
            title: "Ownership",
            quote,
            detail: "You describe your own actions.",
          },
        ]
      : [],
    improvements: quote
      ? [
          {
            title: "Explain the decision",
            quote,
            detail: "Explain the alternative you considered.",
          },
          {
            title: "Clarify the outcome",
            quote,
            detail: "Describe what changed without inventing a metric.",
          },
        ]
      : [],
    outline: [
      {
        label: "Your decision",
        text: "Describe speaking with support and changing the rollout.",
      },
    ],
    missingDetails: ["What made the launch difficult?"],
    retryQuestion: input.context.mode === "mock" ? question : null,
    comparison: input.previous
      ? "This attempt makes your actions easier to identify. Explain the outcome next."
      : null,
  });
}
