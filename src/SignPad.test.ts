// @vitest-environment jsdom
import { expect, test } from "vitest";
import { inkBounds } from "./SignPad";
import { loadSign, storeSign } from "./settings";

test("inkBounds: Rechteck um deckende Pixel, leer → null", () => {
  const w = 5, h = 4, d = new Uint8ClampedArray(w * h * 4);
  expect(inkBounds(d, w, h)).toBeNull();
  d[(1 * w + 2) * 4 + 3] = 255;
  d[(3 * w + 3) * 4 + 3] = 10;
  expect(inkBounds(d, w, h)).toEqual([2, 1, 4, 4]);
});

test("Unterschrift gerätelokal: speichern, laden, leer speichern löscht; kaputte Daten → leer", () => {
  storeSign({ sign: "iVBORw0KGgoA", initials: "iVBORw0KGgoB" });
  expect(loadSign()).toEqual({ sign: "iVBORw0KGgoA", initials: "iVBORw0KGgoB" });
  storeSign({ ...loadSign(), initials: undefined });
  expect(loadSign()).toEqual({ sign: "iVBORw0KGgoA" });
  localStorage.setItem("pdfnote.sign", "{kaputt");
  expect(loadSign()).toEqual({});
});
