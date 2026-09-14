/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as email from "../email.js";
import type * as http from "../http.js";
import type * as limits from "../limits.js";
import type * as openai from "../openai.js";
import type * as preparation from "../preparation.js";
import type * as research from "../research.js";
import type * as resumes from "../resumes.js";
import type * as sessions from "../sessions.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";
import type * as voice from "../voice.js";
import type * as workflows from "../workflows.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  email: typeof email;
  http: typeof http;
  limits: typeof limits;
  openai: typeof openai;
  preparation: typeof preparation;
  research: typeof research;
  resumes: typeof resumes;
  sessions: typeof sessions;
  users: typeof users;
  validators: typeof validators;
  voice: typeof voice;
  workflows: typeof workflows;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  auth: import("@convex-dev/auth/core/_generated/component.js").ComponentApi<"auth">;
  firecrawl: import("@firecrawl/firecrawl-convex/_generated/component.js").ComponentApi<"firecrawl">;
  authPasskey: import("@convex-dev/auth/providers/passkey/_generated/component.js").ComponentApi<"authPasskey">;
  authUsername: import("@convex-dev/auth/username/_generated/component.js").ComponentApi<"authUsername">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  agentmail: import("@agentmail/convex/_generated/component.js").ComponentApi<"agentmail">;
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
