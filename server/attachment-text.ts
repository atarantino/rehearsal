import { getDocumentProxy } from "unpdf";
import { extractRawText } from "mammoth";
import { unzipSync } from "fflate";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_TEXT,
} from "../shared/attachments";

export async function attachmentText(
  bytes: Uint8Array,
  kind: "pdf" | "docx" | "text",
) {
  if (bytes.length > MAX_ATTACHMENT_BYTES)
    throw new Error("File exceeds the 5 MB limit.");
  let text = "";
  if (kind === "pdf") {
    const pdf = await getDocumentProxy(bytes, {
      useSystemFonts: false,
    });
    try {
      if (pdf.numPages > 30) throw new Error("PDF exceeds the 30-page limit.");
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        text +=
          content.items
            .map((item) =>
              "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
            )
            .join("") + "\n";
        page.cleanup();
        if (text.length > MAX_ATTACHMENT_TEXT) break;
      }
    } finally {
      await pdf.loadingTask.destroy();
    }
  } else if (kind === "docx") {
    // Bound expanded ZIP content before passing the document to Mammoth.
    let expanded = 0;
    let entries = 0;
    unzipSync(bytes, {
      filter(entry) {
        expanded += entry.originalSize;
        if (++entries > 1000 || expanded > 20 * 1024 * 1024)
          throw new Error("Expanded document exceeds the size limit.");
        return false;
      },
    });
    text = (await extractRawText({ buffer: Buffer.from(bytes) })).value;
  } else {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  text = text
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
  if (!text)
    throw new Error(
      "No readable text. Scanned PDFs and images need OCR; forward a text-based copy.",
    );
  return {
    text: text.slice(0, MAX_ATTACHMENT_TEXT),
    truncated: text.length > MAX_ATTACHMENT_TEXT,
  };
}

export async function readAttachmentBody(
  response: Response,
  limit = MAX_ATTACHMENT_BYTES,
  onBytes?: (count: number) => void,
) {
  if (!response.ok || !response.body)
    throw new Error("Attachment download failed.");
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body.cancel();
    throw new Error("File exceeds the download size limit.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      onBytes?.(value.byteLength);
      if (size > limit)
        throw new Error("File exceeds the download size limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
