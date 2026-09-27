import { useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { ArrowUpRight, Check, CreditCard } from "lucide-react";
import { api } from "../convex/_generated/api";
import { PLANS, PLAN_ORDER } from "../shared/plans";

function dateLabel(value: number) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function UsageMeter({
  label,
  used,
  limit,
  reserved = 0,
}: {
  label: string;
  used: number;
  limit: number;
  reserved?: number;
}) {
  const total = Math.max(0, used + reserved);
  const description = `${used.toLocaleString(undefined, { maximumFractionDigits: 1 })} of ${limit} used`;
  return (
    <div className="billing-meter">
      <div>
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <progress
        max={limit}
        value={Math.min(limit, total)}
        aria-label={`${label}: ${description}${reserved ? `, ${reserved} reserved for open practice` : ""}`}
      />
      {reserved > 0 && (
        <p className="muted">
          {reserved.toLocaleString(undefined, { maximumFractionDigits: 1 })}{" "}
          minutes reserved for open practice. Unused time is returned when it
          closes.
        </p>
      )}
      {total >= limit && (
        <p className="billing-limit">Monthly allowance reached.</p>
      )}
    </div>
  );
}

export function Billing() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const billing = useQuery(api.billing.summary, { now });
  const usage = useQuery(api.usage.summary, { now });
  const checkout = useAction(api.billing.checkout);
  const portal = useAction(api.billing.portal);
  const refresh = useAction(api.billing.refresh);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [returned] = useState(() =>
    new URLSearchParams(window.location.search).get("billing"),
  );
  const refreshed = useRef(false);
  const [reconciling, setReconciling] = useState(
    returned === "success" || returned === "return",
  );
  useEffect(() => {
    if (refreshed.current || (returned !== "success" && returned !== "return"))
      return;
    refreshed.current = true;
    // The return URL triggers a server verification; it never grants a plan.
    void refresh({})
      .then(() => {
        const url = new URL(window.location.href);
        url.searchParams.delete("billing");
        window.history.replaceState(window.history.state, "", url);
      })
      .catch(() =>
        setError(
          "We could not refresh your subscription from Stripe. Your last confirmed plan is shown below. Reload this page to check again.",
        ),
      )
      .finally(() => {
        setReconciling(false);
        setNow(Date.now());
      });
  }, [refresh, returned]);

  async function openBilling(plan?: "plus" | "pro") {
    if (busy) return;
    setBusy(plan ?? "portal");
    setError("");
    try {
      const result = plan ? await checkout({ plan }) : await portal({});
      window.location.assign(result.url);
    } catch (error) {
      const e = error as { data?: unknown };
      const details = e.data;
      setError(
        typeof details === "string"
          ? details
          : details !== null &&
              typeof details === "object" &&
              "message" in details &&
              typeof details.message === "string"
            ? details.message
            : "Could not open billing. Please try again in a moment.",
      );
      setBusy(null);
    }
  }

  const subscriber =
    !!billing &&
    !["free", "none", "canceled", "incomplete_expired"].includes(
      billing.status,
    );
  const paid = !!billing && billing.plan !== "free";

  return (
    <div className="billing-page">
      <div className="page-heading">
        <p className="eyebrow">Plans & usage</p>
        <h1>Room to get ready.</h1>
        <p>Choose the practice time you need for your next step.</p>
      </div>
      {!billing || !usage ? (
        <p role="status">Loading your plan and usage…</p>
      ) : (
        <>
          {returned === "success" && (
            <div className="notice" role="status">
              {paid
                ? `Your ${PLANS[billing.plan].name} plan is confirmed and ready to use.`
                : "Waiting for payment confirmation. Your plan updates here automatically once Stripe confirms your subscription."}
            </div>
          )}
          {returned === "return" && (
            <div className="notice" role="status">
              {reconciling
                ? "Checking your subscription with Stripe…"
                : "Your latest confirmed subscription details are shown below."}
            </div>
          )}
          {returned === "cancel" && (
            <div className="notice" role="status">
              Checkout was canceled. Your current plan is unchanged.
            </div>
          )}
          {!billing.configured && (
            <div className="notice" role="status">
              Paid subscriptions are not available yet. You can continue using
              your current allowance.
            </div>
          )}
          {billing.configured && billing.testMode && (
            <div className="notice" role="status">
              Test mode · Checkout uses Stripe test payments. No real payment
              will be collected.
            </div>
          )}
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <section
            className="billing-current"
            aria-labelledby="current-plan-title"
          >
            <div className="billing-current-heading">
              <div>
                <p className="eyebrow">Your current plan</p>
                <h2 id="current-plan-title">
                  Rehearsal {PLANS[billing.plan].name}
                </h2>
                <p className="muted">
                  {billing.cancelAtPeriodEnd && billing.periodEnd
                    ? `Your subscription ends ${dateLabel(billing.periodEnd)}.`
                    : `Allowance resets ${dateLabel(usage.periodEnd)}.`}
                </p>
              </div>
              {subscriber && (
                <button
                  type="button"
                  className="secondary"
                  disabled={!billing.configured || !!busy}
                  onClick={() => void openBilling()}
                >
                  <CreditCard size={17} />
                  {busy === "portal" ? "Opening…" : "Manage subscription"}
                </button>
              )}
            </div>
            {["past_due", "unpaid", "incomplete", "paused"].includes(
              billing.status,
            ) && (
              <p className="billing-limit" role="status">
                Your subscription needs attention. Manage your subscription to
                review payment details.
              </p>
            )}
            <div className="billing-usage">
              <UsageMeter
                label="Voice minutes"
                used={usage.voiceMinutesUsed}
                reserved={usage.voiceMinutesReserved}
                limit={usage.voiceMinutesLimit}
              />
              <UsageMeter
                label="Opportunity preparations"
                used={usage.preparationsUsed}
                limit={usage.preparationsLimit}
              />
            </div>
          </section>
          <div className="billing-plans" aria-label="Available plans">
            {PLAN_ORDER.map((id) => {
              const plan = PLANS[id];
              const current = billing.plan === id;
              return (
                <section
                  className={`billing-plan ${current ? "billing-plan-current" : ""}`}
                  key={id}
                  aria-labelledby={`plan-${id}`}
                >
                  <div className="billing-plan-heading">
                    <h2 id={`plan-${id}`}>{plan.name}</h2>
                    {current && <span className="tag">Current plan</span>}
                  </div>
                  <p className="billing-price">
                    ${plan.monthlyPrice}
                    <span> USD / month</span>
                  </p>
                  <p className="billing-plan-description">
                    {id === "free"
                      ? "Find your footing with a little practice."
                      : id === "plus"
                        ? "Build confidence for an active job search."
                        : "More practice for a full interview schedule."}
                  </p>
                  <ul>
                    <li>
                      <Check size={16} />
                      {plan.voiceMinutes} voice minutes / month
                    </li>
                    <li>
                      <Check size={16} />
                      {plan.preparations} opportunity preparations / month
                    </li>
                    <li>
                      <Check size={16} />
                      Written coaching after practice
                    </li>
                  </ul>
                  <button
                    type="button"
                    className={id === "plus" ? "primary" : "secondary"}
                    disabled={
                      current ||
                      !billing.configured ||
                      !!busy ||
                      (id === "free" && !subscriber)
                    }
                    onClick={() =>
                      void openBilling(
                        subscriber || id === "free" ? undefined : id,
                      )
                    }
                  >
                    {current
                      ? "Current plan"
                      : busy === id
                        ? "Opening checkout…"
                        : subscriber
                          ? "Change in billing portal"
                          : id === "free"
                            ? "Included"
                            : `Choose ${plan.name}`}
                    {!current && id !== "free" && <ArrowUpRight size={16} />}
                  </button>
                </section>
              );
            })}
          </div>
          <p className="billing-terms muted">
            Paid plans renew monthly. Cancel in the billing portal. No overage
            charges; unused allowances do not roll over. Voice time rounds up to
            the next minute per practice. One preparation researches an
            opportunity and builds your interview brief.
          </p>
        </>
      )}
    </div>
  );
}
