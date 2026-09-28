"use node";
import WebSocket from "ws";
import { v } from "convex/values";
import { internalAction, env } from "./_generated/server";
import { internal } from "./_generated/api";

// Only the authenticated provider sideband may report billed voice duration.
// Renew below Convex's action runtime limit for twenty-minute interviews.
export const watch = internalAction({
  args: {
    id: v.id("sessions"),
    liveId: v.string(),
    attempt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { id, liveId, attempt = 0 }) => {
    const s = await ctx.runQuery(internal.sessions.load, { id });
    if (!s || s.liveId !== liveId || !env.OPENAI_API_KEY) return null;
    let providerClosed = false;
    let failed = false;
    let renewal = false;
    let writes = Promise.resolve();
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(
        `wss://api.openai.com/v1/live/sessions/${encodeURIComponent(liveId)}/attach`,
        {
          headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
          handshakeTimeout: 10000,
        },
      );
      const finish = () => {
        clearTimeout(timer);
        ws.terminate();
        resolve();
      };
      const timer = setTimeout(() => {
        renewal = true;
        finish();
      }, 240000);
      ws.on("message", (data) => {
        try {
          const event = JSON.parse(data.toString());
          if (!["session.closed", "session.usage.updated"].includes(event.type))
            return;
          const closed = event.type === "session.closed";
          providerClosed ||= closed;
          const seconds = event.usage?.seconds;
          writes = writes
            .then(async () => {
              await ctx.runMutation(internal.providerCleanup.record, {
                ownerId: s.ownerId,
                liveId,
                state: closed ? "closed" : "pending",
                providerSeconds:
                  typeof seconds === "number" &&
                  Number.isFinite(seconds) &&
                  seconds >= 0
                    ? seconds
                    : undefined,
              });
              if (closed)
                await ctx.runMutation(internal.sessions.markClosed, {
                  id,
                  reason: "provider_closed",
                });
            })
            .catch(() => {
              failed = true;
              console.warn("Provider usage recording failed", {
                sessionId: id,
              });
            });
          if (closed) finish();
        } catch {
          /* No user data or raw provider payloads in logs. */
        }
      });
      ws.on("error", () => {
        failed = true;
        finish();
      });
      ws.on("close", () => {
        if (!providerClosed && !renewal) failed = true;
        clearTimeout(timer);
        resolve();
      });
    });
    await writes;
    const current = await ctx.runQuery(internal.sessions.load, { id });
    if (
      !providerClosed &&
      current &&
      !current.record.endedAt &&
      Date.now() < current.expiresAt + 30000 &&
      (!failed || attempt < 8)
    ) {
      await ctx.scheduler.runAfter(
        failed ? Math.min(60000, 5000 * 2 ** attempt) : 0,
        internal.voiceMonitor.watch,
        { id, liveId, attempt: failed ? attempt + 1 : 0 },
      );
    }
    if (!providerClosed && failed)
      console.warn("Provider usage monitoring interrupted", { sessionId: id });
    return null;
  },
});
