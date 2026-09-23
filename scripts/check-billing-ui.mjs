// Development smoke check against a running Vite frontend and Convex backend.
// Creates one synthetic passkey user and shared-inbox route, then rotates its
// marker. --checkout also opens a Stripe TEST checkout; it never pays or emails.
// Screenshots stay under ignored data/. Credentials and markers are not logged.
import { chromium, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const option = (name) =>
  process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
const origin = option("url") ?? "http://localhost:4317";
const expectedBackend =
  option("backend") ?? "https://quick-starfish-327.convex.cloud";
const checkout = process.argv.includes("--checkout");
const address = new URL(origin);
if (
  address.protocol !== "http:" ||
  !["localhost", "127.0.0.1"].includes(address.hostname)
)
  throw new Error("Billing smoke checks require a local Vite frontend.");
const stamp = Date.now();
const directory = resolve("data", `billing-ui-${stamp}`);
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.name));
let step = "connecting to the development backend";
async function fitsViewport() {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
try {
  await page.goto(origin);
  const backend = await page.evaluate(
    async () => (await import("/src/convex.ts")).convex?.url,
  );
  if (backend !== expectedBackend)
    throw new Error(
      "The frontend does not use the expected development backend.",
    );
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
  step = "synthetic passkey signup";
  await page.getByLabel("Choose a username").fill(`billingsmoke${stamp}`);
  await page.getByRole("button", { name: "Continue with a passkey" }).click();
  await page.getByLabel("Job posting URL").waitFor({ timeout: 30000 });
  await expect(
    page.getByText("Free includes focused practice.", { exact: false }),
  ).toBeVisible();
  console.log(
    "PASS: development passkey signup and practice allowance guidance",
  );

  step = "shared email route setup and marker rotation";
  await page
    .getByText("Forward an interview invitation", { exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Reply to forwarded invitations" }),
  ).not.toBeChecked();
  await page
    .getByRole("button", { name: "Set up email preparation", exact: true })
    .click();
  const emailDetails = page.locator(".inbox-details");
  await expect(
    emailDetails.getByText("This address is shared.", { exact: false }),
  ).toBeVisible({ timeout: 30000 });
  const codes = emailDetails.locator("code");
  await expect(codes).toHaveCount(2);
  expect((await codes.nth(0).textContent()).includes("@")).toBe(true);
  const before = await codes.nth(1).textContent();
  expect(!!before?.trim()).toBe(true);
  await page
    .getByRole("button", { name: "Replace and copy marker", exact: true })
    .click();
  await expect
    .poll(async () => (await codes.nth(1).textContent()) !== before)
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "Replace and copy marker", exact: true }),
  ).toBeEnabled();
  await expect(
    emailDetails.getByText("Your new brief appears here automatically.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: `${directory}/shared-email.png`,
    fullPage: true,
  });
  console.log(
    "PASS: shared address, account marker, rotation, and no automatic email reply",
  );

  step = "billing plans and initial usage";
  await page
    .getByRole("button", { name: "Plans & usage", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Rehearsal Free", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Test mode · Checkout uses Stripe test payments.", {
      exact: false,
    }),
  ).toBeVisible();
  for (const [name, price, minutes, preparations] of [
    ["Free", 0, 10, 3],
    ["Plus", 19, 60, 15],
    ["Pro", 39, 150, 40],
  ]) {
    const plan = page.getByRole("region", { name, exact: true });
    await expect(plan.locator(".billing-price")).toHaveText(
      `$${price} USD / month`,
    );
    await expect(
      plan.getByText(`${minutes} voice minutes / month`, { exact: true }),
    ).toBeVisible();
    await expect(
      plan.getByText(`${preparations} opportunity preparations / month`, {
        exact: true,
      }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("progressbar", {
      name: "Voice minutes: 0 of 10 used",
      exact: true,
    }),
  ).toHaveAttribute("value", "0");
  await expect(
    page.getByRole("progressbar", {
      name: "Opportunity preparations: 0 of 3 used",
      exact: true,
    }),
  ).toHaveAttribute("value", "0");
  await expect(
    page.getByText("Allowance resets", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Choose Plus", exact: true }),
  ).toBeEnabled();
  await fitsViewport();
  await page.screenshot({
    path: `${directory}/billing-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Choose Pro", exact: true }),
  ).toBeVisible();
  await fitsViewport();
  await page.screenshot({
    path: `${directory}/billing-mobile.png`,
    fullPage: true,
  });
  console.log(
    "PASS: three plans, prices, free usage, test mode, and desktop/mobile layout",
  );

  step = "unverified checkout return";
  await page.goto(`${origin}/?billing=success`);
  await expect(
    page.getByRole("heading", { name: "Rehearsal Free", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Waiting for payment confirmation.", { exact: false }),
  ).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.has("billing"), {
      timeout: 30000,
    })
    .toBe(false);
  await expect(
    page.getByRole("heading", { name: "Rehearsal Free", exact: true }),
  ).toBeVisible();
  console.log(
    "PASS: success URL reconciles with Stripe without granting a paid plan",
  );

  if (checkout) {
    step = "opening Stripe test checkout";
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page
      .getByRole("button", { name: "Choose Plus", exact: true })
      .click();
    await Promise.race([
      page.waitForURL((url) => url.hostname === "checkout.stripe.com", {
        timeout: 45000,
      }),
      page
        .locator(".billing-page .auth-error")
        .waitFor({ state: "visible", timeout: 45000 })
        .then(() => {
          throw new Error(
            "Checkout action failed; inspect the local screenshot.",
          );
        }),
    ]);
    expect(new URL(page.url()).pathname.includes("cs_test_")).toBe(true);
    await expect(
      page.getByText("Rehearsal Plus", { exact: false }).first(),
    ).toBeVisible({ timeout: 30000 });
    // Wait for the hosted form, not merely its product text beneath the loader.
    await expect(
      page.getByRole("button", { name: "Subscribe", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: `${directory}/stripe-test-checkout.png`,
      fullPage: true,
    });
    console.log(
      "PASS: Stripe-hosted Plus test checkout opens; no payment submitted",
    );
  }
  expect(errors).toEqual([]);
  console.log(`Screenshots: ${directory}`);
} catch (error) {
  await page
    .screenshot({ path: `${directory}/failure.png`, fullPage: true })
    .catch(() => {});
  console.error(
    `FAIL: ${step} (${error instanceof Error ? error.name : "Error"}). Inspect ${directory}/failure.png`,
  );
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
