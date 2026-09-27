import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
// Builds the Preparation error harness into dist-test/harness for Playwright.
// Test-only: never part of the production build (see vite.config.ts at root).
export default defineConfig({
  root: resolve(import.meta.dirname),
  base: "/harness/",
  plugins: [react()],
  resolve: {
    alias: {
      "convex/react": resolve(import.meta.dirname, "convex-react-mock.ts"),
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, "../../dist-test/harness"),
    emptyOutDir: true,
  },
});
