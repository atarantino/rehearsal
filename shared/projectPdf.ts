import { getDocumentProxy } from "unpdf";
import { MAX_PDF_BYTES, MAX_PDF_PAGES, MAX_SOURCE_TEXT } from "./coaching";

export async function extractProjectPdf(bytes: ArrayBuffer) {
  if (!bytes.byteLength || bytes.byteLength > MAX_PDF_BYTES)
    throw new Error("Choose a PDF smaller than 4 MB.");
  if (!new TextDecoder().decode(bytes.slice(0, 5)).startsWith("%PDF-"))
    throw new Error(
      "This file is not a PDF. Export your document or slides as PDF first.",
    );
  const pdf = await getDocumentProxy(new Uint8Array(bytes.slice(0)));
  try {
    if (pdf.numPages > MAX_PDF_PAGES)
      throw new Error(
        "Choose a PDF with 20 pages or fewer, or export just the relevant pages.",
      );
    const pages: string[] = [];
    let length = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) =>
          "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
        )
        .join("")
        .trim();
      const section = `[Page ${i}]\n${text || "[No selectable text on this page]"}`;
      length += section.length + 2;
      if (length > MAX_SOURCE_TEXT)
        throw new Error(
          "This PDF has too much text. Export a shorter excerpt or paste the relevant notes.",
        );
      pages.push(section);
      page.cleanup();
    }
    if (pages.every((p) => p.includes("[No selectable text on this page]")))
      throw new Error(
        "This PDF has no selectable text. Paste project notes or use a text-based PDF; scanned pages are not supported yet.",
      );
    return { text: pages.join("\n\n"), pages: pdf.numPages };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
