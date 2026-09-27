// Creates one provider inbox per deployment; user routes are database records.
import { spawnSync } from "node:child_process";
const deployment = process.argv
  .find((a) => a.startsWith("--deployment="))
  ?.split("=")[1];
if (!deployment || !/^[a-z0-9-]+$/.test(deployment))
  throw new Error("Pass --deployment=<name>.");
function get(name) {
  const r = spawnSync(
    "npx",
    ["convex", "env", "get", name, "--deployment", deployment],
    { encoding: "utf8" },
  );
  return r.status === 0 ? r.stdout.trim() : "";
}
function set(name, value) {
  const r = spawnSync(
    "npx",
    ["convex", "env", "set", name, "--deployment", deployment],
    { input: value, encoding: "utf8" },
  );
  if (r.status) throw new Error(`Could not configure ${name}.`);
  console.log(`${name}: configured`);
}
const key = get("AGENTMAIL_API_KEY");
if (!key) throw new Error("AgentMail is not configured on this deployment.");
async function call(path, body) {
  const r = await fetch(`https://api.agentmail.to/v0${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok)
    throw new Error(
      `AgentMail ${path.split("/")[1]} request failed: HTTP ${r.status}`,
    );
  return r.json();
}
let inboxId = get("AGENTMAIL_SHARED_INBOX_ID");
if (inboxId) await call(`/inboxes/${encodeURIComponent(inboxId)}`);
else {
  const inbox = await call("/inboxes", {
    display_name: "Rehearsal invitations",
    client_id: `rehearsal-shared-${deployment}`,
  });
  inboxId = inbox.inbox_id;
  if (typeof inboxId !== "string" || !inboxId.includes("@"))
    throw new Error("Invalid shared inbox returned.");
  set("AGENTMAIL_SHARED_INBOX_ID", inboxId);
}
const url = `https://${deployment}.convex.site/agentmail/webhook`;
const list = await call("/webhooks");
const existing = list.webhooks?.find((x) => x.url === url);
if (!existing || !get("AGENTMAIL_WEBHOOK_SECRET")) {
  const webhook = existing
    ? await call(`/webhooks/${encodeURIComponent(existing.webhook_id)}`)
    : await call("/webhooks", {
        url,
        event_types: ["message.received"],
        client_id: `rehearsal-${deployment}.convex.site`,
      });
  if (!webhook.secret)
    throw new Error(
      "Webhook secret absent; configure it securely before enabling intake.",
    );
  set("AGENTMAIL_WEBHOOK_SECRET", webhook.secret);
}
console.log(
  JSON.stringify(
    { deployment, inboxId, webhookUrl: url, sentMessages: 0 },
    null,
    2,
  ),
);
