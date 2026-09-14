import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { record, fragment, brief, source, prepStatus } from "./validators";
export default defineSchema({
  users: defineTable({ username: v.union(v.string(), v.null()) }),
  sessions: defineTable({
    ownerId: v.id("users"),
    requestId: v.string(),
    record,
    liveId: v.optional(v.string()),
    expiresAt: v.number(),
    fragmentCount: v.number(),
    transcriptBytes: v.number(),
    feedbackState: v.union(
      v.literal("idle"),
      v.literal("running"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    feedbackStartedAt: v.optional(v.number()),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_ownerId_and_requestId", ["ownerId", "requestId"]),
  fragments: defineTable({ sessionId: v.id("sessions"), fragment })
    .index("by_sessionId", ["sessionId"])
    .index("by_sessionId_and_eventId", ["sessionId", "fragment.event_id"]),
  opportunities: defineTable({
    ownerId: v.id("users"),
    requestId: v.string(),
    input: v.string(),
    kind: v.union(v.literal("url"), v.literal("email")),
    status: prepStatus,
    sources: v.array(source),
    brief: v.optional(brief),
    error: v.optional(v.string()),
    workflowId: v.optional(v.string()),
    inboxId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    replyId: v.optional(v.string()),
    receivedAt: v.number(),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_ownerId_and_requestId", ["ownerId", "requestId"]),
  inboxes: defineTable({
    ownerId: v.id("users"),
    inboxId: v.string(),
    address: v.string(),
    autoReply: v.boolean(),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_inboxId", ["inboxId"]),
  mailEvents: defineTable({ eventId: v.string() }).index("by_eventId", [
    "eventId",
  ]),
});
