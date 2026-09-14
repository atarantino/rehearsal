// Run locally; credential values never enter command output or source files.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import { generateKeyPair, exportPKCS8, exportJWK } from "jose";
const prod = process.argv.includes("--prod");
const values = dotenv.parse(fs.readFileSync(".env"));
const local = dotenv.parse(fs.readFileSync(".env.local"));
const siteArg = process.argv.find((a) => a.startsWith("--site="));
const site = siteArg?.slice(7) || local.VITE_CONVEX_SITE_URL;
if (!site?.startsWith("https://"))
  throw new Error("Pass --site=https://your-deployment.convex.site");
function cli(args) {
  return spawnSync(
    "npx",
    ["convex", "env", ...args, ...(prod ? ["--prod"] : [])],
    { encoding: "utf8" },
  );
}
function set(name, value) {
  const r = cli(["set", name + "=" + value]);
  if (r.status !== 0) throw new Error(`Could not configure ${name}`);
  console.log(`${name}: configured`);
}
for (const name of [
  "OPENAI_API_KEY",
  "FIRECRAWL_API_KEY",
  "AGENTMAIL_API_KEY",
]) {
  if (!values[name]) throw new Error(`Missing ${name} in .env`);
  set(name, values[name]);
}
const keyCheck = cli(["get", "AUTH_PRIVATE_KEY"]);
if (keyCheck.status !== 0 || !keyCheck.stdout.trim()) {
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const pub = await exportJWK(publicKey);
  const kid = crypto.randomUUID();
  set(
    "AUTH_PRIVATE_KEY",
    Buffer.from(await exportPKCS8(privateKey)).toString("base64"),
  );
  set(
    "AUTH_JWKS",
    JSON.stringify({ keys: [{ ...pub, kid, alg: "RS256", use: "sig" }] }),
  );
}
set("SITE_URL", site);
const response = await fetch("https://api.agentmail.to/v0/webhooks", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${values.AGENTMAIL_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    url: `${site}/agentmail/webhook`,
    event_types: [
      "message.received",
      "message.sent",
      "message.delivered",
      "message.bounced",
    ],
    client_id: `rehearsal-${new URL(site).hostname}`,
  }),
  signal: AbortSignal.timeout(30000),
});
if (!response.ok)
  throw new Error(`AgentMail webhook setup failed: HTTP ${response.status}`);
const webhook = await response.json();
if (webhook.secret) set("AGENTMAIL_WEBHOOK_SECRET", webhook.secret);
else {
  const existing = cli(["get", "AGENTMAIL_WEBHOOK_SECRET"]);
  if (existing.status !== 0 || !existing.stdout.trim())
    throw new Error("AgentMail returned no webhook secret.");
}
console.log(
  `Ready to deploy ${prod ? "production" : "development"} at ${site}`,
);
