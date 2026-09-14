import type { Page } from "@playwright/test";
import { answer } from "../fixtures";
export async function fakeVoice(page: Page) {
  await page.addInitScript(() => {
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
        return {
          type: "offer",
          sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
        };
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
