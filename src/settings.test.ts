import { expect, test, vi } from "vitest";
import { captureBinding, DEFAULT_PALETTES, DEFAULT_SETTINGS as S, loadPalettes, loadSettings, storePalettes, toolFor } from "./settings";

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
