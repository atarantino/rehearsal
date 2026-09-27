import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
// Builds the error-notice harness into dist-test/harness for Playwright.
export default defineConfig({
  root: resolve(import.meta.dirname),
  base: "/harness/",
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, "../../dist-test/harness"),
    emptyOutDir: true,
  },
});
