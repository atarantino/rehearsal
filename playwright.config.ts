import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4318",
    headless: true,
    viewport: { width: 1440, height: 1100 },
    trace: "retain-on-failure",
  },
  outputDir: "../../work/checks/test-results",
  webServer: {
    command: "npx tsx tests/test-server.ts",
    url: "http://127.0.0.1:4318",
    reuseExistingServer: false,
  },
  reporter: "list",
});
