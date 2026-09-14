# Hackathon log

- **Project:** Rehearsal
- **Event:** Convex All Gas Hackathon
- **What it does:** Local voice interview practice with mock interviews, coached attempts, written feedback, and saved history.
- **Live app:** not deployed
- **Repo:** https://github.com/atarantino/rehearsal
- **Frontend:** not deployed
- **Convex deployment:** not deployed
- **Components:** none
- **Convex features:** none yet
- **Auth:** none
- **AI models:** gpt-live-1; Codex CLI configured model for subscription reasoning; gpt-5.6-terra for optional API reasoning
- **Started:** 2026-09-13T23:45:36Z
- **Last updated:** 2026-09-14T00:17:20Z

## Log

### 2026-09-13 - working tree
Installed the project-local hackathon build-log skill and its format reference
(`.agents/skills/convex-hackathon-skill/`). Selected Convex static hosting for the later build.
This repository has no commits or application source to backfill. Started reflects the
observed setup-file creation time, not a verified application start date.
No application has been built or deployed as part of this setup.

Created the public GitHub repository, documented the setup-only status in `README.md`,
and added `.gitignore` rules for local credentials, session data, and generated files.

### 2026-09-14 - working tree
Imported the local React/Express app with mock interviews, coached retries, evidence-based
feedback, and atomic JSON history (`src/`, `server/`, `shared/`). GPT-Live uses the API;
Codex subscription reasoning is the default, with explicit optional API reasoning.
The build, 16 unit/integration tests, and 9 browser tests passed; real Codex feedback
evaluations and GPT-Live access checks passed. A full real voice-to-Codex round trip
remains unverified. Convex integration and public hosting remain planned.
