import { z } from "zod";
import { ConvexError } from "convex/values";
export async function openaiRequest(
  path: string,
  body?: unknown,
): Promise<any> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new ConvexError("OpenAI is not configured yet.");
  const r = await fetch(`https://api.openai.com/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok)
    throw new ConvexError(
      r.status === 401
        ? "OpenAI credentials were rejected. The app owner needs to update the API key."
        : r.status === 429
          ? "OpenAI is at its current usage limit. Try again later."
          : `OpenAI could not complete this request (HTTP ${r.status}).`,
    );
  if (r.status === 204) return null;
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}
export async function structured<T>(
  shape: z.ZodType<T>,
  name: string,
  instructions: string,
  input: unknown,
): Promise<T> {
  const result = await openaiRequest("/responses", {
    model: "gpt-5.6-terra",
    store: false,
    instructions,
    input: JSON.stringify(input),
    reasoning: { effort: "low" },
    max_output_tokens: 5000,
    text: {
      format: {
        type: "json_schema",
        name,
        strict: true,
        schema: z.toJSONSchema(shape),
      },
    },
  });
  const text = result.output
    ?.flatMap((o: any) => o.content ?? [])
    .filter((c: any) => c.type === "output_text")
    .map((c: any) => c.text)
    .join("");
  if (!text)
    throw new ConvexError("The model returned no usable result. Try again.");
  return shape.parse(JSON.parse(text));
}
