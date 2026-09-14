import { expect, type Page } from "@playwright/test";
import { test } from "./helpers/browser";
import { answer } from "./fixtures";
import { fakeVoice, speak } from "./helpers/voice";
async function start(page: Page, mode: "mock" | "coached" = "coached") {
  await page.goto("/");
  if (mode === "mock")
    await page
      .getByRole("button", { name: /Mock interview A real conversation/ })
      .click();
  if (mode === "coached")
    await page
      .getByRole("button", { name: /Coached practice One question/ })
      .click();
  await page
    .getByLabel("What role are you preparing for?")
    .fill("Product manager");
  await page.getByRole("button", { name: "Start practicing" }).click();
  await expect(page.getByRole("status")).toHaveText("Connected");
}

test("setup is usable at desktop and mobile widths", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Find the words/ }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("setup-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Start practicing" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("setup-mobile.png"),
    fullPage: true,
  });
});
test("coached flow, mute, captions, review, retry comparison, history and deletion", async ({
  page,
}, testInfo) => {
  await fakeVoice(page);
  await start(page);
  await speak(page);
  await page.getByRole("button", { name: "Captions off" }).click();
  await expect(page.getByText(answer, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mute", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unmute", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Unmute", exact: true }).click();
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
  expect(await page.evaluate(() => (window as any).__peerClosed)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("review-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Try this answer again" }).click();
  await expect(page.getByRole("status")).toHaveText("Connected");
  await speak(page);
  await page
    .getByRole("button", { name: "Review answer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Since your last attempt" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /Session history/ }).click();
  await expect(
    page
      .getByRole("button", { name: /Product manager Coached practice/ })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Product manager Coached practice/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Your next improvements" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete this session" }).click();
  await page
    .getByRole("button", { name: "Delete session", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /Your practice/ }),
  ).toBeVisible();
});
test("mock interview completes and next question starts coached practice", async ({
  page,
}) => {
  await fakeVoice(page);
  await start(page, "mock");
  await speak(page);
  await page.getByRole("button", { name: "End & review" }).click();
  await expect(
    page.getByRole("heading", { name: "Your next improvements" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Next question", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Connected");
  await expect(
    page.getByRole("button", { name: "Review answer", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review answer", exact: true })
    .click();
  await expect(page.getByText("Limited evidence")).toBeVisible();
});
test("microphone denial gives an actionable error without starting an interview", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        throw new DOMException("denied", "NotAllowedError");
      },
    });
  });
  await page.goto("/");
  await page.getByLabel("What role are you preparing for?").fill("Designer");
  await page.getByRole("button", { name: "Start practicing" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Microphone permission was denied",
  );
  await expect(
    page.getByRole("heading", { name: /Find the words/ }),
  ).toBeVisible();
});
test("feedback failure retains transcript and retries without another voice session", async ({
  page,
}) => {
  await fakeVoice(page);
  await page.goto("/");
  await page.getByLabel("What role are you preparing for?").fill("Designer");
  await page.getByText("Add a job description or background").click();
  await page.getByLabel("Your experience").fill("TEST_FEEDBACK_FAILURE");
  await page.getByRole("button", { name: "Start practicing" }).click();
  await expect(page.getByRole("status")).toHaveText("Connected");
  await speak(page);
  await page.getByRole("button", { name: "End & review" }).click();
  await expect(
    page.getByRole("button", { name: "Retry feedback" }),
  ).toBeVisible();
  const before = await page.request.get("/api/sessions").then((r) => r.json());
  await page.getByRole("button", { name: "Retry feedback" }).click();
  await expect(
    page.getByRole("heading", { name: "Your next improvements" }),
  ).toBeVisible();
  const after = await page.request.get("/api/sessions").then((r) => r.json());
  expect(after.length).toBe(before.length);
});
test("connection loss retains the partial transcript for review", async ({
  page,
}) => {
  await fakeVoice(page);
  await start(page);
  await speak(page);
  await page.evaluate(() => {
    (window as any).__channel.readyState = "closed";
    (window as any).__channel.onclose();
  });
  await expect(
    page.getByRole("heading", { name: "Your next improvements" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("connection dropped");
  await expect(page.getByText(/Partial session · This review/)).toBeVisible();
});
test("temporary ICE disconnect recovers the same conversation and timer", async ({
  page,
}) => {
  await fakeVoice(page);
  await page.clock.install();
  await start(page);
  await speak(page);
  expect(
    await page.evaluate(() => (window as any).__rtcConfig.iceServers),
  ).toEqual([{ urls: "stun:stun.cloudflare.com:3478" }]);
  await page.clock.fastForward(5000);
  const before = await page.request.get("/api/sessions").then((r) => r.json());
  await page.evaluate(() => {
    const peer = (window as any).__peer;
    peer.iceConnectionState = "disconnected";
    peer.oniceconnectionstatechange();
  });
  await expect(page.getByRole("status")).toHaveText("Reconnecting");
  await page.evaluate(() => {
    const peer = (window as any).__peer;
    peer.connectionState = "disconnected";
    peer.onconnectionstatechange();
  });
  // The browser may recover after the old 15-second application cutoff.
  await page.clock.fastForward(20000);
  await expect(page.getByRole("status")).toHaveText("Reconnecting");
  await page.evaluate(() => {
    const peer = (window as any).__peer;
    peer.iceConnectionState = "completed";
    peer.oniceconnectionstatechange();
  });
  await expect(page.getByRole("status")).toHaveText("Reconnecting");
  await page.evaluate(() => {
    const peer = (window as any).__peer;
    peer.connectionState = "connected";
    peer.onconnectionstatechange();
  });
  await expect(page.getByRole("status")).toHaveText("Connected");
  await page.clock.fastForward(16000);
  await expect(page.getByRole("status")).toHaveText("Connected");
  await expect(page.locator(".timer")).toContainText("00:41");
  expect(await page.evaluate(() => (window as any).__peerClosed)).toBe(false);
  expect(
    await page.evaluate(
      () =>
        (window as any).__sent.filter(
          (e: any) => e.type === "session.instructions.append",
        ).length,
    ),
  ).toBe(1);
  const after = await page.request.get("/api/sessions").then((r) => r.json());
  expect(after.map((s: any) => s.id)).toEqual(before.map((s: any) => s.id));
  await page
    .getByRole("button", { name: "Review answer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your next improvements" }),
  ).toBeVisible();
});
for (const failure of ["ice", "peer", "channel"] as const) {
  test(`${failure} connection failure saves captured speech and releases the microphone`, async ({
    page,
  }) => {
    await fakeVoice(page);
    await page.clock.install();
    await start(page);
    await speak(page);
    await page.evaluate(() => {
      const peer = (window as any).__peer;
      peer.iceConnectionState = "disconnected";
      peer.oniceconnectionstatechange();
    });
    await expect(page.getByRole("status")).toHaveText("Reconnecting");
    await page.evaluate((failure) => {
      const peer = (window as any).__peer;
      if (failure === "peer") {
        peer.connectionState = "failed";
        peer.onconnectionstatechange();
      } else if (failure === "ice") {
        peer.iceConnectionState = "failed";
        peer.oniceconnectionstatechange();
      } else (window as any).__channel.close();
    }, failure);
    await expect(
      page.getByRole("heading", { name: "Your next improvements" }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("could not recover");
    await expect(page.getByText(/Partial session · This review/)).toBeVisible();
    await page.getByText("Read your transcript").click();
    await expect(page.getByText(answer, { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() =>
        (window as any).__tracks.every(
          (t: MediaStreamTrack) => t.readyState === "ended",
        ),
      ),
    ).toBe(true);
    expect(await page.evaluate(() => (window as any).__peerClosed)).toBe(true);
  });
}
test("session starting during a disconnect starts the timer before recovery", async ({
  page,
}) => {
  await fakeVoice(page, "complete", true);
  await page.clock.install();
  await page.goto("/");
  await page.getByLabel("What role are you preparing for?").fill("Designer");
  await page.getByRole("button", { name: "Start practicing" }).click();
  await expect(page.getByRole("status")).toHaveText("Reconnecting");
  await page.clock.fastForward(5000);
  await expect(page.locator(".timer")).toContainText("00:05");
  await page.evaluate(() => {
    const peer = (window as any).__peer;
    peer.connectionState = "connected";
    peer.onconnectionstatechange();
  });
  await expect(page.getByRole("status")).toHaveText("Reconnecting");
  await page.evaluate(() => {
    const peer = (window as any).__peer;
    peer.iceConnectionState = "connected";
    peer.oniceconnectionstatechange();
  });
  await expect(page.getByRole("status")).toHaveText("Connected");
  await page.clock.fastForward(5000);
  await expect(page.locator(".timer")).toContainText("00:10");
  await page.getByRole("button", { name: "End & review" }).click();
  await expect(
    page.getByRole("heading", { name: "Your next improvements" }),
  ).toBeVisible();
});
test("ending while reconnecting saves immediately without waiting for a channel response", async ({
  page,
}) => {
  await fakeVoice(page);
  await page.clock.install();
  await start(page);
  await speak(page);
  await page.evaluate(() => {
    const peer = (window as any).__peer;
    peer.iceConnectionState = "disconnected";
    peer.oniceconnectionstatechange();
  });
  await expect(page.getByRole("status")).toHaveText("Reconnecting");
  await page.clock.pauseAt(new Date());
  await page
    .getByRole("button", { name: "Review answer", exact: true })
    .click();
  // No clock advance: the old 12-second data-channel wait would hang here.
  await expect(
    page.getByRole("heading", { name: "Your next improvements" }),
  ).toBeVisible();
  await expect(page.getByText(/Partial session · This review/)).toBeVisible();
  await page.getByText("Read your transcript").click();
  await expect(page.getByText(answer, { exact: true })).toBeVisible();
});
for (const gathering of [
  "slow",
  "empty",
  "completed",
  "srflx",
  "late",
] as const) {
  test(`${gathering} ICE gathering handles the deadline without losing available candidates`, async ({
    page,
  }) => {
    await fakeVoice(
      page,
      ["empty", "late"].includes(gathering) ? "empty" : "slow",
    );
    await page.clock.install();
    const offers: string[] = [];
    page.on("request", (request) => {
      if (
        request.url().endsWith("/api/sessions") &&
        request.method() === "POST"
      )
        offers.push(request.postDataJSON().sdp);
    });
    await page.goto("/");
    await page.getByLabel("What role are you preparing for?").fill("Designer");
    await page.getByRole("button", { name: "Start practicing" }).click();
    await expect
      .poll(() =>
        page.evaluate(() => !!(window as any).__peer?.localDescription),
      )
      .toBe(true);
    if (gathering === "empty") {
      await page.clock.fastForward(10000);
    } else if (gathering === "late") {
      await page.clock.fastForward(9000);
      await page.evaluate(() => (window as any).__peer.addCandidate("host"));
      await page.clock.fastForward(1000);
    } else {
      await page.clock.fastForward(100);
      expect(offers).toHaveLength(0);
      if (gathering === "completed") {
        await page.evaluate(() => {
          const peer = (window as any).__peer;
          peer.iceGatheringState = "complete";
          peer.dispatchEvent(new Event("icegatheringstatechange"));
        });
      } else {
        if (gathering === "srflx") {
          await page.clock.fastForward(1000);
          await page.evaluate(() =>
            (window as any).__peer.addCandidate("srflx"),
          );
        }
        await page.clock.fastForward(gathering === "srflx" ? 1000 : 2000);
      }
    }
    if (gathering !== "empty") {
      await expect(page.getByRole("status")).toHaveText("Connected");
      expect(offers).toHaveLength(1);
      expect(offers[0]).toContain("a=candidate:");
      if (gathering === "srflx") expect(offers[0]).toContain("typ srflx");
      // Late gathering events and old timers must not create a second session.
      await page.evaluate(() => {
        const peer = (window as any).__peer;
        peer.addCandidate("srflx");
        peer.iceGatheringState = "complete";
        peer.dispatchEvent(new Event("icegatheringstatechange"));
      });
      await page.clock.fastForward(10000);
      expect(offers).toHaveLength(1);
      await page.getByRole("button", { name: "End & review" }).click();
      await expect(
        page.getByRole("heading", { name: "Your next improvements" }),
      ).toBeVisible();
    } else {
      await expect(page.getByRole("alert")).toContainText(
        "Microphone connection timed out",
      );
      expect(offers).toHaveLength(0);
      expect(await page.evaluate(() => (window as any).__peerClosed)).toBe(
        true,
      );
    }
  });
}
test("coached hard limit ends the voice session even without clicking Review", async ({
  page,
}) => {
  await fakeVoice(page);
  await page.clock.install();
  await start(page);
  await speak(page);
  await page.clock.fastForward(300000);
  await page.clock.fastForward(100);
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
});
test("saving failure can be recovered without losing captured fragments", async ({
  page,
}) => {
  await fakeVoice(page);
  await start(page);
  await speak(page);
  let failing = true;
  await page.route("**/api/sessions/*/events", async (route) => {
    if (failing)
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Simulated disk failure" }),
      });
    else await route.continue();
  });
  await page
    .getByRole("button", { name: "Review answer", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry saving" }),
  ).toBeVisible();
  failing = false;
  await page.getByRole("button", { name: "Retry saving" }).click();
  await expect(
    page.getByRole("heading", { name: "Your next improvements" }),
  ).toBeVisible();
  await page.getByText("Read your transcript").click();
  await expect(page.getByText(answer, { exact: true })).toBeVisible();
});
test("API rejection releases the microphone and returns to setup", async ({
  page,
}) => {
  await fakeVoice(page);
  await page.route("**/api/sessions", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error:
              "OpenAI rejected the API key. Put a valid project key in .env and restart the app.",
          }),
        })
      : route.continue(),
  );
  await page.goto("/");
  await page.getByLabel("What role are you preparing for?").fill("Designer");
  await page.getByRole("button", { name: "Start practicing" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "OpenAI rejected the API key",
  );
  expect(
    await page.evaluate(() =>
      (window as any).__tracks.every(
        (t: MediaStreamTrack) => t.readyState === "ended",
      ),
    ),
  ).toBe(true);
});
