import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
export async function qa(name: string, args = {}): Promise<any> {
  if (!process.env.QA_PROJECT?.includes("/.agent/qa-"))
    throw new Error("QA admin access requires an isolated test project.");
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      resolve("node_modules/convex/bin/main.js"),
      "run",
      `qa:${name}`,
      JSON.stringify(args),
    ],
    {
      cwd: process.env.QA_PROJECT,
      env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
      timeout: 15000,
    },
  );
  return stdout.trim() ? JSON.parse(stdout) : null;
}
