import { extractRawText } from "mammoth";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { MAX_RESUME_PAGES } from "../shared/resume";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

self.onmessage = async (
  event: MessageEvent<{ buffer: ArrayBuffer; extension: string }>,
) => {
  try {
    const { buffer, extension } = event.data;
    let text: string;
    if (extension === "docx") {
      text = (await extractRawText({ arrayBuffer: buffer })).value;
    } else {
      GlobalWorkerOptions.workerPort = new Worker(pdfWorkerUrl, {
        type: "module",
      });
      const loading = getDocument({ data: buffer, useSystemFonts: false });
      loading.onPassword = () => {
        self.postMessage({
          error:
            "This PDF is password-protected. Export an unlocked copy or paste your resume text below.",
        });
        void loading.destroy();
      };
      const pdf = await loading.promise;
      try {
        if (pdf.numPages > MAX_RESUME_PAGES)
          throw new Error(
            "Choose a PDF with 10 pages or fewer, or paste the relevant text below.",
          );
        const pages: string[] = [];
        let length = 0;
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const content = await page.getTextContent();
          const pageText = content.items
            .map((item) =>
              "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
            )
            .join("");
          length += pageText.length;
          if (length > 200000)
            throw new Error(
              "This document contains too much text. Paste the relevant resume text below.",
            );
          pages.push(pageText);
          page.cleanup();
        }
        text = pages.join("\n\n");
      } finally {
        await loading.destroy();
        GlobalWorkerOptions.workerPort?.terminate();
      }
    }
    text = text
      .replace(/\r\n?/g, "\n")
      .replace(/\u0000/g, "")
      .trim();
    if (!text)
      throw new Error(
        "No readable text was found. Scanned PDFs are not supported. Paste your resume text below.",
      );
    if (text.length > 200000)
      throw new Error(
        "This document contains too much text. Paste the relevant resume text below.",
      );
    self.postMessage({ text });
  } catch (error) {
    const message = (error as Error).message;
    self.postMessage({
      error: /^(Choose a PDF|No readable text|This document)/.test(message)
        ? message
        : "This file could not be read. Try another file or paste your resume text below.",
    });
  }
};
