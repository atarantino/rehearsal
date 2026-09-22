# Rehearsal experience verification

Frontend redesign and researched mock-interview context.

## Research reaches the interviewer

Previously, saved preparation was serialized into `jobDescription` and truncated
at 15,000 characters; the spoken model received only its first 2,500 characters.
The reasoning delegate received the longer string, so the two models could have
different context. Preparation only offered individual question selection.

The backend now snapshots an optional, structured `preparationBrief` from the
owned, ready opportunity. It ignores client-supplied briefs, keeps the readable
summary in `jobDescription`, and preserves the snapshot on retries. Both the
spoken model and its reasoning delegate receive the complete context. Mock
instructions explicitly use the role, company, sourced focus areas and suggested
questions, while treating uncertainties as unconfirmed and source text as data.
Existing sessions without the optional field remain valid.

Verified on 2026-09-22 UTC:

- 22 Node tests and 28 Convex tests passed, including ownership rejection,
  client-brief rejection, research-to-provider payload coverage, long context,
  and immutable retry context.
- Root and Convex TypeScript checks and the Vite production build passed.
- Backend code pushed successfully to development `quick-starfish-327`.
- A synthetic passkey account ran real Firecrawl preparation for the public
  [Convex Product Engineer posting](https://jobs.ashbyhq.com/convex-dev/3f1fd59b-99bb-490f-bb98-62b27443de81).
  Three sources produced a ready brief.
- A real mock voice connection opened with the brief's question about competing
  customer, business and engineering priorities and deciding what to build or
  defer. The complete stored brief matched the research result. No voice errors
  were reported. The session was closed and persisted as completed with reason
  `verification_complete`.

This was a short live connection with silent synthetic microphone input, not a
full 15-minute human interview or an assessment of transcription quality.

## Frontend and release

Fable authored the workspace, preparation and feedback redesign using Anthropic's
[frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md).
Its cloud command stalled after the edits completed; the successful edits were
recovered from its session log into an isolated worktree, reviewed and integrated.
Local refinements moved the mock action above expandable research, improved small
text and responsive spacing, and cleared stale research when changing roles.

- All 18 browser tests passed: mock and coached flows, feedback/retry, history,
  microphone failures, connection recovery, resume imports and reduced motion.
- Authenticated development checks passed at widths 1440, 390 and 320 pixels,
  without horizontal overflow. Prepared mock selection supplied the expected
  opportunity ID; changing role cleared old context. Company context appeared
  in the connected screen. This UI check used a simulated voice transport;
  the separate real provider check is documented above.
- Production release target: `acoustic-cuttlefish-868`, explicitly authorized
  by the user after verification. Post-release checks are recorded below.

Production release completed on 2026-09-22 UTC from PR #14 (merge commit
`bebeedc27d961630073209aeba278e8154bfb959`). Convex schema validation passed
with no index deletions. Static hosting published successfully to
https://acoustic-cuttlefish-868.convex.site.

Post-release checks passed for public passkey signup, the authenticated redesigned
workspace, the expected production JavaScript asset, and layouts at 1440, 390
and 320 pixels without horizontal overflow. Production voice was not exercised;
the real Firecrawl and voice smoke above ran on development.
