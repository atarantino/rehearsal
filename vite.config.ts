import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  // Prebundle worker dependencies so the first import cannot reload an unsaved draft in dev.
  optimizeDeps: { include: ["mammoth", "pdfjs-dist"] },
  worker: { format: "es" },
  server: { host: "127.0.0.1" },
  build: { outDir: "dist" },
});
