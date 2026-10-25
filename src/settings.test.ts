// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { DEFAULT_PENS, type Pen } from "./ink";
import {
  afterShape, applyTheme, captureBinding, DEFAULT_PALETTES, deviceTools, DEFAULT_SETTINGS as S, initTools, loadPalettes, loadSettings, movePen, nthPen, pickTool,
  storePalettes, storeSettings, toolFor, pickColor,
} from "./settings";

test("Gerät bestimmt das Werkzeug", () => {
  let t = initTools(true);
  expect([t.mouse, t.pen]).toEqual(["lasso", "pen"]); // Maus wählt/tippt, Stift schreibt
  t = pickTool(t, "marker", "pen", true);
  expect([t.mouse, t.pen]).toEqual(["lasso", "marker"]);
  t = pickTool(t, "lasso", "pen", true); // Stift wählt Auswahl, Maus bleibt
  t = pickTool(t, "pen", "mouse", true); // Maus wählt Zeichenwerkzeug → zeichnet (bis Esc), Stift auch
  expect([t.mouse, t.pen]).toEqual(["pen", "pen"]);
  // ohne Automatik ein Werkzeug für alle
  expect(pickTool(initTools(false), "marker", "pen", false).mouse).toBe("marker");
});

test("Form → zurück zum vorherigen Werkzeug, mit Schloss nicht", () => {
  let t = pickTool(initTools(true), "marker", "pen", true);
  t = pickTool(t, "rect", "pen", true);
  t = pickTool(t, "ellipse", "pen", true); // Formwechsel überschreibt das Vorherige nicht
  expect(afterShape(t).pen).toBe("marker");
  expect(afterShape(t).mouse).toBe("lasso");
  expect(afterShape({ ...t, locked: true }).pen).toBe("ellipse");
  expect(pickTool({ ...t, locked: true }, "ellipse", "pen", true).locked).toBe(false); // Klick aufs Symbol löst
});

test("Stifttasten wählen Werkzeug für die Geste", () => {
  expect(toolFor({ pointerType: "pen", buttons: 1 }, "pen", S)).toBe("pen");
  expect(toolFor({ pointerType: "pen", buttons: 3 }, "pen", S)).toBe("lasso"); // Spitze + Seitentaste
  expect(toolFor({ pointerType: "pen", buttons: 32 }, "marker", S)).toBe("eraser");
  expect(toolFor({ pointerType: "mouse", buttons: 2 }, "pen", S)).toBeNull(); // Rechtsklick zeichnet nicht
  expect(toolFor({ pointerType: "mouse", buttons: 1 }, "rect", S)).toBe("rect");
});

test("Taste lernen ignoriert die Spitze", () => {
  expect(captureBinding({ pointerType: "pen", buttons: 1 })).toBeNull();
  expect(captureBinding({ pointerType: "pen", buttons: 3 })).toEqual({ pointerType: "pen", buttons: 2 });
});

test("ohne Speicher → Standard", () => {
  expect(loadSettings()).toEqual(S);
});

test("Presets überleben den Neustart, kaputte Daten → Standard", () => {
  expect(loadPalettes()).toEqual(DEFAULT_PALETTES); // ohne localStorage
  const mem = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) });
  const mine = { pens: [...DEFAULT_PALETTES.pens, { kind: "marker" as const, color: [0.5, 0, 1] as [number, number, number], size: 7.3 }], text: 20 };
  storePalettes(mine);
  expect(loadPalettes()).toEqual(mine);
  mem.set("pdfnote.presets", '{"pen":"kaputt"}');
  expect(loadPalettes()).toEqual(DEFAULT_PALETTES);
  vi.unstubAllGlobals();
});

test("Ansicht + Seitenleiste: alte Einstellungen → dunkel/offen, Auswahl überlebt den Neustart, Hell setzt data-theme", () => {
  const mem = new Map<string, string>([["pdfnote.settings", JSON.stringify({ lasso: S.lasso, eraser: S.eraser, pressureMax: 0.8 })]]);
  vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) });
  expect(loadSettings()).toMatchObject({ theme: "dark", side: true, auto: true });
  storeSettings({ ...S, theme: "system", side: false });
  expect(loadSettings()).toMatchObject({ theme: "system", side: false });
  vi.unstubAllGlobals();
  applyTheme("light");
  expect(document.documentElement.dataset.theme).toBe("light");
  applyTheme("dark");
  expect(document.documentElement.dataset.theme).toBeUndefined();
});

test("Stiftleiste: Marker-Grün bei aktivem Stift-Rot → Werkzeug Marker, Farbe Grün, Stift-Farbe bleibt", () => {
  const rot = nthPen(DEFAULT_PENS, "pen", 0) as Pen;
  const gruen = nthPen(DEFAULT_PENS, "marker", 1) as Pen;
  const start = { tools: pickTool(initTools(false), "pen", "mouse", false), preset: { color: rot.color, size: rot.size }, marker: DEFAULT_PENS[4] as Pen };
  const r = pickColor(start, gruen, "mouse", false);
  expect(r.tools.mouse).toBe("marker");
  expect(r.marker).toEqual({ color: gruen.color, size: gruen.size });
  expect(r.preset).toBe(start.preset);
  // Stift-Gerät bei Automatik: nur der Stift wechselt, die Maus behält Auswahl
  const a = pickColor({ ...start, tools: initTools(true) }, gruen, "pen", true);
  expect([a.tools.mouse, a.tools.pen]).toEqual(["lasso", "marker"]);
});

test("Stiftleiste: Ziehen ordnet um, Q W E = n-ter Stift bzw. Marker in Leistenreihenfolge", () => {
  const list = movePen(DEFAULT_PENS, 4, 0); // ersten Marker ganz nach vorn
  expect(list[0]).toBe(DEFAULT_PENS[4]);
  expect(list).toHaveLength(DEFAULT_PENS.length);
  expect(nthPen(list, "marker", 0)).toBe(DEFAULT_PENS[4]);
  expect(nthPen(list, "pen", 0)).toBe(DEFAULT_PENS[0]);
  expect(nthPen(movePen(DEFAULT_PENS, 0, 2), "pen", 0)).toBe(DEFAULT_PENS[1]);
});

test("Migration: alte Paletten (quick + eigene) → eine Leiste; Druck-aus-Preset → globaler Druck aus; Müll → Standard", () => {
  const mem = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) });
  const old = (name: string, c: number, size: number, pressure?: boolean) => ({ name, color: [c, 0, 0], size, ...(pressure === undefined ? {} : { pressure }) });
  mem.set("pdfnote.presets", JSON.stringify({
    pen: [old("Fein", 0.1, 1), old("Eigenes 5", 0.2, 3, false)], marker: [old("Gelb", 0.3, 12), old("Custom 4", 0.4, 20)], text: 16,
    quick: { pen: [old("Rot", 0.5, 2.2)], marker: [old("MRot", 0.6, 12)] },
  }));
  mem.set("pdfnote.settings", JSON.stringify({ lasso: S.lasso, eraser: S.eraser, pressureMax: 0.8 }));
  const p = loadPalettes();
  expect(p.text).toBe(16);
  expect(p.pens.map((x) => [x.kind, x.color[0], x.size])).toEqual([["pen", 0.5, 2.2], ["pen", 0.2, 3], ["marker", 0.6, 12], ["marker", 0.4, 20]]);
  expect(loadSettings().pressure).toBe(false);
  expect(JSON.parse(mem.get("pdfnote.settings") ?? "{}").pressure).toBe(false); // sofort gespeichert
  mem.set("pdfnote.presets", '{"pens":[{"kind":"pinsel"}]}');
  expect(loadPalettes()).toEqual(DEFAULT_PALETTES);
  mem.set("pdfnote.settings", JSON.stringify({ pressure: "ja", smooth: 5 }));
  expect(loadSettings()).toEqual(S);
  // v1.1.0 ohne Farbfelder/eigene → Standardleiste statt leer
  mem.set("pdfnote.presets", JSON.stringify({ pen: [old("Fein", 0.1, 1)], marker: [old("Gelb", 0.3, 12)], text: 16 }));
  expect(loadPalettes().pens).toEqual(DEFAULT_PALETTES.pens);
  // kaputtes Presets-JSON verwirft die übrigen Einstellungen nicht
  mem.set("pdfnote.presets", "{kaputt");
  mem.set("pdfnote.settings", JSON.stringify({ lasso: S.lasso, eraser: S.eraser, pressureMax: 0.5 }));
  expect(loadSettings().pressureMax).toBe(0.5);
  vi.unstubAllGlobals();
});

test("§3 Gerätewechsel: Stift → letzter Stift/Marker statt Radierer/Auswahl/Form, Maus → Auswahl", () => {
  const t = initTools(true);
  expect(deviceTools({ ...t, pen: "eraser" }, "pen", "marker").pen).toBe("marker");
  expect(deviceTools({ ...t, pen: "lasso" }, "pen", "pen").pen).toBe("pen");
  expect(deviceTools({ ...t, pen: "rect", locked: true }, "pen", "pen")).toMatchObject({ pen: "pen", locked: false });
  expect(deviceTools({ ...t, pen: "marker" }, "pen", "pen").pen).toBe("marker");
  expect(deviceTools({ ...t, mouse: "eraser" }, "mouse", "pen")).toMatchObject({ mouse: "lasso", pen: "pen" });
});

test("§3 zuletzt genutzter Stift überlebt den Neustart", () => {
  const mem = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) });
  const last = { kind: "marker" as const, color: [1, 1, 0] as [number, number, number], size: 9 };
  storePalettes({ ...DEFAULT_PALETTES, last });
  expect(loadPalettes().last).toEqual(last);
  vi.unstubAllGlobals();
});
