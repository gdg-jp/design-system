import { hydrateRoot } from "react-dom/client";
import { App } from "./App";
import "@gdgjp/design-system/tokens.css";
import "@gdgjp/design-system/components.css";
import "@gdgjp/design-system/fonts.css";
const root = document.getElementById("root");
if (!root) throw new Error("Missing consumer root");
hydrateRoot(root, <App />);
