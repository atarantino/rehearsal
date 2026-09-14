export const MAX_RESUME_CHARS = 15000;
export const MAX_RESUME_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_RESUME_PAGES = 10;
export type ResumeMode = "default" | "custom" | "none";

export function validateResumeText(text: string) {
  if (!text.trim()) throw new Error("Paste or import some resume text first.");
  if (text.length > MAX_RESUME_CHARS)
    throw new Error(
      "Keep your resume under 15,000 characters. Edit the text before saving.",
    );
  return text.trim();
}
