import { expect, test, vi } from "vitest";
import {
  afterShape, captureBinding, DEFAULT_PALETTES, DEFAULT_SETTINGS as S, initTools, loadPalettes, loadSettings, pickTool, storePalettes, toolFor,
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
  const mine = { ...DEFAULT_PALETTES, pen: [...DEFAULT_PALETTES.pen, { name: "Eigenes 6", color: [0.5, 0, 1] as [number, number, number], size: 7.3 }], text: 20 };
  storePalettes(mine);
  expect(loadPalettes()).toEqual(mine);
  mem.set("pdfnote.presets", '{"pen":"kaputt"}');
  expect(loadPalettes()).toEqual(DEFAULT_PALETTES);
  vi.unstubAllGlobals();
});
