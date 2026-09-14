import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
const cloud = process.env.QA_CONVEX === "true";
const port = Number(process.env.E2E_PORT || 4318);
const artifacts = process.env.QA_ARTIFACTS || "test-results";
export default defineConfig({
  testDir: "./tests",
  testMatch: cloud ? "cloud.spec.ts" : ["browser.spec.ts", "coaching.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: cloud ? 60000 : 30000,
  expect: { timeout: cloud ? 15000 : 5000 },
  use: {
    baseURL: process.env.QA_BASE_URL || `http://127.0.0.1:${port}`,
    headless: true,
    viewport: { width: 1440, height: 1100 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  outputDir: resolve(artifacts, "results"),
  webServer: cloud
    ? undefined
    : {
        command: "VITE_LOCAL_MODE=true npx tsx tests/test-server.ts",
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: false,
      },
  reporter: [
    ["list"],
    ["html", { outputFolder: resolve(artifacts, "report"), open: "never" }],
    ["json", { outputFile: resolve(artifacts, "playwright.json") }],
  ],
});
