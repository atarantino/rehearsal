# Agent development and verification

The default agent environment runs the current React/Convex app with real passkey authentication, database writes, subscriptions, durable workflows, rate limits, and feedback validation. OpenAI and Firecrawl use deterministic fixtures. No provider keys or Convex account are needed. First setup needs network access to install packages, Chromium, and the local Convex binary. Supported hosts: Linux and macOS with Node 22.6+.

## Fresh worktree

```sh
npm run agent:setup
# On a Linux machine missing browser system libraries:
npm run agent:setup -- --with-deps
npm run agent:up
npm run agent:doctor
npm run agent:browser  # optional headed browser with virtual passkey and voice
```

`agent:setup` works before dependencies are installed. It runs `npm ci`, installs Chromium, assigns ports, and verifies the browser can launch. It is repeatable and does not copy credentials from another checkout.

`agent:up` prints the frontend URL. Use that exact **localhost** origin for passkeys. It starts a background supervisor, local Convex backend, and Vite. Frontend edits hot reload; backend, shared code, and fixture changes synchronize into the isolated project and trigger Convex deployment. Check backend logs after edits: a running server alone does not prove the latest functions deployed.

The ignored `.agent/worktree.json` records the worktree identity and ports. `.agent/dev/` contains the isolated backend's code, database, and generated signing keys. `.agent/runtime.json` contains the supervisor's local control token. The normal `.env`, `.env.local`, cloud deployments, and webhook configuration are not modified. Fixture subprocesses strip inherited Convex selectors, Vite variables, and provider credentials.

Two worktrees can run concurrently. Each has different ports and its own backend database/functions; the harness refuses occupied ports. Do not symlink `.agent/`, `.env.local`, or Convex backend state between worktrees. If the checkout moves, stop it first and remove `.agent/worktree.json` before setup.

```sh
npm run agent:down
```

Shutdown uses an authenticated local supervisor endpoint and stops only its child processes. It never kills a process merely because it occupies a port. Run `agent:down` before removing a worktree. If an external SIGKILL bypasses cleanup, inspect the process owner and command before stopping orphaned processes; `agent:doctor` will flag occupied ports.

## Verification contract

```sh
npm run verify                 # build, unit/backend tests, both browser suites
npm run verify:fast            # build and unit/backend tests
npm run test:e2e               # legacy Express and coaching UI fixture browser suites
npm run test:convex:e2e        # current Convex app browser suite
```

The Convex suite creates a fresh local deployment on separate ports for each run, pushes/typechecks functions, builds the cloud frontend against it, and drives the built app in Chromium. It deletes the test database and signing keys on completion, including failures. It can run while `agent:up` is serving the interactive environment.

Coverage includes:

- Virtual passkey signup, reload, sign-out, returning login, and desktop/mobile workspace layout.
- Job URL preparation through the actual workflow, saved briefs, and starting a sourced question.
- Failed research and retry with state retained after reload.
- Voice startup, transcript writes/deduplication, mute acknowledgment, feedback validation, retry comparison, saved history, microphone release, and deletion.
- Failed feedback, saved-history recovery, and reclamation of an abandoned feedback lease without another voice start.

WebRTC/audio and external provider responses are fixtures. These tests do not prove microphone sound quality, real model behavior, Firecrawl access, email delivery, or production configuration. Existing backend tests separately exercise ownership, webhook signatures/deduplication, cleanup, and limits. The GitHub Actions workflow runs `npm run verify` and retains artifacts for seven days without deployment/provider credentials.

## Debugging and reproduction

```sh
npm run agent:inspect
npm run agent:scenario -- SESSION_ID feedback-failure
npm run agent:scenario -- SESSION_ID feedback-recover
npm run agent:scenario -- SESSION_ID stale-feedback
```

`agent:inspect` returns bounded metadata: test user IDs/names, session IDs/status, opportunity IDs/status, and workflow IDs. It never returns signing keys, full transcripts, or email bodies. Scenario functions exist only in the isolated project and are internal admin functions. `feedback-failure` makes that session's fixture provider fail; `feedback-recover` clears the fixture background marker; `stale-feedback` removes a closed session's feedback and installs an expired lease for retry testing. These commands modify synthetic local data.

For research failure, submit `https://example.com/unreadable`. Other public HTTPS job URLs return the same synthetic Acme role brief. This is a deterministic reproduction environment, not a scraper preview.

`npm run agent:browser` opens Chromium with a virtual passkey, simulated WebRTC, and a synthetic spoken-answer transcript, so you can explore the full fixture flow interactively. Use `npm run agent:browser -- --smoke` for a headless signup-to-feedback check against the running worktree. A normal browser can explore preparation but cannot negotiate real audio with the fixture provider. For real microphone work, use the normal development environment with actual provider credentials.

Read `.agent/logs/backend.log`, `frontend.log`, and `supervisor.log` for interactive problems. Backend logs include structured session/opportunity IDs and lifecycle stages, without transcript or provider-response bodies. Match those IDs with `agent:inspect` and the Convex request events in browser traces.

Each verification prints `.agent/artifacts/<run>/summary.json`. `.agent/latest-verification.json` points to the latest completed run. Artifacts include commit/dirty state, origins, modes, individual check results, process logs, Playwright JSON/HTML reports, browser console/errors, and screenshots. Failures retain traces and video.

```sh
npx playwright show-report .agent/artifacts/RUN/convex/report
npx playwright show-trace .agent/artifacts/RUN/convex/results/TEST/trace.zip
```

Artifacts are local and ignored. Browser traces contain synthetic session authentication and page data; publish only deliberately. Never upload `.agent/dev/`, `.agent/runtime.json`, or an entire `.agent/` directory. CI uploads only `.agent/artifacts/`.

The QA harness copies an allowlist of backend/shared source into the isolated project, replacing only `convex/openai.ts` and the `convex/firecrawl.ts` provider boundary and adding internal scenario helpers. Auth and business functions remain unchanged. Keep fixture/provider interfaces aligned when modifying them; the isolated deployment is typechecked. No environment switch enables fixtures in a normal deployment.

## Real services and final QA

Configure a dedicated development deployment using the README's normal setup. Do not run `scripts/configure-cloud.mjs` as part of worktree startup: it writes deployment secrets and registers a webhook.

```sh
npm run test:cloud -- --url=https://YOUR-DEV-APP.convex.site
npm run test:cloud -- --url=https://YOUR-DEV-APP.convex.site --audio=/absolute/path/to/synthetic.wav
```

The first command creates a real synthetic passkey account. The second also makes two paid voice attempts, waits for transcript and feedback milestones, checks comparison, and removes the two session records after success. A failed run may leave synthetic records; the account itself remains because account deletion is not implemented. Live artifacts are under `.agent/artifacts/live-*`. Run these checks explicitly against the intended environment; `verify` never invokes them.

For a release, also check a synthetic forwarded invitation through the signed webhook and real Firecrawl research. A human should listen to opening questions, answer aloud, pause, interrupt, mute/unmute, and confirm microphone release. Automated synthetic media cannot establish audible quality.
