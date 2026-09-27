// Test-only stand-in for "convex/react": serves fixed query data and makes the
// preparation create/retry mutations fail with a server-shaped plan-limit error.
import { getFunctionName } from "convex/server";
const planLimit = Object.assign(
  new Error(
    '[CONVEX M(preparation:create)] [Request ID: abc] Server Error Uncaught ConvexError: {"code":"PLAN_LIMIT","message":"Your preparation allowance is used up. Upgrade your plan or wait for the next period."} Called by client',
  ),
  {
    data: {
      code: "PLAN_LIMIT",
      message:
        "Your preparation allowance is used up. Upgrade your plan or wait for the next period.",
    },
  },
);
const failed = {
  _id: "opp_failed",
  _creationTime: 1,
  ownerId: "user_1",
  requestId: "r1",
  input: "https://example.com/jobs/1",
  kind: "url",
  status: "failed",
  sources: [],
  error:
    "Your preparation allowance is used up. Your invitation is saved. Retry preparation when your allowance is available.",
  receivedAt: 1,
};
const data: Record<string, unknown> = {
  "preparation:list": [failed],
  "preparation:get": failed,
  "email:inbox": null,
  "resumes:get": { mode: "default", defaultText: "", opportunityLabel: "" },
};
export function useQuery(ref: unknown, args?: unknown) {
  if (args === "skip") return undefined;
  return data[getFunctionName(ref as never)];
}
export function useMutation(ref: unknown) {
  const name = getFunctionName(ref as never);
  return async () => {
    if (name === "preparation:create" || name === "preparation:retry")
      throw planLimit;
    return null;
  };
}
export function useAction(ref: unknown) {
  return async () => {
    throw new Error(`unexpected action ${getFunctionName(ref as never)}`);
  };
}
