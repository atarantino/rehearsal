// Test-only page: mounts the real ErrorNotice with server-shaped errors.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ErrorNotice } from "../../src/ErrorNotice";
const planLimit = Object.assign(
  new Error(
    '[CONVEX M(preparation:create)] [Request ID: abc] Server Error Uncaught ConvexError: {"code":"PLAN_LIMIT","message":"Your preparation allowance is used up. Upgrade your plan or wait for the next period."} Called by client',
  ),
  {
    data: {
      code: "PLAN_LIMIT",
      message:
        "Your preparation allowance is used up. Upgrade your plan or wait for the next period.",
    },
  },
);
const ordinary = Object.assign(
  new Error(
    "[CONVEX M(preparation:create)] [Request ID: abc] Server Error Uncaught ConvexError: Use a public HTTPS job or company URL. Called by client",
  ),
  { data: "Use a public HTTPS job or company URL." },
);
function Harness() {
  const [view, setView] = useState("setup");
  return (
    <main>
      <p data-testid="view">{view}</p>
      <section aria-label="plan limit">
        <ErrorNotice error={planLimit} onViewPlans={() => setView("billing")} />
      </section>
      <section aria-label="ordinary">
        <ErrorNotice error={ordinary} onViewPlans={() => setView("billing")} />
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
