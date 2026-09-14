# Rehearsal

Turn an interview invitation into useful spoken practice. Forward an invitation or paste a job posting, review a sourced role brief, answer a tailored question out loud, then retry with specific feedback.

**Live app:** https://acoustic-cuttlefish-868.convex.site

[Watch the demo draft](https://acoustic-cuttlefish-868.convex.site/demo.html) · [Submission materials](docs/submission.md)

Built for the [Convex All Gas Hackathon](https://www.convex.dev/hackathons/all-gas). See [hackathon.md](hackathon.md) for the build log and submission checklist.

## How it works

- **AgentMail** creates a private preparation inbox. Signed webhooks route invitation text to its owner. An optional reply links back to the authenticated workspace.
- **Firecrawl** reads job postings and public company pages. Briefs include sources, tailored questions, and details that need confirming.
- **OpenAI** conducts spoken interviews with `gpt-live-1`, using `gpt-5.6-terra` for delegated reasoning and written coaching.
- **Convex** stores accounts, opportunities, transcripts, feedback, and retry relationships. Durable workflows show progress live; scheduled functions close abandoned voice sessions; rate limits bound paid work.
- **Convex Agent** manages a saved coaching conversation for each reviewed attempt. “Work on this story” includes the answer, feedback, and role context; add a project PDF or notes, develop an editable draft, then “Practice this version” to retry the question with those notes.

Passkey signup is open without an invitation. Coached attempts last up to five minutes; mock interviews have a twenty-minute maximum. Feedback quotes must match current user speech exactly. Unsupported numeric outline claims are rejected. A retry keeps the question and compares attempts.

## Develop

Use Node 22.6+ and desktop Chrome with passkey support.

```sh
npm ci
cp .env.example .env
npx convex dev --once
```

Set the three server-side keys in `.env`. OpenAI needs the models above; AgentMail needs inbox, message, and webhook access. Configure Convex without printing credentials:

```sh
node scripts/configure-cloud.mjs --site=https://YOUR-DEV-DEPLOYMENT.convex.site
npx convex env set SITE_URL http://localhost:4317
```

The script also creates auth signing keys and registers the AgentMail webhook. The localhost override binds development passkeys to the local frontend while the webhook stays on the public backend. Ensure `.env.local` contains `VITE_CONVEX_URL` for the generated deployment.

```sh
npm run dev:backend  # terminal one
npm run dev          # terminal two: http://localhost:4317
```

The original personal Express app with local JSON history and Codex subscription reasoning remains available; see [local development](docs/local-development.md). The hosted app uses OpenAI API reasoning and does not require visitors to install Codex.

## Deploy and verify

```sh
node scripts/configure-cloud.mjs --prod --site=https://YOUR-PROD-DEPLOYMENT.convex.site
npm run build
npm test
npm run test:e2e
npm run deploy
```

Static hosting builds with the production Convex URL and publishes the frontend and backend. `SITE_URL` must match the frontend origin for passkeys. Development and production environments are separate.

The AgentMail component is pinned to 0.1.0. A version-checked postinstall patch declares its environment bindings and fixes component exports for current Convex. Review that patch before upgrading.

## Data and limits

Credentials stay on the backend. Audio goes through OpenAI WebRTC; Rehearsal does not record or save audio. Convex stores invitation text, research, browser-reported transcript fragments, and feedback under the signed-in account. Transcripts are coaching evidence, not independently verified provider records. Session deletion removes its transcript and feedback; opportunity records remain.

Email text is processed; attachments are not imported. Firecrawl receives public URLs and search terms. Enabling replies sends an authenticated workspace link in the original thread. The app requests `store: false` for OpenAI calls; this is not a claim about provider-wide retention.

Passkeys use Convex Auth v2 alpha. Account recovery is not implemented, so keep access to your passkey. The current AgentMail account has a small inbox allowance; URL preparation remains available when inbox capacity is full. Quotas allow ten preparations and ten voice starts per account per day, with shared ceilings of one hundred each.

### Story coaching

Story coaching is available in the Convex workspace after feedback is ready. Conversations and drafts persist with the attempt. PDF uploads support selectable text (up to 4 MB, 20 pages, and 20,000 extracted characters); scanned pages, charts, and images are not interpreted. Export Word documents or PowerPoint decks as PDF, or paste notes. Each attempt accepts three materials, and the extracted text can be inspected in the panel before asking the coach to use it.

Coaching uses `@convex-dev/agent` with `gpt-5.6-terra`, through the Convex AI Gateway by default. On free, local, or self-hosted deployments where the gateway is unavailable, it uses the existing server-side `OPENAI_API_KEY`. Replies run as scheduled actions and remain recoverable after a tab closes or a model failure. There are 60 coaching requests per account per day, 500 shared requests per day, and 60 user messages per conversation. PDF processing allows 20 uploads per account per day.

Uploaded PDFs, extracted text, coaching messages, and drafts are private to the attempt owner. The model receives extracted text and the conversation context; original PDFs stay in Convex storage. Removing a material deletes its file and extracted text and stops including it in future context; earlier replies may still contain excerpts. Deleting the attempt also deletes its coaching thread, draft, and materials. A practice draft is carried into the retry as preparation, never as evidence of what was said; feedback quote and numeric-evidence validation remain in place. The original Express local mode does not include story coaching.

Automated checks cover ownership, transcript deduplication, feedback leases, cleanup, webhook signatures, and browser practice/retry flows. Real-service checks use synthetic audio and invitations; a human microphone listening check remains part of final demo rehearsal.

Run `node scripts/check-cloud.mjs --url=https://YOUR-APP.convex.site` for a real passkey smoke check. Add `--audio=/absolute/path/to/synthetic.wav` to exercise two paid voice attempts and their comparison.
