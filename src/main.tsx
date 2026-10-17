import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyTheme, loadSettings } from "./settings";

// Ansicht vor dem ersten Bild setzen; das Fenster ist bis dahin versteckt (tauri.conf: visible false)
applyTheme(loadSettings().theme);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
requestAnimationFrame(() => requestAnimationFrame(() => void getCurrentWindow().show()));
