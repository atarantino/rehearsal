# Hackathon log

- **Project:** Rehearsal
- **Event:** Convex All Gas Hackathon
- **What it does:** Turns interview invitations and job postings into sourced briefs, spoken practice, grounded feedback, and retries.
- **Live app:** https://acoustic-cuttlefish-868.convex.site
- **Repo:** https://github.com/atarantino/rehearsal
- **Frontend:** Convex static hosting
- **Convex deployment:** https://acoustic-cuttlefish-868.convex.cloud
- **Components:** @convex-dev/auth (core, passkey, username), @convex-dev/workflow, @convex-dev/rate-limiter, @convex-dev/static-hosting
- **Convex features:** schema, indexes, queries, mutations, actions, HTTP actions, realtime queries, scheduled functions, file storage
- **Auth:** Convex Auth
- **AI models:** gpt-live-1 and gpt-5.6-terra in the hosted app; Codex subscription reasoning remains available in local mode
- **Started:** 2026-09-13T23:50:19Z
- **Last updated:** 2026-09-14T16:45:38Z

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

### 2026-09-14 - c8c6550: resume release; CI branch 336cef3
Shipped optional default and opportunity-specific resumes, with paste, PDF, and Word
`.docx` import for review before saving (`src/Resume.tsx`, `src/resume.worker.ts`).
Parsing runs in browser workers without OCR; original files are not uploaded or retained.
Convex ownership checks and rate-limited mutations save text, and sessions resolve their
resume context server-side so retries retain the original snapshot (`convex/resumes.ts`,
`convex/sessions.ts`). Switching resume modes preserves custom text until explicit deletion.

Reviewed with Claude Opus and fixed draft retention, opportunity selection, and deletion
behavior. Build, 17 unit/integration tests, 17 Convex tests, and 11 browser tests passed;
the authenticated local resume regression check also passed (`scripts/check-resumes.mjs`).
Manually deployed merged main commit `c8c6550` to production using Convex static hosting.
The live HTML matched the build; production checks passed for passkey signup, PDF/DOCX
import, saving across reload, and removing the synthetic resume. These are checks from
this build session, not production calls made for this log update.

Prepared automatic deployment after successful main checks in [PR #8](https://github.com/atarantino/rehearsal/pull/8)
(`.github/workflows/ci.yml` on `ci/deploy-main`, latest commit `336cef3`). GitHub CI passed.
The workflow serializes releases and checks the published HTML, but remains unmerged;
production deploy-key setup and activation are deferred. The resume release was manual.

### 2026-09-14 - 3fb1ebd: focused practice wording; working tree preparation changes
Renamed Coached practice to Focused practice and clarified one interview question with
up to two follow-ups, feedback, and a retry; mock copy now describes several questions
(`src/App.tsx`, `README.md`, `docs/local-development.md`). Consulted Opus on the wording
and approach. Opened [PR #9](https://github.com/atarantino/rehearsal/pull/9); behavior is unchanged.
The branch build and all 11 browser tests passed in this session; no deployment was run.

Uncommitted preparation changes omit research bodies from list responses, avoid duplicate
job evidence in brief prompts, and cap concurrent supplemental scrapes at two
(`convex/preparation.ts`, `convex/research.ts`). Added tests cover ownership, citations,
deduplication, and scrape ordering (`tests/backend.convex.ts`); not rerun in this log update.
Preserved the resume-release and CI history from the existing log at `5dfa935`.

### 2026-09-14 - working tree: voice disconnect reproduction and release
Reproduced the mid-answer cutoff with sustained synthetic speech in Firefox 155;
Chromium sustained two minutes, including a forced Convex WebSocket reconnect.
Consulted Opus and compared Firefox transport logs with Mozilla's ICE-lite bug;
Chrome is the verified workaround, and Firefox 156 remains unverified in this app.

Deployed an affected-Firefox notice, temporary-disconnect warning and recovery grace,
prompt transcript saving, preserved connection-loss reasons, and cleanup diagnostics
(`src/live.ts`, `src/App.tsx`, `convex/sessions.ts`, `convex/voice.ts`). Applied the
changes to deployed resume release `c8c6550` so the older working-tree base would not
remove resume support. All 51 release tests and the production build passed; hosted
HTML and JavaScript matched the release artifacts. Longer reproduction tooling and
limitations are recorded in `scripts/reproduce-voice.mjs` and `docs/voice-reliability.md`.
Post-deployment sign-in, resume-control, and Firefox-notice checks passed. The deployed
Chromium voice call stayed connected for 120 seconds through the forced Convex
reconnect and received transcript events through 119.8 seconds.
These changes improve failure handling; they cannot recover speech never transcribed.

### 2026-09-14 - 9b931c2: grounded review recovery; repository reconciliation
Made feedback quote matching tolerate whitespace and quotation-mark formatting while restoring the exact saved wording; invented claims and quotes stitched across speaker turns still fail (`shared/feedback.ts`, `server/prompts.ts`).
Convex review now corrects the rejected response with a field-specific hint, saves actionable errors, and preserves transcripts for retry; the retry button clears stale feedback banners (`convex/voice.ts`, `src/App.tsx`). Opened [PR #12](https://github.com/atarantino/rehearsal/pull/12) from `fix/grounded-review-errors`.
All 53 branch tests passed: 21 unit/API, 21 backend, and 11 browser tests. The production build and development backend push passed. The original rejected quote was unavailable, so formatting regressions use synthetic fixtures; no production deployment was performed for this fix.
Local commit `2f44b1e` now records the previously logged voice-reliability and preparation changes; those entries described their earlier working-tree and release state.
Merged commit `b16f31c` ([PR #11](https://github.com/atarantino/rehearsal/pull/11)) adds separate microphone/interviewer visualization and reduced-motion-aware review animations (`src/live.ts`, `src/App.tsx`, `src/style.css`). These changes were inspected locally; tests were not rerun for this log update.

## Submission readiness

Checked against the [official requirements](https://www.convex.dev/hackathons/all-gas).

- [x] Public repository and root build log.
- [x] Substantive Convex backend, authentication, workflows, and live updates.
- [x] Working OpenAI, Firecrawl, and AgentMail product integrations.
- [x] Public convex.site app accessible without an invite.
- [x] Hosted preparation and resume source merged into public `main` (PRs #1 and #7).
- [x] [Hosted demo draft, 2 minutes 11 seconds](https://acoustic-cuttlefish-868.convex.site/demo.html).
- [ ] Confirm Luma registration and personal eligibility.
- [ ] Share on X or LinkedIn, tagging all four sponsors.
- [ ] Submit repo, app, and video on vibeapps.dev before September 22, noon PT.

The earliest local commit is September 13, after the August 25 noon PT cutoff;
this supports timing but does not prove when the original app work began.
