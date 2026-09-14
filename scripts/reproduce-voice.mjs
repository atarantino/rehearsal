// Runs real paid voice attempts with synthetic audio; never prints transcripts or credentials.
import { chromium, firefox } from "playwright";
import fs from "node:fs";
const option = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const origin = option("url");
const audioPath = option("audio");
if (!origin || !audioPath)
  throw new Error(
    "Pass --url=https://YOUR-APP and --audio=/path/to/synthetic.wav",
  );
const duration = Number(option("seconds") ?? 100);
if (!Number.isFinite(duration) || duration < 90 || duration > 240)
  throw new Error("Use --seconds between 90 and 240");
const useStun = process.argv.includes("--stun");
const udpOnly = process.argv.includes("--udp-only");
const maxBundle = process.argv.includes("--max-bundle");
const singleCandidate = process.argv.includes("--single-candidate");
const endCandidates = process.argv.includes("--end-candidates");
const disconnectAt = Number(option("disconnect-convex-at") ?? 0);
if (
  !Number.isFinite(disconnectAt) ||
  disconnectAt < 0 ||
  disconnectAt >= duration
)
  throw new Error(
    "Disconnect time must be zero (disabled) or before the test ends",
  );
const browserChoice = option("browser") ?? "both";
if (!["chromium", "firefox", "both"].includes(browserChoice))
  throw new Error("Use --browser=chromium, firefox, or both");
const output = option("output") ?? "/tmp/rehearsal-voice-reproduction.json";
const frontendBundle = option("frontend-bundle");
const audio = fs.readFileSync(audioPath).toString("base64");
const results = [];
async function instrument(page) {
  await page.addInitScript(
    ({
      audio,
      useStun,
      udpOnly,
      endCandidates,
      maxBundle,
      singleCandidate,
    }) => {
      const start = performance.now();
      const log = (kind, data = {}) =>
        console.log(
          "VOICE_DIAG",
          JSON.stringify({
            t: Math.round(performance.now() - start),
            kind,
            ...data,
          }),
        );
      window.__voiceStats = { events: 0, userEndMs: 0, assistantEndMs: 0 };
      const NativePeer = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends NativePeer {
        constructor(config) {
          if (maxBundle) config = { ...config, bundlePolicy: "max-bundle" };
          super(
            useStun
              ? {
                  ...config,
                  iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
                }
              : config,
          );
          window.__voicePeer = this;
          log("peer-created", {
            iceServers: this.getConfiguration().iceServers?.length ?? 0,
          });
          for (const name of [
            "connectionstatechange",
            "iceconnectionstatechange",
            "icegatheringstatechange",
          ])
            this.addEventListener(name, () =>
              log(name, {
                connection: this.connectionState,
                ice: this.iceConnectionState,
                gathering: this.iceGatheringState,
              }),
            );
          this.addEventListener("icecandidateerror", (e) =>
            log("icecandidateerror", { code: e.errorCode }),
          );
        }
        async setRemoteDescription(description) {
          log("answer-ice", {
            attributes: description.sdp
              ?.split(/\r?\n/)
              .filter((line) =>
                /^a=(ice-lite|ice-options|end-of-candidates|setup|group|mid)(:|$)/.test(
                  line,
                ),
              ),
          });
          if (udpOnly && description.type === "answer" && description.sdp) {
            const lines = description.sdp.split(/\r?\n/);
            if (lines.some((line) => /^a=candidate:\S+ \d+ udp /i.test(line))) {
              description = {
                ...description,
                sdp: lines
                  .filter((line) => !/^a=candidate:\S+ \d+ tcp /i.test(line))
                  .join("\r\n"),
              };
              log("udp-only-answer");
            }
          }
          if (singleCandidate && description.sdp) {
            const sections = description.sdp.split(/(?=^m=)/m);
            description = {
              ...description,
              sdp: sections
                .map((section) => {
                  const lines = section.split(/\r?\n/);
                  const candidate = lines.find((line) =>
                    /^a=candidate:\S+ 1 udp /i.test(line),
                  );
                  if (!candidate) return section;
                  return lines
                    .filter(
                      (line) =>
                        !line.startsWith("a=candidate:") || line === candidate,
                    )
                    .join("\r\n");
                })
                .join(""),
            };
            log("single-candidate-answer");
          }
          await super.setRemoteDescription(description);
          if (endCandidates) {
            await this.addIceCandidate(null);
            log("end-of-candidates");
          }
        }
        createDataChannel(...args) {
          const c = super.createDataChannel(...args);
          c.addEventListener("open", () => log("channel-open"));
          c.addEventListener("close", () => log("channel-close"));
          c.addEventListener("message", (e) => {
            const event = JSON.parse(e.data);
            window.__voiceStats.events++;
            if (event.type === "session.input_transcript.delta")
              window.__voiceStats.userEndMs = event.end_ms;
            if (event.type === "session.output_transcript.delta")
              window.__voiceStats.assistantEndMs = event.end_ms;
            if (
              ["session.started", "session.closed", "error"].includes(
                event.type,
              )
            )
              log(event.type, {
                reason: event.reason,
                code: event.error?.code,
                expiresAt: event.session?.expires_at,
              });
          });
          return c;
        }
      };
      const NativeSocket = window.WebSocket;
      window.WebSocket = class extends NativeSocket {
        constructor(...args) {
          super(...args);
          const host = new URL(args[0]).hostname;
          this.addEventListener("open", () => log("websocket-open", { host }));
          this.addEventListener("close", (e) =>
            log("websocket-close", { host, code: e.code, reason: e.reason }),
          );
        }
      };
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => {
          const ctx = new AudioContext();
          await ctx.resume();
          const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
          const buffer = await ctx.decodeAudioData(bytes.buffer);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.loop = true;
          const dest = ctx.createMediaStreamDestination();
          source.connect(dest);
          source.start();
          window.__syntheticAudio = { ctx, source };
          return dest.stream;
        },
      });
    },
    { audio, useStun, udpOnly, endCandidates, maxBundle, singleCandidate },
  );
}
async function sample(page) {
  return page.evaluate(async () => {
    const p = window.__voicePeer;
    const data = {
      ...window.__voiceStats,
      connection: p?.connectionState,
      ice: p?.iceConnectionState,
      iceRole: p?.getSenders()[0]?.transport?.iceTransport?.role,
    };
    if (p) {
      const stats = await p.getStats();
      stats.forEach((r) => {
        if (r.type === "outbound-rtp" && r.kind === "audio")
          data.outbound = { packets: r.packetsSent, bytes: r.bytesSent };
        if (r.type === "inbound-rtp" && r.kind === "audio")
          data.inbound = { packets: r.packetsReceived, lost: r.packetsLost };
        if (
          r.type === "candidate-pair" &&
          r.state === "succeeded" &&
          r.nominated
        ) {
          const local = stats.get(r.localCandidateId);
          const remote = stats.get(r.remoteCandidateId);
          data.pair = {
            local: local?.candidateType,
            remote: remote?.candidateType,
            protocol: local?.protocol,
            rtt: r.currentRoundTripTime,
            requestsSent: r.requestsSent,
            responsesReceived: r.responsesReceived,
            consentRequestsSent: r.consentRequestsSent,
          };
        }
      });
    }
    return data;
  });
}
let state;
for (const name of ["chromium", "firefox"]) {
  if (name === "firefox" && browserChoice === "chromium") continue;
  const browser = await (name === "chromium" ? chromium : firefox).launch({
    headless: true,
    ...(name === "chromium"
      ? { args: ["--autoplay-policy=no-user-gesture-required"] }
      : {
          firefoxUserPrefs: {
            "media.autoplay.default": 0,
            "media.autoplay.block-webaudio": false,
          },
        }),
  });
  const context = await browser.newContext({
    storageState: state,
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  if (frontendBundle)
    await page.route("**/assets/index-*.js", (route) =>
      route.fulfill({
        path: frontendBundle,
        contentType: "application/javascript",
      }),
    );
  const events = [];
  let disconnectSocket;
  if (disconnectAt)
    await page.routeWebSocket(/wss:\/\/[^/]+\.convex\.cloud\//, (ws) => {
      ws.connectToServer();
      if (!disconnectSocket)
        disconnectSocket = () =>
          ws.close({ code: 1011, reason: "InternalServerError" });
    });
  page.on("console", (m) => {
    if (m.text().startsWith("VOICE_DIAG")) {
      const e = JSON.parse(m.text().slice(11));
      events.push(e);
      console.log(name, JSON.stringify(e));
    } else if (/WebSocket (reconnected|closed)/.test(m.text()))
      console.log(name, m.text());
  });
  page.on("pageerror", (e) => console.log(name, "pageerror", e.name));
  try {
    await instrument(page);
    await page.goto(origin);
    if (!state) {
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
      await page.getByLabel("Choose a username").fill("voicediag" + Date.now());
      await page
        .getByRole("button", { name: "Continue with a passkey" })
        .click();
    }
    await page.getByLabel("Job posting URL").waitFor({ timeout: 30000 });
    // Bootstrap a portable test login in Chromium, which supports the virtual
    // passkey authenticator. Firefox then uses that test account's browser state.
    if (name === "chromium" && browserChoice === "firefox") {
      state = await context.storageState();
      continue;
    }
    await page
      .getByLabel("What role are you preparing for?")
      .fill("Product designer");
    await page
      .getByRole("button", { name: "Start practicing", exact: true })
      .click();
    await page
      .getByText("Connected", { exact: true })
      .waitFor({ timeout: 45000 });
    console.log(name, "CONNECTED", new Date().toISOString());
    let injected = false;
    const snapshots = [];
    for (let elapsed = 5; elapsed <= duration; elapsed += 5) {
      await page.waitForTimeout(5000);
      const s = { elapsed, ...(await sample(page)) };
      snapshots.push(s);
      if (disconnectAt && elapsed >= disconnectAt && !injected) {
        injected = true;
        if (!disconnectSocket)
          throw new Error("Convex WebSocket was not intercepted");
        disconnectSocket();
        console.log(name, "INJECTED_CONVEX_DISCONNECT");
      }
      console.log(name, "SAMPLE", JSON.stringify(s));
      if (s.connection === "closed") break;
    }
    if (
      await page
        .getByRole("button", { name: "Review answer", exact: true })
        .isVisible()
    )
      await page
        .getByRole("button", { name: "Review answer", exact: true })
        .click();
    await page
      .getByRole("heading", { name: "Your next improvements" })
      .waitFor({ timeout: 60000 })
      .catch(() => {});
    state = await context.storageState();
    const survived =
      snapshots.at(-1)?.elapsed >= duration &&
      snapshots.at(-1)?.connection === "connected";
    results.push({ browser: name, survived, events, snapshots });
    if (!survived) process.exitCode = 1;
  } catch (e) {
    console.log(name, "FAILED", e.message);
    results.push({ browser: name, error: e.message, events });
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
    fs.writeFileSync(output, JSON.stringify(results, null, 2));
  }
}
