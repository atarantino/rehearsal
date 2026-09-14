import {
  existsSync,
  readFileSync,
  mkdirSync,
  openSync,
  closeSync,
  rmSync,
} from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  root,
  state,
  manifest,
  json,
  cleanEnv,
  run,
  waitFor,
  available,
  stopProcess,
} from "./agent/lib.mjs";

const command = process.argv[2];
const runtimeFile = resolve(state, "runtime.json");
async function control(action) {
  if (!existsSync(runtimeFile)) return null;
  const runtime = JSON.parse(readFileSync(runtimeFile, "utf8"));
  return fetch(`http://127.0.0.1:${runtime.port}/${action}`, {
    method: action === "stop" ? "POST" : "GET",
    headers: { Authorization: `Bearer ${runtime.token}` },
    signal: AbortSignal.timeout(2000),
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}
async function doctor() {
  const m = await manifest();
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  add(
    "Node",
    Number(process.versions.node.split(".")[0]) >= 22,
    process.version,
  );
  add(
    "Dependencies",
    existsSync(resolve(root, "node_modules/.bin/tsc")),
    "Run npm run agent:setup to install.",
  );
  try {
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch();
    await browser.close();
    add("Chromium", true, "Browser launches.");
  } catch {
    add("Chromium", false, "Run npx playwright install --with-deps chromium.");
  }
  const current = await control("status");
  for (const [name, port] of Object.entries(m.ports)) {
    const free = await available(port);
    add(
      `Port ${name}`,
      free ||
        (!!current && ["frontend", "cloud", "site", "control"].includes(name)),
      `${port}: ${free ? "available" : current ? "agent running; see runtime status" : "occupied; stop its owner or regenerate .agent/worktree.json"}`,
    );
  }
  console.log(
    JSON.stringify(
      {
        worktree: m.id,
        mode: m.mode,
        origin: `http://localhost:${m.ports.frontend}`,
        backend: `http://127.0.0.1:${m.ports.cloud}`,
        credentials:
          "Generated local auth; fixture providers. Live-service access is a separate check.",
        runtime: current,
        checks,
      },
      null,
      2,
    ),
  );
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}
async function serve() {
  const m = await manifest();
  const token = crypto.randomUUID();
  let ready = false;
  let backend;
  let frontend;
  let closing = false;
  const controller = new AbortController();
  const handles = [];
  async function stop(code = 0) {
    if (closing) return;
    closing = true;
    controller.abort();
    await Promise.all([stopProcess(frontend), backend?.stop()]);
    server.close();
    if (
      existsSync(runtimeFile) &&
      JSON.parse(readFileSync(runtimeFile, "utf8")).token === token
    )
      rmSync(runtimeFile);
    handles.forEach(closeSync);
    process.exit(code);
  }
  const server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/stop" && req.method === "POST") {
      res.end(JSON.stringify({ stopping: true }));
      void stop();
    } else if (req.url === "/status" && req.method === "GET")
      res.end(JSON.stringify({ ready, pid: process.pid, mode: m.mode }));
    else res.writeHead(404).end("{}");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(m.ports.control, "127.0.0.1", resolve);
  });
  json(runtimeFile, { pid: process.pid, token, port: m.ports.control });
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
  try {
    if (!(await available(m.ports.frontend)))
      throw new Error("Frontend port is occupied.");
    mkdirSync(resolve(state, "logs"), { recursive: true });
    const backendLog = openSync(resolve(state, "logs/backend.log"), "w", 0o600);
    const frontendLog = openSync(
      resolve(state, "logs/frontend.log"),
      "w",
      0o600,
    );
    handles.push(backendLog, frontendLog);
    const { startBackend } = await import("./agent/backend.mjs");
    backend = await startBackend({
      project: resolve(state, "dev"),
      ports: m.ports,
      log: backendLog,
      signal: controller.signal,
      watchSources: true,
      onStart: (handle) => {
        backend = handle;
      },
      onExit: () => {
        if (ready && !closing) void stop(1);
      },
    });
    frontend = spawn(
      process.execPath,
      [
        resolve(root, "node_modules/vite/bin/vite.js"),
        "--config",
        "scripts/agent-vite.config.ts",
        "--host",
        "127.0.0.1",
        "--port",
        String(m.ports.frontend),
      ],
      {
        cwd: root,
        env: cleanEnv({
          AGENT_PROJECT: resolve(state, "dev"),
          VITE_LOCAL_MODE: "false",
          VITE_CONVEX_URL: `http://127.0.0.1:${m.ports.cloud}`,
        }),
        stdio: ["ignore", frontendLog, frontendLog],
      },
    );
    frontend.once("exit", () => {
      if (!closing) void stop(1);
    });
    await waitFor(
      () =>
        fetch(`http://localhost:${m.ports.frontend}`)
          .then((r) => r.ok)
          .catch(() => false),
      "Frontend did not start.",
    );
    ready = true;
  } catch (error) {
    console.error(error.message);
    await stop(1);
  }
}
try {
  if (command === "setup") {
    await manifest();
    if (await control("stop")) {
      await waitFor(
        async () => !(await control("status")),
        "Worktree services did not stop before dependency installation.",
        15000,
      );
      console.log(
        "Stopped worktree services before reinstalling dependencies.",
      );
    }
    await run("npm", ["ci"]);
    await run("npx", [
      "playwright",
      "install",
      ...(process.argv.includes("--with-deps") ? ["--with-deps"] : []),
      "chromium",
    ]);
    await doctor();
  } else if (command === "doctor") await doctor();
  else if (command === "up") {
    const m = await manifest();
    let status = await control("status");
    let child;
    if (!status) {
      mkdirSync(resolve(state, "logs"), { recursive: true });
      const log = openSync(resolve(state, "logs/supervisor.log"), "w", 0o600);
      child = spawn(
        process.execPath,
        [resolve(root, "scripts/agent.mjs"), "serve"],
        {
          cwd: root,
          detached: true,
          stdio: ["ignore", log, log],
          env: cleanEnv(),
        },
      );
      child.unref();
      closeSync(log);
    }
    console.log(
      "Starting isolated Convex and frontend. Logs: .agent/logs/ (first start downloads the backend).",
    );
    try {
      await waitFor(
        async () => {
          if (child && (child.exitCode !== null || child.signalCode !== null))
            throw new Error(
              "Agent startup failed; inspect .agent/logs/supervisor.log and backend.log.",
            );
          return (await control("status"))?.ready;
        },
        "Agent startup timed out; inspect .agent/logs/.",
        360000,
      );
    } catch (error) {
      await control("stop");
      throw error;
    }
    console.log(
      `Ready: http://localhost:${m.ports.frontend}\nMode: Convex with deterministic providers. Stop: npm run agent:down`,
    );
  } else if (command === "inspect" || command === "scenario") {
    if (!(await control("status"))?.ready)
      throw new Error("Run npm run agent:up first.");
    const args =
      command === "inspect"
        ? {}
        : { id: process.argv[3], scenario: process.argv[4] };
    await run(
      process.execPath,
      [
        resolve(root, "node_modules/convex/bin/main.js"),
        "run",
        `qa:${command}`,
        JSON.stringify(args),
      ],
      {
        cwd: resolve(state, "dev"),
        env: cleanEnv({ CONVEX_AGENT_MODE: "anonymous" }),
      },
    );
  } else if (command === "down") {
    const result = await control("stop");
    if (result)
      await waitFor(
        async () => !(await control("status")),
        "Agent did not stop.",
        15000,
      );
    console.log(
      result
        ? "Worktree services stopped."
        : "No reachable worktree supervisor; no processes were signaled.",
    );
  } else if (command === "serve") await serve();
  else throw new Error("Usage: node scripts/agent.mjs setup|doctor|up|down");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
