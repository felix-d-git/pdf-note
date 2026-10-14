import { expect, test } from "vitest";
import { captureBinding, DEFAULT_SETTINGS as S, loadSettings, toolFor } from "./settings";

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
