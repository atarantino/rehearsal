import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Briefcase,
  Check,
  ChevronDown,
  Clock3,
  Headphones,
  History,
  Mic,
  MicOff,
  PhoneOff,
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
import { DefaultResume, PracticeResume, LocalResume } from "./Resume";
import { SignOut } from "./Auth";
import { LiveSession } from "./live";
import { captions, clock } from "./transcript";
// Mozilla bug 1034964 fixes ICE-lite nomination in Firefox 156.
const firefoxVersion = Number(navigator.userAgent.match(/Firefox\/(\d+)/)?.[1]);
const affectedFirefox = firefoxVersion > 0 && firefoxVersion < 156;
// Sessions snapshot the structured brief; older records carried it as JSON in jobDescription.
type BriefLabel = { company: string; role: string };
export function briefOf(config: SessionConfig): BriefLabel | null {
  const b = config.preparationBrief;
  if (b?.company) return { company: b.company, role: b.role || config.role };
  if (!config.opportunityId) return null;
  try {
    const p = JSON.parse(config.jobDescription);
    return typeof p?.company === "string"
      ? { company: p.company, role: p.role || config.role }
      : null;
  } catch {
    return null;
  }
}
function Practicing({
  config,
  onChange,
}: {
  config: SessionConfig;
  onChange?: () => void;
}) {
  const b = briefOf(config);
  if (!b) return null;
  return (
    <div className="practicing" role="note">
      <Briefcase size={16} />
      <span>
        Practicing for <strong>{b.role}</strong> at <strong>{b.company}</strong>
        , using your researched brief.
      </span>
      {onChange && (
        <button type="button" className="text-button" onClick={onChange}>
          Change
        </button>
      )}
    </div>
  );
}
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
function Wave({ active = false }: { active?: boolean }) {
  return (
    <div className={`wave ${active ? "active" : ""}`} aria-hidden="true">
      {[
        0.17, 0.25, 0.39, 0.56, 0.7, 0.87, 0.63, 1, 0.84, 0.55, 0.73, 0.97,
        0.72, 0.47, 0.65, 0.4, 0.29, 0.2, 0.12,
      ].map((v, i) => (
        <i
          key={i}
          style={
            {
              height: `${12 + v * 72}px`,
              "--bar-weight": v,
              "--bar-energy": `var(--voice-band-${i}, 0)`,
              opacity: 0.4 + v * 0.6,
            } as CSSProperties
          }
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
  const prefillPreparation = useCallback((patch: Partial<SessionConfig>) => {
    setConfig((current) =>
      current.role.trim() ? current : { ...current, ...patch },
    );
  }, []);
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
  const [speaker, setSpeaker] = useState<"user" | "assistant" | null>(null);
  const stage = useRef<HTMLDivElement>(null);
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
    setMutePending(false);
    setSpeaker(null);
    setElapsed(0);
    startedAt.current = 0;
    setState("Connecting");
    setView("live");
    setRecord(undefined);
    setShowCaptions(false);
    const live = new LiveSession({
      state: (s) => {
        setState(s);
        if (s === "Connected" && !startedAt.current)
          startedAt.current = Date.now();
      },
      record: setRecord,
      fragments: setFragments,
      level: (levels) => {
        levels.bands.forEach((value, i) =>
          stage.current?.style.setProperty(`--voice-band-${i}`, String(value)),
        );
        stage.current?.style.setProperty("--voice-user", String(levels.user));
        stage.current?.style.setProperty(
          "--voice-assistant",
          String(levels.assistant),
        );
      },
      speaker: setSpeaker,
      error: setError,
      cancelled: () => {
        if (controller.current !== live) return;
        controller.current = undefined;
        setRecord(undefined);
        setView("setup");
        setBusy(false);
      },
      ended: (s, quit) => {
        if (controller.current !== live) return;
        controller.current = undefined;
        setRecord(quit ? undefined : s);
        setView(quit ? "setup" : "review");
        if (quit) setError("");
        setBusy(false);
        void refresh().catch(() => {});
        if (!quit) void generateFeedback(s);
      },
    });
    controller.current = live;
    try {
      await live.start(nextConfig);
    } catch (e) {
      if (controller.current !== live) return;
      controller.current = undefined;
      setError((e as Error).message);
      setView("setup");
      setBusy(false);
      void refresh().catch(() => {});
    } finally {
      if (controller.current === live) setBusy(false);
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
        <nav aria-label="Workspace">
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
        <div className="local-status">
          <ShieldCheck size={15} />
          <span>
            {cloudEnabled
              ? "Private workspace. Audio is never recorded."
              : "Saved on this device. Audio is never recorded."}
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
              {cloudEnabled ? "Private" : "Local"}
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
                <h1>Find the words before it counts.</h1>
                <p>
                  {cloudEnabled
                    ? "Prepare from a real posting or invitation, answer out loud, then read coaching that quotes what you actually said."
                    : "Answer out loud, then read coaching that quotes what you actually said."}
                </p>
              </div>
              <Practicing
                config={config}
                onChange={() =>
                  setConfig({
                    ...config,
                    opportunityId: undefined,
                    startingQuestion: undefined,
                    preparationBrief: undefined,
                    role: "",
                    jobDescription: "",
                    previousId: undefined,
                    relation: undefined,
                  })
                }
              />
              {cloudEnabled && (
                <Preparation
                  onReady={prefillPreparation}
                  onOpportunityChange={() =>
                    setConfig((current) =>
                      current.opportunityId
                        ? {
                            ...current,
                            opportunityId: undefined,
                            startingQuestion: undefined,
                            preparationBrief: undefined,
                            role: "",
                            jobDescription: "",
                            previousId: undefined,
                            relation: undefined,
                          }
                        : current,
                    )
                  }
                  onSelect={(patch) => {
                    setConfig((current) => ({ ...current, ...patch }));
                    document
                      .getElementById("practice-setup")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                />
              )}
              <form
                id="practice-setup"
                onSubmit={(e) => void start(e)}
                className="setup-layout"
              >
                <section className="setup-panel">
                  <div className="section-title">
                    <span className="step-number">{cloudEnabled ? 2 : 1}</span>
                    <h2>Choose how to practice</h2>
                  </div>
                  <div className="mode-grid">
                    <button
                      type="button"
                      className={`mode-card ${config.mode === "mock" ? "chosen" : ""}`}
                      aria-pressed={config.mode === "mock"}
                      onClick={() =>
                        setConfig({
                          ...config,
                          mode: "mock",
                          startingQuestion: undefined,
                        })
                      }
                    >
                      <span className="mode-top">
                        <Headphones size={22} />
                        <span className="radio">
                          {config.mode === "mock" && <i />}
                        </span>
                      </span>
                      <strong>Mock interview</strong>
                      <p>
                        Several questions in one sitting, like the real thing.
                        Coaching at the end.
                      </p>
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
                      <strong>Focused practice</strong>
                      <p>
                        Practice one interview question with up to two
                        follow-ups. Read coaching, then try the same answer
                        again.
                      </p>
                      <span className="duration">
                        <Clock3 size={13} /> Up to 5 minutes per try
                      </span>
                    </button>
                  </div>
                  <div className="section-title context-title">
                    <span className="step-number">{cloudEnabled ? 3 : 2}</span>
                    <h2>Tell the interviewer about the role</h2>
                  </div>
                  {config.startingQuestion && config.mode === "coached" && (
                    <p className="selected-question">
                      <strong>Your question</strong>
                      {config.startingQuestion}
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
                        jobDescription: config.opportunityId
                          ? ""
                          : config.jobDescription,
                        previousId: undefined,
                        relation: undefined,
                        opportunityId: undefined,
                        startingQuestion: undefined,
                        preparationBrief: undefined,
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
                      <label htmlFor="background">Additional background</label>
                      <textarea
                        id="background"
                        placeholder="Add anything beyond your resume that would help your interviewer…"
                        maxLength={15000}
                        value={config.background}
                        onChange={(e) =>
                          setConfig({ ...config, background: e.target.value })
                        }
                      />
                    </div>
                  </details>
                  {cloudEnabled ? (
                    <PracticeResume
                      opportunityId={config.opportunityId}
                      mode={config.resumeMode}
                      onMode={(resumeMode) =>
                        setConfig({ ...config, resumeMode })
                      }
                    />
                  ) : (
                    <LocalResume
                      text={config.resumeText ?? ""}
                      onSave={(resumeText) =>
                        setConfig({ ...config, resumeText })
                      }
                    />
                  )}
                  {!configured && (
                    <p className="inline-notice">
                      Voice practice is temporarily unavailable. Please try
                      again later.
                    </p>
                  )}
                  {affectedFirefox && (
                    <p className="inline-notice" role="note">
                      This Firefox version can disconnect voice practice
                      mid-answer. Use Chrome for your next attempt, or update to
                      Firefox 156 or later when available.
                    </p>
                  )}
                  <button
                    className="primary start-button"
                    disabled={busy || !configured}
                  >
                    <Mic size={18} />
                    {config.mode === "mock"
                      ? "Start mock interview"
                      : "Start practicing"}
                    <ArrowRight size={18} />
                  </button>
                  <p className="privacy-line">
                    <ShieldCheck size={15} />
                    Audio is processed by OpenAI, never recorded by this app.
                  </p>
                </section>
              </form>
              {cloudEnabled && <DefaultResume />}
            </>
          )}
          {view === "live" && (
            <section className="live-room">
              <div className="live-exit">
                <button
                  className="secondary quit-button"
                  disabled={
                    state === "Finishing" || state === "Save interrupted"
                  }
                  onClick={() => {
                    setError("");
                    controller.current?.quit();
                  }}
                >
                  <PhoneOff size={16} />
                  Quit interview
                </button>
              </div>
              <div className="live-heading">
                <span className="eyebrow">
                  {config.mode === "mock"
                    ? "Mock interview"
                    : "Focused practice"}
                </span>
                <span className="timer">
                  <Clock3 size={15} />
                  {clock(elapsed)}
                  <small>/ {config.mode === "mock" ? "20:00" : "05:00"}</small>
                </span>
              </div>
              <h1>{briefOf(record?.config ?? config)?.role || config.role}</h1>
              <p className="muted">
                {briefOf(record?.config ?? config)
                  ? `At ${briefOf(record?.config ?? config)!.company}. Questions draw on your researched brief.`
                  : config.mode === "mock"
                    ? "Let your experience lead the conversation."
                    : "One answer at a time. Review when you’re ready."}
              </p>
              {config.startingQuestion && config.mode === "coached" && (
                <p className="live-question">{config.startingQuestion}</p>
              )}
              <div
                ref={stage}
                className="conversation-stage"
                data-speaker={
                  state === "Connected" ? speaker || "idle" : "idle"
                }
                data-muted={muted}
              >
                <div
                  className={`connection-status ${state === "Connected" ? "connected" : ""}`}
                  role="status"
                >
                  <i />
                  {state}
                </div>
                <div className="voice-visualizer">
                  <div className="voice-halo" aria-hidden="true" />
                  <Wave active={state === "Connected"} />
                </div>
                <h2>
                  {state === "Connecting"
                    ? "Making room for your voice…"
                    : state === "Finishing"
                      ? "Saving your conversation…"
                      : state === "Save interrupted"
                        ? "Your answer is still here."
                        : state.startsWith("Connection interrupted")
                          ? "Pause for a moment."
                          : speaker === "assistant"
                            ? "Interviewer speaking."
                            : muted
                              ? "Take your time."
                              : speaker === "user"
                                ? "You’re speaking."
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
                    <i />
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
                Quit anytime to save your transcript and return to setup. Choose{" "}
                {config.mode === "coached" ? "Review answer" : "End & review"}{" "}
                for written feedback.
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
                      ? "Mock interview"
                      : "Focused practice"}
                    {record.config.relation === "retry" && (
                      <span className="tag">Repeat attempt</span>
                    )}
                  </p>
                  <h1>
                    {record.config.mode === "coached" &&
                    record.config.startingQuestion
                      ? record.config.startingQuestion
                      : briefOf(record.config)?.role || record.config.role}
                  </h1>
                  <p>
                    {briefOf(record.config)
                      ? `${briefOf(record.config)!.role} at ${briefOf(record.config)!.company}`
                      : record.config.role}
                    <span className="separator">·</span>
                    {clock(record.seconds)}
                    <span className="separator">·</span>
                    {new Date(record.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
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
                <div
                  className="review-loading"
                  role="status"
                  aria-live="polite"
                >
                  <div className="loading-orbit" aria-hidden="true">
                    <Sparkles size={25} />
                  </div>
                  <h2>Finding the useful details.</h2>
                  <p>
                    Looking at your answer, your examples, and what could be
                    clearer.
                  </p>
                  <div className="review-detail-hints" aria-hidden="true">
                    <span>Your answer</span>
                    <i />
                    <span>Your examples</span>
                    <i />
                    <span>What could be clearer</span>
                  </div>
                  <div className="review-processing-track" aria-hidden="true">
                    <i />
                  </div>
                </div>
              ) : record.feedback ? (
                <>
                  <section className="summary-card">
                    <span className="eyebrow">Your takeaway</span>
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
                        <p className="eyebrow">For your next attempt</p>
                        <h2>A clearer way through your answer</h2>
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
                    onClick={() => {
                      setError("");
                      void generateFeedback(record);
                    }}
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
                  <span className="review-actions-note">
                    Retries keep the same question and compare both attempts.
                  </span>
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
                  <h1>Your practice</h1>
                  <p>
                    Open a session to reread the coaching or try that answer
                    again.
                  </p>
                </div>
                <button className="primary" onClick={newPractice}>
                  <Plus size={17} />
                  New practice
                </button>
              </div>
              {!sessions.length ? (
                <div className="empty-history">
                  <History size={36} />
                  <h2>No sessions yet</h2>
                  <p>
                    Practice a question and its transcript and coaching will be
                    saved here.
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
                          <h3>
                            {s.config.mode === "coached" &&
                            s.config.startingQuestion
                              ? s.config.startingQuestion
                              : s.config.role}
                          </h3>
                          <p>
                            {s.config.mode === "mock"
                              ? "Mock interview"
                              : "Focused practice"}
                            {briefOf(s.config)
                              ? ` for ${briefOf(s.config)!.role} at ${briefOf(s.config)!.company}`
                              : s.config.startingQuestion
                                ? ` for ${s.config.role}`
                                : ""}
                            {s.config.relation === "retry"
                              ? ", repeat attempt"
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
