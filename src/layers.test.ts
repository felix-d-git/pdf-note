// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isLayerLocked, LOCK_EVENT, lockedLayers, setLayerLocked, targetLayer } from "./layers";

beforeEach(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) });
});
afterEach(() => vi.unstubAllGlobals());

test("Sperre gilt je Dokument und Ebene, überlebt Neuladen, wird wieder aufgehoben", () => {
  expect(isLayerLocked("a.pdf", 1)).toBe(false);
  setLayerLocked("a.pdf", 1, true);
  setLayerLocked("a.pdf", 3, true);
  expect(lockedLayers("a.pdf")).toEqual([1, 3]);
  expect(isLayerLocked("a.pdf", 2)).toBe(false);
  expect(isLayerLocked("b.pdf", 1)).toBe(false);
  setLayerLocked("a.pdf", 1, false);
  expect(lockedLayers("a.pdf")).toEqual([3]);
});

test("kaputter Speicher → nichts gesperrt", () => {
  localStorage.setItem("pdfnote.locks", '{"a.pdf":[7]}');
  expect(isLayerLocked("a.pdf", 1)).toBe(false);
});

test("Zielebene je Werkzeug: Marker/Formen liegen über gesperrter Ebene 1", () => {
  expect(targetLayer("lasso", 1)).toBe(1);
  expect(targetLayer("eraser", 1)).toBe(3);
  expect(targetLayer("marker", 1)).toBe(3);
  expect(targetLayer("rect", 1)).toBe(2);
  expect(targetLayer("rect", 3)).toBe(3);
  expect(targetLayer("pen", 2)).toBe(3);
  expect(targetLayer("marker", 2)).toBe(3);
  expect(targetLayer("space", 2)).toBeNull();
});

test("Änderung meldet sich per Ereignis (Split-Hälfte mit derselben PDF übernimmt sofort)", () => {
  const seen = vi.fn();
  window.addEventListener(LOCK_EVENT, seen);
  setLayerLocked("a.pdf", 2, true);
  window.removeEventListener(LOCK_EVENT, seen);
  expect(seen).toHaveBeenCalledOnce();
});
