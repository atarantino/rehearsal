import dotenv from "dotenv";
dotenv.config({ override: true, quiet: true });
const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error(
    "OPENAI_API_KEY is missing. Copy .env.example to .env and set a project key.",
  );
  process.exit(1);
}
for (const model of process.env.REASONING_BACKEND === "api"
  ? ["gpt-live-1", "gpt-5.6-terra"]
  : ["gpt-live-1"]) {
  try {
    const r = await fetch(`https://api.openai.com/v1/models/${model}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
    console.log(
      `${model}: ${r.ok ? "accessible" : `HTTP ${r.status} — check API key, project access, and billing`}`,
    );
    if (!r.ok) process.exitCode = 1;
  } catch {
    console.error(`${model}: network request failed`);
    process.exitCode = 1;
  }
}
console.log(
  "This checks credentials/model visibility. Use the app to verify actual microphone, speech, and delegation behavior.",
);
