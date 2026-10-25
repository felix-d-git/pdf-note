import { expect, test } from "vitest";
import { combos, comboOf, KEYS, keyMap, pressOf as press } from "./keys";

test("jedes Kürzel aus KEYS wird vom echten Tastendruck getroffen", () => {
  for (const k of Object.values(KEYS)) for (const c of combos(k)) expect(comboOf(press(c)), c).toBe(c);
});

test("Werkzeug-Buchstaben wirken auch mit Umschalt, Strg+Buchstabe unterscheidet Umschalt", () => {
  expect(comboOf({ key: "P", ctrlKey: false, shiftKey: true })).toBe("P");
  expect(comboOf({ key: "S", ctrlKey: true, shiftKey: true })).toBe(KEYS.saveAs);
  const m = keyMap([[KEYS.redo, () => {}]]);
  expect(Object.keys(m).sort()).toEqual(["Strg+Umschalt+Z", "Strg+Y"]);
});

test("Q/W/E = Stift, Umschalt+Q/W/E = Marker; Radierer wich auf D", () => {
  expect(comboOf({ key: "q", ctrlKey: false, shiftKey: false })).toBe(KEYS.pen1);
  expect(comboOf({ key: "W", ctrlKey: false, shiftKey: true })).toBe(KEYS.mark2);
  expect(KEYS.eraser).toBe("D");
  const all = Object.values(KEYS).flatMap(combos);
  expect(new Set(all).size).toBe(all.length); // keine doppelt belegte Taste
});
