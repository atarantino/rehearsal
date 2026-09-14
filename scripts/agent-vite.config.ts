import { defineConfig, mergeConfig } from "vite";
import base from "../vite.config";
export default mergeConfig(
  base,
  defineConfig({
    // Do not load the real worktree's .env files into the fixture frontend.
    envDir: process.env.AGENT_PROJECT,
    server: { strictPort: true },
  }),
);
