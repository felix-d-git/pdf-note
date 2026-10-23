import { describe, expect, it } from "vitest";
import { activeId, closeTab, cycle, EMPTY_TABS, focus, moveTab, onlyActivates, openTab, setDirty, pickDoc, show, toggleSplit, toPane, viewActive, type Tabs } from "./tabs";

const three = (): Tabs => openTab(openTab(openTab(EMPTY_TABS, 1, "C:\\a.pdf"), 2, "C:\\b.pdf"), 3, "C:\\c.pdf");
const ids = (s: Tabs) => s.tabs.map((t) => t.id);

describe("Tabs", () => {
  it("öffnet neue Tabs und zeigt den neuesten", () => {
    const s = three();
    expect(ids(s)).toEqual([1, 2, 3]);
    expect(activeId(s)).toBe(3);
  });

  it("bereits offene Datei springt zu ihrem Tab statt neu zu öffnen", () => {
    const s = openTab(three(), 9, "c:/A.PDF");
    expect(ids(s)).toEqual([1, 2, 3]);
    expect(activeId(s)).toBe(1);
  });

  it("Schließen zeigt den Nachbarn, letzter Tab → leer", () => {
    let s = closeTab(show(three(), 2), 2);
    expect(ids(s)).toEqual([1, 3]);
    expect(activeId(s)).toBe(3);
    s = closeTab(s, 3);
    expect(activeId(s)).toBe(1);
    s = closeTab(s, 1);
    expect(s.tabs).toEqual([]);
    expect(activeId(s)).toBeUndefined();
  });

  it("Strg+Tab wechselt reihum in beide Richtungen", () => {
    const s = three();
    expect(activeId(cycle(s, 1))).toBe(1);
    expect(activeId(cycle(s, -1))).toBe(2);
    expect(cycle(EMPTY_TABS, 1)).toBe(EMPTY_TABS);
  });

  it("Tabs per Ziehen umsortieren", () => {
    expect(ids(moveTab(three(), 0, 2))).toEqual([2, 3, 1]);
    expect(ids(moveTab(three(), 2, 0))).toEqual([3, 1, 2]);
  });

  it("ungespeichert-Status pro Dokument", () => {
    const s = setDirty(three(), 2, true);
    expect(s.tabs.map((t) => t.dirty)).toEqual([false, true, false]);
    expect(setDirty(s, 2, true)).toBe(s);
  });
});

describe("Split", () => {
  it("zweite Hälfte bekommt ein anderes Dokument und wird aktiv", () => {
    const s = toggleSplit(three());
    expect(s.panes).toEqual([3, 1]);
    expect(s.active).toBe(1);
  });

  it("Dokument der anderen Hälfte zeigen/öffnen → zwei Ansichten, aktive Hälfte bleibt (Öffnen je Leiste in dieser Hälfte)", () => {
    const s = show(toggleSplit(three()), 3); // rechts aktiv
    expect(s.panes).toEqual([3, 3]);
    expect(s.active).toBe(1);
    expect(openTab(focus(toggleSplit(three()), 1), 9, "c:/C.pdf").panes).toEqual([3, 3]);
  });

  it("Öffnen und Tab-Klick betreffen nur die aktive Hälfte", () => {
    let s = focus(toggleSplit(three()), 0);
    s = show(s, 2);
    expect(s.panes).toEqual([2, 1]);
    s = openTab(s, 4, "C:\\d.pdf");
    expect(s.panes).toEqual([4, 1]);
  });

  it("Schließen in einer Hälfte nimmt nicht das Dokument der anderen", () => {
    const s = closeTab(toggleSplit(openTab(openTab(EMPTY_TABS, 1, "a"), 2, "b")), 1);
    expect(s.panes).toEqual([2, undefined]);
  });

  it("Split mit nur einem Dokument: rechte Hälfte leer; Öffnen füllt sie", () => {
    let s = toggleSplit(openTab(EMPTY_TABS, 1, "a"));
    expect(s.panes).toEqual([1, undefined]);
    s = openTab(focus(s, 1), 2, "b");
    expect(s.panes).toEqual([1, 2]);
  });

  it("Split aus behält das Dokument der aktiven Hälfte", () => {
    const s = toggleSplit(toggleSplit(three()));
    expect(s.split).toBe(false);
    expect(s.panes).toEqual([1, undefined]);
    expect(activeId(s)).toBe(1);
  });

  it("Tab in die andere Hälfte ziehen tauscht die Hälften", () => {
    const s = toPane(toggleSplit(three()), 3, 1);
    expect(s.panes).toEqual([1, 3]);
    expect(s.active).toBe(1);
  });

  it("Strg+Ziehen oder leere Zielhälfte → gleiche PDF in beiden Hälften; Schließen leert beide", () => {
    expect(toPane(toggleSplit(three()), 3, 1, true).panes).toEqual([3, 3]);
    let s = toPane(toggleSplit(openTab(EMPTY_TABS, 1, "a")), 1, 1);
    expect(s.panes).toEqual([1, 1]);
    expect(show(s, 1).panes).toEqual([1, 1]);
    s = closeTab(s, 1);
    expect(s.panes).toEqual([undefined, undefined]);
  });

  it("Tab aus der Leiste in eine Hälfte ziehen ersetzt nur diese", () => {
    expect(toPane(toggleSplit(three()), 2, 0).panes).toEqual([2, 1]);
  });

  it("focus ohne Split ändert nichts", () => {
    const s = three();
    expect(focus(s, 1)).toBe(s);
  });

  it("nur Ansichten in einer Hälfte hören auf Tastatur/Einfügen (versteckte Tabs nie)", () => {
    const s = three(); // Tab 3 aktiv in Hälfte 0, Tabs 1+2 versteckt
    expect(viewActive(s, 0, true)).toBe(true);
    expect(viewActive(s, 0, false)).toBe(false); // vorher: versteckte Tabs galten als Hälfte 0 → mehrere Ziele
    const sp = toggleSplit(s);
    expect(viewActive(sp, 1, true)).toBe(true);
    expect(viewActive(sp, 0, true)).toBe(false);
  });

  it("Tab-Leiste je Hälfte: jedes offene Dokument wählbar, nur diese Hälfte ändert sich und wird aktiv", () => {
    const sp = toggleSplit(three()); // [3, 1]
    expect(sp.panes).toEqual([3, 1]);
    expect(pickDoc(sp, 2, 1).panes).toEqual([3, 2]);
    expect(pickDoc(sp, 3, 1).panes).toEqual([3, 3]); // zweite Ansicht derselben PDF
    expect(pickDoc(sp, 1, 0).panes).toEqual([1, 1]); // kein Tausch
    expect(pickDoc(sp, 2, 0).active).toBe(0);
    // neues Dokument steht in beiden Leisten (eine Tab-Liste), Schließen in einer Leiste schließt es überall
    const o = openTab(sp, 4, "C:\\d.pdf");
    expect(ids(o)).toEqual([1, 2, 3, 4]);
    expect(o.panes).toEqual([3, 4]);
    expect(closeTab(pickDoc(o, 4, 0), 4).panes).toEqual([3, 1]);
  });

  it("erster Maus-Klick in die inaktive Hälfte aktiviert nur, Stift zeichnet sofort", () => {
    expect(onlyActivates(false, "mouse")).toBe(true);
    expect(onlyActivates(true, "mouse")).toBe(false);
    expect(onlyActivates(false, "pen")).toBe(false);
    expect(onlyActivates(false, "touch")).toBe(false);
  });
});
