import { ConvexReactClient } from "convex/react";
export const cloudEnabled = import.meta.env.VITE_LOCAL_MODE !== "true";
export const convex =
  cloudEnabled && import.meta.env.VITE_CONVEX_URL
    ? new ConvexReactClient(import.meta.env.VITE_CONVEX_URL)
    : null;
