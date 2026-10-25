import { expect, test } from "vitest";
import { hsv2rgb, rgb2hsv } from "./ColorPicker";

test("HSV <-> RGB Rundreise", () => {
  for (const c of [[1, 0, 0], [0, 1, 0], [0.2, 0.4, 0.8], [0.5, 0.5, 0.5], [1, 0.86, 0.1]] as const) {
    hsv2rgb(...rgb2hsv([...c])).forEach((v, i) => expect(v).toBeCloseTo(c[i] ?? 0, 5));
  }
  expect(hsv2rgb(0, 1, 1)).toEqual([1, 0, 0]);
});
