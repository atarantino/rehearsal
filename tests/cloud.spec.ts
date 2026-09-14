import { expect } from "@playwright/test";
import { test } from "./helpers/browser";
import { virtualPasskey, signIn } from "./helpers/passkey";
import { fakeVoice, speak } from "./helpers/voice";

import { qa } from "./helpers/qa";

test.beforeEach(async ({ page }, info) => {
  await page.goto("/");
  await virtualPasskey(page);
  const username = `qa_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  info.annotations.push({ type: "qa-user", description: username });
  await signIn(page, username);
  await expect(page.getByLabel("Job posting URL")).toBeVisible();
});

test("passkey account survives reload and signs out", async ({
  page,
}, info) => {
  await page.reload();
  await expect(page.getByLabel("Job posting URL")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("workspace-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("workspace-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByLabel("Choose a username", { exact: false }),
  ).toBeVisible();
});

test("returning passkey login uses the existing account", async ({
  page,
}, info) => {
  const username = info.annotations.find(
    (a) => a.type === "qa-user",
  )!.description!;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page, username);
  await expect(page.getByLabel("Job posting URL")).toBeVisible();
});

test("real workflow prepares a role, persists its brief and starts a question", async ({
  page,
}, info) => {
  await fakeVoice(page);
  await page.reload();
  await page
    .getByLabel("Job posting URL")
    .fill("https://example.com/careers/designer");
  await page.getByRole("button", { name: "Prepare", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Product designer", exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await page.reload();
  await expect(
    page.getByText("Prepare examples of accessible product launches."),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("brief.png"), fullPage: true });
  await page
    .getByRole("button", {
      name: "Tell me about a difficult project.",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Start practicing", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Connected");
  await speak(page);
  await page
    .getByRole("button", { name: "Review answer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your next improvements" }),
  ).toBeVisible();
});

test("failed preparation survives reload and offers retry", async ({
  page,
}, info) => {
  await page
    .getByLabel("Job posting URL")
    .fill("https://example.com/unreadable");
  await page.getByRole("button", { name: "Prepare", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry preparation" }),
  ).toBeVisible({ timeout: 45000 });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Retry preparation" }),
  ).toBeVisible();
  const snapshot = await qa("inspect");
  const username = info.annotations.find(
    (a) => a.type === "qa-user",
  )!.description;
  const owner = snapshot.users.find((u: any) => u.username === username).id;
  const opportunity = snapshot.opportunities.find(
    (o: any) => o.ownerId === owner,
  );
  await page.getByRole("button", { name: "Retry preparation" }).click();
  await expect
    .poll(
      async () =>
        (await qa("inspect")).opportunities.find(
          (o: any) => o.id === opportunity.id,
        ).workflowId,
    )
    .not.toBe(opportunity.workflowId);
  await expect
    .poll(
      async () =>
        (await qa("inspect")).opportunities.find(
          (o: any) => o.id === opportunity.id,
        ).status,
      { timeout: 45000 },
    )
    .toBe("failed");
  await expect(
    page.getByRole("button", { name: "Retry preparation" }),
  ).toBeVisible({ timeout: 45000 });
});

test("Convex practice, transcript persistence, feedback, retry and deletion", async ({
  page,
}, info) => {
  await fakeVoice(page);
  await page.reload();
  await page
    .getByLabel("What role are you preparing for?")
    .fill("Product designer");
  await page
    .getByRole("button", { name: "Start practicing", exact: true })
    .click();
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(page.getByRole("status")).toHaveText("Connected");
    await speak(page);
    await page.getByRole("button", { name: "Mute", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Unmute", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Review answer", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your next improvements" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        (window as any).__tracks.every(
          (t: MediaStreamTrack) => t.readyState === "ended",
        ),
      ),
    ).toBe(true);
    if (!attempt)
      await page.getByRole("button", { name: "Try this answer again" }).click();
  }
  await expect(
    page.getByRole("heading", { name: "Since your last attempt" }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("retry-review.png"),
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: /Session history/ }).click();
  const sessions = page.getByRole("button", {
    name: /Product designer Coached practice/,
  });
  await expect(sessions).toHaveCount(2);
  await sessions.first().click();
  await expect(
    page.getByRole("heading", { name: "Your next improvements" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete this session" }).click();
  await page
    .getByRole("button", { name: "Delete session", exact: true })
    .click();
  await expect(sessions).toHaveCount(1);
});

test("failed feedback persists and recovers without creating another voice session", async ({
  page,
}, info) => {
  await fakeVoice(page);
  await page.reload();
  await page
    .getByLabel("What role are you preparing for?")
    .fill("Product designer");
  await page
    .getByRole("button", { name: "Start practicing", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Connected");
  await speak(page);
  const before = await qa("inspect");
  const username = info.annotations.find(
    (a) => a.type === "qa-user",
  )!.description;
  const owner = before.users.find((u: any) => u.username === username).id;
  const session = before.sessions.find((s: any) => s.ownerId === owner);
  await qa("scenario", { id: session.id, scenario: "feedback-failure" });
  await page
    .getByRole("button", { name: "Review answer", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry feedback" }),
  ).toBeVisible();
  expect(
    (await qa("inspect")).sessions.find((s: any) => s.id === session.id)
      .feedbackState,
  ).toBe("failed");
  await qa("scenario", { id: session.id, scenario: "feedback-recover" });
  await page.reload();
  await page.getByRole("button", { name: /Session history/ }).click();
  await page
    .getByRole("button", { name: /Product designer Coached practice/ })
    .click();
  await page.getByRole("button", { name: "Retry feedback" }).click();
  await expect(
    page.getByRole("heading", { name: "Your next improvements" }),
  ).toBeVisible();
  expect(
    (await qa("inspect")).sessions.filter((s: any) => s.ownerId === owner),
  ).toHaveLength(1);
  await qa("scenario", { id: session.id, scenario: "stale-feedback" });
  await page.reload();
  await page.getByRole("button", { name: /Session history/ }).click();
  await page
    .getByRole("button", { name: /Product designer Coached practice/ })
    .click();
  await page.getByRole("button", { name: "Retry feedback" }).click();
  await expect(
    page.getByRole("heading", { name: "Your next improvements" }),
  ).toBeVisible();
});
