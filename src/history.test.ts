// Undo-Verlauf: ein Schritt ohne Änderung darf die PDF nicht als geändert markieren (Bug folien.pdf, R1 v1.3.0).
import { expect, test, vi } from "vitest";
import type { Item } from "./ink";
import { push, type Snap } from "./DocView";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => new Promise(() => {}) }));

test("push ohne Änderung behält den Verlauf, echte Änderung legt einen Schritt an", () => {
  const a = { id: 1 } as Item;
  const init: Snap = { items: [a], rev: 0, sizes: [[595, 842]] };
  const h = { list: [init], at: 0 };
  // gleiche Objekte in neuem Array (z. B. map ohne Treffer) → kein Schritt, Stand bleibt `saved`
  expect(push(h, { ...init, items: init.items.map((it) => it) })).toBe(h);
  expect(push(h, { ...init, items: [{ ...a }] }).list).toHaveLength(2);
  expect(push(h, { ...init, rev: 1 }).list).toHaveLength(2);
});
