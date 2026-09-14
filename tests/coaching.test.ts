import { test } from "node:test";
import assert from "node:assert/strict";
import { extractProjectPdf } from "../shared/projectPdf";
import {
  coachingContext,
  practiceWithDraft,
  MAX_PDF_BYTES,
} from "../shared/coaching";
import { projectPdf } from "./pdfFixture";
import { record, sampleFeedback } from "./fixtures";
import { configSchema } from "../shared/types";

test("PDF extraction preserves page references, and rejects unsupported or oversized content", async () => {
  const result = await extractProjectPdf(
    projectPdf([
      "Team result: 20 percent fewer tickets.",
      "My role: rollout planning.",
    ]),
  );
  assert.equal(result.pages, 2);
  assert.match(result.text, /\[Page 1\]\nTeam result/);
  assert.match(result.text, /\[Page 2\]\nMy role/);
  await assert.rejects(
    extractProjectPdf(new TextEncoder().encode("not PDF").buffer),
    /not a PDF/,
  );
  await assert.rejects(
    extractProjectPdf(new ArrayBuffer(MAX_PDF_BYTES + 1)),
    /4 MB/,
  );
  await assert.rejects(
    extractProjectPdf(projectPdf(Array(21).fill("Page"))),
    /20 pages/,
  );
  await assert.rejects(
    extractProjectPdf(projectPdf([""])),
    /no selectable text/,
  );
  await assert.rejects(
    extractProjectPdf(projectPdf(Array(20).fill("A".repeat(1100)))),
    /too much text/,
  );
});

test("project context stays separate from original evidence and retries carry bounded preparation", () => {
  const attempt = record();
  attempt.fragments = [
    {
      event_id: "speech",
      speaker: "user",
      delta: "I planned the rollout.",
      start_ms: 0,
      end_ms: 1000,
    },
  ];
  attempt.feedback = sampleFeedback(attempt);
  attempt.config.background = "x".repeat(15000);
  const snapshot = JSON.stringify(attempt);
  const context = JSON.parse(
    coachingContext(
      attempt,
      [
        {
          id: "source",
          name: "Launch",
          kind: "notes",
          text: "Team result: 20% fewer tickets",
        },
      ],
      "Draft",
    ),
  );
  assert.equal(
    context.originalAttempt.transcript,
    "user: I planned the rollout.",
  );
  assert.match(context.addedAfterInterview[0].text, /20%/);
  assert.doesNotMatch(context.originalAttempt.transcript, /20%/);
  const retry = practiceWithDraft(attempt, "New practice notes");
  assert.equal(retry.previousId, attempt.id);
  assert.equal(retry.relation, "retry");
  assert.equal(retry.background, attempt.config.background);
  assert.equal(retry.practiceNotes, "New practice notes");
  configSchema.parse(practiceWithDraft(attempt, "d".repeat(8000)));
  assert.equal(JSON.stringify(attempt), snapshot);
});
