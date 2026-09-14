import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  configSchema,
  fragmentSchema,
  mergeFragments,
  maxSeconds,
  questionFor,
  speakerText,
  type PracticeSession,
} from "../shared/types.js";
import { SessionStore } from "./store.js";
import { AppError, type Provider, type WireEvent } from "./provider.js";

type LiveHandle = {
  id: string;
  control?: ReturnType<Provider["attach"]>;
  timer?: NodeJS.Timeout;
  closing?: Promise<PracticeSession>;
  resolveClose?: (s: PracticeSession) => void;
  rejectClose?: (e: Error) => void;
  finalTimer?: NodeJS.Timeout;
  delegations: Map<string, AbortController>;
  seenDelegations: Set<string>;
};
export function createApp(
  store: SessionStore,
  provider: Provider,
  port: number,
) {
  const app = express();
  let active: LiveHandle | undefined;
  const feedbackJobs = new Map<string, Promise<PracticeSession>>();
  app.disable("x-powered-by");
  app.use("/api", (req, res, next) => {
    const allowed = [`localhost:${port}`, `127.0.0.1:${port}`];
    if (!allowed.includes(req.headers.host || ""))
      return res.status(403).json({ error: "Unexpected host." });
    const origin = req.headers.origin;
    if (origin && !allowed.map((h) => `http://${h}`).includes(origin))
      return res.status(403).json({ error: "Unexpected request origin." });
    if (!["GET", "HEAD"].includes(req.method) && !origin)
      return res
        .status(403)
        .json({ error: "A same-origin request is required." });
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  const reportAsync = (p: Promise<unknown>) =>
    p.catch(() => {
      console.error("Local session persistence failed.");
    });
  async function finish(
    id: string,
    confirmed: boolean,
    reason: string,
    seconds?: number,
  ) {
    const s = await store
      .update(id, (s) => {
        s.status =
          confirmed && ["close_requested", "expired"].includes(reason)
            ? "completed"
            : "partial";
        s.endedAt = new Date().toISOString();
        s.closeReason = reason;
        s.usageConfirmed = confirmed;
        if (typeof seconds === "number" && Number.isFinite(seconds))
          s.seconds = Math.max(s.seconds, seconds);
      })
      .catch((error: unknown) => {
        if (active?.id === id) {
          const a = active;
          active = undefined;
          clearTimeout(a.timer);
          clearTimeout(a.finalTimer);
          for (const c of a.delegations.values()) c.abort();
          a.control?.close();
          a.rejectClose?.(
            new AppError(
              "The voice session ended, but saving failed. Check the local data folder and retry.",
              500,
            ),
          );
        }
        throw error;
      });
    if (active?.id === id) {
      const a = active;
      active = undefined;
      clearTimeout(a.timer);
      clearTimeout(a.finalTimer);
      for (const c of a.delegations.values()) c.abort();
      a.control?.close();
      a.resolveClose?.(s);
    }
    return s;
  }
  async function receive(id: string, e: WireEvent) {
    if (
      e.type === "session.input_transcript.delta" ||
      e.type === "session.output_transcript.delta"
    ) {
      const f = fragmentSchema.safeParse({
        ...e,
        speaker:
          e.type === "session.input_transcript.delta" ? "user" : "assistant",
      });
      if (f.success)
        await store.update(id, (s) => {
          s.fragments = mergeFragments(s.fragments, [f.data]);
        });
    } else if (e.type === "session.started")
      await store.update(id, (s) => {
        if (s.status === "connecting") s.status = "active";
      });
    else if (
      e.type === "session.usage.updated" &&
      Number.isFinite(e.usage?.seconds)
    )
      await store.update(id, (s) => {
        s.seconds = Math.max(s.seconds, e.usage.seconds);
      });
    else if (e.type === "session.closed")
      await finish(id, true, e.reason || "close_requested", e.usage?.seconds);
    else if (
      e.type === "session.delegation.created" &&
      e.delegation?.target === "client" &&
      provider.followup
    ) {
      const a = active;
      const delegationId = e.delegation.id;
      if (
        !a ||
        a.id !== id ||
        a.closing ||
        typeof delegationId !== "string" ||
        a.seenDelegations.has(delegationId)
      )
        return;
      a.seenDelegations.add(delegationId);
      // Supersede older backend work instead of stacking subscription requests.
      for (const pending of a.delegations.values()) pending.abort();
      a.delegations.clear();
      const controller = new AbortController();
      a.delegations.set(delegationId, controller);
      try {
        // Serialize behind transcript writes received before this delegation.
        const current = await store.update(id, () => {});
        const suggestion = await provider.followup(current, controller.signal);
        if (active === a && !a.closing && !controller.signal.aborted)
          a.control?.send({
            type: "session.commentary.append",
            event_id: randomUUID(),
            delegation_id: delegationId,
            content: suggestion.slice(0, 1600),
          });
      } catch (error) {
        if (active === a && !a.closing && !controller.signal.aborted) {
          const message =
            error instanceof Error
              ? error.message
              : "Codex reasoning is unavailable.";
          await store.update(id, (s) => {
            s.backendError = message;
          });
          a.control?.send({
            type: "session.commentary.append",
            event_id: randomUUID(),
            delegation_id: delegationId,
            content:
              "The interview reasoning service is unavailable. No paid API fallback was used. Please finish this answer and choose Review; written feedback can be retried when Codex is available.",
          });
        }
      } finally {
        a.delegations.delete(delegationId);
      }
    } else if (
      e.type === "response.event" &&
      e.event?.type === "response.completed"
    ) {
      const r = e.event.response;
      if (r?.id && r.usage)
        await store.update(id, (s) => {
          s.backendUsage[r.id] = {
            input_tokens: r.usage.input_tokens || 0,
            output_tokens: r.usage.output_tokens || 0,
          };
        });
    }
  }
  async function close(id: string) {
    const current = await store.get(id);
    if (!active || active.id !== id) return current;
    if (active.closing) return active.closing;
    const a = active;
    for (const c of a.delegations.values()) c.abort();
    clearTimeout(a.timer);
    a.closing = new Promise<PracticeSession>((resolve, reject) => {
      a.resolveClose = resolve;
      a.rejectClose = reject;
    });
    a.finalTimer = setTimeout(() => {
      reportAsync(finish(id, false, "finalization_timeout"));
    }, 15000);
    if (a.control)
      a.control.send({ type: "session.close", event_id: randomUUID() });
    else reportAsync(finish(id, false, "connection_lost"));
    return a.closing;
  }
  app.get("/api/status", (_req, res) =>
    res.json({
      configured: provider.ready(),
      voiceModel: "gpt-live-1",
      backendModel:
        provider.reasoningBackend === "codex"
          ? "Codex subscription"
          : "gpt-5.6-terra",
      reasoningBackend: provider.reasoningBackend || "api",
    }),
  );
  app.get("/api/sessions", async (_req, res) => res.json(await store.list()));
  app.get("/api/sessions/:id", async (req, res) =>
    res.json(await store.get(req.params.id)),
  );
  app.post("/api/sessions", async (req, res) => {
    if (active)
      throw new AppError(
        "Another interview is still open. End it before starting a new one.",
        409,
      );
    const { config, sdp } = z
      .object({ config: configSchema, sdp: z.string().min(1).max(100000) })
      .parse(req.body);
    if (!provider.ready())
      throw new AppError(
        "Add OPENAI_API_KEY to .env in the app folder, then restart the app.",
        503,
      );
    if (!!config.previousId !== !!config.relation)
      throw new AppError(
        "A linked attempt needs both the previous session and relationship.",
        400,
      );
    const previous = config.previousId
      ? await store.get(config.previousId)
      : undefined;
    if (previous && config.relation === "retry") {
      config.resumeText = previous.config.resumeText ?? "";
    }
    const s: PracticeSession = {
      version: 1,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      config,
      question: questionFor(config, previous),
      status: "connecting",
      fragments: [],
      seconds: 0,
      usageConfirmed: false,
      backendUsage: {},
      reasoningBackend: provider.reasoningBackend || "api",
    };
    if (active)
      throw new AppError(
        "Another interview is still open. End it before starting a new one.",
        409,
      );
    const a: LiveHandle = {
      id: s.id,
      delegations: new Map(),
      seenDelegations: new Set(),
    };
    active = a;
    try {
      await store.create(s);
      const live = await provider.create(s, sdp, previous);
      await store.update(s.id, (r) => {
        r.liveId = live.liveId;
      });
      a.control = provider.attach(
        live.liveId,
        (e) => reportAsync(receive(s.id, e)),
        () => {
          console.error("Voice supervision connection unavailable.");
        },
      );
      a.timer = setTimeout(
        () => {
          reportAsync(close(s.id));
        },
        maxSeconds(config.mode) * 1000,
      );
      res.status(201).json({ record: await store.get(s.id), sdp: live.sdp });
    } catch (e) {
      await finish(s.id, false, "startup_failed").catch(() => {
        active = undefined;
      });
      throw e;
    }
  });
  app.post("/api/sessions/:id/events", async (req, res) => {
    const { fragments } = z
      .object({ fragments: z.array(fragmentSchema).max(1500) })
      .parse(req.body);
    res.json(
      await store.update(req.params.id, (s) => {
        s.fragments = mergeFragments(s.fragments, fragments);
      }),
    );
  });
  app.post("/api/sessions/:id/close", async (req, res) =>
    res.json(await close(req.params.id)),
  );
  app.post("/api/sessions/:id/finalize", async (req, res) => {
    const data = z
      .object({
        confirmed: z.boolean(),
        reason: z.string().max(100),
        seconds: z.number().nonnegative().finite().optional(),
      })
      .parse(req.body);
    const s = await store.get(req.params.id);
    if (s.usageConfirmed) {
      if (
        !["close_requested", "expired"].includes(data.reason) &&
        data.reason !== "finalization_timeout"
      )
        return res.json(
          await store.update(s.id, (r) => {
            r.status = "partial";
            r.closeReason = data.reason;
          }),
        );
      return res.json(s);
    }
    res.json(await finish(s.id, data.confirmed, data.reason, data.seconds));
  });
  app.post("/api/sessions/:id/feedback", async (req, res) => {
    const id = req.params.id;
    if (active?.id === id)
      throw new AppError(
        "End the voice session before requesting feedback.",
        409,
      );
    const s = await store.get(id);
    if (s.feedback) return res.json(s);
    if (!feedbackJobs.has(id)) {
      const job = (async () => {
        try {
          let feedback;
          if (!speakerText(s.fragments, "user").trim())
            feedback = {
              summary:
                "There is no spoken answer to review yet. Start a new attempt when you are ready.",
              insufficientEvidence: true,
              strengths: [],
              improvements: [],
              outline: [],
              missingDetails: [],
              comparison: null,
              retryQuestion: null,
            };
          else {
            const previous = s.config.previousId
              ? await store.get(s.config.previousId).catch(() => undefined)
              : undefined;
            feedback = await provider.feedback(s, previous);
          }
          return await store.update(id, (r) => {
            r.feedback = feedback;
            r.feedbackBackend = provider.reasoningBackend || "api";
            delete r.feedbackError;
          });
        } catch (e) {
          await store.update(id, (r) => {
            r.feedbackError =
              e instanceof AppError
                ? e.message
                : "Feedback failed. Retry using your saved transcript.";
          });
          throw e;
        } finally {
          feedbackJobs.delete(id);
        }
      })();
      feedbackJobs.set(id, job);
    }
    res.json(await feedbackJobs.get(id));
  });
  app.delete("/api/sessions/:id", async (req, res) => {
    if (active?.id === req.params.id || feedbackJobs.has(req.params.id))
      throw new AppError(
        "Wait for this session to finish before deleting it.",
        409,
      );
    await store.get(req.params.id);
    await store.delete(req.params.id);
    res.status(204).end();
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Unknown API route." }),
  );
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof z.ZodError)
        return res
          .status(400)
          .json({ error: err.issues[0]?.message || "Invalid request." });
      if (err instanceof AppError)
        return res.status(err.status).json({ error: err.message });
      const status = (err as { status?: number })?.status;
      if (status === 404)
        return res.status(404).json({ error: "Session not found." });
      console.error(
        "Request failed:",
        err instanceof Error ? err.name : "unknown",
      );
      res.status(500).json({
        error:
          "The app could not save or read this session. Check the local data folder and retry.",
      });
    },
  );
  return {
    app,
    shutdown: async () => {
      if (active) await close(active.id);
    },
  };
}
