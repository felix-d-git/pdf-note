import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type RefObject } from "react";
import { z } from "zod";
import {
  box, drawItems, FONT, hitTest, IMAGE_LOADED, inPolygon, lineHeight, MARKER_OPACITY, moveItem, newId, normPressure, scaleItem,
  TEXT_SIZE, textRect, unionBox, type InkPoint, type Item, type Preset,
} from "./ink";
import { toolFor, type Settings, type Tool } from "./settings";

/**
 * Rendert die Seite nur, solange sie (± eine Bildschirmhöhe) sichtbar ist; sonst Bild freigeben.
 * Zoomwechsel: altes Bild wird per CSS gestreckt, Neu-Render gedrosselt.
 */
function usePageImage(ref: RefObject<HTMLElement | null>, doc: number, index: number, scale: number, version: number) {
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // root = scrollender Container, sonst wirkt rootMargin nicht (Vorladen ± eine Bildschirmhöhe)
    const io = new IntersectionObserver((es) => setVisible(es.some((e) => e.isIntersecting)), {
      root: el.closest("[data-scroll]"), rootMargin: "100% 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      if (!visible) return setUrl(undefined);
      try {
        const buf = await invoke<ArrayBuffer>("render_page", { id: doc, index, scale });
        if (alive) setUrl(URL.createObjectURL(new Blob([buf], { type: "image/png" })));
      } catch (e) {
        console.error(e);
      }
    }, visible ? 120 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [visible, doc, index, scale, version]);

  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return [url, visible] as const;
}

export function Thumb({ doc, index, size, version, active, dropMark, onPointerDown, onClick }: {
  doc: number; index: number; size: [number, number]; version: number; active: boolean; dropMark?: "before" | "after";
  onPointerDown: (e: React.PointerEvent) => void; onClick: () => void;
}) {
  const mark = dropMark === "before" ? "border-t-accent" : dropMark === "after" ? "border-b-accent" : "";
  const ref = useRef<HTMLButtonElement>(null);
  const w = 120;
  const [url] = usePageImage(ref, doc, index, (w / size[0]) * devicePixelRatio, version);
  return (
    <button
      ref={ref}
      data-thumb={index}
      onPointerDown={onPointerDown}
      onClick={onClick}
      className={`flex flex-col items-center gap-1 border-y-2 border-transparent py-1 text-xs text-ink-3 ${mark}`}
    >
      <span
        className={`block rounded-xs bg-white ring-2 ${active ? "ring-accent" : "ring-transparent"}`}
        style={{ width: w, height: (w * size[1]) / size[0] }}
      >
        {url && <img src={url} alt="" draggable={false} className="h-full w-full rounded-xs" />}
      </span>
      {index + 1}
    </button>
  );
}

const HOLD_MS = 500;
const straighten = (s: Item, x: number, y: number) => {
  s.points = s.points.slice(0, 1).flatMap((a) => [a, [x, y, a[2]] as InkPoint]);
};
const HOLD_TOL = 2; // pt Bewegung, die das Ruhen nicht unterbricht
const ERASER_PX = 8; // Radierer-Radius in Bildschirmpixeln
const css = (c: [number, number, number]) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;

type Gesture =
  | { t: "draw"; item: Item; hold: { x: number; y: number; timer: number; straight: boolean } | null }
  | { t: "shape"; item: Item }
  | { t: "erase"; ids: Set<number> }
  | { t: "lasso"; poly: [number, number][] }
  | { t: "move"; x: number; y: number; dx: number; dy: number }
  | { t: "scale"; ox: number; oy: number; d0: number; s: number }
  | { t: "para"; i: number; x: number; y: number; dx: number; dy: number }
  | { t: "field" | "link"; x: number; y: number; dx: number; dy: number };

/** Anker-Link der Seite (Backend `links`); `page` −1 = externer Link, nur Platzhalter für die Nummerierung */
const Anchor = z.object({ rect: z.tuple([z.number(), z.number(), z.number(), z.number()]), page: z.number(), y: z.number() });
type Anchor = z.infer<typeof Anchor>;
/** Suchtreffer auf dieser Seite, pt */
export interface Hit { rect: number[]; active: boolean }

/** Erkannter Textabsatz der PDF (Backend `text_paragraphs`), Koordinaten in pt wie die Objekte. */
const Para = z.object({
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]), text: z.string(), font: z.string(), size: z.number(),
  color: z.tuple([z.number(), z.number(), z.number()]),
});
type Para = z.infer<typeof Para>;
/** Formularfeld der PDF (Backend `form_fields`); Wert `on` = angehakt, sonst „Off". */
const Field = z.object({
  xref: z.number(), kind: z.enum(["text", "check", "radio", "combo", "list"]), name: z.string(),
  rect: z.tuple([z.number(), z.number(), z.number(), z.number()]), value: z.string(), on: z.string(),
  options: z.array(z.tuple([z.string(), z.string()])), readonly: z.boolean(), multiline: z.boolean(),
});
type Field = z.infer<typeof Field>;
export interface NewField { kind: "text" | "check" | "combo"; name: string; rect: [number, number, number, number]; options: string[] }
/** Änderung an Absatz `para`; `size`/`font` nur, wenn gewählt (erzwingt Ersatzschrift). */
export interface TextEdit { para: number; text: string; dx?: number; dy?: number; size?: number; font?: "sans" | "serif" | "mono" }

/** Kleinstes Objekt, dessen Box den Punkt enthält (Klick auf überlappende Original-Objekte). */
function smallestAt(its: Item[], x: number, y: number) {
  const area = (it: Item) => { const b = box(it); return (b.x1 - b.x0) * (b.y1 - b.y0); };
  return its.filter((it) => { const b = box(it); return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1; })
    .sort((a, b) => area(a) - area(b))[0];
}

export interface PageProps {
  doc: number; index: number; size: [number, number]; zoom: number; version: number;
  items: Item[]; selected: number[]; tool: Tool; preset: Preset; marker: Preset; settings: Settings;
  onAdd: (it: Item) => void;
  onRemove: (ids: number[]) => void;
  onReplace: (items: Item[]) => void;
  onSelect: (page: number, ids: number[]) => void;
  /** Original-Objekte der PDF ändern (matrix fehlt → löschen), dazu eigene Objekte – ein Schritt */
  onOrig: (edits: OrigEdit[], next: Item[]) => void;
  onText: (edit: TextEdit) => void;
  onField: (xref: number, value: string) => void;
  onNewField: (f: NewField) => void;
  hits: Hit[];
  /** Link-Werkzeug wartet auf das Ziel */
  linking: boolean;
  onLinkFrom: (rect: [number, number, number, number]) => void;
  onLinkTo: (x: number, y: number) => void;
  onJump: (page: number, y: number) => void;
  onUnlink: (n: number) => void;
}

export interface OrigEdit { index: number; matrix?: number[] }

export function PageView(p: PageProps) {
  const { doc, index, size, zoom, version, items, selected, tool, preset, marker, settings } = p;
  const ref = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const g = useRef<Gesture>(null);
  // ein ausstehender Frame: sonst übermalt ein veralteter rAF nach `up` den gerade übernommenen Strich
  const frame = useRef(0);
  // Text-Klick: folgendes mousedown würde der neuen Textarea den Fokus nehmen (Blur → leeres Feld verworfen)
  const textDown = useRef(false);
  // Geste gehört einem Zeiger; aufliegender Handballen o. Ä. darf sie nicht stören
  const owner = useRef(-1);
  // Abbild der Geste für das Rendern (Ref selbst darf im Render nicht gelesen werden)
  const [gs, setGs] = useState<Gesture | null>(null);
  const rerender = () => setGs(g.current && { ...g.current });
  const [hover, setHover] = useState<{ x: number; y: number; tool: Tool }>();
  const [edit, setEdit] = useState<{ item: Item; isNew: boolean }>();
  const [url, visible] = usePageImage(ref, doc, index, zoom * devicePixelRatio, version);
  const [w, h] = [size[0] * zoom, size[1] * zoom];

  // Original-Objekte der PDF (nur Lasso): als Pseudo-Bild-Objekte mit Id −1 − Index, nicht gezeichnet
  // Boxen gehören zu einem Stand (`version`); veraltete Indizes nie verwenden
  const [origBoxes, setOrigBoxes] = useState<{ v: number; b: number[][] }>({ v: -1, b: [] });
  const lassoOn = tool === "lasso" && visible;
  useEffect(() => {
    if (!lassoOn) return;
    let live = true;
    invoke<number[][]>("orig_objects", { id: doc, index }).then((b) => live && setOrigBoxes({ v: version, b }), () => live && setOrigBoxes({ v: version, b: [] }));
    return () => void (live = false);
  }, [doc, index, version, lassoOn]);
  const origs: Item[] = lassoOn && origBoxes.v === version ? origBoxes.b.map(([x0 = 0, y0 = 0, x1 = 0, y1 = 0], i) => ({
    id: -1 - i, page: index, kind: "image", color: [0, 0, 0], opacity: 1, size: 0, simulated: false,
    points: [[x0, y0, 0.5], [x1, y1, 0.5]], text: "",
  })) : [];
  // Textabsätze der PDF (nur PDF-Text-Werkzeug), ebenfalls je Stand
  const [paras, setParas] = useState<{ v: number; list: Para[] }>({ v: -1, list: [] });
  const [pedit, setPedit] = useState<number>();
  const textOn = tool === "pdftext" && visible;
  useEffect(() => {
    if (!textOn) return;
    let live = true;
    invoke("text_paragraphs", { id: doc, index }).then(
      (r) => live && setParas({ v: version, list: z.array(Para).parse(r) }),
      () => live && setParas({ v: version, list: [] }),
    );
    return () => void (live = false);
  }, [doc, index, version, textOn]);
  const plist = textOn && paras.v === version ? paras.list : [];
  // Formularfelder: alte Liste bleibt bis zur neuen stehen, sonst verlieren die Eingaben nach jedem Wert den Fokus (Tab)
  const [fields, setFields] = useState<Field[]>([]);
  const [newf, setNewf] = useState<NewField["rect"]>();
  const formOn = tool === "form" && visible;
  useEffect(() => {
    if (!formOn) return;
    let live = true;
    invoke("form_fields", { id: doc, index }).then((r) => live && setFields(z.array(Field).parse(r)), () => live && setFields([]));
    return () => void (live = false);
  }, [doc, index, version, formOn]);
  const flist = formOn ? fields : [];
  // Anker-Links (nur Link-Werkzeug), je Stand
  const [anchors, setAnchors] = useState<{ v: number; list: Anchor[] }>({ v: -1, list: [] });
  const linkOn = tool === "link" && visible;
  useEffect(() => {
    if (!linkOn) return;
    let live = true;
    invoke("links", { id: doc, index }).then(
      (r) => live && setAnchors({ v: version, list: z.array(Anchor).parse(r) }),
      () => live && setAnchors({ v: version, list: [] }),
    );
    return () => void (live = false);
  }, [doc, index, version, linkOn]);
  const alist = linkOn && anchors.v === version ? anchors.list : [];
  const paraAt = (x: number, y: number) => plist.findIndex(({ bbox: [x0, y0, x1, y1] }) => x >= x0 && x <= x1 && y >= y0 && y <= y1);

  const sel = [...items, ...origs].filter((it) => selected.includes(it.id));
  const transform = (it: Item) =>
    !selected.includes(it.id) ? it
    : gs?.t === "move" ? moveItem(it, gs.dx, gs.dy)
    : gs?.t === "scale" ? scaleItem(it, gs.ox, gs.oy, gs.s)
    : it;
  const shown = () => {
    const c = g.current;
    const out = items
      .filter((it) => !(c?.t === "erase" && c.ids.has(it.id)) && it.id !== edit?.item.id)
      .map(transform);
    return c?.t === "draw" || c?.t === "shape" ? [...out, c.item] : out;
  };

  const redraw = () => {
    const ctx = canvas.current?.getContext("2d");
    if (ctx) drawItems(ctx, shown(), zoom);
  };
  useEffect(redraw);
  const schedule = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(redraw);
  };
  // Bilder laden asynchron → danach neu zeichnen
  useEffect(() => {
    addEventListener(IMAGE_LOADED, redraw);
    return () => removeEventListener(IMAGE_LOADED, redraw);
  });

  const pt = (e: PointerEvent | React.PointerEvent): InkPoint => {
    const r = ref.current?.getBoundingClientRect() ?? new DOMRect();
    const pr = e.pointerType === "pen" ? normPressure(e.pressure, settings.pressureMax) : 0.5;
    return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom, pr];
  };

  // Shape-Hold: Stift ruht ≥ 500 ms → Strich wird zur geraden Linie vom Anfang bis zur Ruhestelle
  const armHold = (x: number, y: number) => {
    const c = g.current;
    const hd = c?.t === "draw" ? c.hold : null;
    if (!hd || !c || c.t !== "draw") return;
    clearTimeout(hd.timer);
    Object.assign(hd, { x, y, timer: setTimeout(() => {
      if (c.item.points.length < 3) return;
      hd.straight = true;
      straighten(c.item, hd.x, hd.y);
      redraw();
    }, HOLD_MS) });
  };

  const eraseAt = (x: number, y: number) => {
    const c = g.current;
    if (c?.t !== "erase") return;
    for (const it of items) if (hitTest(it, x, y, ERASER_PX / zoom)) c.ids.add(it.id);
  };

  const make = (kind: Item["kind"], pr: Preset, q: InkPoint, simulated: boolean): Item => ({
    id: newId(), page: index, kind, color: pr.color, opacity: kind === "marker" ? MARKER_OPACITY : 1,
    size: kind === "text" ? TEXT_SIZE : pr.size, simulated, points: [q], text: "",
  });

  // Stift-Spitze/linke Maustaste nach Werkzeug, gebundene Stifttasten temporär; Finger geht an den Scroll-Container.
  const down = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" || (e.target as Element).closest("textarea, [data-pedit], [data-field]")) return;
    const t = toolFor(e, tool, settings);
    if (!t || g.current) return;
    owner.current = e.pointerId;
    e.stopPropagation();
    const q = pt(e);
    const [x, y] = q;
    if (t === "text") {
      const hit = items.findLast((it) => it.kind === "text" && hitTest(it, x, y, 0));
      // Klick während des Bearbeitens schließt erst das offene Feld (Blur speichert)
      if (!edit) {
        textDown.current = true;
        setEdit(hit ? { item: hit, isNew: false } : { item: make("text", preset, q, false), isNew: true });
      }
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (t === "form") {
      setNewf(undefined);
      g.current = { t: "field", x, y, dx: 0, dy: 0 };
      return rerender();
    }
    if (t === "link") {
      if (p.linking) return p.onLinkTo(x, y);
      g.current = { t: "link", x, y, dx: 0, dy: 0 };
      return rerender();
    }
    if (t === "pdftext") {
      const i = paraAt(x, y);
      setPedit(undefined);
      if (i >= 0) g.current = { t: "para", i, x, y, dx: 0, dy: 0 };
      return rerender();
    }
    if (t === "pen" || t === "marker") {
      const item = make(t === "pen" ? "ink" : "marker", t === "pen" ? preset : marker, q, e.pointerType !== "pen");
      g.current = { t: "draw", item, hold: { x, y, timer: 0, straight: false } };
      armHold(x, y);
    } else if (t === "eraser") {
      g.current = { t: "erase", ids: new Set() };
      eraseAt(x, y);
      redraw();
    } else if (t === "lasso") {
      const b = sel.length ? unionBox(sel) : null;
      if (b && (e.target as Element).closest("[data-handle]")) {
        g.current = { t: "scale", ox: b.x0, oy: b.y0, d0: Math.max(1, Math.hypot(x - b.x0, y - b.y0)), s: 1 };
      } else if (b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) {
        g.current = { t: "move", x, y, dx: 0, dy: 0 };
      } else {
        g.current = { t: "lasso", poly: [[x, y]] };
      }
      rerender();
    } else {
      g.current = { t: "shape", item: { ...make(t, preset, q, false), points: [q, q] } };
    }
  };

  const move = (e: React.PointerEvent) => {
    const c = g.current;
    if (c && e.pointerId !== owner.current) return;
    if (!c) {
      if (e.pointerType === "pen") {
        const t = toolFor({ pointerType: "pen", buttons: e.buttons | 1 }, tool, settings);
        const [x, y] = pt(e);
        setHover(t ? { x, y, tool: t } : undefined);
      }
      return;
    }
    const evs = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    const q = pt(e);
    const [x, y] = q;
    switch (c.t) {
      case "draw":
        for (const ev of evs) {
          const r = pt(ev), hd = c.hold;
          if (hd?.straight) straighten(c.item, r[0], r[1]);
          else {
            c.item.points.push(r);
            if (hd && Math.hypot(r[0] - hd.x, r[1] - hd.y) > HOLD_TOL) armHold(r[0], r[1]);
          }
        }
        return schedule();
      case "shape":
        c.item.points[1] = q;
        return schedule();
      case "erase":
        for (const ev of evs) eraseAt(...(pt(ev).slice(0, 2) as [number, number]));
        return schedule();
      case "lasso":
        c.poly.push([x, y]);
        break;
      case "move":
      case "para":
      case "field":
      case "link":
        Object.assign(c, { dx: x - c.x, dy: y - c.y });
        break;
      case "scale":
        c.s = Math.max(0.05, Math.hypot(x - c.ox, y - c.oy) / c.d0);
        break;
    }
    if (hover) setHover(undefined);
    rerender();
  };

  const up = (e: React.PointerEvent) => {
    const c = g.current;
    if (c && e.pointerId !== owner.current) return;
    g.current = null;
    if (!c) return;
    cancelAnimationFrame(frame.current);
    switch (c.t) {
      case "draw":
        if (c.hold) clearTimeout(c.hold.timer);
        p.onAdd(c.item);
        break;
      case "shape": {
        const [a, b] = c.item.points;
        if (a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) > 1) p.onAdd(c.item);
        break;
      }
      case "erase":
        if (c.ids.size) p.onRemove([...c.ids]);
        break;
      case "lasso": {
        const [x0, y0] = c.poly[0] ?? [0, 0];
        const far = c.poly.some(([x, y]) => Math.hypot(x - x0, y - y0) > 3);
        const ids = far
          ? [...items, ...origs].filter((it) => {
            const b = box(it);
            return inPolygon((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, c.poly);
          }).map((it) => it.id)
          : items.findLast((it) => hitTest(it, x0, y0, 4 / zoom + 1))?.id ?? smallestAt(origs, x0, y0)?.id;
        p.onSelect(index, ids === undefined ? [] : Array.isArray(ids) ? ids : [ids]);
        break;
      }
      case "move":
        if (c.dx || c.dy) commit((it) => moveItem(it, c.dx, c.dy), [1, 0, 0, 1, c.dx, c.dy]);
        break;
      case "para": {
        const para = plist[c.i];
        // kurzes Zucken = Klick → bearbeiten
        if (para && Math.hypot(c.dx, c.dy) * zoom > 3) p.onText({ para: c.i, text: para.text, dx: c.dx, dy: c.dy });
        else setPedit(c.i);
        break;
      }
      case "field":
        if (Math.abs(c.dx) * zoom > 3 && Math.abs(c.dy) * zoom > 3) {
          setNewf([Math.min(c.x, c.x + c.dx), Math.min(c.y, c.y + c.dy), Math.max(c.x, c.x + c.dx), Math.max(c.y, c.y + c.dy)]);
        }
        break;
      case "link": {
        const r: [number, number, number, number] = [Math.min(c.x, c.x + c.dx), Math.min(c.y, c.y + c.dy), Math.max(c.x, c.x + c.dx), Math.max(c.y, c.y + c.dy)];
        if (Math.abs(c.dx) * zoom > 3 && Math.abs(c.dy) * zoom > 3) p.onLinkFrom(r);
        else {
          // Klick auf vorhandenen Link → springen (nur interne Ziele, externe sind nie in der Liste)
          const a = alist.findLast(({ page, rect: [x0, y0, x1, y1] }) => page >= 0 && c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1);
          if (a) p.onJump(a.page, a.y);
        }
        break;
      }
      case "scale":
        if (c.s !== 1) commit((it) => scaleItem(it, c.ox, c.oy, c.s), [c.s, 0, 0, c.s, c.ox * (1 - c.s), c.oy * (1 - c.s)]);
        break;
    }
    rerender();
  };

  /** Verschieben/Skalieren: eigene Objekte per `f`, Original-Objekte per Matrix `m` im Backend */
  const commit = (f: (it: Item) => Item, m: number[]) => {
    const own = sel.filter((it) => it.id >= 0).map(f);
    const orig = sel.filter((it) => it.id < 0).map((it) => ({ index: -1 - it.id, matrix: m }));
    if (orig.length) p.onOrig(orig, own);
    else p.onReplace(own);
  };

  const commitText = (text: string) => {
    if (!edit) return;
    setEdit(undefined);
    const { item, isNew } = edit;
    if (!text.trim()) {
      if (!isNew) p.onRemove([item.id]);
      return;
    }
    if (text === item.text) return;
    const ctx = (canvas.current ?? document.createElement("canvas")).getContext("2d");
    const { x0, y0 } = box(item);
    const points = ctx ? textRect(ctx, text, item.size, x0, y0) : item.points;
    const next = { ...item, text, points };
    if (isNew) p.onAdd(next);
    else p.onReplace([next]);
  };

  const submitPara = (f: HTMLFormElement) => {
    const para = pedit === undefined ? undefined : plist[pedit];
    setPedit(undefined);
    if (!para || pedit === undefined) return;
    const d = new FormData(f);
    const text = String(d.get("text") ?? "");
    const font = String(d.get("font") ?? "");
    const size = Number(d.get("size"));
    const edit: TextEdit = { para: pedit, text };
    if (font === "sans" || font === "serif" || font === "mono") edit.font = font;
    if (Number.isFinite(size) && Math.abs(size - para.size) > 0.05) edit.size = size;
    if (text !== para.text || edit.font || edit.size) p.onText(edit);
  };

  const submitField = (f: HTMLFormElement) => {
    setNewf(undefined);
    const d = new FormData(f);
    const kind = String(d.get("kind"));
    const options = String(d.get("options") ?? "").split("\n").map((o) => o.trim()).filter(Boolean);
    if (newf && (kind === "text" || kind === "check" || kind === "combo")) p.onNewField({ kind, name: String(d.get("name") ?? "").trim(), rect: newf, options });
  };
  const fieldBox = gs?.t === "field" || gs?.t === "link" ? { left: Math.min(gs.x, gs.x + gs.dx) * zoom, top: Math.min(gs.y, gs.y + gs.dy) * zoom, width: Math.abs(gs.dx) * zoom, height: Math.abs(gs.dy) * zoom } : null;

  const sb = sel.length ? unionBox(sel.map(transform)) : null;
  const lasso = gs?.t === "lasso" ? gs.poly : null;
  const hoverD = hover && (hover.tool === "eraser" ? 2 * ERASER_PX
    : hover.tool === "pen" ? preset.size * zoom : hover.tool === "marker" ? marker.size * zoom : 0);

  return (
    <div
      ref={ref}
      data-page={index}
      className="relative mx-auto bg-white shadow-raised"
      style={{ width: w, height: h, touchAction: "none", cursor: tool === "text" || tool === "pdftext" ? "text" : tool === "form" ? "cell" : p.linking ? "alias" : "crosshair" }}
      onPointerDown={down}
      onMouseDown={(e) => {
        if (textDown.current) e.preventDefault();
        textDown.current = false;
      }}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={() => setHover(undefined)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {url && <img src={url} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none" />}
      {/* Canvas nur für sichtbare Seiten: volle Auflösung je Seite kostet sonst bei hohem Zoom zu viel Speicher.
          multiply: Textmarker färbt Text nicht ab (wie Highlight in der PDF) */}
      {visible && <canvas
        ref={canvas}
        width={Math.round(w * devicePixelRatio)}
        height={Math.round(h * devicePixelRatio)}
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ mixBlendMode: "multiply" }}
      />}
      {sb && (
        <div
          className="pointer-events-none absolute border border-dashed border-accent"
          style={{ left: sb.x0 * zoom - 3, top: sb.y0 * zoom - 3, width: (sb.x1 - sb.x0) * zoom + 6, height: (sb.y1 - sb.y0) * zoom + 6 }}
        >
          <span data-handle className="pointer-events-auto absolute -right-2 -bottom-2 h-4 w-4 cursor-nwse-resize rounded-xs bg-accent" />
        </div>
      )}
      {lasso && (
        <svg className="pointer-events-none absolute inset-0" width={w} height={h}>
          <polyline points={lasso.map(([x, y]) => `${x * zoom},${y * zoom}`).join(" ")} fill="var(--accent-soft)" stroke="var(--accent)" strokeDasharray="4 3" />
        </svg>
      )}
      {hover && hoverD ? (
        <span
          className="pointer-events-none absolute rounded-pill"
          style={{
            left: hover.x * zoom - hoverD / 2, top: hover.y * zoom - hoverD / 2, width: Math.max(3, hoverD), height: Math.max(3, hoverD),
            ...(hover.tool === "eraser"
              ? { border: "1px solid var(--ink-3)" }
              : { background: css(hover.tool === "pen" ? preset.color : marker.color), opacity: hover.tool === "marker" ? 0.5 : 0.8 }),
          }}
        />
      ) : null}
      {plist.map(({ bbox: [x0, y0, x1, y1] }, i) => {
        const m = gs?.t === "para" && gs.i === i ? gs : { dx: 0, dy: 0 };
        return (
          <div
            key={i}
            className={`pointer-events-none absolute border border-dashed ${m.dx || m.dy || pedit === i ? "border-accent" : "border-accent/30"}`}
            style={{ left: (x0 + m.dx) * zoom - 2, top: (y0 + m.dy) * zoom - 2, width: (x1 - x0) * zoom + 4, height: (y1 - y0) * zoom + 4 }}
          />
        );
      })}
      {/* Felder in PDF-Reihenfolge → Tab springt zum nächsten; Haken/Punkt zeigt das Seitenbild, Eingabe liegt unsichtbar darüber */}
      {flist.map((f) => {
        const [x0, y0, x1, y1] = f.rect;
        const style = { left: x0 * zoom, top: y0 * zoom, width: (x1 - x0) * zoom, height: (y1 - y0) * zoom, fontSize: Math.min(12 * zoom, (y1 - y0) * zoom * 0.7) };
        const cls = "absolute rounded-xs outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed";
        const key = `${f.xref}:${f.value}`;
        const commit = (v: string) => v !== f.value && p.onField(f.xref, v);
        if (f.kind === "check" || f.kind === "radio") {
          return (
            // gesteuert + Key ohne Wert: Radio-Gruppe teilt den Wert, sonst verlöre jeder Knopf der Gruppe den Fokus
            <input key={f.xref} data-field type={f.kind === "check" ? "checkbox" : "radio"} name={`f${doc}-${index}-${f.name}`} title={f.name}
              checked={f.value === f.on} disabled={f.readonly} className={`${cls} cursor-pointer appearance-none bg-accent/10`} style={style}
              onChange={(e) => commit(e.currentTarget.checked ? f.on : "Off")} />
          );
        }
        if (f.kind === "combo" || f.kind === "list") {
          return (
            <select key={key} data-field title={f.name} defaultValue={f.value} disabled={f.readonly} className={`${cls} bg-white text-black`} style={style}
              onChange={(e) => commit(e.currentTarget.value)}>
              {!f.options.some(([v]) => v === f.value) && <option value={f.value}>{f.value}</option>}
              {f.options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          );
        }
        const Tag = f.multiline ? "textarea" : "input";
        return (
          <Tag key={key} data-field title={f.name} defaultValue={f.value} disabled={f.readonly} className={`${cls} resize-none bg-white px-0.5 text-black`} style={style}
            onBlur={(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => commit(e.currentTarget.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
              if (e.key === "Escape") e.currentTarget.value = f.value;
              if (e.key === "Escape" || (e.key === "Enter" && (!f.multiline || e.ctrlKey))) e.currentTarget.blur();
            }} />
        );
      })}
      {p.hits.map(({ rect: [x0 = 0, y0 = 0, x1 = 0, y1 = 0], active }, i) => (
        <div key={`h${i}`} className={`pointer-events-none absolute rounded-xs bg-accent/25 ${active ? "ring-2 ring-accent" : ""}`}
          style={{ left: x0 * zoom, top: y0 * zoom, width: (x1 - x0) * zoom, height: (y1 - y0) * zoom }} />
      ))}
      {alist.map(({ rect: [x0, y0, x1, y1], page }, n) => page >= 0 && (
        <div key={`l${n}`} className="pointer-events-none absolute border border-dashed border-accent bg-accent/10"
          style={{ left: x0 * zoom, top: y0 * zoom, width: (x1 - x0) * zoom, height: (y1 - y0) * zoom }}>
          <span className="absolute -top-4 left-0 font-mono text-[10px] whitespace-nowrap text-accent">→ S. {page + 1}</span>
          <button data-pedit title="Link löschen" onClick={() => p.onUnlink(n)}
            className="pointer-events-auto absolute -top-2 -right-2 h-4 w-4 rounded-full bg-accent text-[10px] leading-4 text-white">×</button>
        </div>
      ))}
      {fieldBox && (
        <div className="pointer-events-none absolute border border-dashed border-accent"
          style={fieldBox} />
      )}
      {newf && (
        <>
          <div className="pointer-events-none absolute border border-dashed border-accent"
            style={{ left: newf[0] * zoom, top: newf[1] * zoom, width: (newf[2] - newf[0]) * zoom, height: (newf[3] - newf[1]) * zoom }} />
          <form
            data-pedit
            className="absolute z-10 flex w-64 flex-col gap-1 rounded-xs bg-surface p-2 text-sm shadow-raised"
            style={{ left: newf[0] * zoom, top: newf[3] * zoom + 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              submitField(e.currentTarget);
            }}
            onKeyDown={(e) => {
              e.stopPropagation(); // Werkzeug-Kürzel gehören dem Formular
              if (e.key === "Escape") setNewf(undefined);
            }}
          >
            <select name="kind" defaultValue="text" className="rounded-xs border border-line bg-transparent">
              <option value="text">Textfeld</option>
              <option value="check">Checkbox</option>
              <option value="combo">Auswahlliste</option>
            </select>
            <input name="name" required autoFocus placeholder="Name (eindeutig, ohne Punkt)" className="rounded-xs border border-line bg-transparent p-1" />
            <textarea name="options" rows={3} placeholder="Optionen der Auswahlliste, eine je Zeile" className="resize-y rounded-xs border border-line bg-transparent p-1" />
            <div className="flex gap-2">
              <button type="button" className="ml-auto" onClick={() => setNewf(undefined)}>Abbrechen</button>
              <button type="submit" className="text-accent">Anlegen</button>
            </div>
          </form>
        </>
      )}
      {pedit !== undefined && plist[pedit] && (() => {
        const { bbox: [x0, , x1, y1], text, size } = plist[pedit];
        return (
          <form
            data-pedit
            className="absolute z-10 flex flex-col gap-1 rounded-xs bg-surface p-2 text-sm shadow-raised"
            style={{ left: x0 * zoom, top: y1 * zoom + 6, width: Math.max(260, (x1 - x0) * zoom) }}
            onSubmit={(e) => {
              e.preventDefault();
              submitPara(e.currentTarget);
            }}
            onKeyDown={(e) => {
              e.stopPropagation(); // Strg+Z, Werkzeug-Kürzel gehören dem Formular
              if (e.key === "Escape") setPedit(undefined);
              if (e.key === "Enter" && e.ctrlKey) e.currentTarget.requestSubmit();
            }}
          >
            <textarea name="text" autoFocus defaultValue={text} rows={Math.min(12, Math.ceil(text.length / 60) + 1)} className="resize-y rounded-xs border border-line bg-transparent p-1" />
            <div className="flex items-center gap-2">
              <select name="font" defaultValue="" title="Schrift" className="rounded-xs border border-line bg-transparent">
                <option value="">Original</option>
                <option value="sans">Sans</option>
                <option value="serif">Serif</option>
                <option value="mono">Mono</option>
              </select>
              <input name="size" type="number" min={2} max={500} step={0.5} defaultValue={Math.round(size * 10) / 10} title="Größe (pt)" className="w-16 rounded-xs border border-line bg-transparent" />
              <button type="button" className="ml-auto" onClick={() => setPedit(undefined)}>Abbrechen</button>
              <button type="submit" className="text-accent" title="Strg+Enter">OK</button>
            </div>
          </form>
        );
      })()}
      {edit && (() => {
        const { x0, y0 } = box(edit.item);
        const fs = edit.item.size * zoom;
        return (
          <textarea
            autoFocus
            defaultValue={edit.item.text}
            onBlur={(e) => commitText(e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation(); // Strg+Z usw. gehören dem Textfeld
              if (e.key === "Escape" || (e.key === "Enter" && e.ctrlKey)) e.currentTarget.blur();
            }}
            className="absolute resize-none border border-dashed border-accent bg-transparent outline-none"
            style={{
              left: x0 * zoom, top: y0 * zoom, padding: 2 * zoom, font: `${fs}px ${FONT}`, lineHeight: `${lineHeight(fs)}px`,
              color: css(edit.item.color), minWidth: fs * 4, overflow: "hidden", fieldSizing: "content",
            } as React.CSSProperties}
          />
        );
      })()}
    </div>
  );
}
