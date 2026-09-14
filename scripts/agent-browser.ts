import { chromium, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fakeVoice, speak } from "../tests/helpers/voice";
import { virtualPasskey, signIn } from "../tests/helpers/passkey";
const manifest = JSON.parse(readFileSync(".agent/worktree.json", "utf8"));
const origin = `http://localhost:${manifest.ports.frontend}`;
const smoke = process.argv.includes("--smoke");
const browser = await chromium.launch({ headless: smoke });
let timer: ReturnType<typeof setInterval> | undefined;
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (error) =>
    console.error("Browser error:", error.message),
  );
  await fakeVoice(page);
  await page.goto(origin);
  await virtualPasskey(page);
  let injecting = false;
  timer = setInterval(async () => {
    if (injecting || page.isClosed()) return;
    injecting = true;
    try {
      const connected = await page.evaluate(() => {
        const channel = (window as any).__channel;
        if (
          !channel?.onmessage ||
          channel.__spoken ||
          channel.readyState !== "open"
        )
          return false;
        channel.__spoken = true;
        return true;
      });
      if (connected) await speak(page);
    } catch {
      /* Page navigation or browser closure. */
    } finally {
      injecting = false;
    }
  }, 300);
  console.log(
    `Fixture browser: ${origin}\nUses a virtual passkey and synthetic voice/transcript. Close the browser or press Ctrl-C to stop.`,
  );
  process.once("SIGINT", () => void browser.close());
  process.once("SIGTERM", () => void browser.close());
  if (smoke) {
    await signIn(page, `browser_${Date.now()}`);
    await expect(page.getByLabel("Job posting URL")).toBeVisible({
      timeout: 15000,
    });
    await page
      .getByLabel("What role are you preparing for?")
      .fill("Product designer");
    await page
      .getByRole("button", { name: "Start practicing", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText("Connected");
    await page
      .getByRole("button", { name: "Captions off", exact: true })
      .click();
    await expect(page.locator(".caption.user")).toBeVisible();
    await page
      .getByRole("button", { name: "Review answer", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your next improvements" }),
    ).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: "Delete this session" }).click();
    await page
      .getByRole("button", { name: "Delete session", exact: true })
      .click();
    console.log(
      "PASS: interactive fixture browser signup, voice, feedback and deletion.",
    );
  } else
    await new Promise<void>((resolve) =>
      browser.once("disconnected", () => resolve()),
    );
} finally {
  clearInterval(timer);
  await browser.close();
}
