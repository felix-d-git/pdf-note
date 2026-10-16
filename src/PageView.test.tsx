// @vitest-environment jsdom
// Regressionstests für die v1.0.0-Fehler „Text-Klick erzeugt kein Feld" und „schnelle Striche verschwinden".
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DEFAULT_PRESET, type Item, type Layer } from "./ink";
import { PageView } from "./PageView";
import { DEFAULT_SETTINGS, type Tool } from "./settings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => new Promise(() => {}) }));
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

function Page({ start, layer = 3, init = [] }: { start: Tool; layer?: Layer; init?: Item[] }) {
  const [items, setItems] = useState<Item[]>(init);
  const [tool, st] = useState(start);
  const [selected, setSel] = useState<number[]>([]);
  useEffect(() => void Object.assign(ui, { added: items, setTool: st, selected }), [items, selected]);
  return (
    <PageView
      doc={1} index={0} size={[600, 800]} zoom={1} version={0} items={items} selected={selected} tool={tool}
      preset={DEFAULT_PRESET} marker={DEFAULT_PRESET} textSize={14} settings={DEFAULT_SETTINGS}
      onAdd={(it) => (lastAdd.push(it), setItems((xs) => [...xs, it]))} onRemove={() => {}}
      onReplace={(next) => setItems((xs) => xs.map((x) => next.find((n) => n.id === x.id) ?? x))} onSelect={(_, ids) => setSel(ids)}
      onOrig={() => {}} onText={() => {}} onField={() => {}} onNewField={() => {}} hits={[]} linking={false}
      onLinkFrom={() => {}} onLinkTo={() => {}} onJump={() => {}} onUnlink={() => {}}
      layer={layer} textSel={null} onTextSel={() => {}}
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

const mount = (tool: Tool, layer?: Layer, init?: Item[]) => {
  root = createRoot(host);
  act(() => root.render(<Page start={tool} layer={layer} init={init} />));
  return host.querySelector("[data-page]") as HTMLDivElement;
};

const fire = (el: Element, type: string, x: number, y: number, buttons = 1, pointerType = "mouse", shiftKey = false) => {
  // jsdom kennt kein PointerEvent → MouseEvent mit den Feldern, die React liest
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons, shiftKey });
  Object.assign(e, { pointerId: 1, pointerType, pressure: 0.5 });
  act(() => void el.dispatchEvent(e));
  return e;
};

test("Klick mit Text-Werkzeug legt ein Textfeld an, das den Fokus behält", () => {
  const page = mount("text");
  fire(page, "pointerdown", 100, 100);
  // kompatibles mousedown darf der neuen Textarea den Fokus nicht nehmen
  expect(fire(page, "mousedown", 100, 100).defaultPrevented).toBe(true);
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
