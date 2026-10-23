import { expect, test } from "vitest";
import {
  afterDelete, afterDeleteMany, afterInsert, axesLines, afterMove, afterRotate, box, cropDrag, cropItem, hitTest, imageItem, imageMime, inPolygon, ItemData, fromData, layerOf, movedIndex, normPressure, outlinePoints,
  rotateItem, savedWidth, scaleItem, thumbPick, toData, type InkPoint, type Item, type Kind,
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
  // gefüllt (auch nach Strg+S + Neu-Öffnen): Fläche trifft, außerhalb nicht
  const fill: [number, number, number] = [0, 0.8, 0];
  const back = (x: Item) => fromData(ItemData.parse(JSON.parse(JSON.stringify(toData(x)))));
  expect(hitTest(back({ ...rect, fill }), 50, 25, 1)).toBe(true);
  expect(hitTest(back({ ...rect, fill }), 150, 25, 1)).toBe(false);
  expect(hitTest(back({ ...ell, fill }), 50, 25, 1)).toBe(true);
  expect(hitTest(back({ ...ell, fill }), 2, 2, 1)).toBe(false);
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

test("Zuschnitt: Griffe begrenzt, Ausschnitt bleibt an seiner Stelle (auch gedreht)", () => {
  expect(cropDrag([0, 0, 1, 1], "se", -0.3, -0.2)).toEqual([0, 0, 0.7, 0.8]);
  expect(cropDrag([0, 0, 1, 1], "w", -0.5, 0.4)).toEqual([0, 0, 1, 1]); // nicht über den Rand, n/s unberührt
  const [l, , r] = cropDrag([0.2, 0, 0.4, 1], "e", -1, 0);
  expect(r - l).toBeCloseTo(0.05); // Mindestgröße
  const img = it("image", [[0, 0], [40, 20]]);
  expect(cropItem(img, [0.5, 0, 1, 1], "B").points).toEqual([[20, 0, 0.5], [40, 20, 0.5]]);
  // 90° im Uhrzeigersinn: rechte Bildhälfte liegt unten
  const c = cropItem({ ...img, rot: 90 }, [0.5, 0, 1, 1], "B");
  expect(c.points.flatMap((p) => [p[0], p[1]]).map((v) => Math.round(v))).toEqual([10, 10, 30, 30]);
  expect(c.rot).toBe(90);
  expect(c.image).toBe("B");
});

test("Koordinatensystem: xy 2 Achsen + 2 Spitzen, xyz 3 + 3, Gitter nur mit Schalter", () => {
  const a = it("axes", [[0, 0], [200, 150]]);
  expect(axesLines(a).axes).toHaveLength(4);
  expect(axesLines(a).grid).toHaveLength(0);
  expect(axesLines({ ...a, xyz: true }).axes).toHaveLength(6);
  const g = axesLines({ ...a, grid: true }).grid;
  expect(g.length).toBeGreaterThan(4);
  // Gitter bleibt im Rahmen
  expect(g.flat().every(([x, y]) => x >= 0 && x <= 200 && y >= 0 && y <= 150)).toBe(true);
});

test("Mehrfachauswahl der Miniaturen und Löschen mehrerer Seiten", () => {
  expect(thumbPick([], 0, 2, false, false)).toEqual([2]);
  expect(thumbPick([2], 2, 4, true, false)).toEqual([2, 4]);
  expect(thumbPick([2, 4], 4, 2, true, false)).toEqual([4]);
  expect(thumbPick([2], 2, 0, false, true)).toEqual([0, 1, 2]);
  const items = [0, 1, 2, 3].map((p) => it("line", [[0, 0], [1, 1]], p));
  expect(afterDeleteMany(items, [1, 2]).map((i) => i.page)).toEqual([0, 1]);
  expect(afterDeleteMany(items, [0, 3]).map((i) => i.page)).toEqual([0, 1]);
});

// Aufgezeichnete Handschrift (pt, ~1 pt Abstand wie Pointer-Events): Schleife, spitze Ecke „N", i-Punkt
const track = (pts: [number, number][], p: (t: number) => number = () => 0.5): InkPoint[] => {
  const out: InkPoint[] = [];
  pts.slice(1).forEach(([x, y], i) => {
    const [x0, y0] = pts[i] ?? [x, y], n = Math.max(1, Math.ceil(Math.hypot(x - x0, y - y0)));
    for (let k = i ? 1 : 0; k <= n; k++) out.push([x0 + ((x - x0) * k) / n, y0 + ((y - y0) * k) / n, 0]);
  });
  return out.map(([x, y], i) => [x, y, p(i / out.length)]);
};
const loop = track(Array.from({ length: 41 }, (_, i): [number, number] => [20 + i * 0.6 + 8 * Math.sin((i / 40) * 2 * Math.PI * 1.2), 20 - 8 * Math.cos((i / 40) * 2 * Math.PI * 1.2)]));
const N = track([[0, 30], [0, 0], [12, 30], [12, 0]], (t) => 0.3 + 0.6 * t);
const dot: InkPoint[] = [[5, 5, 0.6], [5.2, 5.1, 0.6]];
const segDist = ([x = 0, y = 0]: number[], [ax = 0, ay = 0]: number[], [bx = 0, by = 0]: number[]) => {
  const [dx, dy] = [bx - ax, by - ay], l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0;
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
};
const toEdge = (q: number[], poly: number[][]) => Math.min(...poly.map((a, i) => segDist(q, a, poly[(i + 1) % poly.length] ?? a)));
const hausdorff = (a: number[][], b: number[][]) => Math.max(...a.map((q) => toEdge(q, b)), ...b.map((q) => toEdge(q, a)));

test("Handschrift: Umriss läuft um die echten Punkte (Ecken/Schleifen nicht verzogen), gleich nach Speichern + Neu-Öffnen", () => {
  for (const points of [loop, N, dot]) {
    const st: Item = { ...s(0.5), size: 2.2, points };
    const o = outlinePoints(st);
    // Rand des Umrisses liegt je Punkt im Abstand Radius = size·(0,5 − 0,5·(0,5 − p)) (Abweichung < 0,5 pt);
    // ausgenommen: Kreuzungen (dort liegt der Rand des anderen Strichteils näher) und die letzten 3 pt
    // (perfect-freehand verbindet sie gerade mit der Endkappe – live genauso, springt also nicht)
    const alone = (q: InkPoint, i: number) => i < points.length - 3 && points.every((r, j) => Math.abs(i - j) < 8 || Math.hypot(r[0] - q[0], r[1] - q[1]) > 2 * st.size);
    const off = points.flatMap((q, i) => (alone(q, i) ? [Math.abs(toEdge(q, o) - st.size * (0.5 - 0.5 * (0.5 - q[2])))] : []));
    if (points.length > 2) expect(Math.max(...off)).toBeLessThan(0.5);
    // Speichern (Rust rundet auf 0,01) → Neu-Öffnen → derselbe Umriss
    const saved = JSON.parse(JSON.stringify(toData(st)), (_, v: unknown) => (typeof v === "number" ? Math.round(v * 100) / 100 : v));
    expect(hausdorff(outlinePoints(fromData(ItemData.parse(saved))), o)).toBeLessThan(0.5);
  }
});
