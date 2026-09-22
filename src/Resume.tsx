import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { FileText, LoaderCircle } from "lucide-react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  MAX_RESUME_CHARS,
  validateResumeText,
  type ResumeMode,
} from "../shared/resume";
import { importResume } from "./resume-import";

function errorMessage(error: unknown) {
  const e = error as { data?: unknown; message?: string };
  return typeof e.data === "string"
    ? e.data
    : (e.message ?? "Could not save. Please try again.");
}

export function ResumeEditor({
  text,
  onSave,
  onCancel,
}: {
  text: string;
  onSave: (text: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(text);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function read(file: File) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setReading(true);
    setError("");
    setNotice("");
    try {
      const result = await importResume(file, controller.signal);
      if (!controller.signal.aborted) {
        setDraft(result);
        setNotice(
          `Imported ${file.name}. Check the text and reading order before saving.`,
        );
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!controller.signal.aborted) setReading(false);
    }
  }
  return (
    <div className="resume-editor">
      <label htmlFor={`${id}-file`}>Import PDF or Word document</label>
      <input
        id={`${id}-file`}
        type="file"
        accept=".pdf,.docx"
        disabled={busy || reading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void read(file);
        }}
      />
      <p className="muted">
        PDF or .docx · up to 5 MB · PDFs up to 10 pages. Scanned PDFs and older
        .doc files: paste the text instead.
      </p>
      {reading && (
        <p role="status">
          <LoaderCircle size={16} className="spin" /> Reading your document…
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <label htmlFor={`${id}-text`}>Resume text</label>
      <textarea
        id={`${id}-text`}
        rows={9}
        value={draft}
        disabled={busy || reading}
        aria-describedby={`${id}-count`}
        placeholder="Paste your resume here, or import a file above…"
        onChange={(e) => {
          setDraft(e.target.value);
          setError("");
        }}
      />
      <p
        id={`${id}-count`}
        className={draft.length > MAX_RESUME_CHARS ? "auth-error" : "muted"}
      >
        {draft.length.toLocaleString()} / 15,000 characters
        {draft.length > MAX_RESUME_CHARS
          ? " — shorten the text before saving; nothing has been cut."
          : ""}
      </p>
      <p className="muted">
        Only the text you save is retained and used for coaching. The original
        file stays on your device.
      </p>
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      <div className="resume-actions">
        <button
          type="button"
          className="primary"
          disabled={
            busy || reading || !draft.trim() || draft.length > MAX_RESUME_CHARS
          }
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onSave(validateResumeText(draft));
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save resume"}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function DefaultResume() {
  const data = useQuery(api.resumes.get, {});
  const save = useMutation(api.resumes.saveDefault);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="resume-card" aria-label="Your default resume">
      <div className="resume-heading">
        <FileText size={20} />
        <h2>Your resume</h2>
        <span className="muted">Optional</span>
      </div>
      <p className="muted">
        Save a default for practice, or use a different resume for each
        opportunity.
      </p>
      {!data ? (
        <p>Loading resume…</p>
      ) : editing ? (
        <ResumeEditor
          text={data.defaultText}
          onSave={async (text) => {
            await save({ text });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="resume-actions">
            <span>
              {data.defaultText
                ? "Default resume saved"
                : "No resume saved yet"}
            </span>
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setRemoving(false);
                setError("");
              }}
            >
              {data.defaultText ? "Review or edit resume" : "Add resume"}
            </button>
            {data.defaultText && (
              <button type="button" onClick={() => setRemoving(true)}>
                Delete saved default resume
              </button>
            )}
          </div>
          {removing && (
            <div className="resume-removal">
              <p>
                Delete your default resume from future practice? Existing
                sessions and opportunity-specific resumes keep their saved text.
              </p>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await save({ text: null });
                    setRemoving(false);
                  } catch (e) {
                    setError(errorMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Delete default resume
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setRemoving(false)}
              >
                Keep resume
              </button>
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
    </section>
  );
}

export function OpportunityResume({
  opportunityId,
}: {
  opportunityId: Id<"opportunities">;
}) {
  const data = useQuery(api.resumes.get, { opportunityId });
  const save = useMutation(api.resumes.saveOpportunity);
  const remove = useMutation(api.resumes.removeOpportunityResume);
  const [removing, setRemoving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  if (!data) return <p>Loading resume selection…</p>;
  async function select(mode: ResumeMode) {
    setRemoving(false);
    if (mode === "custom") {
      setEditing(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await save({ opportunityId, mode });
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="resume-selection">
      <label htmlFor={id}>Resume for this opportunity</label>
      <select
        id={id}
        value={data.mode}
        disabled={busy || editing}
        onChange={(e) => void select(e.target.value as ResumeMode)}
      >
        <option value="default">Use my default resume</option>
        <option value="custom">Use an opportunity-specific resume</option>
        <option value="none">No resume</option>
      </select>
      <p className="muted">
        {data.mode === "default"
          ? data.defaultText
            ? "Uses your current default when you start practice."
            : "No default saved yet. Add one in Your resume, or choose a specific resume here."
          : data.mode === "custom"
            ? "This resume is saved only for this opportunity."
            : "Practice for this opportunity will use no resume."}
      </p>
      {data.mode === "custom" && !editing && (
        <button type="button" onClick={() => setEditing(true)}>
          Review or edit this resume
        </button>
      )}
      {!!data.customText && !editing && (
        <>
          {data.mode !== "custom" && (
            <p className="muted">
              Your opportunity-specific resume is saved for later.
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => setRemoving(true)}
          >
            Delete saved opportunity resume
          </button>
          {removing && (
            <div className="resume-removal">
              <p>
                Delete this opportunity's saved resume and use no resume?
                Existing sessions keep their saved text.
              </p>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await remove({ opportunityId });
                    setRemoving(false);
                  } catch (e) {
                    setError(errorMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Delete opportunity resume
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setRemoving(false)}
              >
                Keep opportunity resume
              </button>
            </div>
          )}
        </>
      )}
      {editing && (
        <ResumeEditor
          text={data.customText}
          onSave={async (text) => {
            await save({ opportunityId, mode: "custom", text });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function PracticeResume({
  opportunityId,
  mode,
  onMode,
}: {
  opportunityId?: string;
  mode?: "default" | "none";
  onMode: (mode: "default" | "none") => void;
}) {
  const data = useQuery(
    api.resumes.get,
    opportunityId
      ? { opportunityId: opportunityId as Id<"opportunities"> }
      : {},
  );
  const id = useId();
  if (opportunityId)
    return (
      <div className="resume-selection">
        <strong>Resume for this practice</strong>
        {!!data?.opportunityLabel && (
          <p>Practicing for {data.opportunityLabel}</p>
        )}
        <p className="muted">
          {!data
            ? "Loading…"
            : data.mode === "custom"
              ? "Using the resume saved for your selected opportunity."
              : data.mode === "none"
                ? "No resume — as selected for this opportunity."
                : data.defaultText
                  ? "Using your current default resume."
                  : "No default resume saved."}{" "}
          Change the selection in the opportunity above.
        </p>
      </div>
    );
  return (
    <div className="resume-selection">
      <label htmlFor={id}>Resume for this practice</label>
      <select
        id={id}
        value={mode ?? "default"}
        onChange={(e) => onMode(e.target.value as "default" | "none")}
      >
        <option value="default">Use my default resume</option>
        <option value="none">No resume</option>
      </select>
      {mode !== "none" && data && !data.defaultText && (
        <p className="muted">
          No default saved yet. You can add one above or practice without it.
        </p>
      )}
    </div>
  );
}

export function LocalResume({
  text,
  onSave,
}: {
  text: string;
  onSave: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="resume-selection">
      <strong>Your resume</strong>
      <p className="muted">Optional context for this practice.</p>
      {editing ? (
        <ResumeEditor
          text={text}
          onSave={async (value) => {
            onSave(value);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="resume-actions">
          <button type="button" onClick={() => setEditing(true)}>
            {text ? "Review or edit resume" : "Add resume"}
          </button>
          {text && (
            <button type="button" onClick={() => onSave("")}>
              Remove resume
            </button>
          )}
        </div>
      )}
    </div>
  );
}
