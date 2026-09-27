import { RateLimiter, HOUR, DAY } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";
export const limits = new RateLimiter(components.rateLimiter, {
  resume: { kind: "token bucket", rate: 30, period: HOUR, capacity: 30 },
  research: { kind: "fixed window", rate: 10, period: DAY },
  voice: { kind: "fixed window", rate: 10, period: DAY },
  feedback: { kind: "fixed window", rate: 25, period: DAY },
  inbox: { kind: "fixed window", rate: 3, period: HOUR },
  globalVoice: { kind: "fixed window", rate: 100, period: DAY },
  globalFreeVoiceMinutes: {
    kind: "fixed window",
    rate: 200,
    period: DAY,
    start: 0,
  },
  globalResearch: { kind: "fixed window", rate: 100, period: DAY },
});
