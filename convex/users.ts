import { v } from "convex/values";
import {
  internalMutation,
  query,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { ConvexError } from "convex/values";
export const createPasskeyUser = internalMutation({
  args: {
    provider: v.literal("passkey"),
    providerAccountId: v.string(),
    profile: v.object({ username: v.union(v.string(), v.null()) }),
  },
  returns: v.id("users"),
  handler: async (ctx, { profile }) =>
    ctx.db.insert("users", { username: profile.username }),
});
export async function requireUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity)
    throw new ConvexError("Sign in to use your private workspace.");
  const id = ctx.db.normalizeId("users", identity.subject);
  const user = id ? await ctx.db.get(id) : null;
  if (!user)
    throw new ConvexError("Your account could not be found. Sign in again.");
  return user;
}
export const me = query({
  args: {},
  returns: v.object({ username: v.union(v.string(), v.null()) }),
  handler: async (ctx) => {
    const u = await requireUser(ctx);
    return { username: u.username };
  },
});
