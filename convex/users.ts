import { v } from "convex/values";
import {
  internalMutation,
  query,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { ConvexError } from "convex/values";
import { vGoogleProfile } from "@convex-dev/auth/providers/oauth/google";
export const createGoogleUser = internalMutation({
  args: {
    provider: v.literal("google"),
    providerAccountId: v.string(),
    profile: vGoogleProfile,
  },
  returns: v.id("users"),
  handler: async (ctx, { profile }) => {
    // The auth component maps Google's stable subject to this user on return
    // visits. Display names and emails must never merge existing workspaces.
    return ctx.db.insert("users", { username: profile.name ?? null });
  },
});
export const syncGoogleUser = internalMutation({
  args: {
    provider: v.literal("google"),
    providerAccountId: v.string(),
    profile: vGoogleProfile,
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, { profile, userId }) => {
    const email = profile.emailVerified ? profile.email : undefined;
    const user = await ctx.db.get(userId);
    if (user && user.email !== email) await ctx.db.patch(userId, { email });
    return null;
  },
});
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
