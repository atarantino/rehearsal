import { z } from "zod";
export function publicUrl(value: string) {
  const u = new URL(value);
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    !host.includes(".") ||
    host.includes(":") ||
    /^\d+(\.\d+){3}$/.test(host) ||
    /(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host)
  )
    throw new Error("Use a public HTTPS job or company URL.");
  u.hash = "";
  return u.toString();
}
export const briefSchema = z.object({
  company: z.string().max(200),
  role: z.string().max(200),
  interviewDate: z.string().max(200).nullable(),
  preparation: z.array(z.string().max(600)).max(5),
  summary: z.string().max(700),
  focusAreas: z
    .array(
      z.object({
        topic: z.string().max(200),
        why: z.string().max(350),
        sourceUrl: z.string().max(2000),
      }),
    )
    .max(3),
  questions: z.array(z.string().max(1000)).min(1).max(5),
  uncertainties: z.array(z.string().max(500)).max(5),
});
export const extractionSchema = z.object({
  role: z.string().max(200),
  company: z.string().max(200),
  interviewDate: z.string().max(200).nullable(),
  preparation: z.array(z.string().max(600)).max(5),
  jobUrl: z.string().max(2000).nullable(),
});
