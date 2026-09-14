import { v, ConvexError } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { prepStatus, source, brief } from "./validators";
import { requireUser } from "./users";
import { publicUrl } from "../shared/preparation";
import { limits } from "./limits";
import { workflow } from "./workflows";
export async function enqueue(
  ctx: MutationCtx,
  args: {
    ownerId: Id<"users">;
    requestId: string;
    input: string;
    kind: "url" | "email";
    inboxId?: string;
    messageId?: string;
  },
) {
  const old = await ctx.db
    .query("opportunities")
    .withIndex("by_ownerId_and_requestId", (q) =>
      q.eq("ownerId", args.ownerId).eq("requestId", args.requestId),
    )
    .unique();
  if (old) return old._id;
  await limits.limit(ctx, "research", { key: args.ownerId, throws: true });
  await limits.limit(ctx, "globalResearch", { throws: true });
  const id = await ctx.db.insert("opportunities", {
    ...args,
    status: "queued",
    sources: [],
    receivedAt: Date.now(),
  });
  const workflowId = await workflow.start(ctx, internal.workflows.prepare, {
    id,
  });
  await ctx.db.patch(id, { workflowId });
  return id;
}
export const create = mutation({
  args: { url: v.string(), requestId: v.string() },
  returns: v.id("opportunities"),
  handler: async (ctx, { url, requestId }): Promise<Id<"opportunities">> => {
    const user = await requireUser(ctx);
    if (url.length > 2000 || requestId.length > 100)
      throw new ConvexError("Input too long.");
    return enqueue(ctx, {
      ownerId: user._id,
      requestId,
      input: publicUrl(url),
      kind: "url",
    });
  },
});
export const list = query({
  args: {},
  returns: v.array(schema.doc("opportunities")),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return ctx.db
      .query("opportunities")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .take(20);
  },
});
export const get = query({
  args: { id: v.id("opportunities") },
  returns: schema.doc("opportunities"),
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const o = await ctx.db.get(id);
    if (!o || o.ownerId !== user._id)
      throw new ConvexError("Preparation not found.");
    return o;
  },
});
export const retry = mutation({
  args: { id: v.id("opportunities") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const o = await ctx.db.get(id);
    if (!o || o.ownerId !== user._id)
      throw new ConvexError("Preparation not found.");
    if (o.status !== "failed")
      throw new ConvexError("Only failed preparation can be retried.");
    await limits.limit(ctx, "research", { key: user._id, throws: true });
    await limits.limit(ctx, "globalResearch", { throws: true });
    const workflowId = await workflow.start(ctx, internal.workflows.prepare, {
      id,
    });
    await ctx.db.patch(id, { status: "queued", error: undefined, workflowId });
    return null;
  },
});
export const load = internalQuery({
  args: { id: v.id("opportunities") },
  returns: schema.doc("opportunities"),
  handler: async (ctx, { id }) => {
    const o = await ctx.db.get(id);
    if (!o) throw new Error("Preparation missing.");
    return o;
  },
});
export const update = internalMutation({
  args: {
    id: v.id("opportunities"),
    status: prepStatus,
    sources: v.optional(v.array(source)),
    brief: v.optional(brief),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, ...patch }) => {
    await ctx.db.patch(id, patch);
    return null;
  },
});
