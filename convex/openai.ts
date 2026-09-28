import { z } from "zod";
import { ConvexError } from "convex/values";
import { env, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { AI_MODEL, AI_POLICY, type AiOperation } from "../shared/cost-controls";

type Json = Record<string, any>;
export class OpenAIError extends ConvexError<string> {
  constructor(
    message: string,
    readonly code: string,
    readonly requestId?: string,
    readonly retryAfterMs?: number,
    readonly status?: number,
  ) {
    super(message);
  }
}
const fundingErrors = new Set([
  "insufficient_quota",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "credit_balance_exhausted",
  "billing_hard_limit_reached",
]);
export async function openaiRequest(
  path: string,
  body?: unknown,
  options: { retrySafe?: boolean; timeoutMs?: number } = {},
): Promise<Json> {
  const key = env.OPENAI_API_KEY;
  if (!key)
    throw new OpenAIError("OpenAI is not configured yet.", "not_configured");
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://api.openai.com/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 120000),
    });
    const requestId = r.headers.get("x-request-id") ?? undefined;
    if (!r.ok) {
      const error = (await r.json().catch(() => ({}))) as Json;
      const code =
        typeof error.error?.code === "string"
          ? error.error.code
          : `http_${r.status}`;
      const rawDelay = r.headers.get("retry-after");
      const delay =
        rawDelay === null
          ? undefined
          : /^\d+(\.\d+)?$/.test(rawDelay)
            ? Number(rawDelay) * 1000
            : Date.parse(rawDelay) - Date.now();
      const retryAfterMs =
        delay !== undefined && Number.isFinite(delay)
          ? Math.max(0, delay)
          : undefined;
      const funding = fundingErrors.has(code);
      if (funding)
        console.warn("OpenAI funding exhausted", { code, requestId });
      // Only replay read/count requests. A response or session creation can
      // already have incurred cost when its result is lost.
      if (
        options.retrySafe &&
        !funding &&
        [429, 503].includes(r.status) &&
        attempt < 1 &&
        (retryAfterMs ?? 0) <= 2000
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, (retryAfterMs ?? 500) + Math.random() * 100),
        );
        continue;
      }
      throw new OpenAIError(
        funding
          ? "OpenAI credits or the spending limit have been reached. The app owner needs to restore API funding."
          : r.status === 401
            ? "OpenAI credentials were rejected. The app owner needs to update the API key."
            : r.status === 429
              ? `OpenAI is at its current usage limit. Try again${retryAfterMs ? ` in ${Math.ceil(retryAfterMs / 1000)} seconds` : " later"}.`
              : `OpenAI could not complete this request (HTTP ${r.status}).`,
        code,
        requestId,
        retryAfterMs,
        r.status,
      );
    }
    const text = r.status === 204 ? "" : await r.text();
    const result = text ? JSON.parse(text) : {};
    return { ...result, _requestId: requestId };
  }
}

export type AiContext = {
  ownerId: Id<"users">;
  sessionId?: Id<"sessions">;
  opportunityId?: Id<"opportunities">;
  operation: AiOperation;
  feedbackClaim?: number;
};
export async function structured<T>(
  ctx: ActionCtx,
  attribution: AiContext,
  shape: z.ZodType<T>,
  name: string,
  instructions: string,
  input: unknown,
  options: {
    reservedId?: Id<"aiRequests">;
    alternatives?: readonly unknown[];
  } = {},
): Promise<{ value: T; inputVariant: number }> {
  const id: Id<"aiRequests"> =
    options.reservedId ??
    (await ctx.runMutation(internal.aiUsage.begin, attribution)).id;
  const policy = AI_POLICY[attribution.operation];
  const request = {
    model: AI_MODEL,
    instructions,
    input: JSON.stringify(input),
    reasoning: { effort: "low" },
    text: {
      format: {
        type: "json_schema",
        name,
        strict: true,
        schema: z.toJSONSchema(shape),
      },
    },
  };
  let inputVariant = 0;
  let countedInputTokens: number | undefined;
  let sent = false;
  let result: Json | undefined;
  let savedResult: string | undefined;
  try {
    const inputs = [input, ...(options.alternatives ?? [])];
    for (inputVariant = 0; inputVariant < inputs.length; inputVariant++) {
      request.input = JSON.stringify(inputs[inputVariant]);
      const count = await openaiRequest("/responses/input_tokens", request, {
        retrySafe: true,
        timeoutMs: 10000,
      });
      if (!Number.isSafeInteger(count.input_tokens) || count.input_tokens < 0)
        throw new OpenAIError(
          "Could not verify the request size. Please retry later.",
          "invalid_token_count",
        );
      countedInputTokens = count.input_tokens;
      if (countedInputTokens! <= policy.input) break;
    }
    if (inputVariant === inputs.length)
      throw new OpenAIError(
        "These materials exceed the processing limit. Remove attachments or use a shorter source before trying again. No model generation was started.",
        "input_budget_exceeded",
      );
    await ctx.runMutation(internal.aiUsage.admitTokens, {
      id,
      inputTokens: countedInputTokens!,
    });
    sent = true;
    result = await openaiRequest("/responses", {
      ...request,
      store: false,
      service_tier: "default",
      max_output_tokens: policy.output,
    });
    if (result.status !== "completed")
      throw new OpenAIError(
        "The model did not finish within its processing limit. Your materials are saved.",
        "incomplete_output",
      );
    const text = result.output
      ?.flatMap((o: Json) => o.content ?? [])
      .filter((c: Json) => c.type === "output_text")
      .map((c: Json) => c.text)
      .join("");
    if (!text)
      throw new OpenAIError(
        "The model returned no usable result. Try again.",
        "empty_output",
      );
    const parsed = shape.parse(JSON.parse(text));
    if (attribution.operation === "delegation")
      savedResult = JSON.stringify(parsed);
    await finish("completed");
    return { value: parsed, inputVariant };
  } catch (caught) {
    const data = caught instanceof ConvexError ? caught.data : undefined;
    const error =
      data &&
      typeof data === "object" &&
      (data.code === "capacity_denied" || data.code === "admission_denied") &&
      typeof data.message === "string"
        ? new OpenAIError(data.message, data.code)
        : caught;
    await finish(
      !sent
        ? "rejected"
        : result ||
            (error instanceof OpenAIError &&
              error.status !== undefined &&
              error.status < 500)
          ? "failed"
          : "unknown",
      error,
    );
    throw error;
  }
  async function finish(
    state: "completed" | "failed" | "unknown" | "rejected",
    error?: unknown,
  ) {
    const usage = result?.usage;
    const number = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : undefined;
    await ctx.runMutation(internal.aiUsage.finish, {
      id,
      values: {
        state,
        countedInputTokens,
        inputVariant,
        result: savedResult,
        inputTokens: number(usage?.input_tokens),
        cacheWriteTokens: number(
          usage?.input_tokens_details?.cache_write_tokens,
        ),
        cachedInputTokens: number(usage?.input_tokens_details?.cached_tokens),
        outputTokens: number(usage?.output_tokens),
        reasoningTokens: number(usage?.output_tokens_details?.reasoning_tokens),
        responseId: typeof result?.id === "string" ? result.id : undefined,
        requestId:
          result?._requestId ??
          (error instanceof OpenAIError ? error.requestId : undefined),
        errorCode: error
          ? error instanceof OpenAIError
            ? error.code
            : !sent && error instanceof ConvexError
              ? "admission_denied"
              : "invalid_or_lost_response"
          : undefined,
      },
    });
  }
}
