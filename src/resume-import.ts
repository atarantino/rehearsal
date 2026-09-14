import { MAX_RESUME_FILE_BYTES } from "../shared/resume";

export async function importResume(
  file: File,
  signal: AbortSignal,
): Promise<string> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "pdf" && extension !== "docx")
    throw new Error(
      "Choose a PDF or Word .docx file. For older .doc files, save as .docx or paste the text below.",
    );
  if (!file.size || file.size > MAX_RESUME_FILE_BYTES)
    throw new Error(
      "Choose a nonempty file under 5 MB, or paste the text below.",
    );
  const buffer = await file.arrayBuffer();
  if (signal.aborted) throw new DOMException("Canceled", "AbortError");
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./resume.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = (error?: Error, text?: string) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(text!);
    };
    const abort = () => finish(new DOMException("Canceled", "AbortError"));
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "This file took too long to read. Paste your resume text below.",
          ),
        ),
      25000,
    );
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () =>
      finish(
        new Error(
          "This file could not be read. Try another file or paste your resume text below.",
        ),
      );
    worker.onmessage = (
      event: MessageEvent<{ text?: string; error?: string }>,
    ) => {
      if (typeof event.data.error === "string")
        finish(new Error(event.data.error));
      else if (typeof event.data.text === "string")
        finish(undefined, event.data.text);
    };
    worker.postMessage({ buffer, extension }, [buffer]);
  });
}
