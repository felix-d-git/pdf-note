import { expect, test } from "vitest";
import { normPressure, savedWidth, type Stroke } from "./ink";

const s = (p: number, simulated = false): Stroke => ({
  page: 0, color: [0, 0, 0], opacity: 1, size: 2, simulated, points: [[0, 0, p], [5, 5, p]],
});

test("gespeicherte Breite folgt dem mittleren Druck", () => {
  expect(savedWidth(s(0.5))).toBeCloseTo(2);
  expect(savedWidth(s(1))).toBeCloseTo(3);
  expect(savedWidth(s(0))).toBeCloseTo(1);
  expect(savedWidth(s(0, true))).toBe(2);
});

test("Druck wird auf Stift-Maximum normiert und begrenzt", () => {
  expect(normPressure(0.75)).toBe(1);
  expect(normPressure(0.9)).toBe(1);
  expect(normPressure(0)).toBe(0.05);
});
