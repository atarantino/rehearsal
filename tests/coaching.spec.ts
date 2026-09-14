import { expect, test } from "@playwright/test";
import { projectPdf } from "./pdfFixture";

test("coaching conversation, project notes, saved draft, and practice handoff", async ({
  page,
}) => {
  await page.goto("/tests/coaching-harness.html");
  await page.getByRole("button", { name: "Paste project notes" }).click();
  await page.getByLabel("Project title").fill("Launch notes");
  await page
    .getByLabel("Project notes", { exact: true })
    .fill("I designed the staged rollout.");
  await page.getByRole("button", { name: "Add notes", exact: true }).click();
  await expect(page.getByText("Launch notes", { exact: true })).toBeVisible();
  await page
    .getByLabel("Ask your coach")
    .fill("How can I explain my decision?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Use as practice draft" }).click();
  await expect(page.getByLabel("Practice draft", { exact: true })).toHaveValue(
    /What did you personally own/,
  );
  await page
    .getByLabel("Practice draft", { exact: true })
    .fill("I owned rollout planning and chose staged releases.");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Practice draft", { exact: true })).toHaveValue(
    "I owned rollout planning and chose staged releases.",
  );
  await page.screenshot({
    path: "test-results/coaching-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Practice this version" }).click();
  const config = JSON.parse(
    (await page.getByTestId("practice-config").textContent())!,
  );
  expect(config.previousId).toBe("original-attempt");
  expect(config.relation).toBe("retry");
  expect(config.background).toBe("My background");
  expect(config.practiceNotes).toBe(
    "I owned rollout planning and chose staged releases.",
  );
});

test("failed reply recovers and mobile PDF controls remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/coaching-harness.html");
  await page.getByLabel("Ask your coach").fill("simulate failure");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Retry reply", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Use as practice draft" }),
  ).toBeVisible();
  await expect(page.locator(".coaching-message.user")).toHaveCount(1);
  await page
    .getByLabel("Upload project PDF")
    .setInputFiles({
      name: "Launch.pptx",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("invalid"),
    });
  await expect(page.getByRole("alert")).toContainText(
    "Export Word documents or slides",
  );
  await page
    .getByLabel("Upload project PDF")
    .setInputFiles({
      name: "Launch.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(projectPdf()),
    });
  await page.getByText("Launch.pdf", { exact: true }).click();
  await expect(page.getByText(/\[Page 1\]/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/coaching-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Remove Launch.pdf" }).click();
  await expect(page.getByText("Launch.pdf", { exact: true })).toHaveCount(0);
});
