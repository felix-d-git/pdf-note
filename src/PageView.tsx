import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type RefObject } from "react";
import { z } from "zod";
import {
  box, caretAt, drawItems, fixedWidth, FONT, hitTest, IMAGE_LOADED, inPolygon, lineHeight, makeSpace, MARKER_OPACITY, moveItem, newId, normPressure, rotateItem,
  rotMatrix, scaleItem, scaleMatrix, layerOf, textRect, unionBox, type Crop, type InkPoint, type Item, type Layer, type Preset,
} from "./ink";
import { BetweenHorizontalStart, Check, ClipboardPaste, Copy, Crop as CropIcon, ImagePlus, RotateCw, Scissors, SendToBack, BringToFront, SlidersHorizontal, Trash, Type, X } from "lucide-react";
import { CropBox, HANDLE_CURSOR, HANDLES } from "./Crop";
import { T } from "./i18n";
import { IconBtn } from "./ui";
import { toolFor, type Settings, type Tool } from "./settings";
import { CharLine, posAt, selRange, type Pos } from "./textsel";

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
const hex = (c: [number, number, number]) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
const rgb = (v: string) => [1, 3, 5].map((k) => parseInt(v.slice(k, k + 2), 16) / 255) as [number, number, number];
const ICON = "grid h-7 min-w-7 place-items-center rounded-xs px-1 text-sm text-ink-2 hover:bg-sunken hover:text-ink";
/** Ersatz-Schriftfamilie für die Absatz-Textarea */
const family = (font: string) => /mono|courier/i.test(font) ? "monospace" : /sans|helvet|arial|calibri/i.test(font) ? FONT : "serif";

type Gesture =
  | { t: "draw"; item: Item; hold: { x: number; y: number; timer: number; straight: boolean } | null }
  | { t: "shape"; item: Item }
  | { t: "erase"; ids: Set<number> }
  /** `fresh`: kein Editor war offen → Klick ohne Ziehen setzt Cursor (neues Textfeld/Absatz bearbeiten) */
  | { t: "lasso"; poly: [number, number][]; rect: boolean; fresh: boolean }
  | { t: "tsel"; a: Pos; b: Pos; x: number; y: number; moved: boolean; fresh: boolean }
  /** Ziehen im gerade geöffneten Textfeld markiert von Stelle `a` aus */
  | { t: "fsel"; it: Item; a: number }
  /** Griffleiste/Breitengriff eines Textfelds */
  | { t: "tmove"; id: number; x: number; y: number; dx: number; dy: number }
  | { t: "twidth" | "pwidth"; id: number; x: number; w0: number; w: number }
  | { t: "move"; x: number; y: number; dx: number; dy: number }
  /** Griff `h` (Himmelsrichtung): Gegenseite (ox, oy) bleibt stehen */
  | { t: "scale"; h: string; x: number; y: number; w: number; hh: number; ox: number; oy: number; sx: number; sy: number }
  | { t: "rot"; cx: number; cy: number; a0: number; deg: number }
  /** Marker auf PDF-Text: folgt den Zeilen von a bis b */
  | { t: "hl"; a: Pos; b: Pos; item: Item }
  | { t: "para"; i: number; x: number; y: number; dx: number; dy: number }
  | { t: "field" | "link"; x: number; y: number; dx: number; dy: number }
  /** Platz einfügen: Linie bei `y`, um `dy` gezogen */
  | { t: "space"; y: number; dy: number };

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
export interface TextEdit {
  para: number; text: string; dx?: number; dy?: number; size?: number; font?: "sans" | "serif" | "mono";
  /** feste Breite (Breitengriff), pt; Farbe 0…1 */
  width?: number; color?: [number, number, number];
}

const inBox = (b: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
const deg = (r: number) => (r * 180) / Math.PI;
/** Zeilenrechtecke als Punktpaare (Highlight) */
const hlPoints = (lines: CharLine[], a: Pos, b: Pos): InkPoint[] =>
  selRange(lines, a, b).rects.flatMap(([x0, y0, x1, y1]): InkPoint[] => [[x0, y0, 0.5], [x1, y1, 0.5]]);

/** Kleinstes Objekt, dessen Box den Punkt enthält (Klick auf überlappende Original-Objekte). */
function smallestAt(its: Item[], x: number, y: number) {
  const area = (it: Item) => { const b = box(it); return (b.x1 - b.x0) * (b.y1 - b.y0); };
  return its.filter((it) => { const b = box(it); return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1; })
    .sort((a, b) => area(a) - area(b))[0];
}

/** Markierter PDF-Text der Seite (Stellen in `text_chars`) */
export interface TextSel { a: Pos; b: Pos; text: string }

export interface PageProps {
  doc: number; index: number; size: [number, number]; zoom: number; version: number;
  /** `tool` = Maus-Werkzeug, `penTool` = Stift-Werkzeug (gleich, wenn „Automatisch wechseln" aus ist) */
  items: Item[]; selected: number[]; tool: Tool; penTool: Tool; preset: Preset; marker: Preset; textSize: number; settings: Settings;
  /** Koordinatensystem-Werkzeug: Art fürs nächste Aufziehen */
  axes: { xyz: boolean; grid: boolean };
  /** aktive Ebene: nur deren Objekte sind wähl-/radierbar; 1 = PDF-Inhalt (Bilder, Text, Absätze) */
  layer: Layer;
  textSel: TextSel | null;
  onTextSel: (sel: TextSel | null) => void;
  onAdd: (it: Item) => void;
  /** fertig gezogene Form (Stift oder Maus) */
  onShape: (it: Item, pen: boolean) => void;
  /** Tippen bei ausgewähltem Textfeld: DocView ruft je Seite `(id, Zeichen)` */
  typers: Map<number, (id: number, ch: string) => void>;
  onRemove: (ids: number[]) => void;
  onReplace: (items: Item[]) => void;
  /** Bild zuschneiden (Doppelklick → Zuschnitt-Modus → ✓/Enter) */
  onCrop: (id: number, f: Crop) => void;
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
  /** Mini-Leiste/Rechtsklick-Menü; `at` = Stelle in pt (Einfügen/Bild hier) */
  onCmd: (cmd: Cmd, at?: [number, number]) => void;
  /** Platz einfügen fertig: verschobene Objekte (leer = nichts verschoben), ein Schritt */
  onSpace: (moved: Item[]) => void;
}

export interface OrigEdit { index: number; matrix?: number[] }
/** Aktionen aus Mini-Leiste/Rechtsklick-Menü, die DocView ausführt; `notes` = auf Ebene 3 wechseln (Textfeld hier auf Ebene 1) */
export type Cmd = "cut" | "copy" | "paste" | "delete" | "front" | "back" | "image" | "space" | "notes";

/** Griffleiste oben (verschieben, Klick wählt als Objekt) + Breitengriff rechts; Attributwert = Id/Absatz */
const grips = (grip: string, width: string, id: number) => (
  <>
    <span {...{ [`data-${grip}`]: id }} title={T.move}
      className="pointer-events-auto absolute -top-2.5 left-0 h-2 w-full cursor-move rounded-xs bg-accent/50" />
    <span {...{ [`data-${width}`]: id }} title={T.width}
      className="pointer-events-auto absolute top-0 -right-2 h-full w-1.5 cursor-ew-resize rounded-xs bg-accent/50" />
  </>
);

/** Stift-Latenz (Pointer-Event → gezeichneter Frame), nur Dev oder localStorage `pdfnote.latency`=1; Mittel/Max alle 60 Frames per console.debug */
const lat = { n: 0, sum: 0, max: 0 };
function logLatency(ts: number) {
  try {
    if (!import.meta.env.DEV && localStorage.getItem("pdfnote.latency") !== "1") return;
  } catch {
    return;
  }
  const d = performance.now() - ts;
  lat.n++;
  lat.sum += d;
  lat.max = Math.max(lat.max, d);
  if (lat.n >= 60) {
    console.debug(`[pen] Latenz Event→Frame: Ø ${(lat.sum / lat.n).toFixed(1)} ms, max ${lat.max.toFixed(1)} ms (${lat.n} Frames)`);
    Object.assign(lat, { n: 0, sum: 0, max: 0 });
  }
}

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
  // Zeiger über der Auswahl → Verschiebe-Cursor
  const [overSel, setOverSel] = useState(false);
  // offenes Textfeld; `text` = Startinhalt, falls schon getippt wurde (Tippen bei ausgewähltem Feld); `fixed` = feste Breite
  const [edit, setEdit] = useState<{ item: Item; isNew: boolean; text?: string; fixed?: number }>();
  // Textfeld/Absatz unter der Maus (Rahmen, Griffleiste, I-Cursor)
  const [hovT, setHovT] = useState<number>();
  const [hovP, setHovP] = useState<number>();
  // Textarea des offenen Felds/Absatzes; Cursor/Markierung, die beim Öffnen gesetzt wird
  const ta = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<[number, number]>([0, 0]);
  // erstes Esc schließt den Editor, das Feld bleibt ausgewählt
  const esc = useRef(false);
  // React 19 ruft Ref-Callbacks je Render neu auf → nur beim ersten Mal fokussieren und Cursor setzen
  const taRef = (el: HTMLTextAreaElement | null) => {
    if (!el || el === ta.current) return;
    ta.current = el;
    el.focus();
    el.setSelectionRange(...caret.current);
  };
  const [url, visible] = usePageImage(ref, doc, index, zoom * devicePixelRatio, version);
  const [w, h] = [size[0] * zoom, size[1] * zoom];

  // Ebene 1: Original-Objekte, Absätze und Zeichen der PDF laden
  const lassoOn = p.layer === 1 && visible;
  // Original-Objekte der PDF: als Pseudo-Bild-Objekte mit Id −1 − Index, nicht gezeichnet
  // Boxen gehören zu einem Stand (`version`); veraltete Indizes nie verwenden
  const [origBoxes, setOrigBoxes] = useState<{ v: number; b: number[][] }>({ v: -1, b: [] });
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
  // Textabsätze (Klick bearbeitet) und Zeichen inkl. OCR-Text (Ziehen markiert, Marker rastet ein), je Stand
  const textOn = visible && (p.layer === 1 || tool === "marker" || p.penTool === "marker");
  const [paras, setParas] = useState<{ v: number; list: Para[]; chars: CharLine[] }>({ v: -1, list: [], chars: [] });
  // bearbeiteter Absatz: Index, Verschiebung und feste Breite aus Griffleiste/Breitengriff
  const [pedit, setPedit] = useState<{ i: number; dx: number; dy: number; w?: number }>();
  // Index gilt nur für Stand + Ebene: nach Undo/Seitenoperation/Ebenenwechsel Editor schließen
  const [peditKey, setPeditKey] = useState(`${version}/${p.layer}`);
  if (peditKey !== `${version}/${p.layer}`) {
    setPeditKey(`${version}/${p.layer}`);
    setPedit(undefined);
  }
  useEffect(() => {
    if (!textOn) return;
    let live = true;
    Promise.all([invoke("text_paragraphs", { id: doc, index }), invoke("text_chars", { id: doc, index })]).then(
      ([r, c]) => live && setParas({ v: version, list: z.array(Para).parse(r), chars: z.array(CharLine).parse(c) }),
      () => live && setParas({ v: version, list: [], chars: [] }),
    );
    return () => void (live = false);
  }, [doc, index, version, textOn]);
  const plist = lassoOn && paras.v === version ? paras.list : [];
  const clist = textOn && paras.v === version ? paras.chars : [];
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
  // Drehgriff nur für Bilder (Original-Objekte zählen als Bild)
  const rotatable = sel.length > 0 && sel.every((it) => it.kind === "image");
  // Zuschnitt-Modus: id des eigenen Bilds; verschwindet es (Undo, Entf), endet der Modus von selbst
  const [crop, setCrop] = useState<number>();
  const cropIt = items.find((it) => it.id === crop && it.kind === "image");
  // Rechtsklick-Menü an Stelle (pt); `on` = worauf geklickt wurde
  const [menu, setMenu] = useState<{ x: number; y: number; on: "sel" | "empty" | "text" }>();
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => void (!(e.target instanceof Element && e.target.closest("[data-menu]")) && setMenu(undefined));
    const key = (e: KeyboardEvent) => void (e.key === "Escape" && setMenu(undefined));
    addEventListener("pointerdown", close, true);
    addEventListener("keydown", key);
    return () => {
      removeEventListener("pointerdown", close, true);
      removeEventListener("keydown", key);
    };
  }, [menu]);
  // Zahnrad der Mini-Leiste: zu, sobald sich die Auswahl ändert
  const [gear, setGear] = useState(false);
  const [gearKey, setGearKey] = useState(selected.join());
  if (gearKey !== selected.join()) {
    setGearKey(selected.join());
    setGear(false);
  }
  const spaced = gs?.t === "space" ? makeSpace(items, index, gs.y, gs.dy, size[1]) : [];
  const transform = (it: Item) =>
    spaced.find((s) => s.id === it.id) ?? (gs?.t === "tmove" && gs.id === it.id ? moveItem(it, gs.dx, gs.dy)
    : gs?.t === "twidth" && gs.id === it.id ? (({ x0, y0, y1 }) => ({ ...it, points: [[x0, y0, 0.5], [x0 + gs.w, y1, 0.5]] as InkPoint[] }))(box(it))
    : !selected.includes(it.id) ? it
    : gs?.t === "move" ? moveItem(it, gs.dx, gs.dy)
    : gs?.t === "scale" ? scaleItem(it, gs.ox, gs.oy, gs.sx, gs.sy)
    : gs?.t === "rot" ? rotateItem(it, gs.cx, gs.cy, gs.deg)
    : it);
  const shown = () => {
    const c = g.current;
    const out = items
      .filter((it) => !(c?.t === "erase" && c.ids.has(it.id)) && it.id !== edit?.item.id)
      .map(transform);
    return c?.t === "shape" || c?.t === "hl" ? [...out, c.item] : out;
  };

  // Live-Strich auf eigener Canvas (desynchronized): pro Frame wird nur der laufende Strich gezeichnet, nicht die ganze Seite
  const live = useRef<HTMLCanvasElement>(null);
  // Vorhersage des Browsers: nur temporär gezeichnet, nie gespeichert
  const predicted = useRef<InkPoint[]>([]);
  const lastTs = useRef(0);
  const drawLive = () => {
    const lc = live.current, ctx = lc?.getContext?.("2d", { desynchronized: true });
    if (!lc || !ctx) return;
    const c = g.current, it = c?.t === "draw" ? c.item : undefined;
    lc.style.mixBlendMode = it?.kind === "marker" ? "multiply" : "normal";
    drawItems(ctx, it ? [predicted.current.length ? { ...it, points: [...it.points, ...predicted.current] } : it] : [], zoom);
    if (it) logLatency(lastTs.current);
  };
  const redraw = () => {
    drawLive();
    const ctx = canvas.current?.getContext("2d");
    if (ctx) drawItems(ctx, shown(), zoom);
  };
  useEffect(redraw);
  const schedule = (fn = redraw) => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(fn);
  };
  // Bilder laden asynchron → danach neu zeichnen
  useEffect(() => {
    addEventListener(IMAGE_LOADED, redraw);
    return () => removeEventListener(IMAGE_LOADED, redraw);
  });

  // flat = Preset mit „Druck aus“: immer gleiche Breite
  const pt = (e: PointerEvent | React.PointerEvent, flat = false): InkPoint => {
    const r = ref.current?.getBoundingClientRect() ?? new DOMRect();
    const pr = e.pointerType === "pen" && !flat ? normPressure(e.pressure, settings.pressureMax) : 0.5;
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
    const l = p.layer === 1 ? 3 : p.layer;
    for (const it of items) if (layerOf(it) === l && hitTest(it, x, y, ERASER_PX / zoom)) c.ids.add(it.id);
  };

  const make = (kind: Item["kind"], pr: Preset, q: InkPoint, simulated: boolean): Item => ({
    id: newId(), page: index, kind, color: pr.color, opacity: kind === "marker" || kind === "highlight" ? MARKER_OPACITY : 1,
    size: kind === "text" ? p.textSize : pr.size, simulated, points: [q], text: "",
  });

  const ctx2d = () => (canvas.current ?? document.createElement("canvas")).getContext("2d");
  /** Textbreite in pt; ohne Canvas-Maße (Test) grob geschätzt */
  const measurer = (size: number) => {
    const ctx = ctx2d();
    if (!ctx?.measureText) return (s: string) => s.length * size * 0.5;
    return (s: string) => {
      ctx.font = `${size}px ${FONT}`;
      return ctx.measureText(s).width;
    };
  };
  // nur Textfelder der aktiven Ebene (Ebene 1: keine) – Klick wechselt nie die Ebene
  const textAt = (x: number, y: number, m = 0) => items.findLast((it) => {
    const b = box(it);
    return it.kind === "text" && layerOf(it) === p.layer && x >= b.x0 - m && x <= b.x1 + m && y >= b.y0 - 2 * m && y <= b.y1;
  });
  /** Textfeld öffnen, Cursor an die Klickstelle; Ziehen markiert weiter (`fsel`) */
  const openText = (e: React.PointerEvent, it: Item, x: number, y: number) => {
    const { x0, y0, x1 } = box(it);
    const k = caretAt(it.text, it.size, x1 - x0, x - x0, y - y0, measurer(it.size));
    const ctx = ctx2d();
    caret.current = [k, k];
    textDown.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setEdit({ item: it, isNew: false, fixed: ctx?.measureText ? fixedWidth(ctx, it) : undefined });
    g.current = { t: "fsel", it, a: k };
    rerender();
  };
  /** Stelle im Absatztext (Zeilen mit Leerzeichen verbunden) zur Cursorstelle `[Zeile, Zeichen]` */
  const paraCaret = (para: Para, [l, ch]: Pos) => {
    const [x0, y0, x1, y1] = para.bbox;
    const inside = (n: number) => clist[n]?.boxes.some(([a, b, c, d]) => (a + c) / 2 >= x0 && (a + c) / 2 <= x1 && (b + d) / 2 >= y0 && (b + d) / 2 <= y1);
    let k = 0;
    for (let n = 0; n < l; n++) if (inside(n)) k += (clist[n]?.text.length ?? 0) + 1;
    return Math.min(para.text.length, k + ch);
  };

  // Typen bei ausgewähltem Textfeld: Cursor ans Ende, Zeichen einfügen
  useEffect(() => {
    p.typers.set(index, (id, ch) => {
      const it = items.find((i) => i.id === id && i.kind === "text");
      if (!it) return;
      const ctx = ctx2d();
      caret.current = [it.text.length + ch.length, it.text.length + ch.length];
      p.onSelect(index, []);
      setEdit({ item: it, isNew: false, text: it.text + ch, fixed: ctx?.measureText ? fixedWidth(ctx, it) : undefined });
    });
  });
  useEffect(() => () => void p.typers.delete(index), [p.typers, index]);

  // Stift-Spitze/linke Maustaste nach Werkzeug, gebundene Stifttasten temporär; Finger geht an den Scroll-Container.
  const down = (e: React.PointerEvent) => {
    const tgt = e.target as Element;
    const grip = tgt.closest<HTMLElement>("[data-tgrip], [data-twidth], [data-grip], [data-pwidth]");
    if (e.pointerType === "touch" || (!grip && tgt.closest("textarea, [data-pedit], [data-field]"))) return;
    const t = toolFor(e, e.pointerType === "pen" ? p.penTool : tool, settings);
    if (!t || g.current) return;
    setMenu(undefined);
    owner.current = e.pointerId;
    e.stopPropagation();
    const q = pt(e);
    const [x, y] = q;
    // Griffleiste/Breitengriff: offenes Textfeld erst übernehmen, dann als Objekt verschieben/umbrechen
    if (grip) {
      e.currentTarget.setPointerCapture(e.pointerId);
      const { tgrip, twidth } = grip.dataset;
      if (tgrip !== undefined || twidth !== undefined) {
        const id = Number(tgrip ?? twidth);
        const it = edit?.item.id === id ? edit.item : items.find((i) => i.id === id);
        const w0 = edit?.item.id === id ? (edit.fixed ?? (ta.current?.offsetWidth ?? 0) / zoom) : it ? box(it).x1 - box(it).x0 : 0;
        ta.current?.blur();
        g.current = tgrip !== undefined ? { t: "tmove", id, x, y, dx: 0, dy: 0 } : { t: "twidth", id, x, w0, w: w0 };
        return rerender();
      }
      // Absatz: Fokus bleibt in der Textarea (Eingaben bleiben erhalten)
      const para = pedit && plist[pedit.i];
      if (!pedit || !para) return;
      textDown.current = true;
      const w0 = pedit.w ?? para.bbox[2] - para.bbox[0];
      g.current = "grip" in grip.dataset ? { t: "para", i: pedit.i, x, y, dx: 0, dy: 0 } : { t: "pwidth", id: pedit.i, x, w0, w: w0 };
      return rerender();
    }
    // Auswahl hat Vorrang vor dem Werkzeug: Griff → Größe/Drehen, Rahmen → verschieben, außerhalb → aufheben
    // ponytail: nur die Auswahl dieser Seite; Druck auf einer anderen Seite lässt sie stehen (Esc hebt auf)
    if (sel.length) {
      const b = unionBox(sel);
      const h = tgt.closest<HTMLElement>("[data-handle]")?.dataset.handle;
      // ausgewähltes Textfeld: Klick in den Text setzt den Cursor (Verschieben über die Griffleiste)
      const only = sel.length === 1 && sel[0]?.kind === "text" ? sel[0] : undefined;
      if (t === "lasso" && only && !h && inBox(b, x, y)) {
        p.onSelect(index, []);
        return openText(e, only, x, y);
      }
      if (h || inBox(b, x, y)) {
        e.currentTarget.setPointerCapture(e.pointerId);
        const [cx, cy] = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
        g.current = h === "rot" ? { t: "rot", cx, cy, a0: Math.atan2(y - cy, x - cx), deg: 0 }
          : h ? { t: "scale", h, x, y, w: b.x1 - b.x0, hh: b.y1 - b.y0, ox: h.includes("w") ? b.x1 : b.x0, oy: h.includes("n") ? b.y1 : b.y0, sx: 1, sy: 1 }
          : { t: "move", x, y, dx: 0, dy: 0 };
        return rerender();
      }
      p.onSelect(index, []);
    }
    // Klick während des Bearbeitens schließt erst das offene Feld/den Absatz (Blur speichert)
    const fresh = !edit && !pedit;
    // anderes Textfeld: offenes übernehmen und direkt hineinspringen
    const hitT = t === "lasso" && !pedit ? textAt(x, y) : undefined;
    if (hitT) {
      if (hitT.id === edit?.item.id) return;
      ta.current?.blur();
      return openText(e, hitT, x, y);
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
    const at = t === "marker" ? posAt(clist, x, y) : null;
    if (at) {
      g.current = { t: "hl", a: at, b: at, item: { ...make("highlight", marker, q, false), points: [] } };
    } else if (t === "pen" || t === "marker") {
      const flat = t === "pen" && preset.pressure === false;
      const item = make(t === "pen" ? "ink" : "marker", t === "pen" ? preset : marker, flat ? [q[0], q[1], 0.5] : q, e.pointerType !== "pen" && !flat);
      predicted.current = [];
      lastTs.current = e.timeStamp;
      g.current = { t: "draw", item, hold: { x, y, timer: 0, straight: false } };
      armHold(x, y);
    } else if (t === "eraser") {
      g.current = { t: "erase", ids: new Set() };
      eraseAt(x, y);
      redraw();
    } else if (t === "lasso") {
      const at = p.layer === 1 ? posAt(clist, x, y) : null;
      // Ebene 1: auf Text → markieren (Klick bearbeitet den Absatz), sonst Auswahl; Maus zieht ein Rechteck, Stift ein Lasso
      g.current = at ? { t: "tsel", a: at, b: at, x, y, moved: false, fresh } : { t: "lasso", poly: [[x, y]], rect: e.pointerType !== "pen", fresh };
      rerender();
    } else if (t === "space") {
      g.current = { t: "space", y, dy: 0 };
      rerender();
    } else {
      g.current = { t: "shape", item: { ...make(t, preset, q, false), ...(t === "axes" ? p.axes : {}), points: [q, q] } };
    }
  };

  const move = (e: React.PointerEvent) => {
    const c = g.current;
    if (c && e.pointerId !== owner.current) return;
    if (!c) {
      const [x, y] = pt(e);
      const over = sel.length > 0 && inBox(unionBox(sel), x, y);
      setOverSel(over);
      if (e.pointerType === "pen") {
        const t = toolFor({ pointerType: "pen", buttons: e.buttons | 1 }, p.penTool, settings);
        setHover(t && !over ? { x, y, tool: t } : undefined);
      }
      // Rahmen um Textfeld/Absatz unter der Maus; Rand großzügig, damit Griffleiste/Breitengriff erreichbar bleiben
      const lasso = (e.pointerType === "pen" ? p.penTool : tool) === "lasso";
      setHovT(lasso ? textAt(x, y, 8 / zoom)?.id : undefined);
      setHovP(lasso && p.layer === 1 && !pedit ? paraAt(x, y) : -1);
      return;
    }
    const evs = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    const q = pt(e);
    const [x, y] = q;
    const flat = c.t === "draw" && c.item.kind === "ink" && preset.pressure === false;
    switch (c.t) {
      case "draw":
        lastTs.current = e.timeStamp;
        predicted.current = c.hold?.straight || c.item.kind !== "ink" ? [] : (e.nativeEvent.getPredictedEvents?.() ?? []).map((ev) => pt(ev, flat));
        for (const ev of evs) {
          const r = pt(ev, flat), hd = c.hold;
          if (hd?.straight) straighten(c.item, r[0], r[1]);
          else {
            c.item.points.push(r);
            if (hd && Math.hypot(r[0] - hd.x, r[1] - hd.y) > HOLD_TOL) armHold(r[0], r[1]);
          }
        }
        return schedule(drawLive);
      case "shape":
        c.item.points[1] = q;
        return schedule();
      case "erase":
        for (const ev of evs) eraseAt(...(pt(ev).slice(0, 2) as [number, number]));
        return schedule();
      case "lasso": {
        const [x0, y0] = c.poly[0] ?? [x, y];
        if (c.rect) c.poly = [[x0, y0], [x, y0], [x, y], [x0, y], [x0, y0]];
        else c.poly.push([x, y]);
        break;
      }
      case "tsel":
        c.b = posAt(clist, x, y, true) ?? c.b;
        c.moved ||= Math.hypot(x - c.x, y - c.y) * zoom > 3;
        break;
      case "move":
      case "para":
      case "tmove":
      case "field":
      case "link":
        Object.assign(c, { dx: x - c.x, dy: y - c.y });
        break;
      case "twidth":
      case "pwidth":
        c.w = Math.max(20, c.w0 + x - c.x);
        break;
      case "space":
        c.dy = y - c.y;
        break;
      case "fsel": {
        const { x0, y0, x1 } = box(c.it);
        const b = caretAt(c.it.text, c.it.size, x1 - x0, x - x0, y - y0, measurer(c.it.size));
        ta.current?.setSelectionRange(Math.min(c.a, b), Math.max(c.a, b), b < c.a ? "backward" : "forward");
        return;
      }
      case "scale": {
        // Bilder: Ecke proportional, Umschalt frei; andere umgekehrt. Kanten: eine Achse.
        const fx = c.h.includes("w") ? -1 : c.h.includes("e") ? 1 : 0, fy = c.h.includes("n") ? -1 : c.h.includes("s") ? 1 : 0;
        const sx = fx ? Math.max(0.05, 1 + (fx * (x - c.x)) / Math.max(0.01, c.w)) : 1;
        const sy = fy ? Math.max(0.05, 1 + (fy * (y - c.y)) / Math.max(0.01, c.hh)) : 1;
        // gedrehte Bilder nur proportional (sonst verzerrt das Rechteck in Seitenachsen)
        const prop = (fx && fy && rotatable !== e.shiftKey) || sel.some((it) => it.rot);
        const s = fx && fy ? Math.max(sx, sy) : fx ? sx : sy;
        [c.sx, c.sy] = prop ? [s, s] : [sx, sy];
        break;
      }
      case "rot": {
        const d = deg(Math.atan2(y - c.cy, x - c.cx) - c.a0);
        c.deg = e.shiftKey ? Math.round(d / 15) * 15 : d;
        break;
      }
      case "hl":
        c.b = posAt(clist, x, y, true) ?? c.b;
        c.item.points = hlPoints(clist, c.a, c.b);
        return schedule();
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
        predicted.current = [];
        p.onAdd(c.item);
        break;
      case "shape": {
        const [a, b] = c.item.points;
        if (a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) > 1) p.onShape(c.item, e.pointerType === "pen");
        break;
      }
      case "erase":
        if (c.ids.size) p.onRemove([...c.ids]);
        break;
      case "lasso": {
        const [x0, y0] = c.poly[0] ?? [0, 0];
        const far = c.poly.some(([x, y]) => Math.hypot(x - x0, y - y0) > 3);
        // nur die aktive Ebene ist wählbar
        const cand = p.layer === 1 ? origs : items.filter((it) => layerOf(it) === p.layer);
        const ids = far
          ? cand.filter((it) => {
            const b = box(it);
            return inPolygon((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, c.poly);
          }).map((it) => it.id)
          : p.layer === 1 ? smallestAt(origs, x0, y0)?.id : cand.findLast((it) => hitTest(it, x0, y0, 4 / zoom + 1))?.id;
        p.onSelect(index, ids === undefined ? [] : Array.isArray(ids) ? ids : [ids]);
        // Klick ins Leere (Ebene 2/3) setzt den Cursor; das Feld entsteht erst mit dem ersten Zeichen
        if (!far && c.fresh && ids === undefined && p.layer !== 1 && e.pointerType !== "pen") {
          caret.current = [0, 0];
          setEdit({ item: make("text", preset, [x0, y0, 0.5], false), isNew: true });
        }
        break;
      }
      case "tsel": {
        const i = paraAt(c.x, c.y);
        const para = plist[i];
        if (!c.moved) {
          p.onTextSel(null);
          if (para && c.fresh) {
            const k = paraCaret(para, c.a);
            caret.current = [k, k];
            setPedit({ i, dx: 0, dy: 0 });
          }
        } else p.onTextSel({ a: c.a, b: c.b, text: selRange(clist, c.a, c.b).text });
        break;
      }
      case "tmove":
      case "twidth": {
        const it = items.find((i) => i.id === c.id);
        if (!it) break;
        const { x0, y0 } = box(it);
        const ctx = ctx2d();
        if (c.t === "tmove" ? Math.hypot(c.dx, c.dy) * zoom > 3 : Math.abs(c.w - c.w0) * zoom > 1) {
          p.onReplace([c.t === "tmove" ? moveItem(it, c.dx, c.dy) : { ...it, points: ctx ? textRect(ctx, it.text, it.size, x0, y0, c.w) : transform(it).points }]);
        }
        p.onSelect(index, [c.id]);
        break;
      }
      case "pwidth":
        if (pedit) setPedit({ ...pedit, w: c.w });
        break;
      case "fsel":
        break;
      case "move":
        if (c.dx || c.dy) commit((it) => moveItem(it, c.dx, c.dy), [1, 0, 0, 1, c.dx, c.dy]);
        break;
      case "para":
        // Verschiebung gilt beim Übernehmen, Eingaben bleiben offen
        if (pedit) setPedit({ ...pedit, dx: pedit.dx + c.dx, dy: pedit.dy + c.dy });
        break;
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
        if (c.sx !== 1 || c.sy !== 1) commit((it) => scaleItem(it, c.ox, c.oy, c.sx, c.sy), scaleMatrix(c.ox, c.oy, c.sx, c.sy));
        break;
      case "rot":
        if (c.deg % 360) commit((it) => rotateItem(it, c.cx, c.cy, c.deg), rotMatrix(c.cx, c.cy, c.deg));
        break;
      case "hl":
        if (c.item.points.length) p.onAdd(c.item);
        break;
      case "space":
        p.onSpace(e.type === "pointercancel" ? [] : makeSpace(items, index, c.y, c.dy, size[1]));
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
    const { item, isNew, fixed } = edit;
    // Esc: Feld bleibt als Objekt ausgewählt
    const keep = esc.current;
    esc.current = false;
    if (!text.trim()) {
      if (!isNew) p.onRemove([item.id]);
      return;
    }
    if (keep) p.onSelect(index, [item.id]);
    if (text === item.text) return;
    const ctx = ctx2d();
    const { x0, y0 } = box(item);
    const points = ctx ? textRect(ctx, text, item.size, x0, y0, fixed) : item.points;
    const next = { ...item, text, points };
    if (isNew) p.onAdd(next);
    else p.onReplace([next]);
  };

  const submitPara = (f: HTMLFormElement) => {
    const pe = pedit;
    const para = pe && plist[pe.i];
    setPedit(undefined);
    if (!pe || !para) return;
    const d = new FormData(f);
    const text = String(d.get("text") ?? "");
    const font = String(d.get("font") ?? "");
    const size = Number(d.get("size"));
    const color = String(d.get("color") ?? "");
    const edit: TextEdit = { para: pe.i, text };
    if (pe.dx || pe.dy) Object.assign(edit, { dx: pe.dx, dy: pe.dy });
    if (pe.w !== undefined) edit.width = pe.w;
    if (font === "sans" || font === "serif" || font === "mono") edit.font = font;
    if (Number.isFinite(size) && Math.abs(size - para.size) > 0.05) edit.size = size;
    if (/^#[0-9a-f]{6}$/i.test(color) && color !== hex(para.color)) edit.color = rgb(color);
    if (text !== para.text || Object.keys(edit).length > 2) p.onText(edit);
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
  const ts = gs?.t === "tsel" ? gs : p.textSel;
  const tsRects = ts && clist.length ? selRange(clist, ts.a, ts.b).rects : [];
  // ausgewähltes Textfeld mit Auswahl-Werkzeug: Klick setzt den Cursor → I-Cursor statt Vier-Pfeil
  const textOnly = tool === "lasso" && sel.length === 1 && sel[0]?.kind === "text";
  const cursor = gs?.t === "scale" ? `${HANDLE_CURSOR[gs.h] ?? "move"}-resize` : gs?.t === "rot" ? "grabbing"
    : (overSel && !textOnly) || gs?.t === "move" || gs?.t === "tmove" || gs?.t === "para" ? "move"
    : gs?.t === "twidth" || gs?.t === "pwidth" ? "ew-resize"
    : gs?.t === "tsel" || gs?.t === "fsel" ? "text"
    : gs?.t === "space" || tool === "space" ? "row-resize"
    : tool === "lasso" ? (hovT !== undefined || (hovP ?? -1) >= 0 || overSel ? "text" : "default")
    : tool === "form" ? "cell" : p.linking ? "alias" : "crosshair";
  const own = sel.length > 0 && sel.every((it) => it.id >= 0);
  /** Zahnrad/Text-Größe/-Farbe auf die eigene Auswahl (Bilder ausgenommen); Text wird neu umbrochen */
  const restyle = (f: { size?: number; color?: [number, number, number] }) => {
    const ctx = ctx2d();
    p.onReplace(sel.filter((it) => it.id >= 0 && it.kind !== "image").map((it) => {
      const n = { ...it, ...f };
      if (it.kind !== "text" || !ctx?.measureText) return n;
      const { x0, y0 } = box(it);
      return { ...n, points: textRect(ctx, n.text, n.size, x0, y0, fixedWidth(ctx, it)) };
    }));
  };
  // natives `change` (Loslassen/Schließen/Enter) statt Reacts `input`: ein Undo-Schritt je Änderung, nicht je Mausbewegung
  useEffect(() => {
    const el = ref.current;
    const on = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || !t.dataset.restyle) return;
      if (t.dataset.restyle === "color") restyle({ color: rgb(t.value) });
      else if (Number(t.value) > 0) restyle({ size: Number(t.value) });
    };
    el?.addEventListener("change", on);
    return () => el?.removeEventListener("change", on);
  });
  const rotate90 = () => {
    const b = unionBox(sel);
    const [cx, cy] = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    commit((it) => rotateItem(it, cx, cy, 90), rotMatrix(cx, cy, 90));
  };
  const cmd = (c: Cmd, at?: [number, number]) => () => {
    setMenu(undefined);
    p.onCmd(c, at);
  };
  const styled = sel.filter((it) => it.id >= 0 && it.kind !== "image");
  const allText = sel.length > 0 && sel.every((it) => it.kind === "text" && it.id >= 0);
  const [first] = sel;
  const hoverD = hover && (hover.tool === "eraser" ? 2 * ERASER_PX
    : hover.tool === "pen" ? preset.size * zoom : hover.tool === "marker" ? marker.size * zoom : 0);

  return (
    <div
      ref={ref}
      data-page={index}
      className="relative mx-auto bg-white shadow-raised"
      style={{ width: w, height: h, touchAction: "none", cursor }}
      onPointerDown={down}
      onMouseDown={(e) => {
        if (textDown.current) e.preventDefault();
        textDown.current = false;
      }}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={() => {
        setHover(undefined);
        setOverSel(false);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        // Stift-Langdruck/Finger öffnen kein Menü; synthetisch (Kontextmenü-Taste) hat keinen pointerType
        const pe = e.nativeEvent as Partial<PointerEvent>;
        if (g.current || (pe.pointerType && pe.pointerType !== "mouse")) return;
        const r = ref.current?.getBoundingClientRect() ?? new DOMRect();
        const [x, y] = [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom];
        if (tsRects.some(([x0, y0, x1, y1]) => inBox({ x0, y0, x1, y1 }, x, y))) return setMenu({ x, y, on: "text" });
        if (sel.length && (!e.isTrusted || inBox(unionBox(sel), x, y))) return setMenu({ x, y, on: "sel" });
        const hit = p.layer === 1 ? smallestAt(origs, x, y) : items.findLast((it) => layerOf(it) === p.layer && hitTest(it, x, y, 4 / zoom + 1));
        if (hit) p.onSelect(index, [hit.id]);
        setMenu({ x, y, on: hit ? "sel" : "empty" });
      }}
      onDoubleClick={(e) => {
        const r = ref.current?.getBoundingClientRect() ?? new DOMRect();
        const [it] = sel;
        if (sel.length === 1 && it && it.id >= 0 && it.kind === "image" && hitTest(it, (e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom, 0)) setCrop(it.id);
      }}
    >
      {url && <img src={url} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none" />}
      {/* Canvas nur für sichtbare Seiten: volle Auflösung je Seite kostet sonst bei hohem Zoom zu viel Speicher.
          multiply: Textmarker färbt Text nicht ab (wie Highlight in der PDF) */}
      {visible && <canvas
        ref={live}
        width={Math.round(w * devicePixelRatio)}
        height={Math.round(h * devicePixelRatio)}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />}
      {visible && <canvas
        ref={canvas}
        width={Math.round(w * devicePixelRatio)}
        height={Math.round(h * devicePixelRatio)}
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ mixBlendMode: "multiply" }}
      />}
      {cropIt && <CropBox item={cropIt} zoom={zoom} onDone={(f) => {
        setCrop(undefined);
        if (f && f.join() !== "0,0,1,1") p.onCrop(cropIt.id, f);
      }} />}
      {sb && !cropIt && (
        <div
          className="pointer-events-none absolute border border-dashed border-accent"
          style={{ left: sb.x0 * zoom - 3, top: sb.y0 * zoom - 3, width: (sb.x1 - sb.x0) * zoom + 6, height: (sb.y1 - sb.y0) * zoom + 6 }}
        >
          {HANDLES.map((k) => (
            <span key={k} data-handle={k}
              className="pointer-events-auto absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-xs border border-white bg-accent"
              style={{
                left: k.includes("w") ? 0 : k.includes("e") ? "100%" : "50%", top: k.includes("n") ? 0 : k.includes("s") ? "100%" : "50%",
                cursor: `${HANDLE_CURSOR[k] ?? "move"}-resize`,
              }} />
          ))}
          {rotatable && (
            <span data-handle="rot" title={`${T.turn} (${T.shift}: 15°)`}
              className="pointer-events-auto absolute -top-6 left-1/2 h-3 w-3 -translate-x-1/2 cursor-grab rounded-full border border-white bg-accent" />
          )}
        </div>
      )}
      {/* Mini-Leiste: über der Auswahl (über dem Drehgriff), ohne Platz darüber darunter; beim Ziehen weg */}
      {sb && !cropIt && !gs && !edit && !menu && (() => {
        const above = sb.y0 * zoom - (rotatable ? 30 : 6) - 34;
        return (
          <div data-pedit data-menu role="toolbar" aria-label={T.selection}
            className="absolute z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-sm border border-line bg-surface p-0.5 shadow-raised"
            style={{ left: Math.min(Math.max((sb.x0 + sb.x1) / 2 * zoom, 120), w - 120), top: above >= 0 ? above : Math.min(sb.y1 * zoom + 8, h - 34) }}>
            {own && <IconBtn icon={Scissors} label={T.cut} keys="Strg+X" className={ICON} onClick={cmd("cut")} />}
            {own && <IconBtn icon={Copy} label={T.copy} keys="Strg+C" className={ICON} onClick={cmd("copy")} />}
            <IconBtn icon={Trash} label={T.del} keys="Entf" className={ICON} onClick={cmd("delete")} />
            {allText && first && <>
              <input type="number" min={4} max={200} step={1} title={T.fontSize} aria-label={T.fontSize} defaultValue={first.size} key={`s${first.id}${first.size}`}
                data-restyle="size"
                className="h-7 w-12 rounded-xs border border-line bg-surface px-1 text-sm" />
              <input type="color" title={T.fontColor} aria-label={T.fontColor} defaultValue={hex(first.color)} key={`c${first.id}${hex(first.color)}`}
                data-restyle="color" className="h-7 w-7 cursor-pointer" />
            </>}
            {sel.length === 1 && first?.kind === "image" && first.id >= 0 && <IconBtn icon={CropIcon} label={T.crop} className={ICON} onClick={() => setCrop(first.id)} />}
            {rotatable && <IconBtn icon={RotateCw} label={T.rotate90} className={ICON} onClick={rotate90} />}
            {styled.length > 0 && !allText && styled.length === sel.length && (
              <span className="relative">
                <IconBtn icon={SlidersHorizontal} label={`${T.color}/${T.size}`} className={ICON} aria-expanded={gear} onClick={() => setGear(!gear)} />
                {gear && first && (
                  <div className="absolute top-8 left-0 flex items-center gap-2 rounded-sm border border-line bg-surface p-2 shadow-raised">
                    <input type="range" min={0.5} max={30} step={0.5} title={T.size} aria-label={T.size} defaultValue={first.size} key={`g${first.id}${first.size}`}
                      data-restyle="size" className="w-28" />
                    <input type="color" title={T.color} aria-label={T.color} defaultValue={hex(first.color)} key={`h${first.id}${hex(first.color)}`}
                      data-restyle="color" className="h-7 w-7 cursor-pointer" />
                  </div>
                )}
              </span>
            )}
          </div>
        );
      })()}
      {/* Rechtsklick-Menü: nur Icons mit Tooltip */}
      {menu && (
        <div data-pedit data-menu role="menu"
          className="absolute z-30 flex items-center gap-0.5 rounded-sm border border-line bg-surface p-0.5 shadow-raised"
          style={{ left: Math.max(0, Math.min(menu.x * zoom, w - 200)), top: Math.max(0, Math.min(menu.y * zoom, h - 36)) }}>
          {menu.on === "text" && <IconBtn icon={Copy} label={T.copy} keys="Strg+C" role="menuitem" className={ICON} onClick={cmd("copy")} />}
          {menu.on === "sel" && <>
            {own && <IconBtn icon={Scissors} label={T.cut} keys="Strg+X" role="menuitem" className={ICON} onClick={cmd("cut")} />}
            {own && <IconBtn icon={Copy} label={T.copy} keys="Strg+C" role="menuitem" className={ICON} onClick={cmd("copy")} />}
            <IconBtn icon={ClipboardPaste} label={T.paste} keys="Strg+V" role="menuitem" className={ICON} onClick={cmd("paste", [menu.x, menu.y])} />
            <IconBtn icon={Trash} label={T.del} keys="Entf" role="menuitem" className={ICON} onClick={cmd("delete")} />
            {own && <IconBtn icon={BringToFront} label={T.front} role="menuitem" className={ICON} onClick={cmd("front")} />}
            {own && <IconBtn icon={SendToBack} label={T.back} role="menuitem" className={ICON} onClick={cmd("back")} />}
          </>}
          {menu.on === "empty" && <>
            <IconBtn icon={ClipboardPaste} label={T.paste} keys="Strg+V" role="menuitem" className={ICON} onClick={cmd("paste", [menu.x, menu.y])} />
            <IconBtn icon={Type} label={T.textHere} role="menuitem" className={ICON} onClick={() => {
              setMenu(undefined);
              // Ebene 1 hat keine eigenen Textfelder → auf Notizen (Ebene 3) wechseln
              if (p.layer === 1) p.onCmd("notes");
              caret.current = [0, 0];
              setEdit({ item: make("text", preset, [menu.x, menu.y, 0.5], false), isNew: true });
            }} />
            <IconBtn icon={ImagePlus} label={T.imageHere} role="menuitem" className={ICON} onClick={cmd("image", [menu.x, menu.y])} />
            <IconBtn icon={BetweenHorizontalStart} label={T.space} role="menuitem" className={ICON} onClick={cmd("space")} />
          </>}
        </div>
      )}
      {gs?.t === "space" && (
        <svg className="pointer-events-none absolute inset-0" width={w} height={h}>
          <line x1={0} x2={w} y1={gs.y * zoom} y2={gs.y * zoom} stroke="var(--accent)" strokeDasharray="4 3" />
          <line x1={0} x2={w} y1={(gs.y + gs.dy) * zoom} y2={(gs.y + gs.dy) * zoom} stroke="var(--accent)" />
        </svg>
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
      {tsRects.map(([x0, y0, x1, y1], i) => (
        <div key={`s${i}`} className="pointer-events-none absolute bg-accent/30"
          style={{ left: x0 * zoom, top: y0 * zoom, width: (x1 - x0) * zoom, height: (y1 - y0) * zoom }} />
      ))}
      {/* Absatz unter der Maus: dünner Rahmen */}
      {hovP !== undefined && hovP >= 0 && plist[hovP] && !pedit && (() => {
        const [x0, y0, x1, y1] = plist[hovP].bbox;
        return <div className="pointer-events-none absolute border border-accent/40"
          style={{ left: x0 * zoom - 2, top: y0 * zoom - 2, width: (x1 - x0) * zoom + 4, height: (y1 - y0) * zoom + 4 }} />;
      })()}
      {/* Textfelder unter der Maus/ausgewählt/gezogen: Rahmen, Griffleiste oben, Breitengriff rechts */}
      {items.filter((it) => it.kind === "text" && it.id !== edit?.item.id && layerOf(it) === p.layer
        && (it.id === hovT || (sel.length === 1 && sel[0]?.id === it.id) || ((gs?.t === "tmove" || gs?.t === "twidth") && gs.id === it.id)))
        .map((it) => {
          const b = box(transform(it));
          return (
            <div key={`t${it.id}`} className="pointer-events-none absolute border border-accent/40"
              style={{ left: b.x0 * zoom - 1, top: b.y0 * zoom - 1, width: (b.x1 - b.x0) * zoom + 2, height: (b.y1 - b.y0) * zoom + 2 }}>
              {grips("tgrip", "twidth", it.id)}
            </div>
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
          <IconBtn data-pedit icon={X} label={T.unlink} onClick={() => p.onUnlink(n)}
            className="pointer-events-auto absolute -top-2 -right-2 grid h-4 w-4 place-items-center rounded-full bg-accent text-white [&>svg]:size-3" />
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
            <input name="name" required autoFocus placeholder={T.fieldName} className="rounded-xs border border-line bg-transparent p-1" />
            <textarea name="options" rows={3} placeholder={T.fieldOptions} className="resize-y rounded-xs border border-line bg-transparent p-1" />
            <div className="flex gap-2">
              <IconBtn icon={X} label={T.cancel} keys="Esc" text className="ml-auto inline-flex items-center gap-1" onClick={() => setNewf(undefined)} />
              <IconBtn icon={Check} label={T.create} text type="submit" className="inline-flex items-center gap-1 text-accent" />
            </div>
          </form>
        </>
      )}
      {/* Absatz direkt bearbeiten: Textarea über dem Absatz, Mini-Leiste darunter; Verlassen/Esc übernimmt (Schwärzen + neu setzen) */}
      {pedit && (() => {
        const para = plist[pedit.i];
        if (!para) return null;
        const [x0, y0, x1, y1] = para.bbox;
        const m = gs?.t === "para" ? gs : { dx: 0, dy: 0 };
        const pw = gs?.t === "pwidth" ? gs.w : pedit.w ?? x1 - x0;
        const fs = para.size * zoom;
        const field = "rounded-xs border border-line bg-transparent";
        return (
          <form
            data-pedit
            className="absolute z-10"
            style={{ left: (x0 + pedit.dx + m.dx) * zoom - 2, top: (y0 + pedit.dy + m.dy) * zoom - 2 }}
            onSubmit={(e) => e.preventDefault()}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) submitPara(e.currentTarget);
            }}
            onKeyDown={(e) => {
              e.stopPropagation(); // Strg+Z, Werkzeug-Kürzel gehören dem Absatz
              if (e.key === "Escape" || (e.key === "Enter" && e.ctrlKey)) (document.activeElement as HTMLElement | null)?.blur();
            }}
          >
            {grips("grip", "pwidth", pedit.i)}
            <textarea
              ref={taRef}
              name="text"
              defaultValue={para.text}
              className="block resize-none bg-white outline-1 outline-accent outline-dashed"
              style={{
                width: pw * zoom + 4, minHeight: (y1 - y0) * zoom + 4, padding: 2, font: `${fs}px ${family(para.font)}`,
                lineHeight: `${lineHeight(fs)}px`, color: css(para.color), overflow: "hidden", fieldSizing: "content",
              } as React.CSSProperties}
            />
            <div className="absolute top-full left-0 mt-1 flex items-center gap-1 rounded-xs bg-surface p-1 text-sm shadow-raised">
              <select name="font" defaultValue="" title={T.font} aria-label={T.font} className={field}>
                <option value="">Original</option>
                <option value="sans">Sans</option>
                <option value="serif">Serif</option>
                <option value="mono">Mono</option>
              </select>
              <input name="size" type="number" min={2} max={500} step={0.5} defaultValue={Math.round(para.size * 10) / 10} title={`${T.fontSize} (pt)`} aria-label={T.fontSize} className={`w-16 ${field}`} />
              <input name="color" type="color" defaultValue={hex(para.color)} title={T.color} aria-label={T.color} className="h-6 w-8" />
            </div>
          </form>
        );
      })()}
      {/* Textfeld: wächst mit dem Text oder bricht bei fester Breite um (wie MuPDF beim Speichern) */}
      {edit && (() => {
        const { x0, y0 } = box(edit.item);
        const fs = edit.item.size * zoom;
        return (
          <div key={edit.item.id} className="absolute" style={{ left: x0 * zoom, top: y0 * zoom }}>
            {grips("tgrip", "twidth", edit.item.id)}
            <textarea
              ref={taRef}
              defaultValue={edit.text ?? edit.item.text}
              onBlur={(e) => commitText(e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation(); // Strg+Z usw. gehören dem Textfeld
                if (e.key === "Escape") esc.current = true;
                if (e.key === "Escape" || (e.key === "Enter" && e.ctrlKey)) e.currentTarget.blur();
              }}
              className="block resize-none bg-transparent outline-1 outline-accent outline-dashed"
              style={{
                padding: 2 * zoom, font: `${fs}px ${FONT}`, lineHeight: `${lineHeight(fs)}px`, color: css(edit.item.color),
                overflow: "hidden", fieldSizing: "content", ...(edit.fixed ? { width: edit.fixed * zoom } : { minWidth: fs * 4 }),
              } as React.CSSProperties}
            />
          </div>
        );
      })()}
    </div>
  );
}
