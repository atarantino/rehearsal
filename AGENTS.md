<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Worktree and verification contract

Read [docs/agent-development.md](docs/agent-development.md) for setup, debug access, fixtures, and real-service limits.

- Fresh worktree: `npm run agent:setup`; interactive app: `npm run agent:up`. Use the printed localhost origin for passkeys.
- Check readiness with `npm run agent:doctor`. Read `.agent/logs/backend.log` after backend edits to confirm the latest deployment succeeded.
- Run `npm run verify` before handing off implementation changes. It covers build, unit/backend tests, legacy Express browser tests, and the actual Convex app browser suite. For iteration use `verify:fast`, `test:e2e`, or `test:convex:e2e` as appropriate.
- Report which checks ran and link the printed `summary.json`. Distinguish fixture verification from real-service verification; a build or legacy browser pass does not prove the Convex product works.
- Use `agent:inspect` and `agent:scenario` for bounded local test data and failure reproduction. Backend logs include session/opportunity IDs. Artifacts are under `.agent/artifacts/`; the latest run is in `.agent/latest-verification.json`.
- `agent:up` uses `.agent/dev/`, not the worktree's normal cloud configuration. Never share `.agent/` or a backend deployment between concurrent implementation worktrees. Stop owned services with `npm run agent:down` before removing a worktree.
- Fixture code under `tests/convex-fixtures/` is copied only into isolated QA projects. Do not introduce production auth bypasses or production fixture flags. Keep provider interfaces aligned and retain real auth/business functions in QA.
- Live provider smoke checks are explicit commands documented in the runbook. They incur usage and must identify the target environment. Do not turn ordinary setup/verification into cloud deployment, webhook registration, or email sending.
