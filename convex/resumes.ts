import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./users";
import { resumeMode } from "./validators";
import { validateResumeText } from "../shared/resume";
import { limits } from "./limits";

function checked(text: string) {
  try {
    return validateResumeText(text);
  } catch (error) {
    throw new ConvexError((error as Error).message);
  }
}

export const get = query({
  args: { opportunityId: v.optional(v.id("opportunities")) },
  returns: v.object({
    defaultText: v.string(),
    mode: resumeMode,
    customText: v.string(),
    opportunityLabel: v.string(),
  }),
  handler: async (ctx, { opportunityId }) => {
    const user = await requireUser(ctx);
    const opportunity = opportunityId ? await ctx.db.get(opportunityId) : null;
    if (opportunityId && (!opportunity || opportunity.ownerId !== user._id))
      throw new ConvexError("Opportunity not found.");
    return {
      defaultText: user.resumeText ?? "",
      mode: opportunity?.resumeMode ?? "default",
      customText: opportunity?.resumeText ?? "",
      opportunityLabel: opportunity?.brief
        ? [opportunity.brief.role, opportunity.brief.company]
            .filter(Boolean)
            .join(" · ")
        : "",
    };
  },
});

export const saveDefault = mutation({
  args: { text: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { text }) => {
    const user = await requireUser(ctx);
    const resumeText = text === null ? undefined : checked(text);
    await limits.limit(ctx, "resume", { key: user._id, throws: true });
    await ctx.db.patch(user._id, { resumeText });
    return null;
  },
});

export const saveOpportunity = mutation({
  args: {
    opportunityId: v.id("opportunities"),
    mode: resumeMode,
    text: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { opportunityId, mode, text }) => {
    const user = await requireUser(ctx);
    const opportunity = await ctx.db.get(opportunityId);
    if (!opportunity || opportunity.ownerId !== user._id)
      throw new ConvexError("Opportunity not found.");
    const patch =
      mode === "custom"
        ? { resumeMode: mode, resumeText: checked(text ?? "") }
        : { resumeMode: mode };
    await limits.limit(ctx, "resume", { key: user._id, throws: true });
    await ctx.db.patch(opportunityId, patch);
    return null;
  },
});

export const removeOpportunityResume = mutation({
  args: { opportunityId: v.id("opportunities") },
  returns: v.null(),
  handler: async (ctx, { opportunityId }) => {
    const user = await requireUser(ctx);
    const opportunity = await ctx.db.get(opportunityId);
    if (!opportunity || opportunity.ownerId !== user._id)
      throw new ConvexError("Opportunity not found.");
    await limits.limit(ctx, "resume", { key: user._id, throws: true });
    await ctx.db.patch(opportunityId, {
      resumeMode: "none",
      resumeText: undefined,
    });
    return null;
  },
});
