import { z } from "zod";
import WebSocket from "ws";
import {
  feedbackGenerationSchema,
  speakerText,
  type Feedback,
  type PracticeSession,
} from "../shared/types.js";
import { feedbackInstructions, feedbackInput, liveConfig } from "./prompts.js";
export class AppError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
  }
}
export function apiError(status: number) {
  if (status === 401)
    return new AppError(
      "OpenAI rejected the API key. Put a valid project key in .env and restart the app.",
      503,
    );
  if (status === 403 || status === 404)
    return new AppError(
      "This OpenAI project cannot access the requested model. Check access to gpt-live-1 and gpt-5.6-terra; no replacement model was used.",
      503,
    );
  if (status === 429)
    return new AppError(
      "OpenAI usage or concurrency limit reached. Check project billing and limits, then retry.",
      429,
    );
  return new AppError(
    `OpenAI could not complete the request (HTTP ${status}). Retry; if it persists, run npm run check:live.`,
    502,
  );
}
export type WireEvent = Record<string, any>;
export interface Provider {
  readonly reasoningBackend?: "api" | "codex";
  checkReasoning?(): Promise<void>;
  followup?(s: PracticeSession, signal: AbortSignal): Promise<string>;
  ready(): boolean;
  create(
    s: PracticeSession,
    sdp: string,
    previous?: PracticeSession,
  ): Promise<{ liveId: string; sdp: string }>;
  attach(
    id: string,
    onEvent: (e: WireEvent) => void,
    onError: () => void,
  ): { send: (e: WireEvent) => void; close: () => void };
  feedback(s: PracticeSession, previous?: PracticeSession): Promise<Feedback>;
}
export { validateFeedback } from "../shared/feedback.js";
import { validateFeedback } from "../shared/feedback.js";
export class OpenAIProvider implements Provider {
  constructor(private key = process.env.OPENAI_API_KEY || "") {}
  ready() {
    return !!this.key;
  }
  private async request(path: string, body: unknown) {
    if (!this.key)
      throw new AppError(
        "Add OPENAI_API_KEY to .env in the app folder, then restart the app.",
        503,
      );
    let r: Response;
    try {
      r = await fetch(`https://api.openai.com/v1${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.key}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(path === "/responses" ? 90000 : 30000),
      });
    } catch {
      throw new AppError(
        "OpenAI connection timed out or failed. Check your network and retry.",
        502,
      );
    }
    if (!r.ok) throw apiError(r.status);
    return r.json();
  }
  protected sessionConfig(
    s: PracticeSession,
    previous?: PracticeSession,
  ): object {
    return liveConfig(s, previous);
  }
  async create(s: PracticeSession, sdp: string, previous?: PracticeSession) {
    const data = await this.request("/live/sessions", {
      session: this.sessionConfig(s, previous),
      transport: { type: "webrtc", sdp },
    });
    if (!data?.session?.id || !data?.transport?.sdp)
      throw new AppError(
        "OpenAI returned an incomplete voice connection. Retry.",
        502,
      );
    return { liveId: data.session.id, sdp: data.transport.sdp };
  }
  attach(id: string, onEvent: (e: WireEvent) => void, onError: () => void) {
    const ws = new WebSocket(
      `wss://api.openai.com/v1/live/sessions/${encodeURIComponent(id)}/attach`,
      {
        headers: { Authorization: `Bearer ${this.key}` },
        handshakeTimeout: 15000,
      },
    );
    let closed = false;
    const pending: WireEvent[] = [];
    ws.on("open", () =>
      pending.splice(0).forEach((e) => ws.send(JSON.stringify(e))),
    );
    ws.on("message", (data) => {
      try {
        const e = JSON.parse(data.toString());
        if (
          e.type?.includes("transcript") ||
          [
            "session.started",
            "session.closed",
            "session.usage.updated",
            "response.event",
            "session.delegation.created",
            "error",
          ].includes(e.type)
        )
          onEvent(e);
      } catch {}
    });
    ws.on("error", () => {
      if (!closed) onError();
    });
    ws.on("close", () => {
      if (!closed) onError();
    });
    return {
      send(e: WireEvent) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e));
        else if (ws.readyState === WebSocket.CONNECTING) pending.push(e);
        else onError();
      },
      close() {
        closed = true;
        ws.close();
      },
    };
  }
  async feedback(s: PracticeSession, previous?: PracticeSession) {
    const input = feedbackInput(s, previous);
    const schema = z.toJSONSchema(feedbackGenerationSchema);
    delete schema.$schema;
    const data = await this.request("/responses", {
      model: "gpt-5.6-terra",
      store: false,
      instructions: feedbackInstructions,
      input: JSON.stringify(input),
      reasoning: { effort: "low" },
      text: {
        format: {
          type: "json_schema",
          name: "interview_feedback",
          strict: true,
          schema,
        },
      },
      max_output_tokens: 5000,
    });
    if (data.status !== "completed")
      throw new AppError(
        "The feedback did not finish. Your transcript is saved; retry feedback.",
        502,
      );
    const text = (data.output || [])
      .flatMap((i: any) => i.content || [])
      .filter((c: any) => c.type === "output_text")
      .map((c: any) => c.text)
      .join("");
    try {
      const result = validateFeedback(JSON.parse(text), s);
      if (!previous) result.comparison = null;
      return result;
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(
        "The feedback response could not be read. Your transcript is saved; retry feedback.",
        502,
      );
    }
  }
}
