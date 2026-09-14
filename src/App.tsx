import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  ChevronDown,
  Clock3,
  Headphones,
  History,
  Mic,
  MicOff,
  MoreHorizontal,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type {
  Fragment,
  PracticeSession,
  SessionConfig,
  SessionSummary,
} from "../shared/types";
import { api } from "./api";
import { cloudEnabled, convex } from "./convex";
import { api as backend } from "../convex/_generated/api";
import { Preparation } from "./Preparation";
import { SignOut } from "./Auth";
import { LiveSession } from "./live";
import { captions, clock } from "./transcript";
const initial: SessionConfig = {
  mode: cloudEnabled ? "coached" : "mock",
  role: "",
  jobDescription: "",
  background: "",
};
function Transcript({
  fragments,
  live = false,
}: {
  fragments: Fragment[];
  live?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (follow.current && ref.current)
      ref.current.scrollTop = ref.current.scrollHeight;
  }, [fragments]);
  return (
    <div
      ref={ref}
      className={`transcript ${live ? "live-transcript" : ""}`}
      onScroll={() => {
        const e = ref.current!;
        follow.current = e.scrollHeight - e.scrollTop - e.clientHeight < 50;
      }}
    >
      {captions(fragments).map((c) => (
        <div className={`caption ${c.speaker}`} key={c.id}>
          <span>
            {c.speaker === "user" ? "You" : "Interviewer"}{" "}
            <time>{clock(c.start_ms / 1000)}</time>
          </span>
          <p>{c.text}</p>
        </div>
      ))}
      {!fragments.length && (
        <p className="muted">
          Your conversation will appear here as you speak.
        </p>
      )}
    </div>
  );
}
function Wave({
  level = 0,
  active = false,
}: {
  level?: number;
  active?: boolean;
}) {
  return (
    <div className={`wave ${active ? "active" : ""}`} aria-hidden="true">
      {[
        0.17, 0.25, 0.39, 0.56, 0.7, 0.87, 0.63, 1, 0.84, 0.55, 0.73, 0.97,
        0.72, 0.47, 0.65, 0.4, 0.29, 0.2, 0.12,
      ].map((v, i) => (
        <i
          key={i}
          style={{
            height: `${12 + v * (active ? 20 + level * 120 : 72)}px`,
            opacity: 0.4 + v * 0.6,
          }}
        />
      ))}
    </div>
  );
}
export default function App() {
  const [view, setView] = useState<"setup" | "live" | "review" | "history">(
    "setup",
  );
  const [config, setConfig] = useState<SessionConfig>(initial);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [record, setRecord] = useState<PracticeSession>();
  const [fragments, setFragments] = useState<Fragment[]>([]);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState(true);
  const [reasoningBackend, setReasoningBackend] = useState<"codex" | "api">(
    "api",
  );
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [state, setState] = useState("Connecting");
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [mutePending, setMutePending] = useState(false);
  const [showCaptions, setShowCaptions] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [deleteId, setDeleteId] = useState<string>();
  const controller = useRef<LiveSession | undefined>(undefined);
  const startedAt = useRef(0);
  async function refresh() {
    setSessions(await api<SessionSummary[]>("/sessions"));
  }
  useEffect(() => {
    const watch = convex?.watchQuery(backend.sessions.list, {});
    const unsubscribe = watch?.onUpdate(() => {
      const rows = watch.localQueryResult();
      if (rows)
        setSessions(rows.map((r) => ({ ...r, hasFeedback: !!r.feedback })));
    });
    void refresh().catch((e) => setError(e.message));
    void api<{ configured: boolean; reasoningBackend?: "codex" | "api" }>(
      "/status",
    )
      .then((s) => {
        setConfigured(s.configured);
        setReasoningBackend(s.reasoningBackend || "api");
      })
      .catch((e) => setError(e.message));
    const before = (e: BeforeUnloadEvent) => {
      if (controller.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const hide = () => controller.current?.abandon();
    window.addEventListener("beforeunload", before);
    window.addEventListener("pagehide", hide);
    return () => {
      unsubscribe?.();
      window.removeEventListener("beforeunload", before);
      window.removeEventListener("pagehide", hide);
    };
  }, []);
  useEffect(() => {
    if (view !== "live" || state !== "Connected") return;
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [view, state]);
  async function generateFeedback(s: PracticeSession) {
    setReviewing(true);
    try {
      setRecord(await api<PracticeSession>(`/sessions/${s.id}/feedback`, {}));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReviewing(false);
    }
  }
  async function start(e?: FormEvent, nextConfig = config) {
    e?.preventDefault();
    if (busy || controller.current) return;
    setError("");
    setBusy(true);
    setFragments([]);
    setMuted(false);
    setElapsed(0);
    setState("Connecting");
    setView("live");
    setRecord(undefined);
    setShowCaptions(false);
    const live = new LiveSession({
      state: (s) => {
        setState(s);
        if (s === "Connected") startedAt.current = Date.now();
      },
      record: setRecord,
      fragments: setFragments,
      level: setLevel,
      error: setError,
      ended: (s) => {
        controller.current = undefined;
        setRecord(s);
        setView("review");
        setBusy(false);
        void refresh().catch(() => {});
        void generateFeedback(s);
      },
    });
    controller.current = live;
    try {
      await live.start(nextConfig);
    } catch (e) {
      controller.current = undefined;
      setError((e as Error).message);
      setView("setup");
      void refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  function newPractice() {
    setError("");
    setConfig(initial);
    setRecord(undefined);
    setView("setup");
  }
  async function open(id: string) {
    setError("");
    setBusy(true);
    try {
      setRecord(await api<PracticeSession>(`/sessions/${id}`));
      setView("review");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function linked(relation: "retry" | "next") {
    if (!record) return;
    const c = {
      ...record.config,
      mode: "coached" as const,
      previousId: record.id,
      relation,
    };
    setConfig(c);
    void start(undefined, c);
  }
  async function deleteSession() {
    if (!deleteId) return;
    try {
      await api(`/sessions/${deleteId}`, undefined, "DELETE");
      if (record?.id === deleteId) {
        setRecord(undefined);
        setView("history");
      }
      setDeleteId(undefined);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const locked = view === "live" || reviewing;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (!locked) newPractice();
          }}
        >
          <span className="brand-mark">
            <AudioLines size={22} />
          </span>
          rehearsal<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">YOUR PRACTICE SPACE</div>
        <nav>
          <button
            className={
              view === "setup" || view === "live"
                ? "nav-item selected"
                : "nav-item"
            }
            disabled={locked}
            onClick={newPractice}
          >
            <Mic size={18} />
            Practice room
          </button>
          <button
            className={view === "history" ? "nav-item selected" : "nav-item"}
            disabled={locked}
            onClick={() => {
              setView("history");
              setError("");
            }}
          >
            <History size={18} />
            Session history<span className="count">{sessions.length}</span>
          </button>
        </nav>
        <div className="sidebar-note">
          <span className="small-wave">
            <AudioLines size={26} />
          </span>
          <p>
            A little practice.
            <br />A clearer answer.
          </p>
          <span>Make room for your next step.</span>
        </div>
        <div className="local-status">
          <i /> Personal workspace{" "}
          <span>
            {cloudEnabled
              ? "Saved privately in the cloud"
              : "Saved on this Mac"}
          </span>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            {view === "history"
              ? "Your sessions"
              : view === "review"
                ? "Session review"
                : "Practice room"}
          </span>
          <div>
            <span className="local-pill">
              <span />
              {cloudEnabled ? "PRIVATE" : "LOCAL"}
            </span>
            <span className="avatar">You</span>
            {cloudEnabled && <SignOut disabled={locked} />}
          </div>
        </header>
        <div className="content">
          {error && (
            <div className="error-banner" role="alert">
              <div>
                <strong>Something needs your attention</strong>
                <p>{error}</p>
                {error.includes("Audio playback") && (
                  <button
                    onClick={() =>
                      void controller.current
                        ?.enableSound()
                        .then(() => setError(""))
                        .catch(() => {})
                    }
                  >
                    Enable sound
                  </button>
                )}
              </div>
              <button aria-label="Dismiss message" onClick={() => setError("")}>
                <X size={18} />
              </button>
            </div>
          )}
          {cloudEnabled &&
            view === "setup" &&
            sessions.some(
              (s) => s.status === "active" || s.status === "connecting",
            ) && (
              <div className="prep-progress">
                <p>
                  An earlier interview is still open. Close it to review the
                  saved transcript.
                </p>
                <button
                  disabled={busy}
                  onClick={async () => {
                    const s = sessions.find(
                      (s) => s.status === "active" || s.status === "connecting",
                    );
                    if (!s) return;
                    setBusy(true);
                    try {
                      const r = await api<PracticeSession>(
                        `/sessions/${s.id}/close`,
                        {},
                      );
                      setRecord(r);
                      setView("review");
                      await refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Close earlier interview
                </button>
              </div>
            )}
          {view === "setup" && (
            <>
              <div className="page-heading">
                <p className="eyebrow">A LITTLE REHEARSAL GOES A LONG WAY</p>
                <h1>
                  Find the words.
                  <br />
                  <span>Make them yours.</span>
                </h1>
                <p>
                  Practice the conversation before it counts.
                  <br />A thoughtful interviewer. Room to think. Feedback you
                  can use.
                </p>
              </div>
              {cloudEnabled && (
                <Preparation
                  onSelect={(patch) => {
                    setConfig({ ...config, ...patch });
                    document
                      .getElementById("role")
                      ?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                />
              )}
              <form onSubmit={(e) => void start(e)} className="setup-layout">
                <section className="setup-panel">
                  <div className="section-title">
                    <span className="step-number">1</span>
                    <h2>Choose your practice</h2>
                  </div>
                  <div className="mode-grid">
                    <button
                      type="button"
                      className={`mode-card ${config.mode === "mock" ? "chosen" : ""}`}
                      aria-pressed={config.mode === "mock"}
                      onClick={() => setConfig({ ...config, mode: "mock" })}
                    >
                      <span className="mode-top">
                        <Headphones size={22} />
                        <span className="radio">
                          {config.mode === "mock" && <i />}
                        </span>
                      </span>
                      <strong>Mock interview</strong>
                      <p>A real conversation, with feedback at the end.</p>
                      <span className="duration">
                        <Clock3 size={13} /> About 15 minutes
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`mode-card ${config.mode === "coached" ? "chosen" : ""}`}
                      aria-pressed={config.mode === "coached"}
                      onClick={() => setConfig({ ...config, mode: "coached" })}
                    >
                      <span className="mode-top">
                        <Sparkles size={22} />
                        <span className="radio">
                          {config.mode === "coached" && <i />}
                        </span>
                      </span>
                      <strong>Coached practice</strong>
                      <p>One question. Useful feedback. Another try.</p>
                      <span className="duration">
                        <Clock3 size={13} /> Up to 5 minutes per try
                      </span>
                    </button>
                  </div>
                  <div className="section-title context-title">
                    <span className="step-number">2</span>
                    <h2>Set the scene</h2>
                  </div>
                  {config.startingQuestion && (
                    <p className="selected-question">
                      <strong>Your question:</strong> {config.startingQuestion}
                    </p>
                  )}
                  <label htmlFor="role">What role are you preparing for?</label>
                  <input
                    id="role"
                    placeholder="e.g. Senior product designer"
                    maxLength={200}
                    required
                    value={config.role}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        role: e.target.value,
                        opportunityId: undefined,
                        startingQuestion: undefined,
                      })
                    }
                  />
                  <details className="context-details">
                    <summary>
                      Add a job description or background{" "}
                      <span>
                        Optional <ChevronDown size={15} />
                      </span>
                    </summary>
                    <div>
                      <label htmlFor="job">Job description</label>
                      <textarea
                        id="job"
                        placeholder="Paste the role’s responsibilities and requirements…"
                        maxLength={15000}
                        value={config.jobDescription}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            jobDescription: e.target.value,
                          })
                        }
                      />
                      <label htmlFor="background">Your experience</label>
                      <textarea
                        id="background"
                        placeholder="Paste your résumé or a few notes about your work…"
                        maxLength={15000}
                        value={config.background}
                        onChange={(e) =>
                          setConfig({ ...config, background: e.target.value })
                        }
                      />
                    </div>
                  </details>
                  {!configured && (
                    <p className="inline-notice">
                      Voice practice is temporarily unavailable. Please try
                      again later.
                    </p>
                  )}
                  <button
                    className="primary start-button"
                    disabled={busy || !configured}
                  >
                    <Mic size={18} />
                    Start practicing
                    <ArrowRight size={18} />
                  </button>
                  <p className="privacy-line">
                    <ShieldCheck size={15} />
                    Audio is processed by OpenAI, never recorded by this app.
                  </p>
                </section>
                <aside className="room-preview">
                  <div className="preview-label">
                    <span /> YOUR INTERVIEWER
                  </div>
                  <div className="voice-art">
                    <Wave />
                  </div>
                  <h3>
                    A conversation,
                    <br />
                    at your pace.
                  </h3>
                  <p>
                    Take a breath. Think it through.
                    <br />
                    You don’t need a perfect first answer.
                  </p>
                  <div className="preview-divider" />
                  <ul>
                    <li>
                      <Check size={16} />
                      Questions shaped around your role
                    </li>
                    <li>
                      <Check size={16} />
                      Follow-ups that help you go deeper
                    </li>
                    <li>
                      <Check size={16} />
                      Two clear things to work on next
                    </li>
                  </ul>
                  <div className="headphone-note">
                    <Headphones size={17} />
                    <span>
                      A quiet spot and headphones
                      <br />
                      make a good starting point.
                    </span>
                  </div>
                </aside>
              </form>
              <footer className="setup-footer">
                <span>BEHAVIORAL INTERVIEW PRACTICE</span>
                <span>Built for practice. Space to improve.</span>
              </footer>
            </>
          )}
          {view === "live" && (
            <section className="live-room">
              <div className="live-heading">
                <span className="eyebrow">
                  {config.mode === "mock"
                    ? "MOCK INTERVIEW"
                    : "COACHED PRACTICE"}
                </span>
                <span className="timer">
                  <Clock3 size={15} />
                  {clock(elapsed)}
                  <small>/ {config.mode === "mock" ? "20:00" : "05:00"}</small>
                </span>
              </div>
              <h1>{config.role}</h1>
              <p className="muted">
                {config.mode === "mock"
                  ? "Let your experience lead the conversation."
                  : "One answer at a time. Review when you’re ready."}
              </p>
              <div className="conversation-stage">
                <div
                  className={`connection-status ${state === "Connected" ? "connected" : ""}`}
                  role="status"
                >
                  <i />
                  {state}
                </div>
                <Wave
                  active={state === "Connected"}
                  level={muted ? 0 : level}
                />
                <h2>
                  {state === "Connecting"
                    ? "Making room for your voice…"
                    : state === "Finishing"
                      ? "Saving your conversation…"
                      : state === "Save interrupted"
                        ? "Your answer is still here."
                        : muted
                          ? "Take your time."
                          : "You have the floor."}
                </h2>
                <p>
                  {state === "Connected"
                    ? muted
                      ? "Your microphone is muted."
                      : "Listen, think, and answer naturally. Pauses are welcome."
                    : "Your transcript stays with this session."}
                </p>
                <div
                  className="microphone-meter"
                  aria-label={`Microphone activity ${muted ? "muted" : "active"}`}
                >
                  <Mic size={14} />
                  <div>
                    <i
                      style={{
                        width: `${muted ? 0 : Math.max(3, level * 100)}%`,
                      }}
                    />
                  </div>
                  <span>{muted ? "Muted" : "Microphone"}</span>
                </div>
              </div>
              <div className="live-controls">
                <button
                  className="secondary"
                  disabled={state !== "Connected" || mutePending}
                  onClick={async () => {
                    setMutePending(true);
                    try {
                      await controller.current?.mute(!muted);
                      setMuted(!muted);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setMutePending(false);
                    }
                  }}
                >
                  {muted ? <MicOff size={18} /> : <Mic size={18} />}{" "}
                  {mutePending ? "Updating…" : muted ? "Unmute" : "Mute"}
                </button>
                <button
                  className="secondary"
                  aria-pressed={showCaptions}
                  onClick={() => setShowCaptions(!showCaptions)}
                >
                  Captions {showCaptions ? "on" : "off"}
                </button>
                {state === "Save interrupted" ? (
                  <button
                    className="primary"
                    onClick={() =>
                      void controller.current
                        ?.retrySave()
                        .catch((e) => setError(e.message))
                    }
                  >
                    Retry saving
                  </button>
                ) : (
                  <button
                    className="primary"
                    disabled={busy || state === "Finishing" || !record}
                    onClick={() => void controller.current?.end()}
                  >
                    {config.mode === "coached"
                      ? "Review answer"
                      : "End & review"}
                    <ArrowRight size={18} />
                  </button>
                )}
              </div>
              {elapsed >= 900 && config.mode === "mock" && (
                <p className="muted">
                  You’ve reached the 15-minute target. Finish your thought, then
                  review.
                </p>
              )}
              {showCaptions && <Transcript fragments={fragments} live />}
              <p className="session-footnote">
                Ending the conversation closes the voice session before written
                feedback begins.
              </p>
            </section>
          )}
          {view === "review" && record && (
            <>
              <button
                className="back-link"
                disabled={reviewing}
                onClick={() => setView("history")}
              >
                <ArrowLeft size={16} />
                Session history
              </button>
              <div className="review-heading">
                <div>
                  <p className="eyebrow">
                    {record.config.mode === "mock"
                      ? "MOCK INTERVIEW"
                      : "COACHED PRACTICE"}{" "}
                    ·{" "}
                    {new Date(record.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                  <h1>
                    A little clearer,
                    <br />
                    <span>one answer at a time.</span>
                  </h1>
                  <p>
                    {record.config.role} <span className="separator">·</span>{" "}
                    {clock(record.seconds)}{" "}
                    {record.config.relation === "retry" && (
                      <span className="tag">Repeat attempt</span>
                    )}
                  </p>
                </div>
                <button
                  className="icon-button"
                  aria-label="Delete this session"
                  disabled={reviewing}
                  onClick={() => setDeleteId(record.id)}
                >
                  <Trash2 size={18} />
                </button>
              </div>
              {record.backendError && (
                <div className="notice">{record.backendError}</div>
              )}
              {(record.status === "partial" ||
                (!cloudEnabled && !record.usageConfirmed)) && (
                <div className="notice">
                  Partial session · This review uses the available transcript.{" "}
                  {cloudEnabled || record.usageConfirmed
                    ? ""
                    : "Final voice usage could not be confirmed."}
                </div>
              )}
              {reviewing ? (
                <div className="review-loading" role="status">
                  <div className="loading-orbit">
                    <Sparkles size={25} />
                  </div>
                  <h2>Finding the useful details.</h2>
                  <p>
                    Looking at your answer, your examples, and what could be
                    clearer.
                  </p>
                </div>
              ) : record.feedback ? (
                <>
                  <section className="summary-card">
                    <span className="eyebrow">
                      YOUR TAKEAWAY ·{" "}
                      {record.feedbackBackend === "codex"
                        ? "CODEX SUBSCRIPTION"
                        : "API"}
                    </span>
                    <h2>{record.feedback.summary}</h2>
                    {record.feedback.insufficientEvidence && (
                      <span className="tag">Limited evidence</span>
                    )}
                  </section>
                  <div className="feedback-grid">
                    <section className="feedback-panel">
                      <h2>
                        <Check size={19} />
                        What worked
                      </h2>
                      {record.feedback.strengths.map((v, i) => (
                        <article key={i}>
                          <h3>{v.title}</h3>
                          <blockquote>“{v.quote}”</blockquote>
                          <p>{v.detail}</p>
                        </article>
                      ))}
                      {!record.feedback.strengths.length && (
                        <p className="muted">
                          There isn’t enough evidence to identify a specific
                          strength yet.
                        </p>
                      )}
                    </section>
                    <section className="feedback-panel priorities">
                      <h2>
                        <Sparkles size={19} />
                        Your next improvements
                      </h2>
                      {record.feedback.improvements.map((v, i) => (
                        <article key={i}>
                          <h3>
                            <span>{i + 1}</span>
                            {v.title}
                          </h3>
                          <blockquote>“{v.quote}”</blockquote>
                          <p>{v.detail}</p>
                        </article>
                      ))}
                      {!record.feedback.improvements.length && (
                        <p className="muted">
                          Try a fuller answer so your coach has something
                          concrete to work with.
                        </p>
                      )}
                    </section>
                  </div>
                  {!!record.feedback.outline.length && (
                    <section className="outline-panel">
                      <div>
                        <p className="eyebrow">FOR YOUR NEXT ATTEMPT</p>
                        <h2>A clearer way through your answer.</h2>
                        {record.feedback.retryQuestion && (
                          <p className="focus-question">
                            {record.feedback.retryQuestion}
                          </p>
                        )}
                        <p className="muted">
                          An outline to make your own, using your experience.
                        </p>
                      </div>
                      <ol>
                        {record.feedback.outline.map((v, i) => (
                          <li key={i}>
                            <strong>{v.label}</strong>
                            <p>{v.text}</p>
                          </li>
                        ))}
                      </ol>
                      {!!record.feedback.missingDetails.length && (
                        <div className="missing-details">
                          <h3>Details only you can add</h3>
                          <ul>
                            {record.feedback.missingDetails.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </section>
                  )}
                  {record.feedback.comparison && (
                    <section className="comparison">
                      <RotateCcw size={22} />
                      <div>
                        <h2>Since your last attempt</h2>
                        <p>{record.feedback.comparison}</p>
                      </div>
                    </section>
                  )}
                </>
              ) : (
                <section className="empty-feedback">
                  <h2>Your transcript is saved.</h2>
                  <p>
                    Generate feedback when you’re ready. You won’t need to
                    repeat the interview.
                  </p>
                  <button
                    className="primary"
                    onClick={() => void generateFeedback(record)}
                  >
                    Retry feedback
                    <Sparkles size={17} />
                  </button>
                </section>
              )}
              {!reviewing && (
                <div className="review-actions">
                  <button className="primary" onClick={() => linked("retry")}>
                    <RotateCcw size={17} />
                    Try this answer again
                  </button>
                  <button className="secondary" onClick={() => linked("next")}>
                    Next question
                    <ArrowRight size={17} />
                  </button>
                  <button className="text-button" onClick={newPractice}>
                    New practice
                  </button>
                </div>
              )}
              <details className="saved-transcript">
                <summary>
                  Read your transcript{" "}
                  <span>
                    {record.fragments.length
                      ? "Saved in your workspace"
                      : "No speech captured"}
                    <ChevronDown size={16} />
                  </span>
                </summary>
                <Transcript fragments={record.fragments} />
              </details>
            </>
          )}
          {view === "history" && (
            <>
              <div className="history-heading">
                <div>
                  <p className="eyebrow">ONE CONVERSATION AT A TIME</p>
                  <h1>
                    Your practice,
                    <br />
                    <span>worth coming back to.</span>
                  </h1>
                  <p>Revisit the useful bits. Give an answer another try.</p>
                </div>
                <button className="primary" onClick={newPractice}>
                  <Plus size={17} />
                  New practice
                </button>
              </div>
              {!sessions.length ? (
                <div className="empty-history">
                  <History size={36} />
                  <h2>Your first conversation starts here.</h2>
                  <p>
                    Practice a question and your transcript and feedback will
                    appear here.
                  </p>
                  <button className="secondary" onClick={newPractice}>
                    Go to practice room
                    <ArrowRight size={17} />
                  </button>
                </div>
              ) : (
                <div className="history-list">
                  {sessions.map((s) => (
                    <article key={s.id}>
                      <button
                        className="history-entry"
                        disabled={busy}
                        onClick={() => void open(s.id)}
                      >
                        <span className="history-icon">
                          {s.config.mode === "mock" ? (
                            <Headphones size={22} />
                          ) : (
                            <Sparkles size={22} />
                          )}
                        </span>
                        <div>
                          <h3>{s.config.role}</h3>
                          <p>
                            {s.config.mode === "mock"
                              ? "Mock interview"
                              : "Coached practice"}
                            {s.config.relation === "retry"
                              ? " · Repeat attempt"
                              : ""}
                          </p>
                        </div>
                        <div className="history-meta">
                          <span>
                            {new Date(s.createdAt).toLocaleDateString(
                              undefined,
                              { month: "short", day: "numeric" },
                            )}
                          </span>
                          <small>
                            {clock(s.seconds)} ·{" "}
                            {s.hasFeedback
                              ? "Reviewed"
                              : s.status === "partial"
                                ? "Partial session"
                                : "Transcript saved"}
                          </small>
                        </div>
                        <ArrowRight size={18} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Delete ${s.config.role} session`}
                        onClick={() => setDeleteId(s.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>
      {deleteId && (
        <div className="modal-backdrop">
          <section
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-title"
          >
            <h2 id="delete-title">Delete this session?</h2>
            <p>
              This removes its transcript and feedback from your workspace.
              Later attempts remain available.
            </p>
            <div>
              <button
                className="secondary"
                autoFocus
                onClick={() => setDeleteId(undefined)}
              >
                Keep session
              </button>
              <button className="danger" onClick={() => void deleteSession()}>
                Delete session
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
