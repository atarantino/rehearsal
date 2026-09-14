import { test, expect, type Page } from "@playwright/test";
import { answer } from "./fixtures";
async function fakeVoice(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__stopped = false;
    w.__peerClosed = false;
    w.__sent = [];
    const context = new AudioContext();
    const stream = context.createMediaStreamDestination().stream;
    w.__tracks = stream.getTracks();
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => stream,
      configurable: true,
    });
    class Channel {
      readyState = "open";
      onmessage: any;
      onclose: any;
      send(raw: string) {
        const e = JSON.parse(raw);
        w.__sent.push(e);
        if (e.type === "session.close")
          setTimeout(
            () =>
              this.emit({
                type: "session.closed",
                reason: "close_requested",
                usage: { seconds: 42 },
              }),
            10,
          );
        if (
          e.type === "session.input_audio.mute" ||
          e.type === "session.input_audio.unmute"
        )
          setTimeout(
            () =>
              this.emit({
                type:
                  e.type === "session.input_audio.mute"
                    ? "session.input_audio.muted"
                    : "session.input_audio.unmuted",
                client_event_id: e.event_id,
              }),
            1,
          );
      }
      emit(e: any) {
        this.onmessage?.({ data: JSON.stringify(e) });
      }
      close() {
        this.readyState = "closed";
        this.onclose?.();
      }
    }
    class Peer {
      iceGatheringState = "complete";
      connectionState = "connected";
      localDescription: any;
      ontrack: any;
      onconnectionstatechange: any;
      addTrack() {}
      createDataChannel() {
        w.__channel = new Channel();
        return w.__channel;
      }
      async createOffer() {
        return { type: "offer", sdp: "fixture-offer" };
      }
      async setLocalDescription(d: any) {
        this.localDescription = d;
      }
      async setRemoteDescription() {
        setTimeout(
          () =>
            w.__channel.emit({
              type: "session.started",
              session: { id: "fixture" },
            }),
          10,
        );
      }
      close() {
        w.__peerClosed = true;
      }
      addEventListener() {}
      removeEventListener() {}
    }
    w.RTCPeerConnection = Peer;
  });
}
async function speak(page: Page) {
  await page.evaluate((text) => {
    (window as any).__channel.emit({
      type: "session.output_transcript.delta",
      event_id: "q1",
      delta: "Tell me about a difficult project.",
      start_ms: 0,
      end_ms: 800,
    });
    (window as any).__channel.emit({
      type: "session.input_transcript.delta",
      event_id: "u1",
      delta: text,
      start_ms: 700,
      end_ms: 1900,
    });
    (window as any).__channel.emit({
      type: "session.input_transcript.delta",
      event_id: "u1",
      delta: text,
      start_ms: 700,
      end_ms: 1900,
    });
  }, answer);
}
async function start(page: Page, mode: "mock" | "coached" = "coached") {
  await page.goto("/");
  if (mode === "mock")
    await page.getByRole("button", { name: /Mock interview A real conversation/ }).click();
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

test("setup is usable at desktop and mobile widths", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Find the words/ }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/setup-desktop.png",
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
    path: "test-results/setup-mobile.png",
    fullPage: true,
  });
});
test("coached flow, mute, captions, review, retry comparison, history and deletion", async ({
  page,
}) => {
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
    path: "test-results/review-desktop.png",
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
