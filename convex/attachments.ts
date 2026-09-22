"use node";
import { v, type Infer } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { attachment } from "./validators";
import {
  attachmentKind,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
} from "../shared/attachments";
import { attachmentText, readAttachmentBody } from "../server/attachment-text";
import { publicUrl } from "../shared/preparation";

export const importEmail = internalAction({
  args: { id: v.id("opportunities") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const o = await ctx.runQuery(internal.preparation.load, { id });
    if (
      o.kind !== "email" ||
      !o.attachments?.length ||
      !o.inboxId ||
      !o.messageId
    )
      return null;
    const attachments: Infer<typeof attachment>[] = o.attachments;
    let downloaded = attachments
      .filter((a) => a.status === "imported")
      .reduce((sum, a) => sum + a.size, 0);
    for (let i = 0; i < attachments.length; i++) {
      const a = attachments[i];
      if (a.status === "imported" || a.status === "skipped") continue;
      const kind = attachmentKind(a.filename, a.contentType);
      if (
        !kind ||
        a.size > MAX_ATTACHMENT_BYTES ||
        downloaded >= MAX_ATTACHMENT_TOTAL_BYTES
      ) {
        attachments[i] = {
          ...a,
          status: "skipped",
          note: !kind
            ? "Unsupported file. Use PDF, DOCX or plain text; images need OCR."
            : a.size > MAX_ATTACHMENT_BYTES
              ? "File exceeds the 5 MB limit."
              : "Email exceeds the 15 MB download limit.",
        };
      } else {
        try {
          const key = process.env.AGENTMAIL_API_KEY;
          if (!key) throw new Error("Provider unavailable");
          const path = [o.inboxId, o.messageId, a.id].map(encodeURIComponent);
          const metadata = await fetch(
            `https://api.agentmail.to/v0/inboxes/${path[0]}/messages/${path[1]}/attachments/${path[2]}`,
            {
              headers: { Authorization: `Bearer ${key}` },
              signal: AbortSignal.timeout(15000),
              redirect: "error",
            },
          );
          if (!metadata.ok) throw new Error("Provider unavailable");
          const info = (await metadata.json()) as {
            download_url?: unknown;
            size?: unknown;
          };
          if (typeof info.download_url !== "string")
            throw new Error("Missing download");
          if (
            typeof info.size === "number" &&
            info.size > MAX_ATTACHMENT_BYTES
          ) {
            attachments[i] = {
              ...a,
              status: "skipped",
              note: "File exceeds the 5 MB limit.",
            };
          } else {
            // Only provider-issued URLs are used; never a URL from email metadata.
            const response = await fetch(publicUrl(info.download_url), {
              signal: AbortSignal.timeout(20000),
              redirect: "error",
            });
            const bytes = await readAttachmentBody(
              response,
              Math.min(
                MAX_ATTACHMENT_BYTES,
                MAX_ATTACHMENT_TOTAL_BYTES - downloaded,
              ),
              (count) => {
                downloaded += count;
              },
            );
            const result = await attachmentText(bytes, kind);
            attachments[i] = {
              ...a,
              size: bytes.length,
              status: "imported",
              text: result.text,
              ...(result.truncated
                ? {
                    note: "Imported the first 12,000 characters; the rest was omitted.",
                  }
                : { note: "Text imported into your preparation." }),
            };
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          const known =
            /^(No readable text|PDF exceeds|Expanded document|File exceeds)/.test(
              message,
            );
          attachments[i] = {
            ...a,
            status: "failed",
            note: known
              ? message
              : "Could not read this file. Retry, or forward an unlocked PDF, DOCX or UTF-8 text copy.",
          };
        }
      }
      // Persist each result so a workflow retry retains successful imports.
      await ctx.runMutation(internal.preparation.update, {
        id,
        status: "reading",
        attachments,
      });
    }
    return null;
  },
});
