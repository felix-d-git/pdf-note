// @vitest-environment jsdom
// Regressionstests für die v1.0.0-Fehler „Text-Klick erzeugt kein Feld" und „schnelle Striche verschwinden".
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { box, DEFAULT_PRESET, savedWidth, type Item, type Layer, type Preset } from "./ink";
import { PageView } from "./PageView";
import { DEFAULT_SETTINGS, type Tool } from "./settings";

const FELD = { xref: 9, kind: "check", name: "H", rect: [20, 60, 32, 72], value: "Off", on: "Yes", options: [], readonly: false, multiline: false };
const answers = vi.hoisted(() => ({} as Record<string, unknown>));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string) => (cmd === "form_fields" ? Promise.resolve([FELD]) : cmd in answers ? Promise.resolve(answers[cmd]) : new Promise(() => {})) }));
const deleted: number[] = [];
const draws = vi.hoisted(() => [] as Item[][]);
vi.mock("./ink", async (orig) => {
  const m = await orig<typeof import("./ink")>();
  return {
    ...m,
    drawItems: (_: unknown, its: Item[]) => void draws.push(its),
    // Canvas-Textmaße gibt es in jsdom nicht
    textRect: (_: unknown, _t: string, _s: number, x: number, y: number) => [[x, y, 0.5], [x + 50, y + 12, 0.5]],
  };
});

// rAF von Hand: erst nach dem Neu-Rendern des Elternteils ausführen, wie im echten Ablauf
let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
const flushFrames = () => act(() => {
  const fs = [...frames.values()];
  frames = new Map();
  for (const f of fs) f(0);
});

let root: Root;
let host: HTMLDivElement;
// Zugriff auf den Zustand des Testelternteils (nach jedem Render gesetzt)
const ui: { added: Item[]; setTool: (t: Tool) => void; selected: number[] } = { added: [], setTool: () => {}, selected: [] };
const lastAdd: Item[] = [];
const opened: string[] = [];
const shapes: Item[] = [];
const crops: [number, number[]][] = [];

/** `pen` = Werkzeug des Stifts (Automatik), sonst gilt `start` für alle Geräte */
function Page({ start, pen, layer = 3, init = [], sel = [], preset = DEFAULT_PRESET, locked }: { start: Tool; pen?: Tool; layer?: Layer; init?: Item[]; sel?: number[]; preset?: Preset; locked?: (l: Layer) => boolean }) {
  const [items, setItems] = useState<Item[]>(init);
  const [tool, st] = useState(start);
  const [selected, setSel] = useState<number[]>(sel);
  useEffect(() => void Object.assign(ui, { added: items, setTool: st, selected }), [items, selected]);
  return (
    <PageView
      doc={1} index={0} size={[600, 800]} zoom={1} version={0} items={items} selected={selected} tool={tool} penTool={pen ?? tool} typers={new Map()}
      preset={preset} marker={DEFAULT_PRESET} textSize={14} settings={DEFAULT_SETTINGS}
      onAdd={(it) => (lastAdd.push(it), setItems((xs) => [...xs, it]))}
      onShape={(it) => (shapes.push(it), setItems((xs) => [...xs, it]), setSel([it.id]))} onRemove={() => {}}
      onReplace={(next) => setItems((xs) => xs.map((x) => next.find((n) => n.id === x.id) ?? x))} onSelect={(_, ids) => setSel(ids)}
      onCrop={(id, f) => void crops.push([id, f])}
      onOrig={() => {}} onText={() => {}} onField={() => {}} onNewField={() => {}} hits={[]} linking={false}
      onLinkFrom={() => {}} onLinkTo={() => {}} onJump={() => {}} onOpenUrl={(u) => void opened.push(u)} onUnlink={() => {}} onDeleteField={(x) => void deleted.push(x)}
      onCmd={() => {}} onSpace={(moved) => setItems((xs) => xs.map((x) => moved.find((n) => n.id === x.id) ?? x))}
      layer={layer} locked={locked} textSel={null} onTextSel={() => {}} axes={{ xyz: false, grid: false }}
    />
  );
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private cb: (es: { isIntersecting: boolean }[]) => void) {}
    observe() { this.cb([{ isIntersecting: true }]); }
    disconnect() {}
  });
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => (frames.set(++nextFrame, f), nextFrame));
  vi.stubGlobal("cancelAnimationFrame", (n: number) => void frames.delete(n));
  HTMLCanvasElement.prototype.getContext = (() => ({})) as never;
  Element.prototype.setPointerCapture = () => {};
  frames = new Map();
  draws.length = 0;
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const mount = (tool: Tool, layer?: Layer, init?: Item[], more: { pen?: Tool; sel?: number[]; preset?: Preset } = {}) => {
  root = createRoot(host);
  act(() => root.render(<Page start={tool} layer={layer} init={init} {...more} />));
  return host.querySelector("[data-page]") as HTMLDivElement;
};

const fire = (el: Element, type: string, x: number, y: number, buttons = 1, pointerType = "mouse", shiftKey = false, ctrlKey = false) => {
  // jsdom kennt kein PointerEvent → MouseEvent mit den Feldern, die React liest
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons, shiftKey, ctrlKey });
  Object.assign(e, { pointerId: 1, pointerType, pressure: 0.5 });
  act(() => void el.dispatchEvent(e));
  return e;
};

test("Klick mit Auswahl/Text auf freie Fläche legt ein Textfeld an, das den Fokus behält", () => {
  const page = mount("lasso");
  // Feld entsteht erst beim Loslassen (Ziehen wäre Auswahl) → mousedown davor nimmt ihm keinen Fokus
  fire(page, "pointerdown", 100, 100);
  fire(page, "mousedown", 100, 100);
  fire(page, "pointerup", 100, 100, 0);
  const ta = host.querySelector("textarea") as HTMLTextAreaElement;
  expect(ta).not.toBeNull();
  expect(document.activeElement).toBe(ta);
  ta.value = "Hallo";
  act(() => ta.blur());
  expect(ui.added.map((it) => [it.kind, it.text])).toEqual([["text", "Hallo"]]);
  act(() => ui.setTool("pen"));
  expect(ui.added).toHaveLength(1);
  // gewöhnliche Klicks ohne Text-Werkzeug behalten ihr mousedown
  expect(fire(page, "mousedown", 10, 10).defaultPrevented).toBe(false);
});

test("50 schnelle Striche und Formen bleiben alle sichtbar", () => {
  const page = mount("pen");
  const tools: Tool[] = ["pen", "rect", "pen", "line", "pen", "ellipse", "arrow"];
  for (let i = 0; i < 50; i++) {
    const t = tools[i % tools.length] ?? "pen";
    act(() => ui.setTool(t));
    const [x, y] = [20 + (i % 10) * 50, 40 + Math.floor(i / 10) * 60];
    fire(page, "pointerdown", x, y);
    fire(page, "pointermove", x + 15, y + 10);
    fire(page, "pointermove", x + 30, y + 20);
    fire(page, "pointerup", x + 30, y + 20, 0);
    // veraltete Frames aus `move` erst nach dem Übernehmen ausführen
    flushFrames();
    expect(draws.at(-1)).toHaveLength(i + 1);
  }
  expect(ui.added).toHaveLength(50);
});

test("Auswahl trifft nur die aktive Ebene", () => {
  const obj = (id: number, kind: Item["kind"], x: number): Item => ({
    id, page: 0, kind, color: [0, 0, 0], opacity: 1, size: 2, simulated: false, points: [[x, 100, 0.5], [x + 20, 120, 0.5]], text: "",
  });
  const init = [obj(1, "ink", 100), obj(2, "rect", 200), obj(3, "rect", 300)];
  init[2] = { ...obj(3, "rect", 300), layer: 3 }; // manuell auf Ebene 3 gezeichnet
  const page = mount("lasso", 3, init);
  // Maus zieht ein Rechteck über alle drei Objekte
  fire(page, "pointerdown", 50, 50);
  fire(page, "pointermove", 400, 50);
  fire(page, "pointermove", 400, 200);
  fire(page, "pointerup", 400, 200, 0);
  expect(ui.selected).toEqual([1, 3]);
});

const obj = (id: number, kind: Item["kind"], x0: number, y0: number, x1: number, y1: number): Item => ({
  id, page: 0, kind, color: [0, 0, 0], opacity: 1, size: 2, simulated: false, points: [[x0, y0, 0.5], [x1, y1, 0.5]], text: "",
  ...(kind === "image" ? { image: "x" } : {}),
});

test("Stifttaste-Lasso → Stift aktiv → Ziehen im Rahmen verschiebt, kein Strich", () => {
  const page = mount("pen", 3, [obj(1, "ink", 100, 100, 120, 120)]);
  // Seitentaste (2) + Spitze: Freihand-Lasso um das Objekt
  for (const [x, y] of [[80, 80], [150, 80], [150, 150], [80, 150]] as const) fire(page, x === 80 && y === 80 ? "pointerdown" : "pointermove", x, y, 3, "pen");
  fire(page, "pointerup", 80, 150, 0, "pen");
  expect(ui.selected).toEqual([1]);
  lastAdd.length = 0;
  // nur Spitze: Stift wäre aktiv, aber die Auswahl hat Vorrang
  fire(page, "pointerdown", 110, 110, 1, "pen");
  fire(page, "pointermove", 160, 130, 1, "pen");
  fire(page, "pointerup", 160, 130, 0, "pen");
  flushFrames();
  expect(lastAdd).toEqual([]);
  expect(ui.added.map((it) => it.points.map(([x, y]) => [x, y]))).toEqual([[[150, 120], [170, 140]]]);
  expect(ui.selected).toEqual([1]); // bleibt bestehen
  // Drücken außerhalb hebt auf und zeichnet
  fire(page, "pointerdown", 400, 400, 1, "pen");
  fire(page, "pointerup", 400, 400, 0, "pen");
  expect(ui.selected).toEqual([]);
  expect(lastAdd.map((it) => it.kind)).toEqual(["ink"]);
});

test("Eckgriff: Bild proportional, Umschalt frei", () => {
  const page = mount("lasso", 2, [obj(1, "image", 100, 100, 200, 150)]);
  fire(page, "pointerdown", 90, 90);
  fire(page, "pointermove", 250, 200);
  fire(page, "pointerup", 250, 200, 0);
  expect(ui.selected).toEqual([1]);
  const se = () => host.querySelector('[data-handle="se"]') as HTMLElement;
  fire(se(), "pointerdown", 200, 150);
  fire(page, "pointermove", 300, 160);
  fire(page, "pointerup", 300, 160, 0);
  expect(ui.added[0]?.points.map(([x, y]) => [x, y])).toEqual([[100, 100], [300, 200]]);
  fire(se(), "pointerdown", 300, 200, 1, "mouse", true);
  fire(page, "pointermove", 300, 250, 1, "mouse", true);
  fire(page, "pointerup", 300, 250, 0, "mouse", true);
  expect(ui.added[0]?.points.map(([x, y]) => [x, y])).toEqual([[100, 100], [300, 250]]);
  expect(host.querySelector('[data-handle="rot"]')).not.toBeNull();
});

test("Gerät bestimmt das Werkzeug: Stift zeichnet, Maus wählt aus", () => {
  const page = mount("lasso", 3, [], { pen: "pen" });
  fire(page, "pointerdown", 100, 100, 1, "pen");
  fire(page, "pointermove", 150, 150, 1, "pen");
  fire(page, "pointerup", 150, 150, 0, "pen");
  expect(ui.added.map((it) => it.kind)).toEqual(["ink"]);
  fire(page, "pointerdown", 300, 300);
  fire(page, "pointermove", 400, 400);
  fire(page, "pointerup", 400, 400, 0);
  expect(ui.added).toHaveLength(1); // Maus zeichnet nicht
});

test("Klick in ausgewähltes Textfeld setzt den Cursor an die Klickstelle", () => {
  const it: Item = {
    id: 5, page: 0, kind: "text", color: [0, 0, 0], opacity: 1, size: 10, simulated: false, layer: 3,
    points: [[100, 100, 0.5], [150, 112, 0.5]], text: "Hallo Welt",
  };
  const page = mount("lasso", 3, [it], { sel: [5] });
  // jsdom: Ersatzmaß 0,5 × Größe je Zeichen → 3 Zeichen = 15 pt hinter dem Innenabstand
  fire(page, "pointerdown", 100 + 2 + 15, 104);
  fire(page, "pointerup", 100 + 2 + 15, 104, 0);
  const ta = host.querySelector("textarea") as HTMLTextAreaElement;
  expect(ta.value).toBe("Hallo Welt");
  expect([ta.selectionStart, ta.selectionEnd]).toEqual([3, 3]);
  expect(document.activeElement).toBe(ta);
});

test("Form landet über onShape und ist ausgewählt", () => {
  shapes.length = 0;
  const page = mount("rect");
  fire(page, "pointerdown", 100, 100);
  fire(page, "pointermove", 200, 160);
  fire(page, "pointerup", 200, 160, 0);
  expect(shapes.map((s) => s.kind)).toEqual(["rect"]);
  expect(ui.selected).toEqual([shapes[0]?.id]);
});

test("Doppelklick auf Bild: Zuschneiden, Enter übernimmt, Esc bricht ab", () => {
  crops.length = 0;
  const page = mount("lasso", 2, [obj(1, "image", 100, 100, 200, 150)], { sel: [1] });
  const dbl = () => act(() => void page.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 150, clientY: 120 })));
  const key = (k: string) => act(() => void dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));
  dbl();
  expect(host.querySelector('[data-handle="se"]')).toBeNull(); // Auswahlrahmen weicht dem Zuschnitt
  const e = host.querySelector('[data-crop="e"]') as HTMLElement;
  fire(e, "pointerdown", 200, 125);
  fire(e, "pointermove", 150, 125); // halbe Breite nach links
  fire(e, "pointerup", 150, 125, 0);
  key("Enter");
  expect(crops).toEqual([[1, [0, 0, 0.5, 1]]]);
  expect(host.querySelector("[data-crop]")).toBeNull();
  dbl();
  key("Escape");
  expect(crops).toHaveLength(1);
  expect(host.querySelector("[data-crop]")).toBeNull();
  expect(host.querySelector('[data-handle="se"]')).not.toBeNull();
});

test("Platz einfügen verschiebt nur Objekte unterhalb, höchstens bis zum Seitenrand", () => {
  const page = mount("space", 3, [obj(1, "rect", 10, 10, 100, 80), obj(2, "image", 10, 200, 100, 300), obj(3, "ink", 200, 150, 260, 400)]);
  const tops = () => ui.added.map((it) => Math.round(box(it).y0));
  const drag = (y0: number, y1: number) => {
    fire(page, "pointerdown", 50, y0);
    fire(page, "pointermove", 50, y1);
    fire(page, "pointerup", 50, y1, 0);
  };
  drag(100, 150);
  expect(tops()).toEqual([9, 250, 199]);
  // weit nach unten: unterstes Objekt stößt an den Rand, Abstände bleiben
  drag(100, 2000);
  expect(Math.max(...ui.added.map((it) => box(it).y1))).toBeCloseTo(800);
  expect(tops()).toEqual([9, 599, 548]);
  // weit nach oben: Platz entfernen, nie über den oberen Rand
  drag(300, -1000);
  expect(tops()).toEqual([9, 51, 0]);
});

test("Druck aus: Stift mit wechselndem Druck → alle Punkte gleiche Breite; Druck an: Werte bleiben", () => {
  for (const [pressure, flat] of [[false, true], [undefined, false]] as const) {
    lastAdd.length = 0;
    const page = mount("pen", 3, [], { preset: { ...DEFAULT_PRESET, pressure } });
    [0.1, 0.9, 0.3, 0.7].forEach((pr, i) => {
      const e = new MouseEvent(i ? "pointermove" : "pointerdown", { bubbles: true, cancelable: true, clientX: 100 + 10 * i, clientY: 100, buttons: 1 });
      Object.assign(e, { pointerId: 1, pointerType: "pen", pressure: pr });
      act(() => void page.dispatchEvent(e));
    });
    fire(page, "pointerup", 130, 100, 0, "pen");
    const it = lastAdd[0];
    expect(new Set(it?.points.map((q) => q[2])).size === 1).toBe(flat);
    expect(it?.simulated).toBe(false);
    if (flat) expect(savedWidth(it as Item)).toBe(DEFAULT_PRESET.size);
    if (flat) act(() => root.unmount());
  }
});

test("gesperrte Ebene: Auswahl und Radierer greifen nicht, Marker darüber (Ebene 3) schon", () => {
  const rect: Item = { id: 1, page: 0, kind: "rect", color: [0, 0, 0], opacity: 1, size: 2, simulated: false, points: [[100, 100, 0.5], [140, 130, 0.5]], text: "" };
  const lock = (l: Layer) => l === 2;
  const run = (tool: Tool, layer: Layer, locked?: (l: Layer) => boolean) => {
    act(() => root?.unmount());
    root = createRoot(host);
    act(() => root.render(<Page start={tool} layer={layer} init={[rect]} locked={locked} />));
    const page = host.querySelector("[data-page]") as HTMLDivElement;
    fire(page, "pointerdown", 120, 100);
    fire(page, "pointerup", 120, 100, 0);
    return ui.selected;
  };
  expect(run("lasso", 2)).toEqual([1]); // ungesperrt wählbar
  expect(run("lasso", 2, lock)).toEqual([]);
  expect(run("lasso", 3, lock)).toEqual([]); // andere Ebene: nichts zu wählen, aber nicht gesperrt
  run("marker", 3, lock);
  lastAdd.length = 0;
  const page = host.querySelector("[data-page]") as HTMLDivElement;
  fire(page, "pointerdown", 300, 300);
  fire(page, "pointermove", 330, 305);
  fire(page, "pointerup", 330, 305, 0);
  expect(lastAdd.map((i) => i.kind)).toEqual(["marker"]);
  run("pen", 2, lock);
  lastAdd.length = 0;
  const p2 = host.querySelector("[data-page]") as HTMLDivElement;
  fire(p2, "pointerdown", 300, 300);
  fire(p2, "pointermove", 330, 305);
  fire(p2, "pointerup", 330, 305, 0);
  expect(lastAdd).toHaveLength(0); // Zeichnen in gesperrte Ebene 2 blockiert
});

test("selbst angelegte Checkbox lässt sich löschen: Entf auf dem Feld und Mini-Leiste", async () => {
  mount("form");
  await act(async () => {});
  const box = host.querySelector<HTMLInputElement>("input[data-field]");
  expect(box).not.toBeNull();
  act(() => box?.focus());
  const x = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
  act(() => void box?.dispatchEvent(x));
  expect(deleted).toEqual([9]);
  expect(x.defaultPrevented).toBe(true);
  // Mini-Leiste am fokussierten Feld
  const bar = host.querySelector<HTMLButtonElement>("button[data-pedit]");
  expect(bar).not.toBeNull();
  act(() => bar?.click());
  expect(deleted).toEqual([9, 9]);
  // Rechtsklick wählt das Feld statt des Seitenmenüs
  act(() => box?.blur());
  expect(host.querySelector("button[data-pedit]")).toBeNull();
  act(() => void box?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  expect(host.querySelector("button[data-pedit]")).not.toBeNull();
  expect(host.querySelector("[role=menu]")).toBeNull();
});

test("Links: einfacher Klick öffnet nichts, Strg+Klick meldet die Adresse (Annotation und Textfeld)", async () => {
  opened.length = 0;
  Object.assign(answers, { links: [{ rect: [200, 200, 300, 220], page: -1, y: 0, uri: "https://example.org/" }], text_chars: [] });
  const it: Item = {
    id: 5, page: 0, kind: "text", color: [0, 0, 0], opacity: 1, size: 10, simulated: false, layer: 3,
    points: [[100, 100, 0.5], [150, 112, 0.5]], text: "Doku www.a.de",
  };
  const page = mount("lasso", 3, [it]);
  const click = (x: number, y: number, ctrl: boolean) => {
    fire(page, "pointerdown", x, y, 1, "mouse", false, ctrl);
    fire(page, "pointerup", x, y, 0, "mouse", false, ctrl);
  };
  click(250, 210, false);
  expect(opened).toEqual([]);
  // Strg-Hover lädt die Links der Seite, Tooltip zeigt das Ziel
  fire(page, "pointermove", 250, 210, 0, "mouse", false, true);
  await act(async () => {});
  fire(page, "pointermove", 251, 210, 0, "mouse", false, true);
  expect(page.querySelector("[role=tooltip]")?.textContent).toBe("https://example.org/");
  click(250, 210, true);
  click(110, 105, true);
  expect(opened).toEqual(["https://example.org/", "https://www.a.de/"]);
  delete answers.links;
  delete answers.text_chars;
});
