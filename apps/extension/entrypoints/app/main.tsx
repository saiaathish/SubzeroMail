import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "../../src/ui/App";
import "../../src/ui/styles.css";
import "@subzero/ui/styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Subzero Mail app root is missing.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
