/** Turn thrown values (structured ConvexError, plain Error, strings) into user-facing text. */
export type DecodedError = { message: string; planLimit: boolean };
const fallback = "The request failed. Please retry.";
export function decodeError(
  error: unknown,
  defaultMessage = fallback,
): DecodedError {
  const e = error as { data?: unknown; message?: unknown } | null;
  const data = e && typeof e === "object" ? e.data : undefined;
  if (data !== null && typeof data === "object") {
    const d = data as { code?: unknown; message?: unknown };
    if (typeof d.message === "string")
      return { message: d.message, planLimit: d.code === "PLAN_LIMIT" };
  }
  if (typeof data === "string") return { message: data, planLimit: false };
  if (typeof error === "string") return { message: error, planLimit: false };
  const raw = e && typeof e.message === "string" ? e.message : "";
  // Convex client messages append call-site details; keep only the server text.
  const message = raw
    .split("Called by client")[0]
    .replace(
      /^\[CONVEX [^\]]*\]\s*(\[Request ID: [^\]]*\]\s*)?(Server Error\s*)?(Uncaught (ConvexError|Error):\s*)?/,
      "",
    )
    .trim();
  return { message: message || defaultMessage, planLimit: false };
}
