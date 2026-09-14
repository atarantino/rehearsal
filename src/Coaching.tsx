import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  FileText,
  MessageCircle,
  Paperclip,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  MAX_COACHING_TURNS,
  MAX_DRAFT_TEXT,
  MAX_PDF_BYTES,
  MAX_SOURCE_TEXT,
  MAX_SOURCES,
  type CoachingState,
} from "../shared/coaching";

export type CoachingActions = {
  send(text: string): Promise<unknown>;
  retry(): Promise<unknown>;
  addNotes(name: string, text: string): Promise<unknown>;
  upload(file: File): Promise<unknown>;
  removeSource(id: string): Promise<unknown>;
  saveDraft(draft: string): Promise<unknown>;
};
function errorText(error: unknown) {
  const e = error as { data?: unknown; message?: string };
  return typeof e.data === "string"
    ? e.data
    : e.message?.split("Called by client")[0] ||
        "That didn’t save. Please try again.";
}

export function Coaching({
  sessionId,
  onPractice,
}: {
  sessionId: string;
  onPractice(draft: string): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [opened, setOpened] = useState(false);
  return (
    <section className="coaching-section" aria-label="Story coaching">
      <div className="coaching-heading">
        <div>
          <p className="eyebrow">BUILD ON YOUR FEEDBACK</p>
          <h2>
            <MessageCircle size={22} /> Work on this story
          </h2>
          <p className="muted">
            Your coach has this answer and its feedback. Add project context,
            find the missing details, and shape your next attempt.
          </p>
        </div>
        <button
          className="secondary"
          aria-expanded={expanded}
          onClick={() => {
            setOpened(true);
            setExpanded(!expanded);
          }}
        >
          {expanded ? "Close coaching" : "Work on this story"}
          <ArrowRight size={17} />
        </button>
      </div>
      {opened && (
        <div hidden={!expanded}>
          <ConnectedCoaching
            sessionId={sessionId as Id<"sessions">}
            onPractice={onPractice}
          />
        </div>
      )}
    </section>
  );
}

function ConnectedCoaching({
  sessionId,
  onPractice,
}: {
  sessionId: Id<"sessions">;
  onPractice(draft: string): void;
}) {
  const data = useQuery(api.coaching.get, { sessionId });
  const send = useMutation(api.coaching.send);
  const retry = useMutation(api.coaching.retry);
  const addNotes = useMutation(api.coaching.addNotes);
  const removeSource = useMutation(api.coaching.removeSource);
  const saveDraft = useMutation(api.coaching.saveDraft);
  const uploadPdf = useAction(api.projectFiles.uploadPdf);
  if (!data)
    return (
      <p role="status" className="muted">
        Loading your coaching conversation…
      </p>
    );
  return (
    <CoachingPanel
      data={data}
      onPractice={onPractice}
      actions={{
        send: (text) => send({ sessionId, text }),
        retry: () => retry({ sessionId }),
        addNotes: (name, text) => addNotes({ sessionId, name, text }),
        removeSource: (sourceId) =>
          removeSource({ sourceId: sourceId as Id<"projectSources"> }),
        saveDraft: (draft) => saveDraft({ sessionId, draft }),
        upload: async (file) =>
          uploadPdf({
            sessionId,
            name: file.name,
            bytes: await file.arrayBuffer(),
          }),
      }}
    />
  );
}

export function CoachingPanel({
  data,
  actions,
  onPractice,
}: {
  data: CoachingState;
  actions: CoachingActions;
  onPractice(draft: string): void;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState(data.draft);
  const previousDraft = useRef(data.draft);
  const draftInput = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const uploadInput = useRef<HTMLInputElement>(null);
  const dirty = draft !== data.draft;
  useEffect(() => {
    const previous = previousDraft.current;
    setDraft((current) => (current === previous ? data.draft : current));
    previousDraft.current = data.draft;
  }, [data.draft]);
  useEffect(() => {
    if (follow.current && log.current)
      log.current.scrollTop = log.current.scrollHeight;
  }, [data.messages.length, data.pending]);
  useEffect(() => {
    if (!dirty && !notes && !message) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, notes, message]);
  const waiting = !!busy || data.pending;
  async function perform(label: string, fn: () => Promise<unknown>) {
    if (busy) return;
    setError("");
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }
  async function send(text: string) {
    if (waiting || !text.trim()) return;
    await perform("Sending…", async () => {
      await actions.send(text.trim());
      setMessage("");
      follow.current = true;
    });
  }
  return (
    <div className="coaching-workspace">
      <div className="coaching-context">
        <span className="tag">Answer + feedback included</span>
        <span className="tag">Role context included</span>
        <p>
          Project materials add context for your next attempt. Your original
          feedback stays tied to what you said.
        </p>
      </div>
      <div className="coaching-columns">
        <div className="coaching-conversation">
          <div
            ref={log}
            className="coaching-messages"
            role="log"
            aria-label="Coaching conversation"
            aria-live="polite"
            onScroll={() => {
              const el = log.current!;
              follow.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 60;
            }}
          >
            {!data.messages.length && (
              <div className="coaching-welcome">
                <Sparkles size={24} />
                <h3>Let’s find the details only you can add.</h3>
                <p>
                  Ask about your feedback, or share project materials so your
                  coach can help you explain your contribution.
                </p>
              </div>
            )}
            {data.messages.map((m) => (
              <article key={m.id} className={`coaching-message ${m.role}`}>
                <span>{m.role === "user" ? "You" : "Your coach"}</span>
                <p>{m.text}</p>
                {m.role === "assistant" && (
                  <button
                    className="text-button"
                    onClick={() => {
                      if (m.text.length > MAX_DRAFT_TEXT) {
                        setError(
                          "This reply is too long for a draft. Copy the relevant part into your practice draft.",
                        );
                        return;
                      }
                      setDraft(m.text);
                      draftInput.current?.focus();
                    }}
                  >
                    Use as practice draft
                  </button>
                )}
              </article>
            ))}
            {data.pending && (
              <p className="coaching-thinking" role="status">
                <Sparkles size={16} /> Your coach is thinking… You can come back
                to this attempt later.
              </p>
            )}
          </div>
          {!data.messages.length && (
            <div className="coaching-starters">
              {[
                "Help me clarify my contribution.",
                "What details are missing from my answer?",
                "Help me build a 90-second story.",
              ].map((text) => (
                <button
                  key={text}
                  className="secondary"
                  disabled={waiting}
                  onClick={() => void send(text)}
                >
                  {text}
                </button>
              ))}
            </div>
          )}
          {data.error && (
            <div className="coaching-error" role="alert">
              <p>{data.error}</p>
              {data.canRetry && (
                <button
                  className="secondary"
                  disabled={waiting}
                  onClick={() => void perform("Retrying…", actions.retry)}
                >
                  Retry reply
                </button>
              )}
            </div>
          )}
          <form
            className="coaching-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send(message);
            }}
          >
            <label htmlFor="coaching-message">Ask your coach</label>
            <textarea
              id="coaching-message"
              value={message}
              maxLength={4000}
              rows={3}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="I owned the rollout, but the deck describes our whole team. How can I explain my part?"
            />
            <div>
              <span className="muted">
                {data.turns >= MAX_COACHING_TURNS
                  ? "Conversation full — practice your draft to continue in a new attempt."
                  : "Enter adds a new line. Send when you’re ready."}
              </span>
              <button
                className="primary"
                disabled={
                  waiting || !message.trim() || data.turns >= MAX_COACHING_TURNS
                }
              >
                <Send size={16} />
                Send
              </button>
            </div>
          </form>
        </div>
        <aside className="coaching-materials" aria-label="Project materials">
          <h3>
            <Paperclip size={18} /> Project materials
          </h3>
          <p className="muted">
            Add notes or a PDF of your project. Export Word documents and
            PowerPoint slides as PDF.
          </p>
          {data.sources.map((s) => (
            <div className="coaching-source" key={s.id}>
              <details>
                <summary>
                  <FileText size={16} />
                  <span>{s.name}</span>
                  {s.pages && (
                    <small>
                      {s.pages} {s.pages === 1 ? "page" : "pages"}
                    </small>
                  )}
                </summary>
                <p className="source-extract">{s.text}</p>
              </details>
              <button
                className="text-button"
                disabled={waiting}
                aria-label={`Remove ${s.name}`}
                onClick={() =>
                  void perform("Removing material…", () =>
                    actions.removeSource(s.id),
                  )
                }
              >
                <Trash2 size={15} />
                Remove
              </button>
            </div>
          ))}
          <div className="coaching-material-actions">
            <input
              ref={uploadInput}
              type="file"
              accept=".pdf,application/pdf"
              aria-label="Upload project PDF"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (
                  !file.name.toLowerCase().endsWith(".pdf") ||
                  file.size > MAX_PDF_BYTES ||
                  !file.size
                ) {
                  setError(
                    "Choose a PDF smaller than 4 MB. Export Word documents or slides as PDF first.",
                  );
                  return;
                }
                void perform("Reading PDF…", () => actions.upload(file));
              }}
            />
            <button
              className="secondary"
              disabled={waiting || data.sources.length >= MAX_SOURCES}
              onClick={() => uploadInput.current?.click()}
            >
              <Paperclip size={16} />
              Upload PDF
            </button>
            <button
              className="text-button"
              disabled={waiting || data.sources.length >= MAX_SOURCES}
              aria-expanded={showNotes}
              onClick={() => setShowNotes(!showNotes)}
            >
              Paste project notes
            </button>
          </div>
          <p className="coaching-limit">
            Up to 3 materials · PDF: 4 MB, 20 pages · Selectable text only;
            charts and scanned pages aren’t read.
          </p>
          {showNotes && (
            <form
              className="coaching-notes"
              onSubmit={(e) => {
                e.preventDefault();
                void perform("Saving notes…", async () => {
                  await actions.addNotes(name, notes);
                  setNotes("");
                  setName("");
                  setShowNotes(false);
                });
              }}
            >
              <label htmlFor="project-name">Project title</label>
              <input
                id="project-name"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <label htmlFor="project-notes">Project notes</label>
              <textarea
                id="project-notes"
                value={notes}
                maxLength={MAX_SOURCE_TEXT}
                rows={6}
                onChange={(e) => setNotes(e.target.value)}
                required
              />
              <button
                className="secondary"
                disabled={waiting || !name.trim() || !notes.trim()}
              >
                Add notes
              </button>
            </form>
          )}
          {!!data.sources.length && (
            <p className="coaching-limit">
              Removing a material stops including it in future context. Earlier
              chat replies may still contain excerpts.
            </p>
          )}
        </aside>
      </div>
      {busy && (
        <p role="status" className="muted">
          {busy}
        </p>
      )}
      {error && (
        <p className="coaching-error" role="alert">
          {error}
        </p>
      )}
      <section className="coaching-draft">
        <div>
          <p className="eyebrow">MAKE IT YOUR OWN</p>
          <h3>Your practice draft</h3>
          <p className="muted">
            Use a coach reply or write your own outline. Confirm the facts and
            your contribution before practicing.
          </p>
        </div>
        <label htmlFor="practice-draft" className="sr-only">
          Practice draft
        </label>
        <textarea
          ref={draftInput}
          id="practice-draft"
          rows={7}
          value={draft}
          maxLength={MAX_DRAFT_TEXT}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Situation → what I owned → the decision I made → the result → what I learned"
        />
        <div className="coaching-draft-actions">
          <span className="muted">
            {dirty
              ? "Unsaved changes"
              : draft
                ? "Draft saved"
                : "Your outline will be saved with this attempt."}
          </span>
          <button
            className="secondary"
            disabled={!!busy || !dirty}
            onClick={() =>
              void perform("Saving draft…", () => actions.saveDraft(draft))
            }
          >
            Save draft
          </button>
          <button
            className="primary"
            disabled={waiting || !draft.trim()}
            onClick={() =>
              void perform("Saving draft…", async () => {
                await actions.saveDraft(draft);
                onPractice(draft);
              })
            }
          >
            Practice this version
            <ArrowRight size={17} />
          </button>
        </div>
      </section>
    </div>
  );
}
