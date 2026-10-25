import { expect, test } from "vitest";
import { posAt, selRange, type CharLine } from "./textsel";

// zwei Zeilen à 10 pt breite Zeichen
const line = (text: string, y: number): CharLine => ({ text, boxes: [...text].map((_, i) => [i * 10, y, i * 10 + 10, y + 12]) });
const lines = [line("Hallo", 0), line("Welt", 20)];

test("Stelle unter dem Punkt: nur auf Text, beim Ziehen nächste Zeile", () => {
  expect(posAt(lines, 12, 5)).toEqual([0, 1]);
  expect(posAt(lines, 16, 5)).toEqual([0, 2]);
  expect(posAt(lines, 200, 5)).toBeNull();
  expect(posAt(lines, 200, 5, true)).toEqual([0, 5]);
  expect(posAt(lines, 2, 100, true)).toEqual([1, 0]);
  expect(posAt([], 0, 0, true)).toBeNull();
});

test("Markierung über Zeilen, Richtung egal, OCR-Text wie normaler Text", () => {
  expect(selRange(lines, [0, 3], [1, 2])).toEqual({ rects: [[30, 0, 50, 12], [0, 20, 20, 32]], text: "lo\nWe" });
  expect(selRange(lines, [1, 2], [0, 3]).text).toBe("lo\nWe");
  expect(selRange(lines, [0, 2], [0, 2])).toEqual({ rects: [], text: "" });
  expect(selRange([line("Äß€", 0)], [0, 0], [0, 3]).text).toBe("Äß€");
});
