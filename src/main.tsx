import { availableMonitors, getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { loadSession, placeWindow } from "./session";
import { applyTheme, loadSettings } from "./settings";

// Ansicht vor dem ersten Bild setzen; das Fenster ist bis dahin versteckt (tauri.conf: visible false)
applyTheme(loadSettings().theme);

/** Fenster wie zuletzt (fehlender Monitor → auf einen sichtbaren), noch versteckt */
async function placeWin() {
  const last = loadSession()?.win;
  if (!last) return;
  const w = getCurrentWindow();
  const p = placeWindow(last, await availableMonitors());
  await w.setSize(new PhysicalSize(p.w, p.h));
  await w.setPosition(new PhysicalPosition(p.x, p.y));
  if (p.max) await w.maximize();
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
const placed = placeWin().catch(() => {});
requestAnimationFrame(() => requestAnimationFrame(() => void placed.then(() => getCurrentWindow().show())));
