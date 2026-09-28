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
  aiRequests: defineTable({
    ownerId: v.id("users"),
    sessionId: v.optional(v.id("sessions")),
    opportunityId: v.optional(v.id("opportunities")),
    delegationId: v.optional(v.string()),
    feedbackClaim: v.optional(v.number()),
    inputVariant: v.optional(v.number()),
    operation: v.union(
      v.literal("feedback"),
      v.literal("delegation"),
      v.literal("extraction"),
      v.literal("brief"),
    ),
    model: v.string(),
    state: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("unknown"),
      v.literal("rejected"),
    ),
    countedInputTokens: v.optional(v.number()),
    reservedCostMicros: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    cachedInputTokens: v.optional(v.number()),
    cacheWriteTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    reasoningTokens: v.optional(v.number()),
    responseId: v.optional(v.string()),
    requestId: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    result: v.optional(v.string()),
    finishedAt: v.optional(v.number()),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_sessionId_and_delegationId", ["sessionId", "delegationId"])
    .index("by_state", ["state"]),
  providerClosures: defineTable({
    ownerId: v.id("users"),
    liveId: v.string(),
    state: v.union(
      v.literal("pending"),
      v.literal("closed"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    updatedAt: v.number(),
    providerSeconds: v.optional(v.number()),
    errorCode: v.optional(v.string()),
  })
    .index("by_liveId", ["liveId"])
    .index("by_state", ["state"]),
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
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_stripeCustomerId", ["stripeCustomerId"]),
  users: defineTable({
    username: v.union(v.string(), v.null()),
    // Google-verified address, refreshed on each Google sign-in. Contact
    // only: never use it to find or merge accounts.
    email: v.optional(v.string()),
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
    feedbackChargedClaim: v.optional(v.number()),
    delegationCalls: v.optional(v.number()),
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
    feedbackCalls: v.optional(v.number()),
    delegationCalls: v.optional(v.number()),
  }).index("by_ownerId_and_periodStart", ["ownerId", "periodStart"]),
  voiceReservations: defineTable({
    ownerId: v.id("users"),
    sessionId: v.id("sessions"),
    usagePeriodId: v.id("usagePeriods"),
    minutes: v.number(),
    settledAt: v.optional(v.number()),
    chargedMinutes: v.optional(v.number()),
    // UTC day whose shared Free capacity this reservation debited, if any.
    freeDay: v.optional(v.number()),
    providerStartState: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("created"),
        v.literal("failed"),
        v.literal("unknown"),
      ),
    ),
    providerRequestId: v.optional(v.string()),
    providerErrorCode: v.optional(v.string()),
    providerLiveId: v.optional(v.string()),
  }).index("by_sessionId", ["sessionId"]),
  // Shared Free voice capacity per UTC day: reserved minutes minus releases.
  freeVoiceDays: defineTable({
    day: v.number(),
    reservedMinutes: v.number(),
  }).index("by_day", ["day"]),
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
    inputTooLarge: v.optional(v.boolean()),
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
    routingMode: v.optional(
      v.union(v.literal("dedicated"), v.literal("shared")),
    ),
    routingToken: v.optional(v.string()),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_inboxId", ["inboxId"])
    .index("by_inboxId_and_routingToken", ["inboxId", "routingToken"]),
  mailEvents: defineTable({ eventId: v.string() }).index("by_eventId", [
    "eventId",
  ]),
});
