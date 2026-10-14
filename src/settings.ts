import { z } from "zod";
import { PRESSURE_MAX } from "./ink";

export const TOOLS = ["pen", "marker", "eraser", "lasso", "text", "line", "arrow", "rect", "ellipse"] as const;
export type Tool = (typeof TOOLS)[number];

/** Stifttaste: Zeigerart + Bitmaske aus PointerEvent.buttons (2 = Seitentaste, 32 = Radierer-Ende). */
const Binding = z.object({ pointerType: z.string(), buttons: z.number().int().positive() });
export type Binding = z.infer<typeof Binding>;

const Settings = z.object({
  lasso: Binding,
  eraser: Binding,
  pressureMax: z.number().min(0.3).max(1),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  lasso: { pointerType: "pen", buttons: 2 },
  eraser: { pointerType: "pen", buttons: 32 },
  pressureMax: PRESSURE_MAX,
};

const KEY = "pdfnote.settings";

// localStorage kann in WebView2 fehlen/werfen → Standardwerte
export function loadSettings(): Settings {
  try {
    return Settings.parse(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function storeSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* nur Komfort */
  }
}

const matches = (b: Binding, e: { pointerType: string; buttons: number }) =>
  e.pointerType === b.pointerType && (e.buttons & b.buttons) === b.buttons;

/** Werkzeug für diese Geste: gebundene Taste schlägt das gewählte Werkzeug; sonst nur Spitze/linke Taste. */
export function toolFor(e: { pointerType: string; buttons: number }, tool: Tool, s: Settings): Tool | null {
  if (matches(s.eraser, e)) return "eraser";
  if (matches(s.lasso, e)) return "lasso";
  return e.buttons === 1 ? tool : null;
}

/** Taste aus einem Ereignis lernen: alles außer Spitze/linker Taste. */
export const captureBinding = (e: { pointerType: string; buttons: number }): Binding | null =>
  e.buttons & ~1 ? { pointerType: e.pointerType, buttons: e.buttons & ~1 } : null;

export const describe = (b: Binding) =>
  `${b.pointerType === "pen" ? "Stift" : b.pointerType === "mouse" ? "Maus" : b.pointerType}, Taste ${b.buttons}`;
