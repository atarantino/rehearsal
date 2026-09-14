import { convex, cloudEnabled } from "./convex";
import { api as backend } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
async function cloudApi(
  path: string,
  body: any,
  method?: string,
): Promise<unknown> {
  if (!convex) throw new Error("The cloud connection is not configured.");
  if (path === "/status") return convex.action(backend.voice.status, {});
  if (path === "/sessions") {
    if (body === undefined)
      return (await convex.query(backend.sessions.list, {})).map((r) => ({
        ...r,
        hasFeedback: !!r.feedback,
      }));
    return convex.action(backend.voice.start, {
      ...body,
      requestId: crypto.randomUUID(),
    });
  }
  const match = path.match(
    /^\/sessions\/([^/]+)(?:\/(events|close|finalize|feedback))?$/,
  );
  if (!match) throw new Error("Unknown operation.");
  const id = match[1] as Id<"sessions">;
  if (method === "DELETE")
    return convex.mutation(backend.sessions.remove, { id });
  if (match[2] === "events")
    return convex.mutation(backend.sessions.append, { id, ...body });
  if (match[2] === "close") return convex.action(backend.voice.close, { id });
  if (match[2] === "finalize")
    return convex.mutation(backend.sessions.finalize, { id, ...body });
  if (match[2] === "feedback")
    return convex.action(backend.voice.review, { id });
  return convex.query(backend.sessions.get, { id });
}
export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  if (cloudEnabled) {
    try {
      return (await cloudApi(path, body, method)) as T;
    } catch (e) {
      const error = e as { data?: unknown; message?: string };
      throw new Error(
        typeof error.data === "string"
          ? error.data
          : error.message?.split("Called by client")[0] ||
              "The request failed. Please retry.",
      );
    }
  }
  let r: Response;
  try {
    r = await fetch(`/api${path}`, {
      method: method || (body === undefined ? "GET" : "POST"),
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(path.endsWith("/feedback") ? 170000 : 35000),
    });
  } catch {
    throw new Error(
      "The local server did not respond. Keep this tab open, check the app terminal, and retry.",
    );
  }
  if (!r.ok) {
    const data = await r.json().catch(() => ({
      error: "The local server is unavailable. Restart the app and retry.",
    }));
    throw new Error(data.error);
  }
  if (r.status === 204) return undefined as T;
  return r.json();
}
