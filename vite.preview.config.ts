import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Design preview: renders signed-in components against fixtures, no backend.
// Dev only; the production build (vite.config.ts) never includes src/preview.
export default defineConfig({
  root: "src/preview",
  plugins: [react()],
  resolve: {
    alias: {
      "convex/react": fileURLToPath(
        new URL("./src/preview/convex-react.ts", import.meta.url),
      ),
    },
  },
  optimizeDeps: { include: ["mammoth", "pdfjs-dist"] },
  worker: { format: "es" },
  server: { host: "127.0.0.1", port: 4321 },
});
