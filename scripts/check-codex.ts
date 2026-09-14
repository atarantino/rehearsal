import { resolve } from "node:path";
import { z } from "zod";
import { CodexRunner } from "../server/codex.js";
const runner = new CodexRunner(resolve("data/.codex-runs"));
try {
  await runner.check();
  console.log("Codex is signed in with ChatGPT.");
  const result = await runner.run(
    z.object({ question: z.string() }),
    "Return one short behavioral interview question about collaboration.",
    { role: "Product designer" },
  );
  console.log("Subscription-backed structured response:", result.question);
} catch (e) {
  console.error(e instanceof Error ? e.message : "Codex check failed.");
  process.exitCode = 1;
}
