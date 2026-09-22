# Hackathon log

- **Project:** Rehearsal
- **Event:** Convex All Gas Hackathon
- **What it does:** Turns interview invitations, attached prep materials, and job postings into sourced briefs, spoken practice, grounded feedback, and retries.
- **Live app:** https://acoustic-cuttlefish-868.convex.site
- **Repo:** https://github.com/atarantino/rehearsal
- **Frontend:** Convex static hosting
- **Convex deployment:** https://acoustic-cuttlefish-868.convex.cloud
- **Components:** @convex-dev/auth (core, passkey, username), @convex-dev/workflow, @convex-dev/rate-limiter, @convex-dev/static-hosting
- **Convex features:** schema, indexes, queries, mutations, actions, HTTP actions, realtime queries, scheduled functions, file storage
- **Auth:** Convex Auth
- **AI models:** gpt-live-1 and gpt-5.6-terra in the hosted app; gpt-4o-mini-tts for synthetic voice evaluation; Codex subscription reasoning remains available in local mode
- **Started:** 2026-09-13T23:50:19Z
- **Last updated:** 2026-09-22T17:23:48Z

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

### 2026-09-14 - 71b6148
Added browser-side PDF/DOCX resume import, editable defaults and opportunity overrides, and resume snapshots retained for retries (c8c6550; `src/Resume.tsx`, `src/resume.worker.ts`). Convex queries and ownership-checked mutations persist this context (`convex/resumes.ts`, `convex/schema.ts`, `convex/sessions.ts`).
Clarified focused practice as one question with up to two follow-ups, and distinguished it from a full mock interview (3fb1ebd, merged in 0ea16ec; `src/App.tsx`, `README.md`).
Made the waveform respond to both microphone and interviewer audio, with distinct speaking labels and colors, smoother motion, and CSS updates that avoid redrawing the whole app each frame (`src/live.ts`, `src/App.tsx`, `src/style.css`).
Added an orbit, pulsing hints, and a moving activity indicator while “Finding the useful details” waits for feedback. Both animations respect reduced motion.
Consulted Claude Opus through the CLI on audio measurement, rendering performance, accessibility, and animation design. The production build, TypeScript check, and all 13 browser tests passed; synthetic audio checks covered both voices, mute, silence, reduced motion, and pending feedback (`tests/browser.spec.ts`). These checks do not establish a new deployment or a human microphone test.

### 2026-09-14 - 9b931c2: grounded review recovery; repository reconciliation
Made feedback quote matching tolerate whitespace and quotation-mark formatting while restoring the exact saved wording; invented claims and quotes stitched across speaker turns still fail (`shared/feedback.ts`, `server/prompts.ts`).
Convex review now corrects the rejected response with a field-specific hint, saves actionable errors, and preserves transcripts for retry; the retry button clears stale feedback banners (`convex/voice.ts`, `src/App.tsx`). Opened [PR #12](https://github.com/atarantino/rehearsal/pull/12) from `fix/grounded-review-errors`.
All 53 branch tests passed: 21 unit/API, 21 backend, and 11 browser tests. The production build and development backend push passed. The original rejected quote was unavailable, so formatting regressions use synthetic fixtures; no production deployment was performed for this fix.
Local commit `2f44b1e` now records the previously logged voice-reliability and preparation changes; those entries described their earlier working-tree and release state.
Merged commit `b16f31c` ([PR #11](https://github.com/atarantino/rehearsal/pull/11)) adds separate microphone/interviewer visualization and reduced-motion-aware review animations (`src/live.ts`, `src/App.tsx`, `src/style.css`). These changes were inspected locally; tests were not rerun for this log update.

### 2026-09-14 - 06dc4a9: voice reliability conflict resolution
Resolved [PR #13](https://github.com/atarantino/rehearsal/pull/13) against current main, preserving resume support, voice animations, and both build-log histories.
Kept STUN and disconnect recovery alongside microphone/interviewer visualization; interruption warnings take priority over speaking labels (`src/live.ts`, `src/App.tsx`, `tests/browser.spec.ts`).
All 57 tests passed: 17 unit/API, 22 Convex backend, and 18 browser tests. Application/backend typechecks and the production build passed.
Pushed the merge and confirmed the PR was mergeable; corrected its description to reflect retained resume functionality. No deployment or live microphone test was performed, and these checks were not rerun for this log update.

### 2026-09-14 - 0b43ffb: review simplification and conflict resolution
Removed the redundant transcript read before feedback generation; the Convex claim mutation still checks authentication and session ownership (`convex/voice.ts`, `convex/sessions.ts`).
Merged current main into [PR #10](https://github.com/atarantino/rehearsal/pull/10), preserving its voice reliability and grounded-feedback changes. Kept the stronger retry-question validation, which already includes the duplicate-reset removal (`shared/feedback.ts`).
The application/backend typechecks, production build, and all 47 unit/API and Convex tests passed before pushing the merge. Existing tests were preserved.
Confirmed the pushed PR was conflict-free and mergeable. These checks were performed during conflict resolution, not rerun for this log update; no deployment was performed.

### 2026-09-22 - 450c80e: researched voice context and workspace
Integrated Fable’s preparation, live-session and feedback design, including prepared mock selection and responsive layouts (`src/App.tsx`, `src/Preparation.tsx`, `src/style.css`; implementation commit `bebeedc`).
Convex snapshots the owned structured research brief into each session; voice and reasoning receive the same complete context, with immutable retry snapshots (`convex/sessions.ts`, `server/prompts.ts`).
`docs/experience-verification.md` records 68 passing tests, a real development Firecrawl-to-voice smoke, and the earlier production release with signup and responsive checks. These are recorded results, not checks rerun during setup.

### 2026-09-22 - 712dec2: email prep materials
Added PDF, DOCX and plain-text attachment import before email preparation, including attachment-only messages, bounded downloads/parsing and per-file status/retry (`convex/email.ts`, `convex/attachments.ts`, `server/attachment-text.ts`, `src/Preparation.tsx`).
Private attachment text becomes sourced preparation and reaches the session brief; Convex ownership checks and webhook deduplication remain in place (`convex/research.ts`, `convex/workflows.ts`, `tests/backend.convex.ts`).
`docs/email-attachments.md` records 75 passing tests and development runtime/UI checks. Provider downloads and webhook delivery were simulated; scanned PDFs and images still need a text-based copy. Tests were not rerun during this setup.

### 2026-09-22 - working tree: All Gas setup verification
Rechecked the official Convex setup procedure in the existing Codex Linux workspace. The marketplace update and plugin install commands retained enabled `convex@convex-codex-plugin` 1.10.0; its deployment MCP status call succeeded in this session without reading application records.
Verified managed Convex AI files are current, refreshed both project-local hackathon skill files from their official repository, and confirmed the skill is enabled through Codex’s skills list. No restart is required for these already-loaded integrations.
Preserved the existing Convex static hosting choice, verified its registered component and HTTP routes, and backfilled the two recent changes from Git and repository documentation. This setup did not build, deploy, publish, submit, commit or push the application.

### 2026-09-22 - bb2b09a: constrain preparation citations
Fixed brief generation failing after successful attachment import and research: citations are now restricted in the model output schema to the exact supplied public URLs and private attachment anchors (`convex/research.ts`). Runtime validation still rejects unknown citations.
The 26 Node tests, 32 Convex tests, typechecks and build passed. A real development model call returned verified citations, including an attachment reference. Deployed the backend fix and retried the affected production preparation; it reached ready with all citations verified and the imported attachment cited.

### 2026-09-22 - working tree: quit interviews and responsive voice bars
Added a visible “Quit interview” button that immediately stops microphone and playback, saves the available transcript, and returns to setup without generating feedback (`src/App.tsx`, `src/live.ts`, `src/style.css`).
Cancellation also handles pending microphone permission and late session creation; interrupted saves retain the transcript for retry, and successful recovery clears the error banner.
Updated voice bars to follow measured frequency bands from both speakers, settle during silence or mute, and respect reduced motion (`src/voiceMeter.ts`, `src/live.ts`, `src/style.css`).
Application/backend typechecks, the production build, and all 23 local browser tests passed; all five quit regressions passed again after the final error-banner fix (`tests/browser.spec.ts`). Tests use simulated voice connections and synthetic audio.
These are uncommitted changes using the existing session APIs; no deployment or human microphone check was performed. Validation results come from the preceding build session, not reruns for this log update.

### 2026-09-22 - bb2b09a and working tree: researched context and opportunity management
Merged the interview workspace redesign and complete researched-brief snapshots for voice practice (`bebeedc`; `convex/sessions.ts`, `src/App.tsx`). The production release and responsive signup checks are recorded in `docs/experience-verification.md`; its real research and short voice check ran on development.
Imported emailed PDF, DOCX, and text prep materials with bounded downloads, per-file status, partial-failure recovery, and ownership checks (`712dec2`; `convex/attachments.ts`, `convex/workflows.ts`). Constrained generated citations to supplied public URLs and exact attachment anchors (`bb2b09a`; `convex/research.ts`).
In the working tree, the selected ready brief now prefills the role and practice context while preserving manual role entries. Opportunity labels use the researched job title and employer instead of overwriting them with the initial email extraction (`src/Preparation.tsx`, `src/App.tsx`, `convex/research.ts`); existing saved titles require regeneration.
Added confirmed opportunity and prep-material deletion, and made existing resume deletion controls clearer (`src/DeleteSaved.tsx`, `src/Preparation.tsx`, `src/Resume.tsx`). Ownership-checked Convex mutations cancel active preparation when deleting an opportunity and tolerate late updates without recreating it (`convex/preparation.ts`).
Removing a material clears the derived brief and offers preparation from the remaining sources; saved session snapshots remain available. Realtime selection and resume queries handle deleted opportunities without retaining stale practice context (`convex/preparation.ts`, `convex/resumes.ts`, `src/Preparation.tsx`).
During this build session, the build and all 36 backend tests passed, including deletion ownership, workflow cancellation, and stale-brief rejection (`tests/backend.convex.ts`). Browser checks with simulated backend responses covered autofill, manual edits, mobile confirmation/cancel, delete failure/retry, both resume removals, and last-opportunity removal. The backend changes pushed successfully to development; the working-tree UI was not published to production. No checks or deployments were rerun for this log update.

### 2026-09-22 - 19d1805: paced mock interviews and candidate questions
The previously logged opportunity-management work is now on main (`c89f961`, PR #19). Added a roughly 15-minute mock agenda, quiet clock cues, candidate Q&A, and a natural closing in [PR #20](https://github.com/atarantino/rehearsal/pull/20) (`shared/interview.ts`, `src/live.ts`).
Separated candidate-question reflection from behavioral evidence, preserved overlapping answer fragments, and advanced through prepared questions using the owned brief; Convex mutations retain retry snapshots and actions validate feedback (`shared/feedback.ts`, `convex/sessions.ts`, `convex/voice.ts`). Retry labels now show the actual question, and entering a call reveals its controls on mobile (`src/App.tsx`).
[Fable approved the revised PR](https://github.com/atarantino/rehearsal/pull/20#issuecomment-5780919138) after its findings were fixed and independently passed 11 focused tests. Build/typechecks and all 97 tests passed: 33 unit/integration, 38 Convex, and 26 browser; GitHub verification passed.
Real-provider synthetic mock and focused checks exercised thinking pauses and validated feedback; the mock also reached Q&A, admitted unknown employer facts, and closed naturally (`scripts/evaluate-interview.ts`, `docs/interview-realism.md`). Accelerated WebSocket checks do not establish full-length human/WebRTC reliability or guaranteed transition timing.
Validated the backend on development. PR #20 remains open; no production release was made for this feature. These results come from the implementation session, not tests or deployments rerun for this log update.

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
