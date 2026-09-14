import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthRoot } from "./Auth";
import { cloudEnabled } from "./convex";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {cloudEnabled ? (
      <AuthRoot>
        <App />
      </AuthRoot>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
