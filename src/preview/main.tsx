import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PreviewContext } from "./convex-react";
import { scenarios, type Scenario } from "./scenarios";
import "../style.css";
import "./preview.css";

const groups = [...new Set(scenarios.map((s) => s.group))];
const hashId = () => decodeURIComponent(location.hash.slice(1)) || "all";

function Stage({
  scenario,
  onLog,
}: {
  scenario: Scenario;
  onLog: (entry: string) => void;
}) {
  const body = scenario.render();
  return (
    <PreviewContext.Provider
      value={{ handlers: scenario.handlers, log: onLog }}
    >
      {scenario.panel ? (
        <section className="setup-panel">{body}</section>
      ) : (
        body
      )}
    </PreviewContext.Provider>
  );
}

function Preview() {
  const [id, setId] = useState(hashId);
  const [openDetails, setOpenDetails] = useState(false);
  const [calls, setCalls] = useState<string[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  const selected = scenarios.find((s) => s.id === id);
  const shown = selected ? [selected] : scenarios;

  useEffect(() => {
    const sync = () => setId(hashId());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  // Billing reads ?billing= on mount, so set the query before the scenario renders.
  const search = selected?.search ?? "";
  if (location.search !== search)
    history.replaceState(null, "", `${location.pathname}${search}#${id}`);
  useEffect(() => {
    setCalls([]);
    // Components render data after their own effects run; wait a tick.
    const timer = setTimeout(() => {
      stage.current
        ?.querySelectorAll("details")
        .forEach((d) => (d.open = openDetails));
    }, 50);
    return () => clearTimeout(timer);
  }, [id, openDetails]);

  return (
    <>
      <header className="preview-bar">
        <strong>Design preview</strong>
        <label>
          <span>Scenario</span>
          <select value={id} onChange={(e) => (location.hash = e.target.value)}>
            <option value="all">All scenarios</option>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {scenarios
                  .filter((s) => s.group === g)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="preview-toggle">
          <input
            type="checkbox"
            checked={openDetails}
            onChange={(e) => setOpenDetails(e.target.checked)}
          />
          Open all details
        </label>
        {calls.length > 0 && (
          <output className="preview-log" aria-live="polite">
            Called {calls.at(-1)}
          </output>
        )}
      </header>
      <main className="preview-main">
        <div className="content" ref={stage}>
          {shown.map((s) => (
            <section
              key={`${s.id}${search}`}
              className="preview-scenario"
              id={selected ? undefined : s.id}
            >
              {!selected && (
                <a className="preview-label" href={`#${s.id}`}>
                  {s.group} · {s.title}
                </a>
              )}
              <Stage
                scenario={s}
                onLog={(entry) => setCalls((c) => [...c, entry])}
              />
            </section>
          ))}
        </div>
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
);
