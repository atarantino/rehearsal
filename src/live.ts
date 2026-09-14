import { api } from "./api";
import {
  fragmentSchema,
  mergeFragments,
  maxSeconds,
  type Fragment,
  type PracticeSession,
  type SessionConfig,
} from "../shared/types";
type Handlers = {
  state: (s: string) => void;
  fragments: (f: Fragment[]) => void;
  level: (n: number) => void;
  error: (s: string) => void;
  ended: (s: PracticeSession) => void;
  record: (s: PracticeSession) => void;
};
export class LiveSession {
  private peer?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private mic?: MediaStream;
  private audio = new Audio();
  private context?: AudioContext;
  private animation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private setupTimer?: ReturnType<typeof setTimeout>;
  private saveTimer?: ReturnType<typeof setInterval>;
  private record?: PracticeSession;
  private fragments: Fragment[] = [];
  private pending: Fragment[] = [];
  private saving: Promise<void> = Promise.resolve();
  private finalEvent?: any;
  private finalWait?: () => void;
  private ending?: Promise<void>;
  private disposed = false;
  private started = false;
  private interrupted = false;
  private disconnectTimer?: ReturnType<typeof setTimeout>;
  private endReason = "close_requested";
  private muteAck?: {
    id: string;
    resolve: () => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  constructor(private h: Handlers) {
    this.audio.autoplay = true;
  }
  private send(event: object) {
    if (this.channel?.readyState === "open")
      this.channel.send(JSON.stringify(event));
  }
  async start(config: SessionConfig) {
    this.h.state("Connecting");
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Open this app over HTTPS in Chrome to use your microphone.",
        );
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      this.context = new AudioContext();
      await this.context.resume();
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 256;
      this.context.createMediaStreamSource(this.mic).connect(analyser);
      const values = new Uint8Array(analyser.frequencyBinCount);
      const measure = () => {
        analyser.getByteTimeDomainData(values);
        const rms =
          Math.sqrt(
            values.reduce((sum, v) => sum + (v - 128) ** 2, 0) / values.length,
          ) / 128;
        this.h.level(Math.min(1, rms * 7));
        this.animation = requestAnimationFrame(measure);
      };
      measure();
      const peer = (this.peer = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
      }));
      peer.ontrack = (e) => {
        this.audio.srcObject = new MediaStream([e.track]);
        this.audio
          .play()
          .catch(() =>
            this.h.error(
              "Audio playback was blocked. Click Enable sound to hear the interviewer.",
            ),
          );
      };
      this.mic.getAudioTracks().forEach((t) => peer.addTrack(t, this.mic!));
      const channel = (this.channel = peer.createDataChannel("oai-events"));
      channel.onmessage = (e) => {
        try {
          this.event(JSON.parse(e.data));
        } catch {
          this.h.error(
            "A voice event could not be read. You can end and review the saved transcript.",
          );
        }
      };
      channel.onclose = () => {
        if (!this.disposed && !this.ending && this.record) {
          this.h.error(
            "The voice connection dropped. Your available transcript has been kept.",
          );
          void this.end("connection_lost");
        }
      };
      peer.onconnectionstatechange = () => {
        this.connectionChanged();
      };
      peer.oniceconnectionstatechange = () => this.connectionChanged();
      await peer.setLocalDescription(await peer.createOffer());
      if (peer.iceGatheringState !== "complete")
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            peer.removeEventListener("icegatheringstatechange", onState);
            // STUN may be blocked even when direct connectivity to the voice
            // service works. Offer the candidates already gathered in that case.
            if (peer.localDescription?.sdp.includes("a=candidate:")) {
              resolve();
              return;
            }
            reject(
              new Error(
                "Microphone connection timed out. Check your network and retry.",
              ),
            );
          }, 10000);
          function onState() {
            if (peer.iceGatheringState === "complete") {
              clearTimeout(timeout);
              peer.removeEventListener("icegatheringstatechange", onState);
              resolve();
            }
          }
          peer.addEventListener("icegatheringstatechange", onState);
          onState();
        });
      const result = await api<{ record: PracticeSession; sdp: string }>(
        "/sessions",
        { config, sdp: peer.localDescription!.sdp },
      );
      this.record = result.record;
      this.h.record(result.record);
      this.saveTimer = setInterval(() => {
        void this.flush().catch(() =>
          this.h.error(
            "Transcript saving is interrupted. Keep this tab open and retry saving before leaving.",
          ),
        );
      }, 1200);
      this.setupTimer = setTimeout(() => {
        if (!this.started) {
          this.h.error(
            "The voice session did not start. Check model access and your connection.",
          );
          void this.end("startup_timeout");
        }
      }, 20000);
      await peer.setRemoteDescription({
        type: "answer",
        sdp: result.sdp,
      });
      this.timer = setTimeout(
        () => {
          this.h.error("This practice session reached its time limit.");
          void this.end();
        },
        maxSeconds(config.mode) * 1000,
      );
    } catch (e) {
      this.cleanup();
      if (this.record)
        await api(`/sessions/${this.record.id}/close`, {}).catch(() => {});
      throw new Error(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access in Chrome’s site settings, then try again."
          : e instanceof DOMException && e.name === "NotFoundError"
            ? "No microphone was found. Connect a microphone and try again."
            : e instanceof Error
              ? e.message
              : "The voice connection could not start.",
      );
    }
  }
  private connectionChanged() {
    const peer = this.peer;
    if (!peer || this.disposed || this.ending) return;
    console.info("Voice connection state", {
      at: new Date().toISOString(),
      sessionId: this.record?.id,
      connection: peer.connectionState,
      ice: peer.iceConnectionState,
      channel: this.channel?.readyState,
      lastTranscriptMs: this.fragments.at(-1)?.end_ms ?? 0,
    });
    if (
      peer.connectionState === "failed" ||
      peer.iceConnectionState === "failed"
    ) {
      this.connectionLost();
    } else if (
      peer.connectionState === "disconnected" ||
      peer.iceConnectionState === "disconnected"
    ) {
      if (this.interrupted) return;
      this.interrupted = true;
      this.h.state("Connection interrupted — pause speaking");
      void this.flush().catch(() => {});
      // A disconnected ICE transport may recover on its own. Do not close it
      // immediately, or claim to be recording speech while it cannot deliver it.
      this.disconnectTimer = setTimeout(() => this.connectionLost(), 15000);
    } else if (
      peer.connectionState === "connected" &&
      ["connected", "completed"].includes(peer.iceConnectionState)
    ) {
      clearTimeout(this.disconnectTimer);
      if (this.interrupted && this.started) this.h.state("Connected");
      this.interrupted = false;
    }
  }
  private connectionLost() {
    if (this.disposed || this.ending) return;
    this.h.error(
      "The voice connection dropped. Your received transcript has been kept, but speech during the interruption may be missing.",
    );
    void this.end("connection_lost");
  }
  private event(e: any) {
    if (e.type === "session.started") {
      this.started = true;
      clearTimeout(this.setupTimer);
      this.h.state("Connected");
      this.send({
        type: "session.instructions.append",
        event_id: crypto.randomUUID(),
        delegation_id: null,
        content:
          "Begin now: briefly welcome the candidate, then ask the starting question from the reference data. Ask it as one clear question and wait for their answer. Do not read setup or earlier feedback aloud.",
      });
    } else if (
      e.type === "session.input_transcript.delta" ||
      e.type === "session.output_transcript.delta"
    ) {
      const f = fragmentSchema.safeParse({
        ...e,
        speaker:
          e.type === "session.input_transcript.delta" ? "user" : "assistant",
      });
      if (f.success) {
        const next = mergeFragments(this.fragments, [f.data]);
        if (next.length !== this.fragments.length) {
          this.fragments = next;
          this.pending.push(f.data);
          this.h.fragments(next);
        }
      }
    } else if (e.type === "session.closed") {
      this.finalEvent = e;
      this.finalWait?.();
      if (!this.ending) void this.end(e.reason || "close_requested");
    } else if (
      e.type === "session.input_audio.muted" ||
      e.type === "session.input_audio.unmuted"
    ) {
      if (this.muteAck && this.muteAck.id === e.client_event_id) {
        clearTimeout(this.muteAck.timer);
        this.muteAck.resolve();
        this.muteAck = undefined;
      }
    } else if (e.type === "error") {
      if (this.muteAck && this.muteAck.id === e.client_event_id) {
        clearTimeout(this.muteAck.timer);
        this.muteAck.reject(
          new Error("The microphone change was not accepted. Try again."),
        );
        this.muteAck = undefined;
      }
      this.h.error(
        "The voice service reported an error. You can end and review what was saved.",
      );
    }
  }
  async flush() {
    const id = this.record?.id;
    this.saving = this.saving
      .catch(() => {})
      .then(async () => {
        while (id && this.pending.length) {
          const batch = this.pending.splice(0, 250);
          try {
            await api(`/sessions/${id}/events`, { fragments: batch });
          } catch (e) {
            this.pending.unshift(...batch);
            throw e;
          }
        }
      });
    return this.saving;
  }
  async mute(muted: boolean) {
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    const id = crypto.randomUUID();
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.muteAck = undefined;
          reject(new Error("Microphone change timed out. Try again."));
        }, 5000);
        this.muteAck = { id, resolve, reject, timer };
        this.send({
          type: muted
            ? "session.input_audio.mute"
            : "session.input_audio.unmute",
          event_id: id,
        });
      });
    } catch (e) {
      this.mic?.getAudioTracks().forEach((t) => (t.enabled = muted));
      throw e;
    }
  }
  enableSound() {
    return this.audio.play();
  }
  end(reason = "close_requested"): Promise<void> {
    if (this.ending) return this.ending;
    this.endReason = reason;
    this.ending = this.finish(reason);
    return this.ending;
  }
  private async finish(reason: string) {
    this.h.state("Finishing");
    clearTimeout(this.timer);
    clearTimeout(this.setupTimer);
    clearInterval(this.saveTimer);
    clearTimeout(this.disconnectTimer);
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = false));
    this.audio.muted = true;
    // An ICE failure can leave readyState="open" on a dead data channel.
    if (
      reason !== "connection_lost" &&
      !this.finalEvent &&
      this.channel?.readyState === "open"
    )
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 12000);
        this.finalWait = () => {
          clearTimeout(timeout);
          resolve();
        };
        this.send({ type: "session.close", event_id: crypto.randomUUID() });
      });
    try {
      if (!this.record) return;
      let record: PracticeSession | undefined;
      // Save in parallel with provider cleanup, so a slow hangup cannot hold
      // the pending transcript hostage. flush retains failed batches for retry.
      const saved = this.flush();
      void saved.catch(() => {});
      if (!this.finalEvent)
        record = await api<PracticeSession>(
          `/sessions/${this.record.id}/close`,
          {},
        ).catch(() => undefined);
      this.cleanup();
      await saved;
      await this.flush();
      record = await api<PracticeSession>(
        `/sessions/${this.record.id}/finalize`,
        {
          confirmed: !!this.finalEvent,
          reason: !["close_requested", "expired"].includes(reason)
            ? reason
            : this.finalEvent?.reason || "finalization_timeout",
          seconds: this.finalEvent?.usage?.seconds,
        },
      );
      this.h.ended(record);
    } catch {
      this.cleanup();
      this.h.error(
        "Your interview ended, but saving did not finish. Keep this tab open and click Retry saving.",
      );
      this.h.state("Save interrupted");
    } finally {
      this.cleanup();
    }
  }
  async retrySave() {
    if (!this.record) return;
    await this.flush();
    const s = await api<PracticeSession>(
      `/sessions/${this.record.id}/finalize`,
      {
        confirmed: !!this.finalEvent,
        reason:
          this.endReason !== "close_requested"
            ? this.endReason
            : this.finalEvent?.reason || "finalization_timeout",
        seconds: this.finalEvent?.usage?.seconds,
      },
    );
    this.h.ended(s);
  }
  cleanup() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    clearTimeout(this.setupTimer);
    clearInterval(this.saveTimer);
    clearTimeout(this.disconnectTimer);
    cancelAnimationFrame(this.animation);
    if (this.muteAck) {
      clearTimeout(this.muteAck.timer);
      this.muteAck.reject(new Error("The session ended."));
      this.muteAck = undefined;
    }
    this.mic?.getTracks().forEach((t) => t.stop());
    this.audio.pause();
    this.audio.srcObject = null;
    this.channel?.close();
    this.peer?.close();
    void this.context?.close().catch(() => {});
    this.h.level(0);
  }
  abandon() {
    if (this.record) {
      const id = this.record.id;
      this.send({ type: "session.close", event_id: crypto.randomUUID() });
      void this.flush().catch(() => {});
      void api(`/sessions/${id}/close`, {}).catch(() => {});
    }
    this.cleanup();
  }
}
