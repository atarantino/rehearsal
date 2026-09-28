/// <reference types="vite/client" />
import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import rateLimiter from "@convex-dev/rate-limiter/test";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
const sockets = vi.hoisted(
  () => [] as Array<{ emit: (name: string, ...args: unknown[]) => void }>,
);
vi.mock("ws", () => ({
  default: class {
    listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    constructor() {
      sockets.push(this);
    }
    on(name: string, fn: (...args: unknown[]) => void) {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
    }
    emit(name: string, ...args: unknown[]) {
      for (const f of this.listeners.get(name) ?? []) f(...args);
    }
    terminate() {
      this.emit("close");
    }
  },
}));
const modules = import.meta.glob("../convex/**/*.ts");
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  sockets.length = 0;
});
async function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 8, 27));
  vi.stubEnv("OPENAI_API_KEY", "test-only");
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  const ownerId = await t.run((ctx) =>
    ctx.db.insert("users", { username: "monitor" }),
  );
  const a = t.withIdentity({ subject: ownerId });
  const id = await a.mutation(internal.sessions.reserve, {
    config: {
      mode: "coached",
      role: "Engineer",
      jobDescription: "",
      background: "",
    },
    requestId: "monitor",
  });
  await a.mutation(internal.sessions.activate, { id, liveId: "live_test" });
  return { t, id };
}
it("normal monitor renewal resets the consecutive-failure budget", async () => {
  const { t, id } = await setup();
  const running = t.action(internal.voiceMonitor.watch, {
    id,
    liveId: "live_test",
    attempt: 5,
  });
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  await vi.advanceTimersByTimeAsync(240000);
  await running;
  const jobs = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  expect(
    jobs.some((j) =>
      j.args.some(
        (arg: unknown) =>
          !!arg &&
          typeof arg === "object" &&
          "attempt" in arg &&
          arg.attempt === 0,
      ),
    ),
  ).toBe(true);
});
it("unexpected socket closure backs off and consumes a consecutive failure", async () => {
  const { t, id } = await setup();
  const running = t.action(internal.voiceMonitor.watch, {
    id,
    liveId: "live_test",
    attempt: 2,
  });
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  sockets[0].emit("close");
  await running;
  const jobs = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  expect(
    jobs.some(
      (j) =>
        j.scheduledTime === Date.now() + 20000 &&
        j.args.some(
          (arg: unknown) =>
            !!arg &&
            typeof arg === "object" &&
            "attempt" in arg &&
            arg.attempt === 3,
        ),
    ),
  ).toBe(true);
});
