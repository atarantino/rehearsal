# Subscriptions and usage

Rehearsal has three monthly USD plans. Free has no Stripe subscription.

| Plan | Monthly price | Voice minutes | Preparations |
| ---- | ------------: | ------------: | -----------: |
| Free |            $0 |            10 |            3 |
| Plus |           $19 |            60 |           15 |
| Pro  |           $39 |           150 |           40 |

No automatic overage charges. These are pilot allowances; see [OpenAI cost assumptions](billing-costs.md) before a live launch. Costs depend on document sizes, model delegations and retries, not just voice minutes.

## What the allowance means

Focused practice reserves five minutes, and a mock reserves twenty. Free therefore supports focused practice. After a session closes, server elapsed time is rounded up to the next minute, capped at the reservation, and unused reserved minutes are released. A provider startup that never activates does not consume the account's minutes. Provider startup charges can still be an operating cost. Client-reported duration never determines allowance consumption. Deleting session history does not erase usage.

New feedback requires a provider-activated session with settled, nonzero voice usage. Up to three generation attempts are allowed for one session; successful feedback is reused. A validation attempt can itself make two model calls. The app still treats browser transcripts as unverified coaching evidence.

Each URL or email preparation consumes one preparation; a user-requested retry consumes another. A duplicate request does not consume again. Workflow retries remain within the original preparation. Over-quota email is saved privately with a retry message, without starting paid research.

Free allowances reset on the UTC calendar month. Paid allowances use the subscription billing period. A paid plan change within that period retains usage. Starting a new paid subscription purchases a new period. Per-account daily abuse limits remain, including ten voice starts and ten preparations. Free accounts also share a conservative daily budget of 200 reserved voice minutes, with no refund to that shared safety budget for early closure or failed startup; paid accounts are exempt. The overall service retains the existing daily ceilings of 100 voice starts and 100 research starts.

## Stripe integration

`@convex-dev/stripe` verifies webhook signatures and maintains the Stripe component's records. Rehearsal also stores an account-linked billing snapshot because allowances need the subscription item's current period start as well as its end. This snapshot is refreshed from Stripe's current subscriptions, scoped by app, deployment and owner metadata. The browser never selects a price ID or supplies an owner/customer ID. Only known configured price IDs with active/trialing status and a current period grant paid allowance.

Checkout uses server-configured return origins and Stripe idempotency keys. Concurrent requests cannot create separate open checkouts through the app. An existing nonterminal subscription routes to the customer portal. An open checkout for another plan must expire or complete before a new plan checkout can start. Portal return and successful checkout URLs trigger a server refresh; URL parameters never grant paid access. Public Stripe actions are rate limited.

The portal permits payment method and receipt-email updates, plan changes, invoice viewing, and cancellation at period end. It requests invoiced prorations for upgrades and schedules decreasing-price changes at period end. Stripe may apply portal eligibility restrictions to a particular subscription; review the portal's confirmation screen. No account-wide branding, customer-email policy, existing Statsketball products, or existing subscriptions are changed.

Past-due, unpaid, canceled, incomplete and expired periods do not grant paid allowance. Stored practice history remains accessible. Payment recovery goes through the portal. Account recovery for lost passkeys remains outside this change; a live launch needs a reachable billing-support path.

## Configure a deployment

Credentials remain in Convex environment variables; never use a `VITE_` secret. Required billing values:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PLUS_PRICE_ID`
- `STRIPE_PRO_PRICE_ID`
- `STRIPE_PORTAL_CONFIGURATION_ID`
- `SITE_URL` (the actual frontend origin, including the correct local port)

The setup script defaults to Stripe **test mode** and creates or reuses Rehearsal-only products, prices, a deployment-specific portal configuration and signed webhook endpoint. It can read the authenticated Stripe CLI configuration or `STRIPE_SECRET_KEY` from its process environment. It sends secrets to Convex through stdin and never logs them.

```sh
node scripts/configure-billing.mjs --deployment=quick-starfish-327
node scripts/configure-shared-inbox.mjs --deployment=quick-starfish-327
npx convex dev --once
```

The configured development account is `acct_1StXDPQnSPdixoA6` (Tarantino Software Consulting LLC). The active test catalog uses lookup keys `rehearsal_plus_monthly_v2` and `rehearsal_pro_monthly_v2`. Plus and Pro are separate products because Stripe's portal requires unique billing intervals among prices within each offered product.

The test setup uses a Stripe CLI credential, which expires 90 days after login. Replace it with a durable scoped server credential before live deployment. Do not copy test price IDs or webhook secrets into a live configuration. `--live` is an explicit setup-script switch; run it only after deciding to enable real billing. The setup script refuses to silently replace an existing price with a different amount or currency.

The webhook path is `/stripe/webhook`. It subscribes to checkout completion, customer changes, subscription changes, invoice payment success and failure. The endpoint and SDK are pinned to Stripe API `2026-08-26.dahlia`. Retried or out-of-order events trigger current-state reconciliation; revision fencing prevents an older request from overwriting a newer applied snapshot, and a superseded refresh re-fetches before returning.

See [email routing](email-routing.md) for shared-inbox configuration and legacy compatibility. New fields are additive; existing dedicated inboxes and saved opportunities remain readable without a destructive migration.

## Validate

```sh
npm test
npm run build
npm run test:e2e
node scripts/check-billing.mjs --deployment=quick-starfish-327
node scripts/check-billing-ui.mjs --url=http://localhost:4319 --checkout
```

The API smoke is explicitly restricted to the known development deployment and test Stripe keys. It creates a synthetic account/customer, checks hosted checkout and duplicate reuse, creates a test subscription with a Stripe test payment method, waits for real signed webhook delivery, upgrades and cancels, and cleans up its active subscription in `finally`. It does not use real cards or send email. Test customer/user records remain identifiable by their smoke-test names.

The browser smoke uses a virtual passkey and a synthetic development account. It checks prices, usage, shared mail routing setup/rotation, mobile layout and false success-return handling. `--checkout` opens the real hosted test checkout but does not submit a payment. Keep `SITE_URL` matched to the chosen frontend port.
