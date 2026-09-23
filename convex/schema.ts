import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  record,
  fragment,
  brief,
  source,
  prepStatus,
  resumeMode,
  attachment,
} from "./validators";
export default defineSchema({
  billingAccounts: defineTable({
    ownerId: v.id("users"),
    stripeCustomerId: v.optional(v.string()),
    subscriptionId: v.optional(v.string()),
    priceId: v.optional(v.string()),
    status: v.string(),
    periodStart: v.optional(v.number()),
    periodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.boolean(),
    syncRevision: v.number(),
    checkoutToken: v.optional(v.string()),
    checkoutLeaseUntil: v.optional(v.number()),
    checkoutSessionId: v.optional(v.string()),
    checkoutUrl: v.optional(v.string()),
    checkoutExpiresAt: v.optional(v.number()),
    checkoutPlan: v.optional(v.union(v.literal("plus"), v.literal("pro"))),
  }).index("by_ownerId", ["ownerId"])
    .index("by_stripeCustomerId", ["stripeCustomerId"]),
  users: defineTable({
    username: v.union(v.string(), v.null()),
    resumeText: v.optional(v.string()),
  }),
  sessions: defineTable({
    ownerId: v.id("users"),
    requestId: v.string(),
    record,
    liveId: v.optional(v.string()),
    activatedAt: v.optional(v.number()),
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
    feedbackAttempts: v.optional(v.number()),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_ownerId_and_requestId", ["ownerId", "requestId"]),
  usagePeriods: defineTable({
    ownerId: v.id("users"),
    periodStart: v.number(),
    periodEnd: v.number(),
    voiceMinutesUsed: v.number(),
    voiceMinutesReserved: v.number(),
    preparationsUsed: v.number(),
    preparationLimit: v.optional(v.number()),
  }).index("by_ownerId_and_periodStart", ["ownerId", "periodStart"]),
  voiceReservations: defineTable({
    ownerId: v.id("users"),
    sessionId: v.id("sessions"),
    usagePeriodId: v.id("usagePeriods"),
    minutes: v.number(),
    settledAt: v.optional(v.number()),
    chargedMinutes: v.optional(v.number()),
  }).index("by_sessionId", ["sessionId"]),
  fragments: defineTable({ sessionId: v.id("sessions"), fragment })
    .index("by_sessionId", ["sessionId"])
    .index("by_sessionId_and_eventId", ["sessionId", "fragment.event_id"]),
  opportunities: defineTable({
    ownerId: v.id("users"),
    resumeMode: v.optional(resumeMode),
    resumeText: v.optional(v.string()),
    requestId: v.string(),
    input: v.string(),
    kind: v.union(v.literal("url"), v.literal("email")),
    status: prepStatus,
    sources: v.array(source),
    brief: v.optional(brief),
    error: v.optional(v.string()),
    workflowId: v.optional(v.string()),
    inboxId: v.optional(v.string()),
    inboxRecordId: v.optional(v.id("inboxes")),
    messageId: v.optional(v.string()),
    replyId: v.optional(v.string()),
    attachments: v.optional(v.array(attachment)),
    omittedAttachmentCount: v.optional(v.number()),
    receivedAt: v.number(),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_ownerId_and_requestId", ["ownerId", "requestId"]),
  inboxes: defineTable({
    ownerId: v.id("users"),
    inboxId: v.string(),
    address: v.string(),
    autoReply: v.boolean(),
    routingMode: v.optional(v.union(v.literal("dedicated"), v.literal("shared"))),
    routingToken: v.optional(v.string()),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_inboxId", ["inboxId"])
    .index("by_inboxId_and_routingToken", ["inboxId", "routingToken"]),
  mailEvents: defineTable({ eventId: v.string() }).index("by_eventId", [
    "eventId",
  ]),
});
