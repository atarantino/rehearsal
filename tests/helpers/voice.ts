import type { Page } from "@playwright/test";
import { answer } from "../fixtures";
export async function fakeVoice(
  page: Page,
  gathering: "complete" | "slow" | "empty" = "complete",
  startDisconnected = false,
) {
  await page.addInitScript(
    ({ gathering, startDisconnected }) => {
      const w = window as any;
      // tsx preserves nested function names with this helper when this fixture is
      // serialized by agent:browser; Playwright's test compiler does not need it.
      w.__name ??= Object;
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
          if (
            e.type === "session.close" &&
            w.__peer.iceConnectionState !== "disconnected"
          )
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
      class Peer extends EventTarget {
        iceGatheringState = gathering === "complete" ? "complete" : "gathering";
        iceConnectionState = "connected";
        connectionState = "connected";
        localDescription: any;
        ontrack: any;
        onconnectionstatechange: any;
        oniceconnectionstatechange: any;
        constructor(config: RTCConfiguration) {
          super();
          w.__peer = this;
          w.__rtcConfig = config;
        }
        addTrack() {}
        createDataChannel() {
          w.__channel = new Channel();
          return w.__channel;
        }
        async createOffer() {
          return {
            type: "offer",
            sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
          };
        }
        async setLocalDescription(d: any) {
          this.localDescription = d;
          if (gathering === "slow")
            setTimeout(() => this.addCandidate("host"), 100);
        }
        addCandidate(type: "host" | "srflx") {
          this.localDescription.sdp += `a=candidate:1 1 UDP 2130706431 192.0.2.1 5000 typ ${type}\r\n`;
          this.dispatchEvent(new Event("icecandidate"));
        }
        async setRemoteDescription() {
          setTimeout(() => {
            if (startDisconnected) {
              this.iceConnectionState = "disconnected";
              this.connectionState = "disconnected";
              this.oniceconnectionstatechange?.();
              this.onconnectionstatechange?.();
            }
            w.__channel.emit({
              type: "session.started",
              session: { id: "fixture" },
            });
          }, 10);
        }
        close() {
          w.__peerClosed = true;
        }
      }
      w.RTCPeerConnection = Peer;
    },
    { gathering, startDisconnected },
  );
}
export async function speak(page: Page) {
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
