// Optional live smoke check. --audio=/absolute/path.wav runs two paid voice
// attempts using synthetic microphone audio. With no audio, checks signup only.
import { chromium } from "playwright";
const origin =
  process.argv.find((a) => a.startsWith("--url="))?.slice(6) ??
  "http://localhost:4317";
const audio = process.argv.find((a) => a.startsWith("--audio="))?.slice(8);
const browser = await chromium.launch({
  headless: true,
  args: audio
    ? [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${audio}`,
      ]
    : [],
});
const context = await browser.newContext({
  permissions: audio ? ["microphone"] : [],
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
try {
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
  await page.getByLabel("Choose a username").fill(`smoke${Date.now()}`);
  await page.getByRole("button", { name: "Continue with a passkey" }).click();
  await page.getByLabel("Job posting URL").waitFor({ timeout: 30000 });
  console.log("PASS: public signup and authenticated workspace");
  if (audio) {
    await page
      .getByLabel("What role are you preparing for?")
      .fill("Product designer");
    await page
      .getByRole("button", { name: "Start practicing", exact: true })
      .click();
    for (let attempt = 0; attempt < 2; attempt++) {
      await page
        .getByText("Connected", { exact: true })
        .waitFor({ timeout: 45000 });
      await page.waitForTimeout(55000);
      await page
        .getByRole("button", { name: "Review answer", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Your next improvements" })
        .waitFor({ timeout: 280000 });
      console.log(
        `PASS: real voice and validated feedback, attempt ${attempt + 1}`,
      );
      if (attempt === 0)
        await page
          .getByRole("button", { name: "Try this answer again" })
          .click();
    }
    await page
      .getByText("Since your last attempt", { exact: true })
      .waitFor({ timeout: 10000 });
    console.log("PASS: retry comparison");
  }
} catch (error) {
  console.error(
    "Cloud smoke check failed:",
    error instanceof Error ? error.name : "Error",
  );
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
