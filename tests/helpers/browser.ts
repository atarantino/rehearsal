import { test as base, expect } from "@playwright/test";
// Fixture runs contain synthetic data only. Never capture credentials/headers/bodies.
export const test = base.extend<{ diagnostics: void }>({
  diagnostics: [
    async ({ page }, use, info) => {
      const events: object[] = [];
      const uncaught: string[] = [];
      page.on("console", (message) =>
        events.push({
          kind: "console",
          level: message.type(),
          text: message.text(),
        }),
      );
      page.on("pageerror", (error) => {
        uncaught.push(error.message);
        events.push({ kind: "pageerror", message: error.message });
      });
      page.on("requestfailed", (request) => {
        const url = new URL(request.url());
        events.push({
          kind: "requestfailed",
          method: request.method(),
          url: url.origin + url.pathname,
          error: request.failure()?.errorText,
        });
      });
      await use();
      await info.attach("browser-events", {
        body: JSON.stringify(events, null, 2),
        contentType: "application/json",
      });
      if (info.status === info.expectedStatus)
        expect(uncaught, "Uncaught browser errors").toEqual([]);
    },
    { auto: true },
  ],
});
