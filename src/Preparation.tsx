import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import {
  Mail,
  ArrowRight,
  Check,
  Headphones,
  LoaderCircle,
  ExternalLink,
} from "lucide-react";
const stages = ["queued", "reading", "researching", "writing"] as const;
const stageLabel = {
  queued: "Starting",
  reading: "Reading the posting or invitation",
  researching: "Researching the role and company",
  writing: "Writing your brief",
};
import { api } from "../convex/_generated/api";
import type { SessionConfig } from "../shared/types";
import type { Id } from "../convex/_generated/dataModel";
import { OpportunityResume } from "./Resume";
import { DeleteSaved } from "./DeleteSaved";
export function Preparation({
  onSelect,
  onReady,
  onOpportunityChange,
}: {
  onSelect: (config: Partial<SessionConfig>) => void;
  onReady: (config: Partial<SessionConfig>) => void;
  onOpportunityChange: () => void;
}) {
  const opportunities = useQuery(api.preparation.list, {});
  const inbox = useQuery(api.email.inbox, {});
  const create = useMutation(api.preparation.create);
  const retry = useMutation(api.preparation.retry);
  const remove = useMutation(api.preparation.remove);
  const removeAttachment = useMutation(api.preparation.removeAttachment);
  const createInbox = useAction(api.email.create);
  const rotateMarker = useAction(api.email.rotateMarker);
  const [url, setUrl] = useState("");
  const [initialSelection] = useState(() =>
    new URLSearchParams(location.search).get("prep"),
  );
  const [selected, setSelected] = useState<Id<"opportunities"> | null>(null);
  const selectedOpportunity = useQuery(
    api.preparation.get,
    selected ? { id: selected } : "skip",
  );
  // Pin the first selection before rendering an editor. New arrivals must not move it,
  // even when the selected record ages out of the recent-opportunity query.
  useEffect(() => {
    if (!selected && opportunities?.length)
      setSelected(
        (
          opportunities.find((o) => o._id === initialSelection) ??
          opportunities[0]
        )._id,
      );
  }, [selected, opportunities, initialSelection]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [autoReply, setAutoReply] = useState(false);
  const [copied, setCopied] = useState(false);
  const current =
    selectedOpportunity === undefined
      ? opportunities?.find((o) => o._id === selected)
      : selectedOpportunity;
  useEffect(() => {
    if (selected && selectedOpportunity === null) {
      onOpportunityChange();
      setSelected(null);
    }
  }, [selected, selectedOpportunity, onOpportunityChange]);
  const visibleOpportunities =
    current &&
    opportunities &&
    !opportunities.some((o) => o._id === current._id)
      ? [current, ...opportunities]
      : opportunities;
  const b = current?.brief;
  const autofilled = useRef<Id<"opportunities"> | null>(null);
  useEffect(() => {
    autofilled.current = null;
  }, [selected]);
  useEffect(() => {
    if (current && !b && autofilled.current === current._id) {
      autofilled.current = null;
      onOpportunityChange();
    }
    if (
      !current ||
      current.status !== "ready" ||
      !b?.role.trim() ||
      autofilled.current === current._id
    )
      return;
    // Apply each selected brief once so live updates don't undo manual edits.
    autofilled.current = current._id;
    onReady({
      role: b.role,
      jobDescription: b.summary,
      opportunityId: current._id,
      preparationBrief: b,
      startingQuestion: undefined,
      previousId: undefined,
      relation: undefined,
    });
  }, [current, b, onReady, onOpportunityChange]);
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const id = await create({ url, requestId: crypto.randomUUID() });
      onOpportunityChange();
      setSelected(id);
      setUrl("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="prep-panel">
      <div className="section-title">
        <span className="step-number">1</span>
        <h2>Prepare for a real opportunity</h2>
      </div>
      <p className="muted">
        Paste a job posting, or forward the interview invitation. Rehearsal
        reads the public pages and writes a sourced brief.
      </p>
      <div className="prep-input">
        <input
          type="url"
          aria-label="Job posting URL"
          placeholder="https://company.com/careers/your-role"
          value={url}
          maxLength={2000}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && url && !busy) void submit();
          }}
        />
        <button
          className="primary"
          disabled={!url || busy}
          onClick={() => void submit()}
        >
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            <ArrowRight size={18} />
          )}
          Prepare
        </button>
      </div>
      <details className="inbox-details">
        <summary>
          <Mail size={17} /> Forward an interview invitation
        </summary>
        {inbox ? (
          <>
            <p>
              Forward the invitation using the email details below. Email text
              and PDF, DOCX, and plain-text attachments are included in your
              preparation. Up to 10 files, 5 MB each (15 MB total); PDFs up to
              30 pages. Scanned PDFs and images need a text-based copy.
            </p>
            <div className="inbox-address">
              <code>{inbox.address}</code>
              <button
                onClick={() =>
                  void navigator.clipboard
                    .writeText(inbox.address)
                    .then(() => setCopied(true))
                    .catch(() => setError("Copy the address manually."))
                }
              >
                {copied ? <Check size={16} /> : "Copy"}
              </button>
            </div>
            {inbox.subjectMarker && (
              <>
                <p>
                  This address is shared. Add your account marker to the email
                  subject so the invitation appears only in your workspace. Keep
                  the marker private: anyone with it can submit preparation
                  materials to your account. They cannot read your workspace.
                </p>
                <div className="inbox-address">
                  <code>{inbox.subjectMarker}</code>
                  <button
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(inbox.subjectMarker!)
                        .catch(() =>
                          setError("Copy the subject marker manually."),
                        )
                    }
                  >
                    Copy marker
                  </button>
                </div>
                <p>
                  If the marker was shared accidentally, replace it below. The
                  old marker will stop accepting new invitations; saved
                  preparations stay in your account.
                </p>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const updated = await rotateMarker({
                        expectedMarker: inbox.subjectMarker!,
                      });
                      if (updated.subjectMarker) {
                        await navigator.clipboard
                          .writeText(updated.subjectMarker)
                          .catch(() =>
                            setError(
                              "Your new marker is ready. Copy it manually.",
                            ),
                          );
                      }
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Replace and copy marker
                </button>
              </>
            )}
            <small>
              {inbox.autoReply
                ? "A preparation link will be sent in reply when your brief is ready."
                : "Your new brief appears here automatically."}
            </small>
          </>
        ) : (
          <>
            <p>
              Link email preparation to your account. You will get a shared
              forwarding address and a private subject marker that routes
              invitations to your workspace.
            </p>
            <label className="check-label">
              <input
                type="checkbox"
                checked={autoReply}
                onChange={(e) => setAutoReply(e.target.checked)}
              />
              Reply to forwarded invitations with a private preparation link.
            </label>
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await createInbox({ autoReply });
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Set up email preparation
            </button>
          </>
        )}
      </details>
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      {!!opportunities?.length && (
        <>
          <label htmlFor="opportunity" className="field-label">
            Your recent opportunities
          </label>
          <select
            id="opportunity"
            value={current?._id ?? ""}
            disabled={busy}
            onChange={(e) => {
              onOpportunityChange();
              setSelected(e.target.value as Id<"opportunities">);
            }}
          >
            {visibleOpportunities?.map((o) => (
              <option key={o._id} value={o._id}>
                {o.brief
                  ? [
                      o.brief.role.trim() || "Role to confirm",
                      o.brief.company.trim(),
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : o.kind === "email"
                    ? "Forwarded invitation"
                    : o.input}
                {o.status === "ready" ? "" : ` (${o.status})`}
              </option>
            ))}
          </select>
          {current && (
            <div className="opportunity-actions">
              <DeleteSaved
                key={current._id}
                label="Delete this opportunity"
                confirmLabel="Delete opportunity"
                description={`Delete ${b ? [b.role, b.company].filter(Boolean).join(" · ") : "this opportunity"}, including its brief, prep materials, and saved opportunity resume? This cannot be undone. Your default resume and past practice sessions will remain.`}
                disabled={busy}
                onBusy={setBusy}
                onDelete={async () => {
                  await remove({ id: current._id });
                  onOpportunityChange();
                  setSelected(null);
                }}
              />
            </div>
          )}
          {current && (
            <OpportunityResume key={current._id} opportunityId={current._id} />
          )}
          {!!current?.attachments?.length && (
            <section className="attachment-list" aria-label="Email attachments">
              <h4>Prep materials</h4>
              {!["ready", "failed"].includes(current.status) && (
                <p>You can remove materials once preparation finishes.</p>
              )}
              <ul>
                {current.attachments.map((a) => (
                  <li key={a.id} id={`attachment-${encodeURIComponent(a.id)}`}>
                    <strong>{a.filename}</strong>
                    {" — "}
                    <span>
                      {a.status === "pending"
                        ? "Waiting to import"
                        : a.status === "imported"
                          ? "Imported"
                          : a.status === "skipped"
                            ? "Not imported"
                            : "Could not import"}
                    </span>
                    {a.note && <p>{a.note}</p>}
                    <DeleteSaved
                      label={`Remove ${a.filename}`}
                      confirmLabel="Remove prep material"
                      description={`Remove ${a.filename} from this opportunity? The current brief will be cleared so you can prepare again using the remaining sources. Past practice sessions and the original email are kept.`}
                      disabled={
                        busy || !["ready", "failed"].includes(current.status)
                      }
                      onBusy={setBusy}
                      onDelete={async () => {
                        await removeAttachment({
                          id: current._id,
                          attachmentId: a.id,
                        });
                        onOpportunityChange();
                      }}
                    />
                  </li>
                ))}
              </ul>
              {!!current.omittedAttachmentCount && (
                <p>
                  {current.omittedAttachmentCount} additional files were not
                  imported (10-file limit).
                </p>
              )}
              {current.status === "ready" &&
                current.attachments.some((a) => a.status === "failed") && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void retry({ id: current._id }).catch((e) =>
                        setError(e.message),
                      )
                    }
                  >
                    Retry attachment import
                  </button>
                )}
            </section>
          )}
          {current && !["ready", "failed"].includes(current.status) && (
            <div className="prep-progress" role="status">
              <ol className="prep-stages">
                {stages.map((stage) => {
                  const at = stages.indexOf(current.status as "queued");
                  const i = stages.indexOf(stage);
                  return (
                    <li
                      key={stage}
                      data-state={i < at ? "done" : i === at ? "now" : "next"}
                    >
                      {i < at ? (
                        <Check size={14} />
                      ) : i === at ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : (
                        <i />
                      )}
                      {stageLabel[stage]}
                    </li>
                  );
                })}
              </ol>
              <p>
                This updates live. You can leave and come back while we prepare
                your brief.
              </p>
            </div>
          )}
          {current?.status === "failed" && (
            <div className="prep-progress failed">
              <p>{current.error}</p>
              <button
                disabled={busy}
                onClick={() =>
                  void retry({ id: current._id }).catch((e) =>
                    setError(e.message),
                  )
                }
              >
                Prepare again
              </button>
            </div>
          )}
          {b && current?.status === "ready" && (
            <div className="brief">
              <h3>{b.role || "Role to confirm"}</h3>
              <p className="company">
                {b.company}
                {b.interviewDate ? `, interview ${b.interviewDate}` : ""}
                {current.sources.length
                  ? ` — from ${current.sources.length} ${current.sources.length === 1 ? "source" : "sources"}`
                  : ""}
              </p>
              <p className="brief-summary">{b.summary}</p>
              <div className="brief-actions">
                <button
                  className="primary"
                  onClick={() =>
                    onSelect({
                      mode: "mock",
                      role: b.role,
                      jobDescription: b.summary,
                      opportunityId: current._id,
                      preparationBrief: b,
                      startingQuestion: undefined,
                      previousId: undefined,
                      relation: undefined,
                    })
                  }
                >
                  <Headphones size={18} />
                  Use this brief for a mock interview
                </button>
                <p className="muted">
                  Or rehearse one question at a time, with coaching after each
                  answer. Either way, the interviewer uses this brief and the
                  resume above.
                </p>
              </div>
              <details className="brief-research">
                <summary>Explore the research and practice questions</summary>
                {!!b.preparation.length && (
                  <>
                    <h4>From the invitation</h4>
                    <ul>
                      {b.preparation.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </>
                )}
                <h4>What to prepare</h4>
                <dl className="focus-list">
                  {b.focusAreas.map((f) => (
                    <div key={f.topic}>
                      <dt>{f.topic}</dt>
                      <dd>
                        {f.why}{" "}
                        <a
                          href={f.sourceUrl}
                          target={
                            f.sourceUrl.startsWith("#") ? undefined : "_blank"
                          }
                          rel="noreferrer"
                        >
                          Source <ExternalLink size={12} />
                        </a>
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="question-list">
                  {b.questions.map((q) => (
                    <button
                      key={q}
                      onClick={() =>
                        onSelect({
                          mode: "coached",
                          role: b.role,
                          jobDescription: b.summary,
                          opportunityId: current._id,
                          preparationBrief: b,
                          startingQuestion: q,
                          previousId: undefined,
                          relation: undefined,
                        })
                      }
                    >
                      {q}
                      <ArrowRight size={17} />
                    </button>
                  ))}
                </div>
              </details>
              {!!b.uncertainties.length && (
                <details>
                  <summary>What still needs confirming</summary>
                  <ul>
                    {b.uncertainties.map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                </details>
              )}
              <details>
                <summary>Research sources ({current.sources.length})</summary>
                <ul>
                  {current.sources.map((s) => (
                    <li key={s.url}>
                      <a
                        href={s.url}
                        target={s.url.startsWith("#") ? undefined : "_blank"}
                        rel="noreferrer"
                      >
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
        </>
      )}
    </section>
  );
}
