import {
  ArrowUpRight, Axis3d, Circle, ClipboardPen, Eraser, FileText, Highlighter, Link, MousePointer2, Pen, PenLine, Shapes, Slash, Square, type LucideIcon,
} from "lucide-react";
import { T, type Strings } from "./i18n";
import type { Layer } from "./ink";
import type { Tool } from "./settings";

/**
 * Einzige Quelle aller Tastenkürzel: Tastatur-Handler (App, DocView), Tooltips und die Kürzel-Tabelle der Hilfe lesen von hier.
 * Schlüssel = Name in `T`; mehrere Kombinationen mit „ / " getrennt.
 */
export const KEYS = {
  open: "Strg+O", close: "Strg+W", nextTab: "Strg+Tab", prevTab: "Strg+Umschalt+Tab", help: "F1",
  save: "Strg+S", saveAs: "Strg+Umschalt+S", undo: "Strg+Z", redo: "Strg+Y / Strg+Umschalt+Z",
  pen: "P", marker: "M", eraser: "D", lasso: "A / T", line: "L", arrow: "F", rect: "R", ellipse: "K", axes: "X", form: "O", link: "G",
  pen1: "Q", pen2: "W", pen3: "E", mark1: "Umschalt+Q", mark2: "Umschalt+W", mark3: "Umschalt+E",
  image: "I", layer1: "1", layer2: "2", layer3: "3",
  selectAll: "Strg+A", copy: "Strg+C", cut: "Strg+X", paste: "Strg+V", del: "Entf / Rücktaste", nudge: "← / → / ↑ / ↓",
  escape: "Esc", menu: "Menütaste / Umschalt+F10", search: "Strg+F", zoomIn: "Strg++ / Strg+=", zoomOut: "Strg+-",
} as const satisfies Partial<Record<keyof Strings, string>>;

export const combos = (k: string) => k.split(" / ");

const NAMES: Record<string, string> = {
  Delete: "Entf", Backspace: "Rücktaste", Escape: "Esc", ContextMenu: "Menütaste", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓",
};

/**
 * Tastendruck → Kombination wie in `KEYS` („Strg+Umschalt+S"). Umschalt zählt nur bei Sondertasten und Strg+Buchstabe:
 * bei Zeichen hängt es vom Tastaturlayout ab (`+` auf US = Umschalt+`=`), Werkzeug-Buchstaben wirken auch groß.
 * Ausnahme Q/W/E: Umschalt wählt dort den Marker statt des Stifts.
 */
export function comboOf(e: { key: string; ctrlKey: boolean; shiftKey: boolean }) {
  const one = e.key.length === 1;
  const shift = e.shiftKey && (!one || (e.ctrlKey && /\p{L}/u.test(e.key)) || /^[qwe]$/i.test(e.key));
  return `${e.ctrlKey ? "Strg+" : ""}${shift ? "Umschalt+" : ""}${NAMES[e.key] ?? (one ? e.key.toUpperCase() : e.key)}`;
}

/** Aktionen je Kürzel aus `KEYS` → Nachschlagetabelle je Kombination */
export const keyMap = (list: [string, () => void][]): Record<string, () => void> =>
  Object.fromEntries(list.flatMap(([k, f]) => combos(k).map((c) => [c, f])));

/** Werkzeug, Symbol, Name, Kürzel (Werkzeugleiste + Hilfe) */
export const TOOL_LABELS: [Tool, LucideIcon, string, string][] = ([
  ["pen", Pen], ["marker", Highlighter], ["eraser", Eraser], ["lasso", MousePointer2], ["line", Slash], ["arrow", ArrowUpRight],
  ["rect", Square], ["ellipse", Circle], ["axes", Axis3d], ["form", ClipboardPen], ["link", Link],
] as const).map(([t, icon]) => [t, icon, T[t], KEYS[t]]);

/** Stift-Kürzel: Art, n-ter Stift dieser Art in `Palettes.pens`, Name, Kürzel */
export const QUICK: ["pen" | "marker", number, string, string][] = [
  ["pen", 0, T.pen1, KEYS.pen1], ["pen", 1, T.pen2, KEYS.pen2], ["pen", 2, T.pen3, KEYS.pen3],
  ["marker", 0, T.mark1, KEYS.mark1], ["marker", 1, T.mark2, KEYS.mark2], ["marker", 2, T.mark3, KEYS.mark3],
];

/** Ebene, Symbol, Name; Kürzel = Nummer */
export const LAYERS: [Layer, LucideIcon, string][] = [[1, FileText, T.layer1], [2, Shapes, T.layer2], [3, PenLine, T.layer3]];
