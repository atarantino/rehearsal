// Stand-in for "convex/react" in the design preview (see vite.preview.config.ts).
// Queries and calls resolve from the selected scenario instead of a deployment.
import { createContext, useContext } from "react";
import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "convex/server";

export const LOADING = Symbol("loading");
export const PENDING = Symbol("pending");
type Handler = (args: any) => unknown;
export type Handlers = Record<string, Handler>;

/** Typed handler entry: the fixture must match the real function's return type. */
export function handle<F extends FunctionReference<any, any>>(
  ref: F,
  fn: (
    args: FunctionArgs<F>,
  ) =>
    | FunctionReturnType<F>
    | typeof LOADING
    | typeof PENDING
    | Promise<FunctionReturnType<F>>,
): [string, Handler] {
  return [getFunctionName(ref), fn];
}

type Preview = { handlers: Handlers; log: (entry: string) => void };
export const PreviewContext = createContext<Preview>({
  handlers: {},
  log: () => {},
});

function describe(name: string, args: unknown) {
  const shown = JSON.stringify(args);
  return shown && shown !== "{}" ? `${name} ${shown}` : name;
}

export function useQuery(ref: FunctionReference<"query">, args?: unknown) {
  const { handlers } = useContext(PreviewContext);
  if (args === "skip") return undefined;
  const handler = handlers[getFunctionName(ref)];
  const result = handler?.(args ?? {});
  return result === LOADING ? undefined : result;
}

function useCall(ref: FunctionReference<"mutation" | "action">) {
  const { handlers, log } = useContext(PreviewContext);
  const name = getFunctionName(ref);
  return async (args?: unknown) => {
    log(describe(name, args));
    const handler = handlers[name];
    const result = handler ? await handler(args ?? {}) : null;
    // PENDING keeps the caller in its busy state, e.g. "Opening checkout…".
    if (result === PENDING) return new Promise(() => {});
    if (!handler) await new Promise((r) => setTimeout(r, 300));
    return result;
  };
}
export const useMutation = useCall;
export const useAction = useCall;
