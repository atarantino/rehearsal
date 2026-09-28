// Import a Google Web application client download without printing credentials.
// node scripts/configure-google-auth.mjs --deployment=<name> --client=/path/client.json
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const option = (name) =>
  process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
const deployment = option("deployment");
const clientPath = option("client");
if (!deployment || !/^[a-z0-9-]+$/.test(deployment) || !clientPath)
  throw new Error(
    "Provide --deployment=<name> and --client=/path/client.json.",
  );

const { web } = JSON.parse(readFileSync(clientPath, "utf8"));
const callback = `https://${deployment}.convex.site/oauth/google/callback`;
if (
  !web ||
  typeof web.client_id !== "string" ||
  !web.client_id.endsWith(".apps.googleusercontent.com") ||
  typeof web.client_secret !== "string" ||
  !web.client_secret ||
  !Array.isArray(web.redirect_uris) ||
  !web.redirect_uris.includes(callback)
)
  throw new Error(
    "Expected a Google Web client with this deployment's callback URI.",
  );

for (const [name, value] of [
  ["AUTH_GOOGLE_CLIENT_ID", web.client_id],
  ["AUTH_GOOGLE_CLIENT_SECRET", web.client_secret],
]) {
  // Pipe values through stdin; do not expose secrets in command arguments.
  const result = spawnSync(
    "npx",
    ["convex", "env", "set", name, "--deployment", deployment],
    { input: value, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
  if (result.status !== 0)
    throw new Error(
      `Could not set ${name} on ${deployment}. CLI output withheld to protect credentials.`,
    );
  console.log(`Configured ${name} on ${deployment}.`);
}
