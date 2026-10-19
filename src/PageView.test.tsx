// @vitest-environment jsdom
// Regressionstests für die v1.0.0-Fehler „Text-Klick erzeugt kein Feld" und „schnelle Striche verschwinden".
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { box, DEFAULT_PRESET, PARA0, type Item, type Layer } from "./ink";
import { PageView, type OrigEdit, type ParaMove } from "./PageView";
import { DEFAULT_SETTINGS, type Tool } from "./settings";

// Backend-Antworten je Test: Standard = antwortet nie
const backend = vi.hoisted(() => ({ reply: ((): Promise<unknown> => new Promise(() => {})) as (cmd: string) => Promise<unknown> }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string) => backend.reply(cmd) }));
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
const ui: { added: Item[]; setTool: (t: Tool) => void; selected: number[]; layer: Layer } = { added: [], setTool: () => {}, selected: [], layer: 3 };
const origs: [OrigEdit[], ParaMove | undefined][] = [];
const lastAdd: Item[] = [];
const shapes: Item[] = [];
const crops: [number, number[]][] = [];

/** `pen` = Werkzeug des Stifts (Automatik), sonst gilt `start` für alle Geräte */
function Page({ start, pen, layer: layer0 = 3, init = [], sel = [] }: { start: Tool; pen?: Tool; layer?: Layer; init?: Item[]; sel?: number[] }) {
  const [items, setItems] = useState<Item[]>(init);
  const [layer, setLayer] = useState<Layer>(layer0);
  const [tool, st] = useState(start);
  const [selected, setSel] = useState<number[]>(sel);
  useEffect(() => void Object.assign(ui, { added: items, setTool: st, selected, layer }), [items, selected, layer]);
  return (
    <PageView
      doc={1} index={0} size={[600, 800]} zoom={1} version={0} items={items} selected={selected} tool={tool} penTool={pen ?? tool} typers={new Map()}
      preset={DEFAULT_PRESET} marker={DEFAULT_PRESET} textSize={14} settings={DEFAULT_SETTINGS}
      onAdd={(it) => (lastAdd.push(it), setItems((xs) => [...xs, it]))}
      onShape={(it) => (shapes.push(it), setItems((xs) => [...xs, it]), setSel([it.id]))} onRemove={() => {}}
      onReplace={(next) => setItems((xs) => xs.map((x) => next.find((n) => n.id === x.id) ?? x))} onSelect={(_, ids) => setSel(ids)}
      onCrop={(id, f) => void crops.push([id, f])}
      onOrig={(edits, _n, paras) => void origs.push([edits, paras])} onText={() => {}} onField={() => {}} onNewField={() => {}} hits={[]} linking={false}
      onLinkFrom={() => {}} onLinkTo={() => {}} onJump={() => {}} onUnlink={() => {}}
      onCmd={() => {}} onSpace={(moved) => setItems((xs) => xs.map((x) => moved.find((n) => n.id === x.id) ?? x))}
      layer={layer} onLayer={setLayer} textSel={null} onTextSel={() => {}} axes={{ xyz: false, grid: false }}
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
  origs.length = 0;
  backend.reply = () => new Promise(() => {});
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const mount = (tool: Tool, layer?: Layer, init?: Item[], more: { pen?: Tool; sel?: number[] } = {}) => {
  root = createRoot(host);
  act(() => root.render(<Page start={tool} layer={layer} init={init} {...more} />));
  return host.querySelector("[data-page]") as HTMLDivElement;
};

const fire = (el: Element, type: string, x: number, y: number, buttons = 1, pointerType = "mouse", shiftKey = false) => {
  // jsdom kennt kein PointerEvent → MouseEvent mit den Feldern, die React liest
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons, shiftKey });
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

const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const text = (id: number, x: number): Item => ({ ...obj(id, "text", x, 100, x + 60, 112), text: "Notiz", layer: 3 });

test("Stift fasst Text nie an: kein Textfeld, kein Cursor, kein Absatz-Editor", () => {
  // Stift-Lasso (Seitentaste) auf freier Fläche und auf einem Textfeld; Stift-Spitze mit Auswahl-Werkzeug
  const page = mount("lasso", 3, [text(1, 100)], { pen: "lasso" });
  for (const buttons of [3, 1]) {
    for (const x of [300, 110]) {
      fire(page, "pointerdown", x, 105, buttons, "pen");
      fire(page, "pointerup", x, 105, 0, "pen");
      expect(host.querySelector("textarea")).toBeNull();
    }
  }
  expect(ui.added).toHaveLength(1);
  // Maus legt dagegen ein Textfeld an
  fire(page, "pointerdown", 300, 300);
  fire(page, "pointerup", 300, 300, 0);
  expect(host.querySelector("textarea")).not.toBeNull();
});

test("Klick auf eigenes Objekt wählt dessen Ebene, auf leere Stelle Textfeld auf Ebene 3", () => {
  const page = mount("lasso", 3, [obj(1, "rect", 100, 100, 200, 160), text(2, 300)]);
  fire(page, "pointerdown", 100, 130);
  fire(page, "pointerup", 100, 130, 0);
  expect(ui.layer).toBe(2);
  expect(ui.selected).toEqual([1]);
  fire(page, "pointerdown", 305, 105);
  fire(page, "pointerup", 305, 105, 0);
  expect(ui.layer).toBe(3);
  expect(host.querySelector("textarea")).not.toBeNull();
  act(() => (host.querySelector("textarea") as HTMLTextAreaElement).blur());
  act(() => ui.setTool("lasso"));
  fire(page, "pointerdown", 500, 500);
  fire(page, "pointerup", 500, 500, 0);
  expect(ui.layer).toBe(3);
  // Ebene 2 aktiv, leerer Klick → Textfeld auf Ebene 3
  const p2 = mount("lasso", 2, []);
  fire(p2, "pointerdown", 500, 500);
  fire(p2, "pointerup", 500, 500, 0);
  expect(ui.layer).toBe(3);
});

test("Klick auf PDF-Bild wechselt auf Ebene 1, der Stift nicht", async () => {
  backend.reply = (c) => Promise.resolve(c === "orig_objects" ? [[100, 300, 200, 400]] : []);
  root = createRoot(host);
  act(() => root.render(<Page start="lasso" layer={3} pen="lasso" />));
  await tick();
  const page = host.querySelector("[data-page]") as HTMLDivElement;
  fire(page, "pointerdown", 150, 350, 1, "pen");
  fire(page, "pointerup", 150, 350, 0, "pen");
  expect(ui.layer).toBe(3);
  fire(page, "pointerdown", 150, 350);
  expect(ui.layer).toBe(1);
  fire(page, "pointerup", 150, 350, 0);
  expect(ui.selected).toEqual([-1]);
});

test("Auswahl bleibt in einer Ebene: Rechteck auf Ebene 2 trifft keine Ebene-3-Objekte", () => {
  const page = mount("lasso", 2, [obj(1, "rect", 100, 100, 150, 150), text(2, 200)]);
  fire(page, "pointerdown", 50, 50);
  fire(page, "pointermove", 400, 300);
  fire(page, "pointerup", 400, 300, 0);
  expect(ui.selected).toEqual([1]);
});

test("Rechteck über Absätze markiert alle berührten; gemeinsam verschieben = ein Aufruf mit Vorschau", async () => {
  const para = (y: number) => ({ bbox: [50, y, 250, y + 30], text: "Absatz", font: "Helvetica", size: 12, color: [0, 0, 0] });
  backend.reply = (c) => Promise.resolve(c === "text_paragraphs" ? [para(100), para(200), para(400)] : []);
  root = createRoot(host);
  act(() => root.render(<Page start="lasso" layer={1} />));
  await tick();
  const page = host.querySelector("[data-page]") as HTMLDivElement;
  // streift Absatz 0 und 1, nicht 2
  fire(page, "pointerdown", 20, 120);
  fire(page, "pointermove", 100, 210);
  fire(page, "pointerup", 100, 210, 0);
  expect(ui.selected).toEqual([PARA0, PARA0 - 1]);
  // Umschalt-Klick fügt Absatz 2 hinzu, noch einmal entfernt ihn
  fire(page, "pointerdown", 100, 410, 1, "mouse", true);
  fire(page, "pointerup", 100, 410, 0, "mouse", true);
  expect(ui.selected).toEqual([PARA0, PARA0 - 1, PARA0 - 2]);
  fire(page, "pointerdown", 100, 410, 1, "mouse", true);
  fire(page, "pointerup", 100, 410, 0, "mouse", true);
  expect(ui.selected).toEqual([PARA0, PARA0 - 1]);
  // gemeinsam ziehen: ein Aufruf mit beiden Absätzen
  fire(page, "pointerdown", 100, 125);
  fire(page, "pointermove", 120, 140);
  fire(page, "pointerup", 120, 140, 0);
  expect(origs).toHaveLength(1);
  expect(origs[0]?.[1]).toMatchObject({ i: [0, 1], dx: 20, dy: 15 });
});
