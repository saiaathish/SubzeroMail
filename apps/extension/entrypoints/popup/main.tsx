import { createRoot } from "react-dom/client";
import { Popup } from "../../src/ui/Popup";
import "@subzero/ui/styles.css";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Subzero popup root is missing.");

createRoot(root).render(<Popup />);
