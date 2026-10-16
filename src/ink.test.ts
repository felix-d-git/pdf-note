import { expect, test } from "vitest";
import {
  afterDelete, afterInsert, afterMove, afterRotate, box, hitTest, imageItem, imageMime, inPolygon, ItemData, fromData, layerOf, movedIndex, normPressure,
  rotateItem, savedWidth, scaleItem, toData, type InkPoint, type Item, type Kind,
} from "./ink";

const s = (p: number, simulated = false): Item => ({
  id: 1, page: 0, kind: "ink", color: [0, 0, 0], opacity: 1, size: 2, simulated, points: [[0, 0, p], [5, 5, p]], text: "",
});
const it = (kind: Kind, points: [number, number][], page = 0): Item => ({
  ...s(0.5), kind, page, points: points.map(([x, y]): InkPoint => [x, y, 0.5]),
});

test("gespeicherte Breite folgt dem mittleren Druck", () => {
  expect(savedWidth(s(0.5))).toBeCloseTo(2);
  expect(savedWidth(s(1))).toBeCloseTo(3);
  expect(savedWidth(s(0))).toBeCloseTo(1);
  expect(savedWidth(s(0, true))).toBe(2);
  expect(savedWidth({ ...s(1), kind: "rect" })).toBe(2);
});

test("Druck wird auf Stift-Maximum normiert und begrenzt", () => {
  expect(normPressure(0.75)).toBe(1);
  expect(normPressure(0.9)).toBe(1);
  expect(normPressure(0)).toBe(0.05);
  expect(normPressure(0.25, 0.5)).toBe(0.5);
});

test("Treffer je Objektart", () => {
  const line = it("line", [[0, 0], [100, 0]]);
  expect(hitTest(line, 50, 2, 1)).toBe(true);
  expect(hitTest(line, 50, 5, 1)).toBe(false);
  const rect = it("rect", [[0, 0], [100, 50]]);
  expect(hitTest(rect, 100, 25, 1)).toBe(true);
  expect(hitTest(rect, 50, 25, 1)).toBe(false); // innen leer
  const ell = it("ellipse", [[0, 0], [100, 50]]);
  expect(hitTest(ell, 50, 0, 1)).toBe(true);
  expect(hitTest(ell, 50, 25, 1)).toBe(false);
  const text = { ...it("text", [[10, 10], [60, 30]]), text: "x" };
  expect(hitTest(text, 30, 20, 0)).toBe(true);
  expect(hitTest(text, 70, 20, 0)).toBe(false);
  expect(hitTest(it("ink", [[5, 5]]), 6, 6, 1)).toBe(true);
});

test("Punkt im Lasso", () => {
  const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  expect(inPolygon(5, 5, sq)).toBe(true);
  expect(inPolygon(15, 5, sq)).toBe(false);
});

test("Skalieren nimmt Breite mit", () => {
  const r = scaleItem(it("rect", [[10, 10], [20, 20]]), 10, 10, 2);
  expect(r?.points.map(([x, y]) => [x, y])).toEqual([[10, 10], [30, 30]]);
  expect(r.size).toBe(4);
});

test("Seitenoperationen nummerieren Objekte um", () => {
  const items = [0, 1, 2].map((p) => it("line", [[0, 0], [1, 1]], p));
  expect(afterInsert(items, 1, 2).map((i) => i.page)).toEqual([0, 3, 4]);
  expect(afterDelete(items, 1).map((i) => i.page)).toEqual([0, 1]);
  expect(afterMove(items, 0, 2).map((i) => i.page)).toEqual([2, 0, 1]);
  expect(afterMove(items, 2, 0).map((i) => i.page)).toEqual([1, 2, 0]);
  // jede Verschiebung bleibt eine Permutation
  for (let f = 0; f < 4; f++)
    for (let t = 0; t < 4; t++)
      expect(new Set([0, 1, 2, 3].map((p) => movedIndex(p, f, t))).size).toBe(4);
  // 90° im Uhrzeigersinn, Höhe 100: oben links → oben rechts
  const r = afterRotate([it("line", [[0, 0], [10, 20]])], 0, 100)[0];
  expect(r?.points.map(([x, y]) => [x, y])).toEqual([[100, 0], [80, 10]]);
});

test("Speicherform passt zur Lade-Prüfung", () => {
  const d = toData(it("arrow", [[1, 2], [3, 4]]));
  const back = fromData(ItemData.parse(d));
  expect(back.points).toEqual(d.points);
  expect(() => ItemData.parse({ ...d, kind: "bogus" })).toThrow();
  expect(() => ItemData.parse({ ...d, points: [[NaN, 0, 0]] })).toThrow();
});

test("Ebene: gespeichert, alte Objekte ohne Angabe nach Art", () => {
  expect(toData(it("arrow", [[1, 2], [3, 4]])).layer).toBe(2);
  expect(toData({ ...it("arrow", [[1, 2], [3, 4]]), layer: 3 }).layer).toBe(3);
  const old = { ...toData(it("marker", [[1, 2], [3, 4]])), layer: undefined };
  expect(fromData(ItemData.parse(old)).layer).toBe(3);
  expect(fromData(ItemData.parse({ ...old, kind: "rect", layer: 7 })).layer).toBe(2);
  expect([layerOf(it("ink", [[0, 0]])), layerOf(it("text", [[0, 0]])), layerOf(it("image", [[0, 0]]))]).toEqual([3, 3, 2]);
});

test("Bild-Objekt: mittig, Seitenverhältnis bleibt, auf max begrenzt; Format am Base64-Anfang", () => {
  const it = imageItem(2, "iVBORw0KGgoAAA", 400, 200, 100, 100, 100);
  expect(it.points.map(([x, y]) => [x, y])).toEqual([[50, 75], [150, 125]]);
  expect(box(it)).toEqual({ x0: 50, y0: 75, x1: 150, y1: 125 });
  expect(toData(it).image).toBe("iVBORw0KGgoAAA");
  expect(imageMime(it.image ?? "")).toBe("image/png");
  expect(imageMime("/9j/4AAQ")).toBe("image/jpeg");
  expect(imageMime("R0lGOD")).toBeNull();
});

const round = (b: object) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round(v as number) + 0]));

test("Bild drehen: Box umschließt die gedrehten Ecken, Mitte wandert mit", () => {
  const img = { ...it("image", [[0, 0], [40, 20]]), image: "x" };
  const r = rotateItem(img, 20, 10, 90); // um die eigene Mitte
  expect(r.rot).toBe(90);
  expect(round(box(r))).toEqual({ x0: 10, y0: -10, x1: 30, y1: 30 });
  const o = rotateItem(img, 0, 0, -90); // um den Ursprung: Mitte (20,10) → (10,-20)
  expect(o.rot).toBe(270);
  expect(round(box({ ...o, rot: 0 }))).toEqual({ x0: -10, y0: -30, x1: 30, y1: -10 });
  expect(hitTest(r, 20, 28, 1)).toBe(true);
  // nicht-uniform skalieren: Breite mit geometrischem Mittel
  expect(scaleItem(it("rect", [[0, 0], [10, 10]]), 0, 0, 4, 1).size).toBeCloseTo(2 * 2);
});

test("Highlight trifft nur seine Zeilenrechtecke", () => {
  const h = it("highlight", [[0, 0], [100, 10], [0, 20], [30, 30]]);
  expect(hitTest(h, 50, 5, 0)).toBe(true);
  expect(hitTest(h, 80, 25, 0)).toBe(false);
  expect(layerOf(h)).toBe(3);
});
