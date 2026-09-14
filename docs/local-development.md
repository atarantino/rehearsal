# Rehearsal

A local voice interview coach for behavioral practice. React + TypeScript, Vite, Express, OpenAI GPT-Live, and your ChatGPT-authenticated Codex CLI.

This document describes the legacy personal Express mode. The current hosted product uses Convex; see the [README](../README.md). For isolated worktrees and automated QA of the current app, use the [agent development runbook](agent-development.md).

## Run on your Mac

Use Node 22.6 or later, Codex CLI 0.154 or later, and desktop Chrome. From this folder:

```sh
npm install
cp .env.example .env
```

Edit `.env` and set `OPENAI_API_KEY` to a valid OpenAI project key with access to **gpt-live-1** for live voice. Backend reasoning uses your **Codex subscription** by default. `.env` deliberately takes precedence over an inherited environment value, so you can replace a stale key. Never paste the key into the frontend or into a chat.

```sh
codex login # choose ChatGPT sign-in, if not already signed in
npm run check:codex
npm run check:live
npm run dev:local
```

Open **http://localhost:4317**. Allow microphone access when you start a session. A quiet room and headphones help. Changes to `.env` or server code require restarting `npm run dev:local`; frontend changes reload automatically.

For a production build served locally:

```sh
VITE_LOCAL_MODE=true npm run build
npm start
```

The server binds to `127.0.0.1`. This is a personal, local application; it has no account system or public hosting configuration.

## Practice

- **Mock interview:** A realistic conversation with follow-ups, a 15-minute target, and a 20-minute hard limit. End & review closes the voice session and starts written coaching.
- **Coached practice:** A single question with up to two follow-ups. Click Review answer when ready. Each attempt has a five-minute limit.
- **Review:** Specific strengths, two supported improvements when evidence permits, an answer outline, and questions for missing details. Short or partial answers are explicitly labeled. No numeric scores or personality judgments.
- **Retry:** Rehearse the same coached question; after a mock interview, the coach selects a question from that interview to practice. The new review compares attempts. Next question starts another coached round.
- **History:** Reopen saved transcripts and feedback, or delete a session. Deleting a parent does not delete later attempts; comparisons unavailable after a parent is deleted are omitted.

The microphone control waits for the service acknowledgment. Captions are optional and can overlap. Pauses never trigger a review automatically. If a save fails, keep the tab open and use Retry saving. If feedback fails, Retry feedback uses the stored transcript without creating another voice session.

## Data and API behavior

API credentials stay in the local server. The browser negotiates WebRTC through a same-origin endpoint. GPT-Live handles speech. Client delegation sends backend interview reasoning to the local Codex CLI, authenticated through your existing ChatGPT login. Written coaching and retry comparisons also use Codex, with structured output and the same evidence validation.

**Billing split:** voice sessions use the OpenAI API; backend reasoning uses your Codex subscription limits. GPT-Live is billed for the live session, including listening and speaking, not just speech-to-text. Codex is not unlimited, and a delegated follow-up can take longer than managed API reasoning. End sessions when you are done; waiting in an open voice session still uses API time.

The app removes API credentials from Codex subprocesses, verifies ChatGPT login, and enforces that authentication method. It invokes `codex exec` with structured output, a read-only sandbox, ephemeral sessions, shell/tools/plugins disabled, no user configuration, and an isolated scratch directory. Authentication is reused by the CLI without reading or copying its tokens. Supplied transcripts go through stdin; temporary schemas and results are removed afterward. Codex work follows your ChatGPT/Codex data settings.

There is **no automatic paid API fallback**. If Codex is missing, signed out, rate-limited, or fails, the app explains the error. Saved feedback can be retried. `REASONING_BACKEND=api` in `.env` explicitly opts into the original paid GPT-5.6 Terra backend for both live reasoning and feedback. `CODEX_BIN` can specify the executable path. Restart after changing either setting. The setup screen shows which reasoning backend is configured, and saved reviews record which backend generated them.

Audio and supplied context are sent to OpenAI for processing. The app **does not record or save audio**. It requests `store: false` on Live and, in the optional API reasoning mode, standalone Responses calls; this does not constitute a claim about provider-wide retention policies.

Session records live in the ignored `data/` directory as versioned JSON, written atomically. They contain context, transcript fragments, timestamps, feedback, relationships, and available usage. Files use owner-only permissions. There are no analytics, cloud history, external fonts, or advertising requests.

Both the browser and a server sideband collect transcripts, deduplicated by event ID. Raw text and timing remain intact; displayed caption groups are not authoritative turns. Browser closure is the normal end path. The server enforces a second duration timer and can close the session through its sideband. Final usage is confirmed only after a `session.closed` event. Interrupted records are recoverable after restart.

Feedback quotes must match current user speech. A suggested mock retry question must match the assistant transcript. Numeric claims newly introduced in an outline are rejected. These checks catch some ungrounded output; broader factual accuracy and the usefulness of model advice still require human judgment.

### Local API

| Method       | Route                        | Purpose                                                              |
| ------------ | ---------------------------- | -------------------------------------------------------------------- |
| GET          | `/api/status`                | Key presence and configured model names; not a live-access guarantee |
| GET          | `/api/sessions`              | Session summaries                                                    |
| POST         | `/api/sessions`              | Validate configuration and SDP offer; create one active Live session |
| GET / DELETE | `/api/sessions/:id`          | Read or delete a local session                                       |
| POST         | `/api/sessions/:id/events`   | Persist deduplicated transcript fragments                            |
| POST         | `/api/sessions/:id/close`    | Request server-side closure and await finalization                   |
| POST         | `/api/sessions/:id/finalize` | Persist browser-observed finalization or interruption                |
| POST         | `/api/sessions/:id/feedback` | Generate or return saved feedback; concurrent calls share one job    |

Mutating requests require a matching localhost Origin. Host checks and binding are local protections, not multiuser authentication. Error responses never forward OpenAI keys or raw provider error bodies.

## Verification

```sh
npm test
VITE_LOCAL_MODE=true npm run build
npm run test:e2e
```

Browser tests use an isolated fixture server and simulated WebRTC events; the production server cannot switch into fixture mode. They exercise both complete flows, mute acknowledgments, captions, retry comparisons, saved history, deletion, microphone denial, disconnects, hard limits, failed saves, API rejection, and retrying feedback. Storage tests exercise concurrent writes and restart recovery. Screenshots, browser reports, and failure traces are written to the run directory printed by the command under `.agent/artifacts/`.

To evaluate actual coaching on short, vague, specific, and incomplete sample answers:

```sh
npm run eval:feedback
```

This uses Codex subscription capacity by default and prints synthetic sample feedback. With `REASONING_BACKEND=api`, it instead makes billable API calls. It stops at the first credential, quota, or model failure. Inspect suggestions for factual grounding and usefulness, beyond automated quote checks.

### Historical verification status of the legacy delivery

The TypeScript/production build, 16 unit/integration tests, and 9 browser tests passed after the subscription integration. Desktop and mobile layouts were visually inspected. A real structured Codex request and all four sample feedback evaluations succeeded through the existing ChatGPT login with API credentials removed. The short and incomplete samples were marked as limited evidence; quoted strengths and improvements were verified against each sample. The current GPT-Live model-access check passes. The full live voice-to-Codex round trip has not yet been verified against the real voice service; automated tests cover the delegation contract and lifecycle. No substitute voice model is used.

After adding a valid key, verify:

1. Run `check:live`, then start each practice mode in Chrome.
2. Hear the opening question, answer aloud, pause to think, and interrupt once. Confirm meaningful spoken follow-ups and captions.
3. Mute/unmute and verify the interviewer cannot hear you while muted.
4. End/review, check that Chrome releases the microphone, and assess the quotes and outline against your answer.
5. Retry an answer and confirm the same question and a supported comparison.

## Source references

- [GPT-Live WebRTC setup](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live)
- [Session lifecycle and transcripts](https://developers.openai.com/api/docs/guides/live-conversations)
- [Codex subscription authentication](https://learn.chatgpt.com/docs/auth)
- [Codex non-interactive structured output](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Responses and client delegation](https://developers.openai.com/api/docs/guides/live-delegation)
- [Server sideband controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live)

The legacy Express mode remains a personal local app. Public hosting and accounts are provided by the current Convex product; they are not features of this legacy mode.
