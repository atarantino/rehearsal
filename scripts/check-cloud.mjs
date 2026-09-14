// Explicit real-service smoke check. --audio exercises two paid voice attempts.
import { chromium, expect } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const origin =
  process.argv.find((a) => a.startsWith("--url="))?.slice(6) ??
  "http://localhost:4317";
const audio = process.argv.find((a) => a.startsWith("--audio="))?.slice(8);
if (audio && !existsSync(audio))
  throw new Error("Synthetic WAV file does not exist.");
const artifacts = resolve(".agent/artifacts", `live-${Date.now()}`);
mkdirSync(artifacts, { recursive: true, mode: 0o700 });
const summary = {
  origin,
  mode: audio ? "real-voice" : "real-auth",
  startedAt: new Date().toISOString(),
  milestones: [],
  status: "running",
};
const events = [];
let browser;
let context;
let page;
let inVoice = false;
const milestone = (name) => {
  summary.milestones.push({ name, at: new Date().toISOString() });
  console.log(`PASS: ${name}`);
};
try {
  browser = await chromium.launch({
    headless: true,
    args: audio
      ? [
          "--use-fake-ui-for-media-stream",
          "--use-fake-device-for-media-stream",
          `--use-file-for-fake-audio-capture=${resolve(audio)}`,
        ]
      : [],
  });
  context = await browser.newContext({
    permissions: audio ? ["microphone"] : [],
    viewport: { width: 1440, height: 1000 },
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  page = await context.newPage();
  page.on("pageerror", (error) =>
    events.push({ kind: "pageerror", name: error.name }),
  );
  page.on("requestfailed", (request) =>
    events.push({
      kind: "requestfailed",
      url: new URL(request.url()).origin,
      error: request.failure()?.errorText,
    }),
  );
  await page.goto(origin);
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page
    .getByLabel("Choose a username", { exact: false })
    .fill(`smoke${Date.now()}`);
  await page.getByRole("button", { name: "Continue with a passkey" }).click();
  await page.getByLabel("Job posting URL").waitFor({ timeout: 30000 });
  milestone("public signup and authenticated workspace");
  if (audio) {
    await page
      .getByLabel("What role are you preparing for?")
      .fill("Product designer");
    await page
      .getByRole("button", { name: "Start practicing", exact: true })
      .click();
    inVoice = true;
    for (let attempt = 0; attempt < 2; attempt++) {
      await page
        .getByText("Connected", { exact: true })
        .waitFor({ timeout: 45000 });
      await page
        .getByRole("button", { name: "Captions off", exact: true })
        .click();
      await expect(page.locator(".caption.user p").first()).toContainText(
        /\S/,
        { timeout: 90000 },
      );
      milestone(`user transcript received, attempt ${attempt + 1}`);
      await page
        .getByRole("button", { name: "Review answer", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Your next improvements" })
        .waitFor({ timeout: 280000 });
      inVoice = false;
      milestone(`real voice and validated feedback, attempt ${attempt + 1}`);
      if (attempt === 0) {
        await page
          .getByRole("button", { name: "Try this answer again" })
          .click();
        inVoice = true;
      }
    }
    await page
      .getByText("Since your last attempt", { exact: true })
      .waitFor({ timeout: 10000 });
    milestone("retry comparison");
    // Remove the two synthetic session records via the same authenticated UI.
    for (let i = 0; i < 2; i++) {
      if (i)
        await page
          .getByRole("button", { name: /Product designer Coached practice/ })
          .first()
          .click();
      await page.getByRole("button", { name: "Delete this session" }).click();
      await page
        .getByRole("button", { name: "Delete session", exact: true })
        .click();
      await page.getByRole("heading", { name: /Your practice/ }).waitFor();
    }
    milestone("synthetic sessions removed");
  }
  summary.status = "passed";
} catch (error) {
  summary.status = "failed";
  summary.error = error instanceof Error ? error.message : "Unknown error";
  console.error(
    `Cloud smoke failed after ${summary.milestones.at(-1)?.name ?? "startup"}. See ${artifacts}`,
  );
  await page
    ?.screenshot({ path: resolve(artifacts, "failure.png"), fullPage: true })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  if (inVoice)
    await page
      ?.getByRole("button", { name: "Review answer", exact: true })
      .click({ timeout: 5000 })
      .catch(() => {});
  await context?.tracing
    .stop({ path: resolve(artifacts, "trace.zip") })
    .catch(() => {});
  await context?.close();
  await browser?.close();
  summary.finishedAt = new Date().toISOString();
  writeFileSync(
    resolve(artifacts, "summary.json"),
    JSON.stringify(summary, null, 2),
    { mode: 0o600 },
  );
  writeFileSync(
    resolve(artifacts, "browser-events.json"),
    JSON.stringify(events, null, 2),
    { mode: 0o600 },
  );
  console.log(`Artifacts: ${artifacts}`);
}
