import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  rmSync,
  symlinkSync,
  watch,
} from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { root, cleanEnv, run, waitFor, sleep, available } from "./lib.mjs";

// This explicit allowlist cannot copy .env files or credentials from the real project.
export function syncProject(project) {
  mkdirSync(project, { recursive: true, mode: 0o700 });
  const inputs = ["convex", "shared", "server/prompts.ts"];
  const expected = new Set();
  function copy(source) {
    for (const entry of readdirSync(resolve(root, source), {
      withFileTypes: true,
    })) {
      const name = `${source}/${entry.name}`;
      if (entry.isDirectory()) copy(name);
      else if (/\.(ts|js|json)$/.test(name)) file(name);
    }
  }
  function file(name) {
    // Generated code is copied initially; the isolated CLI owns subsequent codegen.
    if (
      name.startsWith("convex/_generated/") &&
      existsSync(resolve(project, name))
    )
      return;
    let content = readFileSync(resolve(root, name), "utf8");
    if (["convex/openai.ts", "convex/firecrawl.ts"].includes(name)) {
      content = readFileSync(
        resolve(root, "tests/convex-fixtures", name.split("/").pop()),
        "utf8",
      );
    }
    const destination = resolve(project, name);
    expected.add(name);
    mkdirSync(resolve(destination, ".."), { recursive: true });
    if (
      !existsSync(destination) ||
      readFileSync(destination, "utf8") !== content
    )
      writeFileSync(destination, content);
  }
  for (const name of inputs) name.endsWith(".ts") ? file(name) : copy(name);
  const qaPath = resolve(project, "convex/qa.ts");
  const qaSource = readFileSync(
    resolve(root, "tests/convex-fixtures/qa.ts.fixture"),
    "utf8",
  );
  expected.add("convex/qa.ts");
  if (!existsSync(qaPath) || readFileSync(qaPath, "utf8") !== qaSource)
    writeFileSync(qaPath, qaSource);
  function prune(directory) {
    for (const entry of readdirSync(resolve(project, directory), {
      withFileTypes: true,
    })) {
      const name = `${directory}/${entry.name}`;
      if (name.startsWith("convex/_generated")) continue;
      if (entry.isDirectory()) prune(name);
      else if (!expected.has(name)) rmSync(resolve(project, name));
    }
  }
  for (const name of ["convex", "shared", "server"]) prune(name);
  cpSync(resolve(root, "package.json"), resolve(project, "package.json"));
  // Prevent the CLI from discovering a parent project's configuration.
  writeFileSync(
    resolve(project, "convex.json"),
    JSON.stringify({ functions: "convex/" }),
  );
  if (!existsSync(resolve(project, "node_modules")))
    symlinkSync(
      resolve(root, "node_modules"),
      resolve(project, "node_modules"),
      "dir",
    );
}

export async function startBackend({
  project,
  ports,
  log,
  onExit = () => {},
  onStart = () => {},
  watchSources = false,
  signal,
}) {
  for (const port of [ports.cloud, ports.site])
    if (!(await available(port)))
      throw new Error(`Port ${port} is occupied; refusing to reuse a backend.`);
  signal?.throwIfAborted();
  syncProject(project);
  await run(
    process.execPath,
    [
      resolve(root, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "-p",
      resolve(project, "convex/tsconfig.json"),
    ],
    { cwd: project, env: cleanEnv(), signal, stdio: ["ignore", log, log] },
  );
  const { generateKeyPair, exportPKCS8, exportJWK } = await import("jose");
  const secretFile = resolve(project, "auth.env");
  if (!existsSync(secretFile)) {
    const { privateKey, publicKey } = await generateKeyPair("RS256", {
      extractable: true,
    });
    const pub = await exportJWK(publicKey);
    const jwks = JSON.stringify({
      keys: [{ ...pub, kid: crypto.randomUUID(), alg: "RS256", use: "sig" }],
    });
    writeFileSync(
      secretFile,
      `AUTH_PRIVATE_KEY=${Buffer.from(await exportPKCS8(privateKey)).toString("base64")}\nAUTH_JWKS='${jwks}'\n`,
      { mode: 0o600 },
    );
  }
  // Placeholder credentials only. Never inherit deployment selectors or provider keys.
  const envFile = resolve(project, "backend.env");
  writeFileSync(
    envFile,
    readFileSync(secretFile, "utf8") +
      `SITE_URL=http://localhost:${ports.frontend}\nOPENAI_API_KEY=fixture\nFIRECRAWL_API_KEY=fixture\nAGENTMAIL_API_KEY=fixture\n`,
    { mode: 0o600 },
  );
  const env = cleanEnv({ CONVEX_AGENT_MODE: "anonymous" });
  const executable = resolve(root, "node_modules/convex/bin/main.js");
  signal?.throwIfAborted();
  const child = spawn(
    process.execPath,
    [
      executable,
      "dev",
      "--local-cloud-port",
      String(ports.cloud),
      "--local-site-port",
      String(ports.site),
      "--tail-logs",
      "always",
      "--typecheck",
      "enable",
    ],
    { cwd: project, env, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  let deployed = false;
  let outputTail = "";
  let startupError;
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (data) => {
      writeFileSync(log, data);
      outputTail = (outputTail + data.toString()).slice(-2000);
      if (outputTail.includes("Convex functions ready!")) deployed = true;
    });
  }
  child.on("error", (error) => {
    startupError = error;
  });
  child.on("exit", onExit);
  let stopPromise;
  const watchers = [];
  let timer;
  function stop() {
    return (stopPromise ??= (async () => {
      clearTimeout(timer);
      watchers.forEach((w) => w.close());
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
      for (
        let i = 0;
        i < 30 && child.exitCode === null && child.signalCode === null;
        i++
      )
        await sleep(100);
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    })());
  }
  onStart({ stop });
  if (watchSources) {
    for (const directory of [
      "convex",
      "shared",
      "server",
      "tests/convex-fixtures",
    ]) {
      watchers.push(
        watch(resolve(root, directory), { recursive: true }, () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            try {
              syncProject(project);
            } catch (error) {
              console.error("Backend source sync failed:", error.message);
            }
          }, 200);
        }),
      );
    }
  }
  try {
    await waitFor(
      async () => {
        signal?.throwIfAborted();
        if (startupError) throw startupError;
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error("Convex exited during startup. Inspect backend.log.");
        if (
          !existsSync(resolve(project, ".env.local")) ||
          !readFileSync(resolve(project, ".env.local"), "utf8").includes(
            "CONVEX_DEPLOYMENT=",
          )
        )
          return false;
        return fetch(`http://127.0.0.1:${ports.cloud}/version`, {
          signal: AbortSignal.timeout(1000),
        })
          .then((r) => r.ok)
          .catch(() => false);
      },
      "Local Convex did not start. Inspect backend.log.",
      180000,
    );
    await run(
      process.execPath,
      [executable, "env", "set", "--from-file", envFile, "--force"],
      { cwd: project, env, signal, stdio: ["ignore", log, log] },
    );
    await waitFor(
      async () => {
        signal?.throwIfAborted();
        if (startupError) throw startupError;
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error(
            "Convex exited before deployment finished. Inspect backend.log.",
          );
        if (!deployed) return false;
        const r = await fetch(`http://127.0.0.1:${ports.cloud}/api/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: "voice:status",
            args: {},
            format: "json",
          }),
          signal: AbortSignal.timeout(2000),
        })
          .then((r) => r.json())
          .catch(() => null);
        return r?.status === "success" && r.value?.configured;
      },
      "Convex functions did not deploy. Inspect backend.log.",
      180000,
    );
    return { stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
