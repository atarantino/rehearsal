import { mkdirSync, openSync, closeSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import {
  root,
  state,
  json,
  cleanEnv,
  allocatePorts,
  waitFor,
  stopProcess,
} from "./agent/lib.mjs";
import { startBackend } from "./agent/backend.mjs";

const suite =
  process.argv.find((a) => a.startsWith("--suite="))?.slice(8) || "all";
if (!["all", "fast", "legacy", "convex"].includes(suite))
  throw new Error("Use --suite=all|fast|legacy|convex");
const id = `${new Date().toISOString().replaceAll(":", "-")}-${crypto.randomUUID().slice(0, 8)}`;
const artifacts = resolve(state, "artifacts", id);
mkdirSync(artifacts, { recursive: true, mode: 0o700 });
const project = resolve(state, `qa-${id}`);
const report = {
  id,
  suite,
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  dirty: !!execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  startedAt: new Date().toISOString(),
  artifacts,
  providerMode: "fixtures",
  checks: [],
  status: "running",
};
json(resolve(artifacts, "summary.json"), report);
console.log(`Verification artifacts: ${artifacts}`);
let active;
let backend;
let frontend;
let interrupted = false;
const controller = new AbortController();
const handles = [];
const abort = () => {
  interrupted = true;
  controller.abort();
  if (active?.pid) {
    try {
      process.kill(-active.pid, "SIGTERM");
    } catch {}
  }
  frontend?.kill("SIGTERM");
  void backend?.stop();
};
process.on("SIGINT", abort);
process.on("SIGTERM", abort);

async function check(name, executable, args, env = {}) {
  if (interrupted) throw new Error("Verification interrupted.");
  const entry = {
    name,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  report.checks.push(entry);
  const log = openSync(resolve(artifacts, `${name}.log`), "w", 0o600);
  try {
    await new Promise((resolve, reject) => {
      active = spawn(executable, args, {
        cwd: root,
        env: cleanEnv(env),
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      for (const [stream, output] of [
        [active.stdout, process.stdout],
        [active.stderr, process.stderr],
      ]) {
        stream.on("data", (data) => {
          writeFileSync(log, data);
          output.write(data);
        });
      }
      active.once("error", reject);
      active.once("exit", (code, signal) =>
        code === 0
          ? resolve()
          : reject(new Error(`${name} failed (${signal ?? code}).`)),
      );
    });
    entry.status = "passed";
  } catch (error) {
    entry.status = "failed";
    throw error;
  } finally {
    active = undefined;
    entry.finishedAt = new Date().toISOString();
    closeSync(log);
    json(resolve(artifacts, "summary.json"), report);
  }
}
try {
  if (suite === "all" || suite === "fast") {
    await check("build", "npm", ["run", "build"]);
    await check("tests", "npm", ["test"]);
  }
  if (suite === "all" || suite === "legacy") {
    const [port] = await allocatePorts(1);
    const legacyBuild = resolve(artifacts, "legacy-build");
    await check(
      "legacy-build",
      "npx",
      ["vite", "build", "--outDir", legacyBuild],
      { VITE_LOCAL_MODE: "true" },
    );
    await check("legacy-browser", "npx", ["playwright", "test"], {
      E2E_PORT: String(port),
      FIXTURE_DIST: legacyBuild,
      QA_ARTIFACTS: resolve(artifacts, "legacy"),
    });
  }
  if (suite === "all" || suite === "convex") {
    const [frontendPort, cloud, site] = await allocatePorts(3);
    const ports = { frontend: frontendPort, cloud, site };
    report.backend = `http://127.0.0.1:${cloud}`;
    report.origin = `http://localhost:${frontendPort}`;
    const backendLog = openSync(resolve(artifacts, "backend.log"), "w", 0o600);
    handles.push(backendLog);
    const entry = {
      name: "convex-deploy",
      status: "running",
      startedAt: new Date().toISOString(),
    };
    report.checks.push(entry);
    try {
      backend = await startBackend({
        project,
        ports,
        log: backendLog,
        signal: controller.signal,
        onStart: (handle) => {
          backend = handle;
        },
      });
      entry.status = "passed";
    } catch (error) {
      entry.status = "failed";
      throw error;
    } finally {
      entry.finishedAt = new Date().toISOString();
    }
    const env = {
      AGENT_PROJECT: project,
      VITE_LOCAL_MODE: "false",
      VITE_CONVEX_URL: report.backend,
    };
    const build = resolve(artifacts, "cloud-build");
    await check(
      "convex-build",
      "npx",
      [
        "vite",
        "build",
        "--config",
        "scripts/agent-vite.config.ts",
        "--outDir",
        build,
      ],
      env,
    );
    const frontendLog = openSync(
      resolve(artifacts, "frontend.log"),
      "w",
      0o600,
    );
    handles.push(frontendLog);
    frontend = spawn(
      process.execPath,
      [
        resolve(root, "node_modules/vite/bin/vite.js"),
        "preview",
        "--outDir",
        build,
        "--host",
        "127.0.0.1",
        "--port",
        String(frontendPort),
        "--strictPort",
      ],
      {
        cwd: root,
        env: cleanEnv(env),
        stdio: ["ignore", frontendLog, frontendLog],
      },
    );
    await waitFor(
      () =>
        fetch(report.origin, { signal: AbortSignal.timeout(1000) })
          .then((r) => r.ok)
          .catch(() => false),
      "QA frontend did not start.",
      15000,
    );
    await check("convex-browser", "npx", ["playwright", "test"], {
      QA_CONVEX: "true",
      QA_PROJECT: project,
      QA_BASE_URL: report.origin,
      QA_ARTIFACTS: resolve(artifacts, "convex"),
    });
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.message;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await Promise.all([stopProcess(frontend), backend?.stop()]);
  handles.forEach(closeSync);
  // Destroy this run's disposable database and private signing keys on success or failure.
  rmSync(project, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  json(resolve(artifacts, "summary.json"), report);
  json(resolve(state, "latest-verification.json"), {
    artifacts,
    status: report.status,
  });
  console.log(`${report.status.toUpperCase()}: ${artifacts}/summary.json`);
}
