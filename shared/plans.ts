export const PLAN_ORDER = ["free", "plus", "pro"] as const;
export type Plan = (typeof PLAN_ORDER)[number];
export const PLANS = {
  free: { name: "Free", monthlyPrice: 0, voiceMinutes: 10, preparations: 3 },
  plus: { name: "Plus", monthlyPrice: 19, voiceMinutes: 60, preparations: 15 },
  pro: { name: "Pro", monthlyPrice: 39, voiceMinutes: 150, preparations: 40 },
} as const;
