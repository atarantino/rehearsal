# Pilot pricing and cost controls

Updated September 27, 2026. These controls apply to the hosted Convex application. The optional local development server has a separate provider path. A source change does not establish that production has been deployed.

## Prices stay the same

| Plan | Monthly price | Voice minutes | Preparations |
| ---- | ------------: | ------------: | -----------: |
| Free |            $0 |            10 |            3 |
| Plus |           $19 |            60 |           15 |
| Pro  |           $39 |           150 |           40 |

The ordinary-use planning estimate remains **$4.62 OpenAI cost for Plus** and **$11.70 for Pro**, assuming five-minute interviews, three concise delegations and one feedback call per interview, two model calls per preparation, and no retries. These are estimates, not measured costs or guaranteed margins.

## Enforced model budgets

`shared/cost-controls.ts` defines the budgets. The server counts the exact model, input, instructions and output schema through `/responses/input_tokens` before generation. Failed counts stop generation. Oversized feedback and preparation inputs are reduced to explicit verbatim excerpts and counted again before admission. Feedback preserves the complete current transcript first; if transcript excerpts are needed, the resulting review says so. The saved transcript is unchanged.

| Operation         | Maximum input tokens | Maximum billed output tokens |
| ----------------- | -------------------: | ---------------------------: |
| Written feedback  |               12,000 |                        2,500 |
| Live reasoning    |                6,000 |                        1,024 |
| Role extraction   |               12,000 |                        1,000 |
| Preparation brief |               20,000 |                        2,000 |

All four use GPT-5.6 Terra, low reasoning, standard service tier. Output limits include reasoning tokens. Incomplete output can cost money without producing useful feedback.

- Live reasoning uses client delegation routed through an authenticated server action. The browser supplies a delegation ID; the server owns the prompt and model. Repeated IDs are deduplicated. Maximum calls per interview: six coached, twenty mock. New tasks suppress stale browser replies.
- Monthly live reasoning and feedback each have a separate processing-attempt budget equal to the plan's included voice minutes: 10 / 60 / 150. Monthly reasoning and feedback allowances are charged only after token and shared-capacity admission; uncertain paid outcomes retain the charge. Per-interview reasoning attempts include rejected requests to bound repeated token-count work. Deleting a session does not restore capacity.
- Feedback requests have separate abuse guards of 10/minute and 60/day per owner. Known monthly, owner-daily or shared exhaustion is rejected before transcript hydration and token counting; admission repeats capacity checks atomically.
- Written feedback retains three admitted review claims per session, up to two generations each, with the monthly budget taking precedence. A completed review is reused.
- Preparation AI steps have no automatic retries. Unchanged input that still exceeds the cap is blocked from manual retry until an attachment is removed; a shorter source can be submitted separately. A user-requested preparation retry consumes another preparation allowance unless shared capacity denied the run before any model generation was admitted; that retry reuses its existing allowance. Research request rate limits still apply.
- Paid generation and voice creation are not automatically replayed after network failures. Read/count requests may retry once for short 429/503 delays; longer `Retry-After` values are surfaced. Attachment import retries remain separately bounded.
- Funding exhaustion is reported distinctly from request-rate throttling, with safe error codes and request IDs logged.

The Plans screen discloses processing limits, shared Free capacity and material-size restrictions.

## Shared pilot capacity

Free and paid preparation pools are separate: 20 Free preparations/day and 100 paid/day. Feedback processing has separate pools of 60 Free calls/day and 500 paid/day, in addition to owner limits.

Free text-model work also reserves against **$1 per UTC day** before generation. The reservation is `2.5 × counted input tokens + 12 × maximum output tokens`, in millionths of a dollar. This conservatively prices all input as cache writes. Reservations are retained even after success or uncertain outcomes; this is an admission budget, not the actual bill.

**The $1 budget does not include voice.** Existing Free voice controls remain 200 reserved minutes and 120 starts/day across the service, plus per-owner controls. At $0.05/minute, 200 minutes is $10, before failed-start charges or delayed hangup. Paid voice and text work are separate. OpenAI project funding must cover all pools; the application does not change credit reloads, project spend limits or account limits.

## Voice expiry and reconciliation

Unconnected reservations expire after 45 seconds. Activation starts the five- or twenty-minute duration cap without allowing repeated activation to extend it. The backend schedules hangup at that cap. Delayed final transcript fragments may arrive until feedback starts, within the existing size and timeline bounds.

Provider cleanup is retained independently of session deletion. Hangup retries are bounded; exhausted cleanup is queryable through `providerCleanup:failures`. Startup outcomes and known provider IDs/request IDs remain on `voiceReservations`, including ambiguous failures.

A server-authenticated sideband observes provider usage and closure. Cumulative seconds use the highest reported value, never a sum. Provider closure also ends the app session. A missing usage report is unknown, not zero: sideband outages, missed final events, delayed cleanup, and lost startup responses still require reconciliation with the OpenAI project bill. The app's minute settlement uses server elapsed time; client-reported seconds are not trusted for billing.

## Cost arithmetic

Official rates: [GPT-Live 1](https://developers.openai.com/api/docs/models/gpt-live-1), [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [voice costs](https://developers.openai.com/api/docs/guides/voice-latency-cost), [input token counting](https://developers.openai.com/api/docs/guides/token-counting).

```text
Voice = $0.05 × provider-billed minutes
Terra = (2 × ordinary input + 2.5 × cache-write input
         + 0.2 × cached-read input + 12 × billed output) / 1,000,000
```

Use mutually exclusive input categories. Reasoning is already included in billed output. A WebRTC start initially bills 15 seconds, credited against successful connected duration. Failed starts may still cost money. The input caps keep admitted requests below Terra's long-context pricing threshold.

The ordinary-use estimate assumes these call costs: delegation $0.011 (4k input/250 output), feedback $0.028 (5k/1.5k), extraction $0.0172 (5k/600), brief $0.042 (12k/1.5k), all ordinary uncached input. For `M` minutes and `P` preparations:

```text
Ordinary-use estimate = 0.0622M + 0.0592P
```

At maximum admitted tokens and processing attempts, pricing every input token as a cache write, the policy allows feedback at $0.060/call, delegation at $0.027288/call, and up to $0.116 per preparation (one generation at each step):

```text
Policy scenario = (0.05 + 0.060 + 0.027288)M + 0.116P
                = 0.137288M + 0.116P
Plus: $9.98; Pro: $25.23
```

This is a scenario for one full allowance period, not a guaranteed total bill. It excludes failed-start charges, provider overrun, uncertain requests, entitlement transitions, price changes, and other services. Shared daily limits can reduce admitted work. Pro still has limited room under unusually heavy use, so keep pilot monitoring in place before expanding.

## Operator checks

`aiRequests` records owner, operation, session/preparation, model, counted input, reservation, actual input/cache/output/reasoning categories, provider IDs and terminal state. It stores no input prompts or transcripts; a completed live question is retained for deduplication and scrubbed asynchronously on session deletion; late responses cannot restore it. `unknown` and old `pending` records must not be treated as free requests.

Use internal queries with the intended deployment selected:

```sh
npx convex run aiUsage:recent '{"ownerId":"USER_ID"}'
npx convex run providerCleanup:failures '{}'
```

Review startup outcomes in `voiceReservations` and provider seconds in `providerClosures`. Reconcile these records against the OpenAI project bill and track cost per interview, preparation, and paying user, including failures. Cleanup failures are persisted and funding errors are logged; external alert delivery is not configured by this change.

Convex, Firecrawl, AgentMail, payment fees, hosting, support, refunds and taxes are additional costs. Revenue remaining after OpenAI is not net profit. Keep API funding sufficient for the admitted workload; request-rate limits and available credits are separate constraints.

## Validation for this change

- Production build and both TypeScript checks passed; Convex development accepted the schema and functions.
- 37 unit checks, 127 backend/client checks and 27 browser checks passed. Coverage includes atomic admission, concurrent requests, deduplication, monthly and Free budgets, denied-preparation retry, failed/unknown responses, transcript recovery, deletion scrubbing, expiry rescheduling and monitor renewal/backoff.
- The real token counter measured a legal long-feedback fixture at 14,449 tokens. Reducing optional context retained its entire current transcript at 5,730 tokens, below the unchanged 12,000-token cap. A final explicit transcript-excerpt variant counted 1,595 tokens.
- A real development voice test completed at 263 provider seconds after monitor renewal. A provider-created client delegation completed (221 input / 98 output tokens), and the provider acknowledged its commentary response. The session closed normally and feedback completed (1,905 input / 809 output tokens), with completed status and closed cleanup persisted. The test requested delegation explicitly; it was not a natural 20-minute mock conversation.
- Independent Claude Opus 5.5 review of frozen commit 4422e21 verified the original six fixes and arithmetic. Follow-up changes address its capacity accounting, retained question text, preparation excerpt quality and cleanup findings. Final review evidence is retained separately with immutable snapshots.
- Production was not deployed; prices, included allowances and financial account settings were not changed.

The live test verifies one coached session and one monitor renewal. A full mock interview quality/latency soak, provider outage behavior and long-term cost measurements remain pilot monitoring work. Already-closed HTTP errors are not treated as proof of closure without documented provider semantics; authenticated provider closure does stop further retries.
