import { describe, expect, it } from "vitest";
import { COARSE, evict, pageKey, plan, pngBytes, thumbKey, type Entry, type View } from "./render";

const L = { near: 25, far: 5, mb: 1024 };
const sizes = Array.from({ length: 300 }, () => [595, 842] as [number, number]);
const view = (o: Partial<View> = {}): View => ({ doc: 1, center: 150, sizes, scale: 1.5, dpr: 1, version: 0, shown: true, ...o });
const entry = (o: Partial<Entry> = {}): Entry => ({ url: "u", scale: 1.5, version: 0, bytes: 100, used: 0, ...o });

describe("render plan", () => {
  it("sichtbare Seite: erst grob, dann scharf, dann Umgebung und Miniaturen", () => {
    const { jobs } = plan([view()], new Map(), L, true);
    expect(jobs[0]).toMatchObject({ key: pageKey(1, 148), scale: 1.5 * COARSE });
    const sharp = jobs.findIndex((j) => j.key === pageKey(1, 150) && j.scale === 1.5);
    expect(jobs.findIndex((j) => j.key === pageKey(1, 150) && j.scale < 1.5)).toBeLessThan(sharp);
    expect(sharp).toBeLessThan(jobs.findIndex((j) => j.key === pageKey(1, 160)));
    expect(jobs.findIndex((j) => j.key === pageKey(1, 175))).toBeLessThan(jobs.findIndex((j) => j.key === thumbKey(1, 0)));
  });

  it("Zoom: vorhandenes Bild mit alter Skalierung → nur scharf neu, kein grob", () => {
    const { jobs } = plan([view({ scale: 3 })], new Map([[pageKey(1, 150), entry()]]), L, true);
    expect(jobs.filter((j) => j.key === pageKey(1, 150))).toEqual([expect.objectContaining({ scale: 3 })]);
  });

  it("aktiv ±25, versteckt ±5, Miniaturen nur für sichtbare Tabs", () => {
    const { wanted } = plan([view(), view({ doc: 2, shown: false })], new Map(), L, true);
    expect(wanted.has(pageKey(1, 125)) && wanted.has(pageKey(1, 175))).toBe(true);
    expect(wanted.has(pageKey(1, 124)) || wanted.has(pageKey(1, 176))).toBe(false);
    expect(wanted.has(pageKey(2, 145)) && !wanted.has(pageKey(2, 144))).toBe(true);
    expect(wanted.has(thumbKey(1, 299)) && !wanted.has(thumbKey(2, 0))).toBe(true);
  });

  it("Springen: Seiten außerhalb des neuen Fensters werden nicht mehr geplant (= abgebrochen)", () => {
    const { jobs } = plan([view({ center: 10 })], new Map(), L, true);
    expect(jobs.some((j) => j.key === pageKey(1, 150))).toBe(false);
  });

  it("über der Grenze: nur noch sichtbare Seiten", () => {
    const { jobs } = plan([view()], new Map(), L, false);
    expect(jobs.every((j) => Math.abs(Number(j.key.split(":")[1]) - 150) <= 2)).toBe(true);
  });

  it("Split mit selbem Dokument: jede Seite nur einmal", () => {
    const { jobs } = plan([view(), view()], new Map(), L, true);
    expect(new Set(jobs.map((j) => `${j.key}@${j.scale}`)).size).toBe(jobs.length);
  });
});

describe("render evict", () => {
  it("versteckter/geschlossener Tab: Ungewolltes sofort weg, sichtbarer Tab: LRU bis unter die Grenze", () => {
    const e = new Map([
      ["1:0", entry({ used: 1 })],
      ["1:1", entry({ used: 3 })],
      ["1:2", entry({ used: 2 })],
      ["2:0", entry()],
      ["2:1", entry()],
    ]);
    expect(evict(e, new Set(["1:2", "2:0"]), new Set([1]), 1000).sort()).toEqual(["2:1"]);
    expect(evict(e, new Set(["1:2", "2:0"]), new Set([1]), 300).sort()).toEqual(["1:0", "2:1"]);
  });

  it("PNG-Kopf → dekodierte Bytes", () => {
    const b = new ArrayBuffer(24), v = new DataView(b);
    v.setUint32(16, 100);
    v.setUint32(20, 50);
    expect(pngBytes(b)).toBe(20000);
  });
});
