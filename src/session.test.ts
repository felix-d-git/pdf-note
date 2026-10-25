// @vitest-environment jsdom
import { expect, test } from "vitest";
import { firstFile, fromSession, loadSession, placeWindow, storeSession, toSession, type DocStart } from "./session";
import type { Tabs } from "./tabs";

const view = (zoom: number): DocStart => ({ zoom, left: 10, top: 2400, layer: 2, mouse: "lasso", pen: "marker" });
const tabs: Tabs = {
  tabs: [{ id: 7, path: "C:/a.pdf", dirty: false }, { id: 8, path: "C:/b.pdf", dirty: true }, { id: 9, path: "C:/c.pdf", dirty: false }],
  panes: [8, 9], split: true, active: 1,
};
const win = { x: 100, y: 50, w: 900, h: 700, max: false };

test("Speichern → Laden ergibt denselben Zustand", () => {
  storeSession(toSession(tabs, 0.3, (id) => view(id / 4), win, true));
  const s = loadSession();
  if (!s) throw new Error("keine Sitzung");
  expect(s.win).toEqual(win);
  expect(s.side).toBe(true);
  expect(s?.files.map((f) => f.zoom)).toEqual([7 / 4, 2, 9 / 4]);
  expect(s?.files[1]).toMatchObject({ path: "C:/b.pdf", ...view(2) });
  // neue Dokument-Nummern nach dem Neustart
  expect(fromSession(s, [1, 2, 3])).toEqual({
    tabs: [{ id: 1, path: "C:/a.pdf", dirty: false }, { id: 2, path: "C:/b.pdf", dirty: false }, { id: 3, path: "C:/c.pdf", dirty: false }],
    panes: [2, 3], split: true, active: 1,
  });
});

test("fehlende Datei wird übersprungen, Hälfte rückt nach", () => {
  const s = toSession(tabs, 0.5, () => view(1));
  const t = fromSession(s, [1, undefined, 3]);
  expect(t.tabs.map((x) => x.path)).toEqual(["C:/a.pdf", "C:/c.pdf"]);
  expect(t.panes).toEqual([1, 3]);
  // nur noch die aktive rechte Datei fehlt → links aktiv, rechts der andere Tab
  expect(fromSession(s, [1, 2, undefined])).toMatchObject({ panes: [2, 1], active: 1 });
  expect(fromSession(s, [undefined, undefined, undefined])).toMatchObject({ tabs: [], panes: [undefined, undefined], active: 0 });
});

test("kaputte oder fremde Sitzung → keine", () => {
  localStorage.setItem("pdfnote.session", "{kaputt");
  expect(loadSession()).toBeUndefined();
  localStorage.setItem("pdfnote.session", JSON.stringify({ files: [{ path: "x" }] }));
  expect(loadSession()).toBeUndefined();
});

test("fehlender Monitor → Fenster auf sichtbaren Bildschirm", () => {
  const main = { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } };
  const right = { position: { x: 1920, y: 0 }, size: { width: 1280, height: 720 } };
  const there = { x: 2000, y: 100, w: 1000, h: 600, max: true };
  expect(placeWindow(there, [main, right])).toEqual(there);
  expect(placeWindow(there, [main])).toEqual({ x: 460, y: 240, w: 1000, h: 600, max: true });
  expect(placeWindow({ ...there, w: 3000, h: 2000 }, [main])).toMatchObject({ x: 0, y: 0, w: 1920, h: 1080 });
});

test("schneller Start: Datei der aktiven Hälfte zuerst, allein im ersten Bild", () => {
  const s = toSession(tabs, 0.5, () => view(1));
  expect(firstFile(s)).toBe(2);
  expect(firstFile({ ...s, active: 0 })).toBe(1);
  expect(firstFile({ ...s, panes: [null, null] })).toBe(0);
  expect(fromSession({ ...s, split: false, active: 0, panes: [2, null] }, [undefined, undefined, 5])).toEqual({ tabs: [{ id: 5, path: "C:/c.pdf", dirty: false }], panes: [5, undefined], split: false, active: 0 });
});
