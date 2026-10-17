import { z } from "zod";
import { MARKERS, PRESETS, PRESSURE_MAX, TEXT_SIZE, type Preset } from "./ink";

/** `lasso` = Auswahl/Text (Klick setzt Cursor, Ziehen wählt aus); `space` = Platz einfügen (waagrechte Linie ziehen) */
export const TOOLS = ["pen", "marker", "eraser", "lasso", "line", "arrow", "rect", "ellipse", "axes", "form", "link", "space"] as const;
export type Tool = (typeof TOOLS)[number];

/** Stifttaste: Zeigerart + Bitmaske aus PointerEvent.buttons (2 = Seitentaste, 32 = Radierer-Ende). */
const Binding = z.object({ pointerType: z.string(), buttons: z.number().int().positive() });
export type Binding = z.infer<typeof Binding>;

const Settings = z.object({
  lasso: Binding,
  eraser: Binding,
  pressureMax: z.number().min(0.3).max(1),
  /** Gerät bestimmt das Werkzeug: Stift → Stift-Werkzeug, Maus → Auswahl/Text (fehlt in alten Einstellungen → an) */
  auto: z.boolean().default(true),
  /** Ansicht; System = Windows-Einstellung. Je Gerät (localStorage), erster Start dunkel */
  theme: z.enum(["light", "dark", "system"]).default("dark"),
  /** Seitenleiste offen (ohne Split View; im Split startet sie eingeklappt) */
  side: z.boolean().default(true),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  lasso: { pointerType: "pen", buttons: 2 },
  eraser: { pointerType: "pen", buttons: 32 },
  pressureMax: PRESSURE_MAX,
  auto: true,
  theme: "dark",
  side: true,
};

const prefersLight = () => globalThis.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
/** Hell-Tokens per data-theme an <html>; PDF-Seiten bleiben immer weiß (nie invertiert) */
export function applyTheme(t: Settings["theme"]) {
  const light = t === "light" || (t === "system" && prefersLight());
  if (light) document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
}

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

/** Presets (Stift/Formen, Marker) und Textgröße, gerätelokal */
const PresetData = z.object({ name: z.string(), color: z.tuple([z.number(), z.number(), z.number()]), size: z.number().positive() });
const Palettes = z.object({ pen: z.array(PresetData), marker: z.array(PresetData), text: z.number().positive() });
export interface Palettes { pen: Preset[]; marker: Preset[]; text: number }
export const DEFAULT_PALETTES: Palettes = { pen: PRESETS, marker: MARKERS, text: TEXT_SIZE };
const PKEY = "pdfnote.presets";

export function loadPalettes(): Palettes {
  try {
    return Palettes.parse(JSON.parse(localStorage.getItem(PKEY) ?? "null"));
  } catch {
    return DEFAULT_PALETTES;
  }
}

export function storePalettes(p: Palettes) {
  try {
    localStorage.setItem(PKEY, JSON.stringify(p));
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

/**
 * Werkzeug je Gerät: `mouse` gilt ohne `auto` für alle Geräte, `pen` nur mit `auto` für den Stift.
 * `prev` = Werkzeug vor einer Form (danach geht es dorthin zurück), `locked` = Form bleibt (Doppelklick aufs Symbol).
 */
export interface Tools { mouse: Tool; pen: Tool; prev: { mouse: Tool; pen: Tool }; locked: boolean }
/** Einmal-Werkzeuge: danach zurück zum vorherigen (Platz einfügen wie eine Form) */
export const SHAPE_TOOLS: readonly Tool[] = ["line", "arrow", "rect", "ellipse", "axes", "space"];
export const initTools = (auto: boolean): Tools => ({ mouse: auto ? "lasso" : "pen", pen: "pen", prev: { mouse: "lasso", pen: "pen" }, locked: false });

/** Werkzeug wählen; `dev` = womit. Bei `auto` setzt der Stift nur seins, die Maus ihres – Zeichenwerkzeuge gelten auch für den Stift. */
export function pickTool(s: Tools, t: Tool, dev: "pen" | "mouse", auto: boolean): Tools {
  const draw = t !== "lasso" && t !== "form" && t !== "link";
  const mouse = !auto || dev === "mouse";
  const pen = auto && (dev === "pen" || draw);
  const shape = SHAPE_TOOLS.includes(t);
  return {
    mouse: mouse ? t : s.mouse,
    pen: pen ? t : s.pen,
    prev: {
      mouse: mouse && shape && !SHAPE_TOOLS.includes(s.mouse) ? s.mouse : s.prev.mouse,
      pen: pen && shape && !SHAPE_TOOLS.includes(s.pen) ? s.pen : s.prev.pen,
    },
    locked: false,
  };
}

/** Nach dem Zeichnen einer Form: zurück zum vorherigen Werkzeug, außer mit Schloss. */
export const afterShape = (s: Tools): Tools => s.locked ? s : {
  ...s,
  mouse: SHAPE_TOOLS.includes(s.mouse) ? s.prev.mouse : s.mouse,
  pen: SHAPE_TOOLS.includes(s.pen) ? s.prev.pen : s.pen,
};

/** Taste aus einem Ereignis lernen: alles außer Spitze/linker Taste. */
export const captureBinding = (e: { pointerType: string; buttons: number }): Binding | null =>
  e.buttons & ~1 ? { pointerType: e.pointerType, buttons: e.buttons & ~1 } : null;

export const describe = (b: Binding) =>
  `${b.pointerType === "pen" ? "Stift" : b.pointerType === "mouse" ? "Maus" : b.pointerType}, Taste ${b.buttons}`;
