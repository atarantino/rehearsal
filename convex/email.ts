import { v, ConvexError } from "convex/values";
import { AgentMail } from "@agentmail/convex";
import { z } from "zod";
import { query, action, internalMutation } from "./_generated/server";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireUser } from "./users";
import { limits } from "./limits";
import { enqueue } from "./preparation";
export const agentmail: AgentMail = new AgentMail(components.agentmail, {
  onMessageReceived: internal.email.received,
});
export const inbox = query({
  args: {},
  returns: v.union(
    v.object({ address: v.string(), autoReply: v.boolean() }),
    v.null(),
  ),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const i = await ctx.db
      .query("inboxes")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", user._id))
      .unique();
    return i ? { address: i.address, autoReply: i.autoReply } : null;
  },
});
export const reserve = internalMutation({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => {
    const u = await requireUser(ctx);
    await limits.limit(ctx, "inbox", { key: u._id, throws: true });
    return u._id;
  },
});
export const save = internalMutation({
  args: { ownerId: v.id("users"), inboxId: v.string(), autoReply: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("inboxes")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", args.ownerId))
      .unique();
    if (!old)
      await ctx.db.insert("inboxes", { ...args, address: args.inboxId });
    return null;
  },
});
export const create = action({
  args: { autoReply: v.boolean() },
  returns: v.object({ address: v.string(), autoReply: v.boolean() }),
  handler: async (
    ctx,
    { autoReply },
  ): Promise<{ address: string; autoReply: boolean }> => {
    const existing = await ctx.runQuery(api.email.inbox, {});
    if (existing) return existing;
    if (!process.env.AGENTMAIL_API_KEY || !process.env.AGENTMAIL_WEBHOOK_SECRET)
      throw new ConvexError(
        "Email setup is not finished yet. You can paste a job URL in the meantime.",
      );
    const ownerId: Id<"users"> = await ctx.runMutation(
      internal.email.reserve,
      {},
    );
    try {
      const i = await ctx.runAction(components.agentmail.lib.createInbox, {
        request: {
          display_name: "Rehearsal interview preparation",
          client_id: `rehearsal-${ownerId}`,
        },
      });
      if (typeof i.inbox_id !== "string") throw new Error("Invalid inbox.");
      await ctx.runMutation(internal.email.save, {
        ownerId,
        inboxId: i.inbox_id,
        autoReply,
      });
      return { address: i.inbox_id, autoReply };
    } catch (e) {
      const unavailable = /(?:error|HTTP) 403/.test(String(e));
      throw new ConvexError(
        unavailable
          ? "The email provider cannot create another inbox right now. Paste a job URL to prepare, or ask the app owner to check inbox capacity."
          : "Your email inbox could not be created. Try again shortly.",
      );
    }
  },
});
const messageSchema = z.object({
  inbox_id: z.string().max(300),
  message_id: z.string().max(300),
  subject: z.string().max(1000).optional(),
  text: z.string().optional(),
  extracted_text: z.string().optional(),
  labels: z.array(z.string()).optional(),
});
export const received = internalMutation({
  args: { message: v.any(), thread: v.any(), eventId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const parsed = messageSchema.safeParse(args.message);
    if (!parsed.success) return null;
    const message = parsed.data;
    if (
      message.labels?.some((x) => ["spam", "blocked", "auto-reply"].includes(x))
    )
      return null;
    const inbox = await ctx.db
      .query("inboxes")
      .withIndex("by_inboxId", (q) => q.eq("inboxId", message.inbox_id))
      .unique();
    if (!inbox) return null;
    if (
      await ctx.db
        .query("mailEvents")
        .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
        .unique()
    )
      return null;
    const text = message.text || message.extracted_text;
    if (!text) return null;
    await enqueue(ctx, {
      ownerId: inbox.ownerId,
      requestId: `mail:${message.message_id}`,
      kind: "email",
      input:
        `Subject: ${message.subject ?? "Interview invitation"}\n\n${text}`.slice(
          0,
          18000,
        ),
      inboxId: message.inbox_id,
      messageId: message.message_id,
    });
    await ctx.db.insert("mailEvents", { eventId: args.eventId });
    return null;
  },
});
export const notifyReady = internalMutation({
  args: { id: v.id("opportunities") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const o = await ctx.db.get(id);
    if (!o || !o.inboxId || !o.messageId || o.replyId || o.status !== "ready")
      return null;
    const i = await ctx.db
      .query("inboxes")
      .withIndex("by_inboxId", (q) => q.eq("inboxId", o.inboxId!))
      .unique();
    if (!i?.autoReply || i.ownerId !== o.ownerId) return null;
    const replyId = await agentmail.replyToMessage(
      ctx,
      o.inboxId,
      o.messageId,
      {
        text: `Your interview preparation is ready. Open your private Rehearsal workspace to review the brief and practice out loud:\n${process.env.SITE_URL}/?prep=${id}\n\nSign in with the passkey you used when you created this inbox.`,
        replyAll: false,
        labels: ["auto-reply"],
      },
    );
    await ctx.db.patch(id, { replyId });
    return null;
  },
});
