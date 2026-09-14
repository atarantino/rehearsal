"use node";

import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { extractProjectPdf } from "../shared/projectPdf";
import { MAX_PDF_BYTES } from "../shared/coaching";

export const uploadPdf = action({
  args: { sessionId: v.id("sessions"), name: v.string(), bytes: v.bytes() },
  returns: v.null(),
  handler: async (ctx, { sessionId, name, bytes }) => {
    await ctx.runMutation(internal.coaching.claimUpload, { sessionId });
    if (
      !name.trim() ||
      name.length > 120 ||
      !name.toLowerCase().endsWith(".pdf")
    )
      throw new ConvexError(
        "Choose a PDF with a filename under 120 characters.",
      );
    if (bytes.byteLength > MAX_PDF_BYTES)
      throw new ConvexError("Choose a PDF smaller than 4 MB.");
    let parsed;
    try {
      parsed = await extractProjectPdf(bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      throw new ConvexError(
        /^(Choose|This|PDF)/.test(message)
          ? message
          : "This PDF could not be read. Try an unlocked, text-based PDF or paste your notes.",
      );
    }
    const storageId = await ctx.storage.store(
      new Blob([bytes], { type: "application/pdf" }),
    );
    try {
      await ctx.runMutation(internal.coaching.attachPdf, {
        sessionId,
        name: name.trim(),
        ...parsed,
        storageId,
      });
    } catch (error) {
      await ctx.storage.delete(storageId);
      throw error;
    }
    return null;
  },
});
