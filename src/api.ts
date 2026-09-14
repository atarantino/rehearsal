export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
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
