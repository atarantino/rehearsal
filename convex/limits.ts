import { RateLimiter, HOUR, DAY } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";
export const limits = new RateLimiter(components.rateLimiter, {
  resume: { kind: "token bucket", rate: 30, period: HOUR, capacity: 30 },
  research: { kind: "fixed window", rate: 10, period: DAY },
  voice: { kind: "fixed window", rate: 10, period: DAY },
  feedback: { kind: "fixed window", rate: 25, period: DAY },
  inbox: { kind: "fixed window", rate: 3, period: HOUR },
  // Voice start attempts are non-refundable and separate from minute capacity.
  // Paid accounts share globalVoice; Free accounts have their own budgets so
  // Free failures cannot exhaust paid start capacity.
  globalVoice: { kind: "fixed window", rate: 100, period: DAY },
  freeVoiceStarts: { kind: "token bucket", rate: 4, period: DAY, capacity: 4 },
  globalFreeVoiceStarts: {
    kind: "fixed window",
    rate: 120,
    period: DAY,
    start: 0,
  },
  globalFreeAiSpend: {
    kind: "fixed window",
    rate: 1_000_000,
    period: DAY,
    start: 0,
  },
  globalFreeResearch: { kind: "fixed window", rate: 20, period: DAY, start: 0 },
  globalFreeFeedback: { kind: "fixed window", rate: 60, period: DAY, start: 0 },
  globalPaidFeedback: {
    kind: "fixed window",
    rate: 500,
    period: DAY,
    start: 0,
  },
  globalResearch: { kind: "fixed window", rate: 100, period: DAY },
  // Over-quota invitations retained per owner and service-wide per UTC day;
  // excess is acknowledged and dropped.
  mailIntake: { kind: "fixed window", rate: 5, period: DAY, start: 0 },
  globalMailIntake: { kind: "fixed window", rate: 100, period: DAY, start: 0 },
});
