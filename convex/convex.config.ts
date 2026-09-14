import { defineApp } from "convex/server";
import { v } from "convex/values";
import auth from "@convex-dev/auth/core/convex.config";
import passkey from "@convex-dev/auth/providers/passkey/convex.config";
import username from "@convex-dev/auth/username/convex.config";
import workflow from "@convex-dev/workflow/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import agentmail from "@agentmail/convex/convex.config";
import firecrawl from "@firecrawl/firecrawl-convex/convex.config";
import staticHosting from "@convex-dev/static-hosting/convex.config";
const app = defineApp({
  env: {
    AUTH_PRIVATE_KEY: v.string(),
    AUTH_JWKS: v.string(),
    SITE_URL: v.string(),
    OPENAI_API_KEY: v.optional(v.string()),
    FIRECRAWL_API_KEY: v.string(),
    AGENTMAIL_API_KEY: v.string(),
    AGENTMAIL_WEBHOOK_SECRET: v.optional(v.string()),
  },
});
app.use(auth, {
  httpPrefix: "/auth",
  env: {
    AUTH_PRIVATE_KEY: app.env.AUTH_PRIVATE_KEY,
    AUTH_JWKS: app.env.AUTH_JWKS,
  },
});
app.use(firecrawl, { env: { FIRECRAWL_API_KEY: app.env.FIRECRAWL_API_KEY } });
app.use(passkey);
app.use(username);
app.use(workflow);
app.use(rateLimiter);
app.use(agentmail, { env: { AGENTMAIL_API_KEY: app.env.AGENTMAIL_API_KEY } });
app.use(staticHosting);
export default app;
