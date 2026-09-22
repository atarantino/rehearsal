import { api } from "./api";
import { coachedOpening, mockOpening, mockClockCue } from "../shared/interview";
import {
  createVoiceMeter,
  voiceBarCount,
  type VoiceLevels,
} from "./voiceMeter";
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
  level: (levels: VoiceLevels) => void;
  speaker: (speaker: "user" | "assistant" | null) => void;
  error: (s: string) => void;
  ended: (s: PracticeSession, quit: boolean) => void;
  cancelled: () => void;
  record: (s: PracticeSession) => void;
};
export class LiveSession {
  private peer?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private mic?: MediaStream;
  private audio = new Audio();
  private context?: AudioContext;
  private animation = 0;
  private micMeter?: ReturnType<typeof createVoiceMeter>;
  private remoteMeter?: ReturnType<typeof createVoiceMeter>;
  private timer?: ReturnType<typeof setTimeout>;
  private setupTimer?: ReturnType<typeof setTimeout>;
  private saveTimer?: ReturnType<typeof setInterval>;
  private agendaTimer?: ReturnType<typeof setInterval>;
  private startedAt = 0;
  private lastClockCue = -1;
  private muted = false;
  private record?: PracticeSession;
  private fragments: Fragment[] = [];
  private pending: Fragment[] = [];
  private saving: Promise<void> = Promise.resolve();
  private finalEvent?: any;
  private finalWait?: () => void;
  private ending?: Promise<void>;
  private disposed = false;
  private quitting = false;
  private creating = false;
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
    if (this.channel?.readyState === "open") {
      this.channel.send(JSON.stringify(event));
      return true;
    }
    return false;
  }
  private updateAgenda() {
    if (
      this.record?.config.mode !== "mock" ||
      !this.started ||
      this.disposed ||
      this.ending ||
      this.quitting ||
      this.interrupted ||
      this.muted
    )
      return;
    const cue = mockClockCue(
      (Date.now() - this.startedAt) / 1000,
      this.lastClockCue,
    );
    if (
      cue &&
      this.send({
        type: "session.thinking.append",
        event_id: crypto.randomUUID(),
        delegation_id: null,
        content: cue.content,
      })
    )
      this.lastClockCue = cue.index;
  }
  async start(config: SessionConfig) {
    this.h.state("Connecting");
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Open this app over HTTPS in Chrome to use your microphone.",
        );
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (this.disposed) {
        mic.getTracks().forEach((track) => track.stop());
        return;
      }
      this.mic = mic;
      this.context = new AudioContext();
      await this.context.resume();
      if (this.disposed) return;
      this.micMeter = createVoiceMeter(this.context, this.mic);
      let measuredAt = 0;
      let speaker: "user" | "assistant" | null = null;
      let lastSpeechAt = 0;
      const silence = { level: 0, bands: Array<number>(voiceBarCount).fill(0) };
      const measure = (now: number) => {
        if (this.disposed) return;
        const elapsedMs = now - measuredAt;
        if (elapsedMs >= 32) {
          measuredAt = now;
          const user = this.micMeter!.read(
            this.context?.state === "running" &&
              !!this.mic
                ?.getAudioTracks()
                .some(
                  (track) =>
                    track.enabled &&
                    !track.muted &&
                    track.readyState === "live",
                ),
            elapsedMs,
          );
          const assistant =
            this.remoteMeter?.read(
              this.context?.state === "running" &&
                !this.audio.paused &&
                !this.audio.muted &&
                this.audio.volume > 0,
              elapsedMs,
            ) ?? silence;
          const levels = {
            user: user.level,
            assistant: assistant.level,
            bands: user.bands.map((value, i) =>
              Math.max(value, assistant.bands[i]),
            ),
          };
          this.h.level(levels);
          let next =
            levels.assistant > 0.06
              ? ("assistant" as const)
              : levels.user > 0.06
                ? ("user" as const)
                : null;
          if (next) lastSpeechAt = now;
          else if (speaker && levels[speaker] > 0 && now - lastSpeechAt < 300)
            next = speaker;
          if (next !== speaker) {
            speaker = next;
            this.h.speaker(speaker);
          }
        }
        this.animation = requestAnimationFrame(measure);
      };
      this.animation = requestAnimationFrame(measure);
      const peer = (this.peer = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
      }));
      peer.ontrack = (e) => {
        if (this.disposed || e.track.kind !== "audio") return;
        const stream = new MediaStream([e.track]);
        this.audio.srcObject = stream;
        this.remoteMeter?.disconnect();
        // Observe only: the audio element remains the sole playback path.
        this.remoteMeter = createVoiceMeter(this.context!, stream);
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
      const offer = await peer.createOffer();
      if (this.disposed) return;
      await peer.setLocalDescription(offer);
      if (this.disposed) return;
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
      if (this.disposed) return;
      this.creating = true;
      const result = await api<{ record: PracticeSession; sdp: string }>(
        "/sessions",
        { config, sdp: peer.localDescription!.sdp },
      );
      this.creating = false;
      this.record = result.record;
      if (this.quitting) {
        await this.end("quit_requested");
        return;
      }
      if (this.disposed) {
        await api(`/sessions/${this.record.id}/close`, {});
        return;
      }
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
      if (this.disposed) return;
      this.timer = setTimeout(
        () => {
          this.h.error("This practice session reached its time limit.");
          void this.end();
        },
        maxSeconds(config.mode) * 1000,
      );
    } catch (e) {
      if (this.quitting) {
        if (this.creating) {
          this.creating = false;
          this.h.cancelled();
        }
        return;
      }
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
    if (this.disposed) return;
    if (e.type === "session.started") {
      if (this.started || this.ending || this.quitting) return;
      this.started = true;
      this.startedAt = Date.now();
      clearTimeout(this.setupTimer);
      this.h.state("Connected");
      this.send({
        type: "session.instructions.append",
        event_id: crypto.randomUUID(),
        delegation_id: null,
        content:
          this.record?.config.mode === "mock" ? mockOpening : coachedOpening,
      });
      if (this.record?.config.mode === "mock")
        this.agendaTimer = setInterval(() => this.updateAgenda(), 1000);
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
    this.muted = muted;
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
      this.muted = !muted;
      this.mic?.getAudioTracks().forEach((t) => (t.enabled = muted));
      throw e;
    }
  }
  async enableSound() {
    await this.context?.resume();
    await this.audio.play();
  }
  quit() {
    if (this.ending || this.quitting) return;
    this.quitting = true;
    this.send({ type: "session.close", event_id: crypto.randomUUID() });
    // Release the microphone and playback immediately, even if saving is slow.
    this.cleanup();
    if (this.record) void this.end("quit_requested");
    else if (this.creating) this.h.state("Finishing");
    else this.h.cancelled();
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
    clearInterval(this.agendaTimer);
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
      this.h.ended(record, this.quitting);
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
    this.h.ended(s, this.quitting);
  }
  cleanup() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    clearTimeout(this.setupTimer);
    clearInterval(this.saveTimer);
    clearInterval(this.agendaTimer);
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
    this.micMeter?.disconnect();
    this.remoteMeter?.disconnect();
    void this.context?.close().catch(() => {});
    this.h.level({
      user: 0,
      assistant: 0,
      bands: Array(voiceBarCount).fill(0),
    });
    this.h.speaker(null);
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
