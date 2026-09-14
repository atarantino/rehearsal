import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CoachingPanel } from "../src/Coaching";
import { practiceWithDraft, type CoachingState } from "../shared/coaching";
import type { PracticeSession } from "../shared/types";
import "../src/style.css";
const key = "coaching-ui-fixture";
const empty: CoachingState = {
  messages: [],
  sources: [],
  draft: "",
  pending: false,
  canRetry: false,
  turns: 0,
};
const attempt: PracticeSession = {
  version: 1,
  id: "original-attempt",
  createdAt: "2026-09-13",
  config: {
    mode: "coached",
    role: "Designer",
    background: "My background",
    jobDescription: "Product design",
  },
  question: "Tell me about a project",
  status: "completed",
  fragments: [],
  seconds: 30,
  usageConfirmed: true,
  backendUsage: {},
};
function Harness() {
  const [data, setData] = useState<CoachingState>(() =>
    JSON.parse(localStorage.getItem(key) || JSON.stringify(empty)),
  );
  const [practice, setPractice] = useState("");
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(data));
  }, [data]);
  function reply() {
    setTimeout(
      () =>
        setData((d) => ({
          ...d,
          pending: false,
          error: undefined,
          canRetry: false,
          messages: [
            ...d.messages,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              text: "Launch.pdf, page 1 describes a team outcome. What did you personally own?\n\nStart with your role, explain the decision, and confirm the result.",
            },
          ],
        })),
      60,
    );
  }
  return (
    <main style={{ maxWidth: 1100, margin: "32px auto", padding: 16 }}>
      <section className="coaching-section">
        <h2>Work on this story</h2>
        <CoachingPanel
          data={data}
          onPractice={(draft) =>
            setPractice(JSON.stringify(practiceWithDraft(attempt, draft)))
          }
          actions={{
            async send(text) {
              setData((d) => ({
                ...d,
                pending: true,
                turns: d.turns + 1,
                messages: [
                  ...d.messages,
                  { id: crypto.randomUUID(), role: "user", text },
                ],
              }));
              if (text === "simulate failure")
                setTimeout(
                  () =>
                    setData((d) => ({
                      ...d,
                      pending: false,
                      canRetry: true,
                      error:
                        "Your coach could not reply. Your message is saved; try again.",
                    })),
                  60,
                );
              else reply();
            },
            async retry() {
              setData((d) => ({
                ...d,
                pending: true,
                error: undefined,
                canRetry: false,
              }));
              reply();
            },
            async addNotes(name, text) {
              setData((d) => ({
                ...d,
                sources: [
                  ...d.sources,
                  { id: crypto.randomUUID(), name, text, kind: "notes" },
                ],
              }));
            },
            async upload(file) {
              setData((d) => ({
                ...d,
                sources: [
                  ...d.sources,
                  {
                    id: crypto.randomUUID(),
                    name: file.name,
                    kind: "pdf",
                    pages: 1,
                    text: "[Page 1]\nTeam launch reduced support tickets.",
                  },
                ],
              }));
            },
            async removeSource(id) {
              setData((d) => ({
                ...d,
                sources: d.sources.filter((s) => s.id !== id),
              }));
            },
            async saveDraft(draft) {
              setData((d) => ({ ...d, draft }));
            },
          }}
        />
      </section>
      {practice && <output data-testid="practice-config">{practice}</output>}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
