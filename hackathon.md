# Hackathon log

- **Project:** Rehearsal
- **Event:** Convex All Gas Hackathon
- **What it does:** Turns interview invitations and job postings into sourced briefs, spoken practice, grounded feedback, project-informed coaching conversations, and retries.
- **Live app:** https://acoustic-cuttlefish-868.convex.site
- **Repo:** https://github.com/atarantino/rehearsal
- **Frontend:** Convex static hosting
- **Convex deployment:** https://acoustic-cuttlefish-868.convex.cloud
- **Components:** @convex-dev/auth (core, passkey and username), @convex-dev/workflow, @convex-dev/rate-limiter, @convex-dev/static-hosting, @convex-dev/agent
- **Convex features:** schema, indexes, queries, mutations, actions, HTTP actions, realtime queries, scheduled functions, file storage, Agent threads, AI Gateway integration
- **Auth:** Convex Auth
- **AI models:** gpt-live-1 and gpt-5.6-terra in the hosted app; coaching configures openai/gpt-5.6-terra through the Convex AI Gateway with direct OpenAI fallback when the gateway is unavailable; Codex subscription reasoning remains available in local mode
- **Started:** 2026-09-13T23:50:19Z
- **Last updated:** 2026-09-14T02:31:57Z

## Log

### 2026-09-13 - working tree
Installed the project-local hackathon build-log skill and its format reference
(`.agents/skills/convex-hackathon-skill/`). Selected Convex static hosting for the later build.
At initial log creation, there were no commits or application source to backfill.
Started now reflects the first setup commit, not an application implementation date.
No application has been built or deployed as part of this setup.

Created the public GitHub repository, documented the setup-only status in `README.md`,
and added `.gitignore` rules for local credentials, session data, and generated files.

### 2026-09-13 - d959919
The existing first commit records the setup documentation, ignore rules, and both
hackathon skill files. No application source is present in this commit.

### 2026-09-13 - working tree
Verified the remote Codex setup and preserved the selected Convex static hosting.
Installed the official Convex Codex plugin 1.10.0 globally; a fresh skill scan found
its 19 skills and the project hackathon skill. Both bundled MCP servers passed
initialization and tool-list checks. After the reported restart, a fresh Codex MCP
status check exposed both servers and their tools. Activation in the conversation
was still unverified at that point; the check below resolves that remaining item.
The hackathon skill files match upstream. Project AI files and the static-hosting
component remain deferred until a Convex application exists.

### 2026-09-14 - working tree
Completed setup verification: this session exposes 12 Convex deployment tools,
four Convex guidance tools, and the plugin error-monitor tool. The guidance
`get_runbook` call succeeded after authentication; `status` responded with
`No CONVEX_DEPLOYMENT set`, consistent with the absence of application configuration.
Deployment-dependent operations and the runtime monitor were not exercised.
Corrected Frontend to `not deployed`; Convex static hosting remains the planned choice.
Setup is complete. Application scaffolding, project AI files, component wiring,
and deployment remained deferred during setup verification; no app was built or deployed in that setup work.

### 2026-09-14 - d1d74f9
Imported the local React/Express app with mock interviews, coached retries, evidence-based
feedback, and atomic JSON history (`src/`, `server/`, `shared/`). GPT-Live uses the API;
Codex subscription reasoning is the default, with explicit optional API reasoning.
The build, 16 unit/integration tests, and 9 browser tests passed; real Codex feedback
evaluations and GPT-Live access checks passed. A full real voice-to-Codex round trip
remains unverified. Convex integration and public hosting remain planned.

### 2026-09-14 - working tree
Reconciled conflicting log versions, preserving setup and app-import history.
Started uses the first repository commit; the reported September 11 original build
is not independently established by this repository. GitHub visibility is public.
Source inspection confirms Express, local JSON storage, and OpenAI integration;
Convex, Firecrawl, AgentMail, auth, and public hosting are not implemented.
Prior test results above are delivery records, not tests rerun in this audit.

### 2026-09-14 - working tree: hosted preparation and practice
Moved the public app onto Convex with open passkey signup, account ownership,
fragment-level transcript storage, durable preparation workflows, quotas, and
scheduled voice cleanup (`convex/`, `src/Auth.tsx`, `src/Preparation.tsx`).
AgentMail routes signed invitation webhooks and sends opt-in preparation replies;
Firecrawl reads job and company sources; OpenAI writes briefs and conducts spoken
practice. Patched the pinned AgentMail component for environment isolation and
parent-callable inbox actions.

Published and opened the production app using Convex static hosting. Real-service
checks passed for passkey signup, source research, a signed email-to-brief-to-reply
round trip, and two hosted WebRTC attempts with validated feedback and comparison.
These checks used synthetic invitations and audio, not a human microphone session.
The identical retry was correctly described as unchanged. Build, 16 existing
unit/integration tests, 11 Convex tests, and 9 browser tests passed. Development
browser probes interrupted by source reloads were replaced by the hosted check.

Consulted Opus through Claude CLI twice. Its review informed late-start cleanup,
bounded hangup retries, stale feedback protection, stricter numeric grounding,
and request-size limits. Added local/cloud setup instructions and submission
materials (`README.md`, `scripts/check-cloud.mjs`, `docs/submission.md`).
AgentMail credentials work; its small inbox allowance can prevent new inboxes.
URL-based preparation remains available. No keys or inbox addresses are logged here.

Recorded a short demo of actual hosted preparation and two voice attempts.
The draft uses synthetic examples, accelerated playback, and AI narration; the
repeated answer verifies an honest unchanged comparison. It does not claim a human
microphone check or improved second answer (`public/rehearsal-demo.mp4`).

### 2026-09-14 - 93258ce
Added “Work on this story”: a saved coaching conversation with the attempt’s transcript, feedback, role context, and optional project materials (`src/Coaching.tsx`, `shared/coaching.ts`).
Registered Convex Agent for per-attempt threads, with scheduled replies, failure recovery, quotas, ownership checks, and deletion cleanup (`convex/convex.config.ts`, `convex/coaching.ts`, `convex/coach.ts`).
Added PDF uploads with page-referenced text extraction and pasted notes; Word and PowerPoint currently require PDF export. Editable drafts carry into retries as separate practice notes, preserving the original feedback and speech-evidence rules (`convex/projectFiles.ts`, `shared/projectPdf.ts`, `server/prompts.ts`).
Delivery checks passed: build, 18 unit/integration tests, 16 Convex tests, and 11 browser tests. Real local Convex checks covered PDF extraction, persistence, Agent thread creation, missing-model recovery, and deletion; these are prior session results, not tests rerun for this log update.
Coaching is committed and verified locally, not deployed to the public app. Conversation tests use a mock model; live coaching replies remain unverified because this checkout lacked hosted deployment and AI credentials.
The previously logged hosted milestone is committed as `e080892`; `a1a6c9c` adds the browser demo player (`public/demo.html`). Existing public app and demo URLs describe that earlier release.

### 2026-09-14 - 2f5420d
Added repeatable worktree setup, diagnostics, startup/shutdown, and a simulated browser, with separate local Convex backends and ports (`scripts/agent.mjs`, `scripts/agent/`, `scripts/agent-browser.ts`).
Added Convex browser QA for passkey login, preparation workflows, persisted transcripts, feedback, retries, deletion, and failed or abandoned feedback recovery (`tests/cloud.spec.ts`, `tests/convex-fixtures/`).
Added session/opportunity lifecycle logs, failure scenarios, screenshots, traces, and per-run reports; GitHub Actions now configures the same verification command (`convex/voice.ts`, `convex/preparation.ts`, `scripts/verify.mjs`, `.github/workflows/verify.yml`).
Fixed mobile Sign out visibility and prevented QA artifacts from reloading the interactive app. Rebased onto the preparation branch while preserving project coaching dependencies, UI fixtures, and tests (`src/style.css`, `vite.config.ts`, `tests/test-server.ts`, `playwright.config.ts`).
Local verification of this commit passed the build, 21 unit/integration tests, 16 Convex tests, 11 Express/coaching browser tests, and 6 Convex browser tests; the saved report completed at 2026-09-14T02:22:57.955Z. These are prior run results, not checks rerun for this log update.
The Convex browser suite uses a real isolated local backend with synthetic provider responses and WebRTC. No public deployment or paid live-service check was performed for this milestone; CI success is not established by the local report.

### 2026-09-14 - b29dbc8
Improved WebRTC disconnect handling: show Reconnecting while the browser can recover, preserve elapsed time, and save captured speech for review after failure (`src/live.ts`, `src/App.tsx`).
Added Cloudflare STUN with a two-second fallback after the first candidate; ending a disconnected session skips the channel-response wait. Claude Opus review informed these refinements (`9e24f03`, `eddbb52`).
Merged the preparation branch into PR #5, preserving project coaching and moving the ICE scenarios into the shared voice fixture with Convex-compatible SDP and browser diagnostics (`tests/helpers/voice.ts`, `tests/browser.spec.ts`).
Full local verification of the resolved tree passed: build, 21 unit/integration tests, 16 Convex tests, 22 Express/coaching browser tests, and 6 Convex app browser tests. The saved report completed at 2026-09-14T02:31:41.861Z, before the merge commit; these checks were not rerun for this log update.
The Convex suite used an isolated local backend with fixture providers and WebRTC. Real-network recovery remains unverified; this milestone did not deploy the fixes or run live-service checks.

## Submission readiness

Checked against the [official requirements](https://www.convex.dev/hackathons/all-gas).

- [x] Public repository and root build log.
- [x] Substantive Convex backend, authentication, workflows, and live updates.
- [x] Working OpenAI, Firecrawl, and AgentMail product integrations.
- [x] Public convex.site app accessible without an invite.
- [x] Source published on the public `hackathon/convex-preparation` branch for review.
- [x] [Hosted demo draft, 2 minutes 11 seconds](https://acoustic-cuttlefish-868.convex.site/demo.html).
- [ ] Confirm Luma registration and personal eligibility.
- [ ] Share on X or LinkedIn, tagging all four sponsors.
- [ ] Submit repo, app, and video on vibeapps.dev before September 22, noon PT.

The earliest local commit is September 13, after the August 25 noon PT cutoff;
this supports timing but does not prove when the original app work began.
