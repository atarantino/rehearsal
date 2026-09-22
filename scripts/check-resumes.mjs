// Regression checks against a running LOCAL Convex backend and Vite frontend.
// Creates a synthetic passkey account and synthetic opportunities; calls no paid APIs.
import { chromium, expect } from "@playwright/test";
import { parse } from "dotenv";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const origin =
  process.argv.find((arg) => arg.startsWith("--url="))?.slice(6) ??
  "http://localhost:4317";
function isLocal(value) {
  const url = new URL(value);
  return (
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname)
  );
}
if (!isLocal(origin))
  throw new Error("Resume regression checks require a local frontend.");
const localConfig = parse(readFileSync(".env.local"));
const baseConfig = existsSync(".env") ? parse(readFileSync(".env")) : {};
const deployment =
  process.env.CONVEX_DEPLOYMENT ??
  localConfig.CONVEX_DEPLOYMENT ??
  baseConfig.CONVEX_DEPLOYMENT;
if (
  !/^(anonymous|local):/.test(deployment ?? "") ||
  process.env.CONVEX_DEPLOY_KEY ||
  localConfig.CONVEX_DEPLOY_KEY ||
  baseConfig.CONVEX_DEPLOY_KEY
)
  throw new Error(
    "Run these checks from a local Convex checkout without a deploy key.",
  );
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage();
const directory = mkdtempSync(join(tmpdir(), "rehearsal-resume-regression-"));
const cli = (...args) =>
  execFileSync("npx", ["convex", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30000,
  });
try {
  await page.goto(origin);
  const backendUrl = await page.evaluate(
    async () => (await import("/src/convex.ts")).convex?.url,
  );
  if (!backendUrl || !isLocal(backendUrl))
    throw new Error(
      "Use a Vite frontend connected to a local Convex deployment.",
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
  const username = "resumetest" + Date.now();
  await page.getByLabel("Choose a username").fill(username);
  await page.getByRole("button", { name: "Continue with a passkey" }).click();
  await page.getByLabel("Job posting URL").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Add resume", exact: true }).click();
  await page
    .getByLabel("Resume text", { exact: true })
    .fill("Default resume for regression checks.");
  await page.getByRole("button", { name: "Save resume", exact: true }).click();
  await expect(
    page.getByText("Default resume saved", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Default resume saved", { exact: true }),
  ).toBeVisible();
  const ownerId = JSON.parse(cli("data", "users", "--format", "json")).find(
    (user) => user.username === username,
  )._id;
  function addOpportunities(names) {
    const path = join(directory, "opportunities.json");
    writeFileSync(
      path,
      JSON.stringify(
        names.map((company) => ({
          ownerId,
          requestId: company + username,
          input: "https://convex.dev/jobs",
          kind: "url",
          status: "ready",
          sources: [],
          receivedAt: Date.now(),
          brief: {
            company,
            role: "Designer",
            interviewDate: null,
            preparation: [],
            summary: "Synthetic role for local regression checks.",
            focusAreas: [],
            questions: [`Describe a project for ${company}.`],
            uncertainties: [],
          },
        })),
      ),
    );
    cli("import", "--table", "opportunities", "--append", path);
  }
  addOpportunities(["Alpha"]);
  const picker = page.getByLabel("Your recent opportunities");
  const choice = page.getByLabel("Resume for this opportunity");
  const editor = page.getByLabel("Resume text", { exact: true });
  await expect(picker).toBeVisible();
  const alpha = await picker.inputValue();
  await choice.selectOption("custom");
  await editor.fill("An unsaved tailored resume.");
  // More than the recent-query limit: the selected document must remain subscribed.
  addOpportunities(Array.from({ length: 25 }, (_, i) => `New arrival ${i}`));
  await expect(picker.locator("option")).toHaveCount(21);
  await expect(picker.locator("option").first()).toContainText("Alpha");
  await expect(picker).toHaveValue(alpha);
  await expect(editor).toHaveValue("An unsaved tailored resume.");
  await page.getByRole("button", { name: "Save resume", exact: true }).click();
  await expect(choice).toHaveValue("custom");
  for (const mode of ["default", "none"]) {
    await choice.selectOption(mode);
    await expect(choice).toHaveValue(mode);
    await choice.selectOption("custom");
    await expect(editor).toHaveValue("An unsaved tailored resume.");
    await page
      .getByRole("button", { name: "Save resume", exact: true })
      .click();
    await expect(choice).toHaveValue("custom");
  }
  console.log(
    "PASS: new arrivals preserve selection/draft; default and none preserve saved custom text.",
  );
  await page
    .getByRole("button", { name: "Describe a project for Alpha.", exact: true })
    .click();
  await expect(
    page.getByText("Practicing for Designer · Alpha", { exact: true }),
  ).toBeVisible();
  const { value: beta, company: betaCompany } = await picker
    .locator("option")
    .evaluateAll((nodes) => {
      const option = nodes.find((node) =>
        node.textContent.includes("New arrival"),
      );
      return {
        value: option.value,
        company: option.textContent.match(/New arrival \d+/)[0],
      };
    });
  await picker.selectOption(beta);
  await expect(page.getByLabel("What role are you preparing for?")).toHaveValue(
    "Designer",
  );
  await expect(
    page.getByText("Practicing for Designer · Alpha", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".selected-question")).toHaveCount(0);
  await choice.selectOption("none");
  await expect(choice).toHaveValue("none");
  await page
    .getByRole("button", {
      name: `Describe a project for ${betaCompany}.`,
      exact: true,
    })
    .click();
  await expect(
    page.getByText(`Practicing for Designer · ${betaCompany}`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No resume — as selected for this opportunity.", {
      exact: false,
    }),
  ).toBeVisible();
  console.log(
    "PASS: changing opportunities clears stale practice; choosing a question uses the named opportunity and its resume choice.",
  );
  // Check that the previous opportunity still retains its saved text after switching away.
  const stored = JSON.parse(cli("data", "opportunities", "--format", "json"));
  expect(stored.find((row) => row._id === alpha).resumeText).toBe(
    "An unsaved tailored resume.",
  );
  // Exercise explicit removal on the currently selected opportunity.
  await choice.selectOption("custom");
  await editor.fill("Resume to delete explicitly.");
  await page.getByRole("button", { name: "Save resume", exact: true }).click();
  await expect(choice).toHaveValue("custom");
  await page
    .getByRole("button", {
      name: "Delete saved opportunity resume",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Keep opportunity resume", exact: true })
    .click();
  await expect(choice).toHaveValue("custom");
  await page
    .getByRole("button", {
      name: "Delete saved opportunity resume",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Delete opportunity resume", exact: true })
    .click();
  await expect(choice).toHaveValue("none");
  await choice.selectOption("custom");
  await expect(editor).toHaveValue("");
  console.log(
    "PASS: deletion is explicit, cancelable, and switches future practice to no resume.",
  );
} finally {
  await browser.close();
  rmSync(directory, { recursive: true, force: true });
}
