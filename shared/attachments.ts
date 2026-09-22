export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENT_TEXT = 12000;
export const MAX_ATTACHMENT_TOTAL_BYTES = 15 * 1024 * 1024;
export function attachmentKind(filename: string, contentType = "") {
  contentType = contentType.split(";")[0].trim().toLowerCase();
  const extension = filename.toLowerCase().split(".").pop();
  if (extension === "pdf" || contentType === "application/pdf") return "pdf";
  if (
    extension === "docx" ||
    contentType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return "docx";
  if (["txt", "md"].includes(extension ?? "") || contentType === "text/plain")
    return "text";
  return null;
}
