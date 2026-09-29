import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/web/app/app";
import { ErrorBoundary } from "@/web/app/error-boundary";
import "@/web/styles/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Pico's root element is missing.");
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
