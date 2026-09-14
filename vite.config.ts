import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    // QA writes HTML reports and tsconfigs underneath this checkout. They must
    // not reload an agent's active browser while an independent check runs.
    watch: {
      ignored: [
        "**/.agent/**",
        "**/dist-test/**",
        "**/test-results/**",
        "**/playwright-report/**",
      ],
    },
  },
  build: { outDir: "dist" },
});
