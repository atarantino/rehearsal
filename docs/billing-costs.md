# OpenAI cost model for Rehearsal subscriptions

Verified **September 22, 2026, America/Los_Angeles** (September 23 UTC) against the working implementation and official OpenAI documentation. USD estimates; no paid model calls were made for this analysis.

The proposed prices are plausible for ordinary usage, but the current allowances alone do **not** guarantee a margin. At full allowance use, the baseline below estimates **$4.62 of OpenAI costs for Plus ($19)** and **$11.70 for Pro ($39)**. An attachment-heavy scenario with retries reaches **$17.52 and $45.22** respectively. These are transparent scenarios, not observed averages or maximum bills.

## Prices and formula

GPT-Live 1 costs **$0.05 per active minute**, billed by the second, with backend reasoning charged separately. [OpenAI model pricing](https://developers.openai.com/api/docs/models/gpt-live-1).

Active time includes silence and backend waiting. WebRTC session creation initially bills 15 seconds ($0.0125), credited toward the running session; do not add it again to a successful session's duration. Failed starts and repeated reconnects still need to be included in reconciliation. [OpenAI voice cost guide](https://developers.openai.com/api/docs/guides/voice-latency-cost).

GPT-5.6 Terra lists **$2 per million uncached input tokens**, **$0.20 per million cached input tokens**, and **$12 per million output tokens**. Cache writes cost 1.25 times the uncached input rate. Requests above 272,000 input tokens use twice the input rate and 1.5 times the output rate for the full request. [OpenAI Terra pricing](https://developers.openai.com/api/docs/models/gpt-5.6-terra).

For standard-size requests, using mutually exclusive token categories:

```text
Terra cost = (2 × ordinary uncached input tokens
              + 2.5 × cache-write input tokens
              + 0.2 × cached-read input tokens
              + 12 × billed output tokens) / 1,000,000

OpenAI cost = 0.05 × provider-billed voice minutes
              + all delegation, feedback, extraction, and brief costs
```

Use billed output usage, including reasoning, rather than counting only the final answer. The output limit includes reasoning and non-visible generated tokens; a request can incur charges even when it exhausts that limit before producing useful content. [OpenAI reasoning cost guidance](https://developers.openai.com/api/docs/guides/reasoning).

The scenarios assume all input at the ordinary uncached rate, no cache discount, no tool fees, and no long-context surcharge. They exclude cache-write premiums; add $0.50 per million input tokens classified as writes instead of ordinary uncached input. Actual API usage categories are required for a precise bill.

## What the application actually requests

| Work                               | Current implementation                                                                   | Cost implications                                                                                                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Spoken interview                   | `server/prompts.ts`: GPT-Live 1 with Terra Responses delegation and low reasoning effort | Every delegation is additional text-model usage. Instructions ask for concise follow-ups, but currently set neither a delegation output-token limit nor a hard call-count budget.                                  |
| Written feedback                   | `convex/voice.ts` calls `structured()` in `convex/openai.ts`                             | Terra, low reasoning, 5,000 output-token limit per call. Evidence validation can trigger a second call; the second includes rejected feedback.                                                                     |
| Feedback retries                   | `convex/sessions.ts`, `claimFeedback`                                                    | Three claimed review attempts per session, each permitting two generation calls: up to six calls across failed retries. Successful feedback is reused. The existing daily feedback limit is additional protection. |
| Role preparation                   | `convex/research.ts`: extraction, Firecrawl research, brief writing                      | Normally two Terra calls, each with 5,000 output-token limit. Firecrawl itself is outside OpenAI pricing.                                                                                                          |
| Automatic preparation retries      | `convex/workflows.ts`: `maxAttempts: 2`                                                  | Extraction and brief actions can each run twice. Four billable model attempts are possible for one workflow. A timeout after provider processing can still incur a charge.                                         |
| User-requested preparation retries | `convex/preparation.ts`                                                                  | Consume another preparation allowance through `consumePreparation`; automatic workflow retries are within the original allowance.                                                                                  |
| Interview duration                 | `shared/types.ts`, `convex/usage.ts`, `convex/voice.ts`                                  | Coached attempts allow five minutes, mocks twenty. Backend reservations, elapsed-time settlement and scheduled hangup limit use, but provider duration and successful closure must still be reconciled.            |

The initial generic question is selected from local data, not a separate model call. Resume and document text extraction are local parsers; their text becomes input to later model calls. Hosted production uses the API path. The optional local Codex backend does not make production API consumption free.

Input size matters. Job descriptions, backgrounds and resumes each permit 15,000 characters. Feedback can include both the current and previous attempt. Transcripts allow up to 300,000 text units under the implementation's `transcriptBytes` guard; that guard does not measure OpenAI tokens. Email preparation accepts 18,000 body characters plus ten attachments with up to 12,000 extracted characters each. Brief generation can include those attachments, a 14,000-character job page, three 9,000-character company pages, and the invitation again.

None of those character counts establishes a token cap. JSON/schema/instruction overhead, language, previous attempts and tokenization affect the actual amount. The present `structured()` helper returns parsed content without persisting response usage, so this document does not claim measured token averages.

## Baseline: full allowance, ordinary documents and concise reasoning

Assume five-minute interviews, three delegation calls per interview, one feedback call per interview, two successful model calls per preparation, and no retries. Token assumptions below include instruction/schema overhead and are planning estimates, not measurements.

| Call            | Input tokens | Billed output tokens | Calculated cost |
| --------------- | -----------: | -------------------: | --------------: |
| Delegation      |        4,000 |                  250 |         $0.0110 |
| Feedback        |        5,000 |                1,500 |         $0.0280 |
| Role extraction |        5,000 |                  600 |         $0.0172 |
| Brief writing   |       12,000 |                1,500 |         $0.0420 |

For `M` voice minutes and `P` preparation workflows:

```text
Baseline = 0.05M + (M/5 × 3 × 0.011)
           + (M/5 × 0.028) + P × (0.0172 + 0.042)
         = 0.0622M + 0.0592P
```

| Full allowance                      | Free: 10m / 3 preps | Plus: 60m / 15 preps | Pro: 150m / 40 preps |
| ----------------------------------- | ------------------: | -------------------: | -------------------: |
| Voice                               |               $0.50 |                $3.00 |                $7.50 |
| Delegation                          |               $0.07 |                $0.40 |                $0.99 |
| Written feedback                    |               $0.06 |                $0.34 |                $0.84 |
| Preparation                         |               $0.18 |                $0.89 |                $2.37 |
| **Total OpenAI estimate**           |           **$0.80** |            **$4.62** |           **$11.70** |
| Subscription price                  |                  $0 |                  $19 |                  $39 |
| Revenue remaining after OpenAI only |              -$0.80 |               $14.38 |               $27.30 |
| Revenue remaining / price           |      Not applicable |                75.7% |                70.0% |

Totals use unrounded values. Revenue remaining is **not net profit** and does not include other service expenses. Free usage is an acquisition cost: 1,000 free users consuming this baseline would cost roughly $800 per allowance period in OpenAI charges alone.

## Stress scenarios: large inputs and repeated work

These intentionally consume the full allowance with more expensive behavior:

- One delegation per active minute, each with 16,000 input and 2,000 output tokens: **$0.056 per minute** in delegation alone.
- One five-minute interview followed by two feedback calls, each with 25,000 input and 5,000 output tokens: **$0.22 per interview**, or **$0.044 per voice minute**. The input assumption includes room for prior context and rejected output.
- Each preparation uses two extraction attempts at 36,000 input / 5,000 output tokens and two brief attempts at 46,000 input / 5,000 output: **$0.568 per preparation**. The input estimates approximate near-full attachments plus source pages using four characters per token and overhead; that ratio is not a guaranteed bound.

```text
Heavy documents + one feedback validation retry
  = (0.05 + 0.056 + 0.044)M + 0.568P
  = 0.15M + 0.568P

Same scenario, with all three review claims using two model calls each
  = (0.05 + 0.056 + 6 × 0.11 / 5)M + 0.568P
  = 0.238M + 0.568P
```

| Scenario                                       |  Free |   Plus |    Pro |
| ---------------------------------------------- | ----: | -----: | -----: |
| Heavy documents + two feedback calls/interview | $3.20 | $17.52 | $45.22 |
| Heavy documents + six feedback calls/interview | $4.08 | $22.80 | $58.42 |

The first stress scenario leaves Plus $1.48 before any other costs and exceeds Pro revenue by $6.22. Exhausting feedback retries can put both paid plans below break-even on OpenAI alone. Shorter interviews with a separate review each can cost more per voice minute than the five-minute assumptions. Longer context or more live delegations can also exceed these scenarios.

## Constraints and measurements needed before scaling

The $19 Plus offer has useful baseline room. The $39 Pro offer reaches 30% of revenue in baseline OpenAI cost before reserving anything for heavier usage or other services. Keep these as pilot prices with monitoring; do not describe them as proven profitable or offer unlimited reasoning under the minute allowance.

1. **Bound live reasoning in code.** Set a tested output-token budget for delegation if supported by the Live API configuration. Enforce a per-session call/token budget; prompt instructions requesting brevity are insufficient. If hosted Responses delegation cannot enforce the budget, use a controlled server delegation path. A starting candidate for evaluation is 1,024–1,536 billed output tokens per delegation, then tune against interview quality.
2. **Enforce input-token budgets.** Summarize long source documents once, select relevant passages and bound current/previous transcript context. Keep every routine request below the long-context pricing threshold. Restricting attachment bytes alone does not control repeated model input cost.
3. **Keep retry budgets explicit.** The three feedback claims are useful protection. Track costs of all rejected/failed attempts, cap total review work per billing period, and measure whether even the second validation call improves successful outcomes enough to justify its cost.
4. **Meter API cost separately from plan allowances.** Persist response IDs, model, input/cached/write/output/reasoning usage, delegation counts, provider voice seconds, and workflow/session/owner associations. Reconcile against the OpenAI project bill and report p50/p95 cost per interview, per preparation and per paying user.
5. **Handle duration discrepancies.** Record provider-confirmed closure; alert on unsuccessful hangup cleanup and abandoned startup charges. Silence is legitimate interview time, so close truly abandoned sessions without treating a thinking pause as abandonment.
6. **Set financial operating thresholds.** A provisional 30%-of-revenue OpenAI target allows $5.70 for Plus and $11.70 for Pro. After full voice use, only $2.70 and $4.20 remain for reasoning/preparation; the Pro baseline already consumes essentially all that $4.20. Before expanding, either reduce measured backend cost, lower included usage, or increase price. Define any customer-facing limits clearly before enforcing them.

Other expenses remain separate: Firecrawl scraping/search, Convex execution/storage/bandwidth/components, AgentMail messages and inbox capacity, Stripe payment and subscription fees, hosting, support, refunds, taxes, and fraud. No estimates for these are included above; determine their actual account rates before calling the remaining revenue gross margin.
