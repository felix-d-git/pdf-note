import { z } from "zod";
import { DEFAULT_PENS, PRESSURE_MAX, TEXT_SIZE, type Pen, type Preset } from "./ink";

/** `lasso` = Auswahl/Text (Klick setzt Cursor, Ziehen wählt aus); `space` = Platz einfügen (waagrechte Linie ziehen) */
export const TOOLS = ["pen", "marker", "eraser", "lasso", "line", "arrow", "rect", "ellipse", "axes", "form", "link", "space"] as const;
export type Tool = (typeof TOOLS)[number];

/** Stifttaste: Zeigerart + Bitmaske aus PointerEvent.buttons (2 = Seitentaste, 32 = Radierer-Ende). */
const Binding = z.object({ pointerType: z.string(), buttons: z.number().int().positive() });
export type Binding = z.infer<typeof Binding>;

export const Settings = z.object({
  lasso: Binding,
  eraser: Binding,
  pressureMax: z.number().min(0.3).max(1),
  /** Stiftdruck für alle Stifte (aus = konstante Breite); fehlt → aus alten Presets übernommen */
  pressure: z.boolean().default(true),
  /** Glättung 0–0,9 für alle Stifte; 0 = exakt wie gezeichnet */
  smooth: z.number().min(0).max(0.9).default(0),
  /** Gerät bestimmt das Werkzeug: Stift → Stift-Werkzeug, Maus → Auswahl/Text (fehlt in alten Einstellungen → an) */
  auto: z.boolean().default(true),
  /** Ansicht; System = Windows-Einstellung. Je Gerät (localStorage), erster Start dunkel */
  theme: z.enum(["light", "dark", "system"]).default("dark"),
  /** Seitenleiste offen (ohne Split View; im Split startet sie eingeklappt) */
  side: z.boolean().default(true),
  /** Vorladen: sichtbarer Tab ± Seiten, versteckter Tab ± Seiten, Speichergrenze der Seitenbilder in MB */
  preload: z.number().int().min(0).max(200).default(25),
  preloadHidden: z.number().int().min(0).max(50).default(5),
  memMb: z.number().int().min(128).max(8192).default(1024),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  lasso: { pointerType: "pen", buttons: 2 },
  eraser: { pointerType: "pen", buttons: 32 },
  pressureMax: PRESSURE_MAX,
  pressure: true,
  smooth: 0,
  auto: true,
  theme: "dark",
  side: true,
  preload: 25,
  preloadHidden: 5,
  memMb: 1024,
};

const prefersLight = () => globalThis.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
/** Hell-Tokens per data-theme an <html>; PDF-Seiten bleiben immer weiß (nie invertiert) */
export function applyTheme(t: Settings["theme"]) {
  const light = t === "light" || (t === "system" && prefersLight());
  if (light) document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
}

const KEY = "pdfnote.settings";
const PKEY = "pdfnote.presets";

// localStorage kann in WebView2 fehlen/werfen → Standardwerte
export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    // v1.1: Druck hing am Stift-Preset → aus, wenn ein altes Stift-Preset ihn abgeschaltet hatte
    if (raw?.pressure !== undefined) return Settings.parse(raw);
    // gleich sichern: die Leiste schreibt die Presets beim ersten Öffnen im neuen Format
    const s = Settings.parse({ ...raw, pressure: !legacyPressureOff() });
    storeSettings(s);
    return s;
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

/** Stifte der Werkzeugleiste und Textgröße, gerätelokal */
const Rgb = z.tuple([z.number(), z.number(), z.number()]);
const PenData = z.object({ kind: z.enum(["pen", "marker"]), color: Rgb, size: z.number().positive() });
/** v1.1: Punkt-Presets + sechs Farbfelder → Farbfelder und eigene Presets werden Stifte; kaputte Daten → Standard */
const Old = z.object({ name: z.string(), color: Rgb, size: z.number().positive(), pressure: z.boolean().optional() });
const Legacy = z.object({
  pen: z.array(Old), marker: z.array(Old), text: z.number().positive(),
  quick: z.object({ pen: z.array(Old), marker: z.array(Old) }).optional(),
});
const own = (p: z.infer<typeof Old>) => /^(Eigenes|Custom) /.test(p.name);
const Palettes = z.union([
  /** `last` = zuletzt genutzter Stift/Marker (Start und Rücksprung auf den Stift) */
  z.object({ pens: z.array(PenData), text: z.number().positive(), last: PenData.optional() }),
  Legacy.transform((o) => {
    const pens = [
      ...[...(o.quick?.pen ?? []), ...o.pen.filter(own)].map(({ color, size }) => ({ kind: "pen" as const, color, size })),
      ...[...(o.quick?.marker ?? []), ...o.marker.filter(own)].map(({ color, size }) => ({ kind: "marker" as const, color, size })),
    ];
    // v1.1.0 ohne Farbfelder und ohne eigene Presets → Standardleiste statt leerer
    return { pens: pens.length ? pens : DEFAULT_PENS, text: o.text };
  }),
]);
export interface Palettes { pens: Pen[]; text: number; last?: Pen }
export const DEFAULT_PALETTES: Palettes = { pens: DEFAULT_PENS, text: TEXT_SIZE };

function legacyPressureOff() {
  try {
    const o = Legacy.safeParse(JSON.parse(localStorage.getItem(PKEY) ?? "null"));
    return o.success && [...o.data.pen, ...(o.data.quick?.pen ?? [])].some((p) => p.pressure === false);
  } catch {
    return false; // kaputte Presets dürfen die übrigen Einstellungen nicht verwerfen
  }
}

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

/** Farbfeld-Klick: Werkzeug und Farbe in einem Schritt (Stift-Farbe → `preset`, Marker-Farbe → `marker`) */
export interface Picked { tools: Tools; preset: Preset; marker: Preset }
export function pickColor(s: Picked, pen: Pen, dev: "pen" | "mouse", auto: boolean): Picked {
  const p = { color: pen.color, size: pen.size };
  return { ...s, tools: pickTool(s.tools, pen.kind, dev, auto), ...(pen.kind === "pen" ? { preset: p } : { marker: p }) };
}

/** Stift `from` an die Stelle `to` schieben (Ziehen in der Leiste) */
export const movePen = (list: Pen[], from: number, to: number) => {
  const r = [...list];
  const [x] = r.splice(from, 1);
  if (x) r.splice(to, 0, x);
  return r;
};
/** n-ter Stift bzw. Marker (Q W E / Umschalt+Q W E) */
export const nthPen = (list: Pen[], kind: Pen["kind"], n: number) => list.filter((p) => p.kind === kind)[n];

/** Gerätewechsel (bei `auto`): Stift → zuletzt genutzter Stift/Marker (nie Radierer/Auswahl/Form), Maus → Auswahl. */
export const deviceTools = (s: Tools, dev: "pen" | "mouse", last: Pen["kind"]): Tools =>
  dev === "pen" ? { ...s, pen: s.pen === "pen" || s.pen === "marker" ? s.pen : last, locked: false } : { ...s, mouse: "lasso", locked: false };

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
