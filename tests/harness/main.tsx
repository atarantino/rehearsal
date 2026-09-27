// Test-only page: mounts the real Preparation panel against mocked Convex hooks.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Preparation } from "../../src/Preparation";
function Harness() {
  const [view, setView] = useState("setup");
  return (
    <main>
      <p data-testid="view">{view}</p>
      <Preparation
        onSelect={() => {}}
        onReady={() => {}}
        onOpportunityChange={() => {}}
        onViewPlans={() => setView("billing")}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
