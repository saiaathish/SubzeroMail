import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { SidePanel } from "../../src/ui/SidePanel";
import "../../src/ui/sidepanel.css";

const root = document.getElementById("root");

if (!root) throw new Error("Subzero side panel root is missing.");

createRoot(root).render(
  <StrictMode>
    <SidePanel />
  </StrictMode>,
);
