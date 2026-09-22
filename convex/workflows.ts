import { WorkflowManager } from "@convex-dev/workflow";
import { components, internal } from "./_generated/api";
import { v } from "convex/values";
export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    maxParallelism: 3,
    defaultRetryBehavior: { maxAttempts: 2, initialBackoffMs: 2000, base: 2 },
    retryActionsByDefault: true,
  },
});
export const prepare = workflow.define({
  args: { id: v.id("opportunities") },
  returns: v.null(),
  handler: async (step, { id }): Promise<null> => {
    try {
      await step.runMutation(internal.preparation.update, {
        id,
        status: "reading",
      });
      await step.runAction(internal.attachments.importEmail, { id });
      const extracted = await step.runAction(internal.research.extract, { id });
      await step.runMutation(internal.preparation.update, {
        id,
        status: "researching",
      });
      const sources = await step.runAction(
        internal.research.research,
        { id, extracted },
        { retry: false },
      );
      await step.runMutation(internal.preparation.update, {
        id,
        status: "writing",
        sources,
      });
      const brief = await step.runAction(internal.research.writeBrief, {
        id,
        extracted,
        sources,
      });
      await step.runMutation(internal.preparation.update, {
        id,
        status: "ready",
        brief,
      });
      try {
        await step.runMutation(internal.email.notifyReady, { id });
      } catch {
        /* Preparation remains available if notification cannot be queued. */
      }
    } catch {
      await step.runMutation(internal.preparation.update, {
        id,
        status: "failed",
        error:
          "Preparation could not finish. Check the source URL or try again shortly.",
      });
    }
    return null;
  },
});
