import { expect, test } from "vitest";
import { combos, comboOf, KEYS, keyMap } from "./keys";

const REV: Record<string, string> = { Entf: "Delete", Rücktaste: "Backspace", Esc: "Escape", Menütaste: "ContextMenu", "←": "ArrowLeft", "→": "ArrowRight", "↑": "ArrowUp", "↓": "ArrowDown" };

/** „Strg+Umschalt+S" → Tastendruck wie im Browser */
function press(c: string) {
  let rest = c;
  const ctrlKey = rest.startsWith("Strg+") && rest.length > 5;
  if (ctrlKey) rest = rest.slice(5);
  const shiftKey = rest.startsWith("Umschalt+");
  if (shiftKey) rest = rest.slice(9);
  return { key: REV[rest] ?? rest, ctrlKey, shiftKey };
}

test("jedes Kürzel aus KEYS wird vom echten Tastendruck getroffen", () => {
  for (const k of Object.values(KEYS)) for (const c of combos(k)) expect(comboOf(press(c)), c).toBe(c);
});

test("Werkzeug-Buchstaben wirken auch mit Umschalt, Strg+Buchstabe unterscheidet Umschalt", () => {
  expect(comboOf({ key: "P", ctrlKey: false, shiftKey: true })).toBe("P");
  expect(comboOf({ key: "S", ctrlKey: true, shiftKey: true })).toBe(KEYS.saveAs);
  const m = keyMap([[KEYS.redo, () => {}]]);
  expect(Object.keys(m).sort()).toEqual(["Strg+Umschalt+Z", "Strg+Y"]);
});
