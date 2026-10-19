import { getStroke } from "perfect-freehand";
import { z } from "zod";

/** Punkt in pt relativ zur linken oberen Seitenecke, p = Druck 0–1. */
export type InkPoint = [x: number, y: number, p: number];
export type Rgb = [number, number, number];

export const KINDS = ["ink", "marker", "line", "arrow", "rect", "ellipse", "text", "image", "highlight", "axes"] as const;
export type Kind = (typeof KINDS)[number];

/**
 * Eigenes Objekt. Formen/Text: zwei Punkte (Ecken bzw. Anfang/Ende), damit Verschieben,
 * Skalieren und Seitendrehung für alle Arten gleich über die Punkte laufen.
 * Highlight (Marker auf PDF-Text): Punkte paarweise = ein Rechteck je Textzeile.
 */
export interface Item {
  id: number;
  page: number;
  kind: Kind;
  color: Rgb;
  opacity: number;
  /** Grundbreite in pt bzw. Schriftgröße */
  size: number;
  /** Maus: Druck wird simuliert */
  simulated: boolean;
  points: InkPoint[];
  text: string;
  /** Bild (kind "image"): PNG/JPEG als Base64, ohne data:-Präfix */
  image?: string;
  /** Ebene 2 = Eingefügtes, 3 = Geschriebenes; fehlt → nach Art (`layerOf`) */
  layer?: 2 | 3;
  /** Bild: Drehung in Grad im Uhrzeigersinn um die Mitte; Punkte = ungedrehtes Rechteck */
  rot?: number;
  /** Koordinatensystem (kind "axes"): Schrägbild x/y/z statt x/y */
  xyz?: boolean;
  /** Koordinatensystem: Karo-Gitter im Achsenbereich */
  grid?: boolean;
  /** Rechteck/Ellipse: Füllfarbe (Deckkraft = `opacity`, wie `/CA` in der PDF); fehlt → keine Füllung */
  fill?: Rgb;
}

/** Ebene 1 = PDF-Inhalt (keine eigenen Objekte), 2 = Elemente, 3 = Notizen */
export type Layer = 1 | 2 | 3;
export const kindLayer = (k: Kind): 2 | 3 => (k === "ink" || k === "marker" || k === "text" || k === "highlight" ? 3 : 2);
export const layerOf = (it: Item): 2 | 3 => it.layer ?? kindLayer(it.kind);
export type Stroke = Item;

const ORIGIN: InkPoint = [0, 0, 0];

let lastId = 0;
export const newId = () => ++lastId;

const num = z.number().finite();
/** Eigene Objekte aus der PDF (Rust prüft schon; PDF bleibt nicht vertrauenswürdig). */
export const ItemData = z.object({
  page: z.number().int().nonnegative(),
  kind: z.enum(KINDS),
  color: z.tuple([num, num, num]),
  opacity: num,
  size: num,
  width: num,
  simulated: z.boolean(),
  points: z.array(z.tuple([num, num, num])).min(1),
  text: z.string(),
  image: z.string().optional(),
  layer: z.number().optional(),
  rot: num.optional(),
  xyz: z.boolean().optional(),
  grid: z.boolean().optional(),
  fill: z.tuple([num, num, num]).optional(),
});
export const fromData = (d: z.infer<typeof ItemData>): Item => ({
  id: newId(), page: d.page, kind: d.kind, color: d.color, opacity: d.opacity, size: d.size,
  simulated: d.simulated, points: d.points, text: d.text, ...(d.image ? { image: d.image } : {}),
  layer: d.layer === 2 || d.layer === 3 ? d.layer : kindLayer(d.kind), ...(d.rot ? { rot: d.rot } : {}),
  ...(d.xyz ? { xyz: true } : {}), ...(d.grid ? { grid: true } : {}),
  ...(d.fill ? { fill: d.fill } : {}),
});

export interface Preset {
  name: string;
  color: Rgb;
  size: number;
  /** false = Stiftdruck ignorieren (konstante Strichbreite); fehlt = Druck an */
  pressure?: boolean;
}

export const DEFAULT_PRESET: Preset = { name: "Schwarz", color: [0.07, 0.07, 0.07], size: 2.2 };

export const PRESETS: Preset[] = [
  { name: "Schwarz fein", color: [0.07, 0.07, 0.07], size: 1.2 },
  DEFAULT_PRESET,
  { name: "Blau", color: [0.12, 0.36, 0.85], size: 2.2 },
  { name: "Rot", color: [0.84, 0.18, 0.18], size: 2.2 },
  { name: "Grün dick", color: [0.06, 0.6, 0.45], size: 4 },
];

export const MARKERS: Preset[] = [
  { name: "Gelb", color: [1, 0.86, 0.1], size: 12 },
  { name: "Grün", color: [0.45, 0.9, 0.35], size: 12 },
  { name: "Pink", color: [1, 0.45, 0.75], size: 12 },
];
/** Immer sichtbare Farbfelder der Werkzeugleiste: Stift bzw. Marker Rot/Grün/Blau (Taste Q W E bzw. Umschalt+Q W E) */
export const QUICK_PEN: Preset[] = [
  { name: "Rot", color: [0.84, 0.18, 0.18], size: 2.2 },
  { name: "Grün", color: [0.06, 0.6, 0.45], size: 2.2 },
  { name: "Blau", color: [0.12, 0.36, 0.85], size: 2.2 },
];
export const QUICK_MARKER: Preset[] = [
  { name: "Rot", color: [1, 0.35, 0.35], size: 12 },
  { name: "Grün", color: [0.45, 0.9, 0.35], size: 12 },
  { name: "Blau", color: [0.4, 0.7, 1], size: 12 },
];
export const MARKER_OPACITY = 0.35;
export const TEXT_SIZE = 14;
export const FONT = "Helvetica, Arial, sans-serif";

const THINNING = 0.5;
// Stift-Test FELIXHP: Druck erreicht nur ~0,7 → darauf normieren; in den Einstellungen änderbar.
export const PRESSURE_MAX = 0.75;

export const normPressure = (p: number, max = PRESSURE_MAX) => Math.min(1, Math.max(0.05, p / max));

/** Gefüllter Umriss (perfect-freehand) in pt; Zeichenkontext skaliert auf Zoom. */
export function outline(s: Item): Path2D {
  const o = getStroke(s.points, {
    size: s.size,
    thinning: THINNING,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: s.simulated,
  });
  const path = new Path2D();
  o.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  path.closePath();
  return path;
}

/**
 * Breite der gespeicherten Annotation: PDF-Ink kennt nur eine Breite je Strich →
 * mittlerer Durchmesser nach perfect-freehand-Formel (Radius = size·(0,5 − thinning·(0,5 − p))).
 * Andere Arten: Grundbreite.
 */
export function savedWidth(s: Item): number {
  if (s.kind !== "ink" || s.simulated || !s.points.length) return s.size;
  const p = s.points.reduce((a, q) => a + q[2], 0) / s.points.length;
  return s.size * (1 - THINNING * (1 - 2 * p));
}

export const toData = (it: Item) => ({
  page: it.page, kind: it.kind, color: it.color, opacity: it.opacity, size: it.size,
  width: savedWidth(it), simulated: it.simulated, points: it.points, text: it.text,
  ...(it.image ? { image: it.image } : {}), layer: layerOf(it), ...(it.rot ? { rot: it.rot } : {}),
  ...(it.xyz ? { xyz: true } : {}), ...(it.grid ? { grid: true } : {}),
  ...(it.fill ? { fill: it.fill } : {}),
});

const css = (c: Rgb) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
export const lineHeight = (size: number) => size * 1.2;
export const TEXT_PAD = 2;

/** Umschließendes Rechteck, normiert (gedrehtes Bild: um die gedrehten Ecken). */
export function box(it: Item) {
  const xs = it.points.map((p) => p[0]), ys = it.points.map((p) => p[1]);
  const pad = it.kind === "text" || it.kind === "image" || it.kind === "highlight" ? 0 : it.size / 2;
  const b = { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
  if (!it.rot) return b;
  const r = (it.rot * Math.PI) / 180, [c, s] = [Math.abs(Math.cos(r)), Math.abs(Math.sin(r))];
  const [cx, cy, hw, hh] = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2];
  const [ex, ey] = [hw * c + hh * s, hw * s + hh * c];
  return { x0: cx - ex, y0: cy - ey, x1: cx + ex, y1: cy + ey };
}

/** Zeilenrechtecke eines Highlights */
const pairs = (it: Item) => it.points.flatMap((a, i) => {
  const b = it.points[i + 1];
  return i % 2 === 0 && b ? [{ x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) }] : [];
});

export function unionBox(items: Item[]) {
  const bs = items.map(box);
  return {
    x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)),
    x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)),
  };
}

type Pt = [number, number];
/** Karo-Gitter: 5 mm */
export const KARO = (72 / 25.4) * 5;
/** Gitterlinien dünner als die Achsen (wie `grid_width` in Rust) */
export const gridWidth = (w: number) => Math.max(w * 0.3, 0.3);

/**
 * Linien eines Koordinatensystems je Polylinie (wie `axes_lines` in Rust – beide gleich halten).
 * xy: Ursprung unten links. xyz (Schrägbild): y rechts, z oben, x schräg nach vorn-links (45°).
 */
export function axesLines(it: Item): { axes: Pt[][]; grid: Pt[][] } {
  const [a = ORIGIN, b = a] = it.points;
  const [x0, x1, y0, y1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  const len = Math.max(it.size * 3, 6);
  const d = it.xyz ? Math.max(Math.min(x1 - x0, y1 - y0) * 0.3, len / 2) : len / 2;
  const o: Pt = [x0 + d, y1 - d];
  const tips: Pt[] = [[x1, o[1]], [o[0], y0], ...(it.xyz ? [[x0, y1] as Pt] : [])];
  const axes = tips.flatMap((t): Pt[][] => {
    const ang = Math.atan2(t[1] - o[1], t[0] - o[0]);
    const leg = (s: number): Pt => [t[0] + len * Math.cos(ang + Math.PI + (s * Math.PI) / 6), t[1] + len * Math.sin(ang + Math.PI + (s * Math.PI) / 6)];
    return [[o, t], [leg(-1), t, leg(1)]];
  });
  const grid: Pt[][] = [];
  if (it.grid) {
    // volle Karos bis eine Pfeillänge vor die Spitzen
    const n = (v: number) => Math.min(1000, Math.max(0, Math.floor(v / KARO + 1e-4)));
    const [nx, ny] = [n(x1 - len - o[0]), n(o[1] - y0 - len)];
    for (let k = 1; k <= nx; k++) grid.push([[o[0] + k * KARO, o[1]], [o[0] + k * KARO, o[1] - ny * KARO]]);
    for (let k = 1; k <= ny; k++) grid.push([[o[0], o[1] - k * KARO], [o[0] + nx * KARO, o[1] - k * KARO]]);
  }
  return { axes, grid };
}

function drawItem(ctx: CanvasRenderingContext2D, it: Item) {
  ctx.globalAlpha = it.opacity;
  ctx.fillStyle = ctx.strokeStyle = css(it.color);
  ctx.lineWidth = it.size;
  ctx.lineCap = ctx.lineJoin = "round";
  const [a = ORIGIN, b = a] = it.points;
  switch (it.kind) {
    case "ink":
      return ctx.fill(outline(it));
    case "marker": {
      ctx.beginPath();
      it.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (it.points.length === 1) ctx.lineTo(a[0] + 0.01, a[1]);
      return ctx.stroke();
    }
    case "line":
    case "arrow": {
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      if (it.kind === "arrow") {
        // wie OpenArrow in MuPDF: zwei Schenkel, 30°
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), len = Math.max(it.size * 3, 6);
        for (const d of [Math.PI - Math.PI / 6, Math.PI + Math.PI / 6]) {
          ctx.moveTo(b[0], b[1]);
          ctx.lineTo(b[0] + len * Math.cos(ang + d), b[1] + len * Math.sin(ang + d));
        }
      }
      return ctx.stroke();
    }
    case "rect":
    case "ellipse": {
      const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
      const w = Math.abs(a[0] - b[0]), h = Math.abs(a[1] - b[1]);
      ctx.beginPath();
      if (it.kind === "rect") ctx.rect(x, y, w, h);
      else ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, 2 * Math.PI);
      if (it.fill) {
        ctx.fillStyle = css(it.fill);
        ctx.fill();
      }
      return ctx.stroke();
    }
    case "text": {
      const { x0, y0 } = box(it);
      const { x1 } = box(it);
      ctx.font = `${it.size}px ${FONT}`;
      ctx.textBaseline = "top";
      wrapText(it.text, x1 - x0 - 2 * TEXT_PAD, (l) => ctx.measureText(l).width)
        .forEach(([l], i) => ctx.fillText(l, x0 + TEXT_PAD, y0 + TEXT_PAD + i * lineHeight(it.size)));
      return;
    }
    case "image": {
      const img = image(it.image ?? "");
      const { x0, y0, x1, y1 } = box({ ...it, rot: 0 });
      if (!img.complete) return;
      ctx.save();
      ctx.translate((x0 + x1) / 2, (y0 + y1) / 2);
      ctx.rotate(((it.rot ?? 0) * Math.PI) / 180);
      ctx.drawImage(img, (x0 - x1) / 2, (y0 - y1) / 2, x1 - x0, y1 - y0);
      return ctx.restore();
    }
    case "highlight":
      for (const r of pairs(it)) ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      return;
    case "axes": {
      const { axes, grid } = axesLines(it);
      for (const [lines, w] of [[grid, gridWidth(it.size)], [axes, it.size]] as const) {
        ctx.lineWidth = w;
        ctx.beginPath();
        for (const l of lines) l.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
    }
  }
}

/** Erkennt PNG/JPEG am Anfang der Base64-Daten (andere Formate kennt der Stamp nicht). */
export const imageMime = (b64: string) =>
  b64.startsWith("iVBORw0KGgo") ? "image/png" : b64.startsWith("/9j/") ? "image/jpeg" : null;

/** Geladene Bilder je Base64; nach dem Laden feuert `IMAGE_LOADED` auf window → neu zeichnen. */
export const IMAGE_LOADED = "pdfnote-image";
const images = new Map<string, HTMLImageElement>();
// ponytail: Cache wächst mit jedem Bild der Sitzung; bei Speicherproblemen LRU
function image(b64: string) {
  let img = images.get(b64);
  if (!img) {
    img = new Image();
    img.onload = () => dispatchEvent(new Event(IMAGE_LOADED));
    img.src = `data:${imageMime(b64) ?? "image/png"};base64,${b64}`;
    images.set(b64, img);
  }
  return img;
}

/** Bild-Objekt mittig um (cx, cy), höchstens max pt groß, Seitenverhältnis bleibt. */
export function imageItem(page: number, b64: string, w: number, h: number, cx: number, cy: number, max: number): Item {
  const s = Math.min(1, max / Math.max(w, h, 1));
  const hw = (w * s) / 2, hh = (h * s) / 2;
  return {
    id: newId(), page, kind: "image", color: [0, 0, 0], opacity: 1, size: 1, simulated: false,
    points: [[cx - hw, cy - hh, 0.5], [cx + hw, cy + hh, 0.5]], text: "", image: b64,
  };
}

export function drawItems(ctx: CanvasRenderingContext2D, items: Item[], zoom: number) {
  const dpr = devicePixelRatio;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, 0, 0);
  for (const it of items) drawItem(ctx, it);
  ctx.globalAlpha = 1;
}

/**
 * Textfeld-Rechteck aus Text: Breite gemessen, etwas Luft, weil PDF-Helvetica anders läuft als die Canvas-Schrift.
 * `fixed` = feste Breite (Breitengriff): Text bricht um, nur die Höhe wächst.
 */
export function textRect(ctx: CanvasRenderingContext2D, text: string, size: number, x: number, y: number, fixed?: number): InkPoint[] {
  ctx.font = `${size}px ${FONT}`;
  const m = (l: string) => ctx.measureText(l).width;
  const lines = fixed ? wrapText(text, fixed - 2 * TEXT_PAD, m).map(([l]) => l) : text.split("\n");
  const w = fixed ?? Math.max(...lines.map(m)) * 1.1 + 2 * TEXT_PAD + size * 0.5;
  const h = lines.length * lineHeight(size) + 2 * TEXT_PAD + size * 0.3;
  return [[x, y, 0.5], [x + w, y + h, 0.5]];
}

/**
 * Feste Breite eines Textfelds oder `undefined` (wächst mit dem Text).
 * ponytail: aus der Box geschlossen (weicht von der Textbreite ab) statt gespeichert – übersteht so Speichern/Öffnen ohne Zusatzfeld.
 */
export function fixedWidth(ctx: CanvasRenderingContext2D, it: Item): number | undefined {
  const { x0, x1 } = box(it);
  const [, [auto = 0] = []] = textRect(ctx, it.text, it.size, 0, 0);
  return it.text && Math.abs(x1 - x0 - auto) > 0.5 ? x1 - x0 : undefined;
}

/**
 * Angezeigte Zeilen: harte Umbrüche, dazu Wortumbruch bei `maxW` (wie MuPDF beim FreeText-Erscheinungsbild).
 * Je Zeile Text + Stelle im Gesamttext; Leerzeichen bleiben am Zeilenende, damit die Stellen aufgehen.
 */
export function wrapText(text: string, maxW: number, measure: (s: string) => number): [string, number][] {
  const out: [string, number][] = [];
  let at = 0;
  for (const para of text.split("\n")) {
    let line = "", start = at;
    for (const w of para.split(/(?<= )/)) {
      if (line && measure(line + w.trimEnd()) > maxW) {
        out.push([line, start]);
        start += line.length;
        line = w;
      } else line += w;
    }
    out.push([line, start]);
    at += para.length + 1;
  }
  return out;
}

/** Cursorstelle im Text eines Felds (Breite `w`) unter dem Punkt (x, y) relativ zur linken oberen Ecke, pt. */
export function caretAt(text: string, size: number, w: number, x: number, y: number, measure: (s: string) => number): number {
  const lines = wrapText(text, w - 2 * TEXT_PAD, measure);
  const [line = "", start = 0] = lines[Math.max(0, Math.min(lines.length - 1, Math.floor((y - TEXT_PAD) / lineHeight(size))))] ?? [];
  let best = 0;
  for (let k = 1; k <= line.length; k++) {
    if (Math.abs(measure(line.slice(0, k)) - (x - TEXT_PAD)) < Math.abs(measure(line.slice(0, best)) - (x - TEXT_PAD))) best = k;
  }
  return start + best;
}

function segDist(px: number, py: number, a: InkPoint, b: InkPoint) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l)) : 0;
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
}

/** Trifft (x, y) das Objekt? tol in pt zusätzlich zur halben Strichbreite. */
export function hitTest(it: Item, x: number, y: number, tol: number): boolean {
  const r = tol + it.size / 2;
  const [a = ORIGIN, b = a] = it.points;
  switch (it.kind) {
    case "ink":
    case "marker":
      return it.points.length === 1
        ? Math.hypot(x - a[0], y - a[1]) <= r
        : it.points.some((p, i) => i > 0 && segDist(x, y, it.points[i - 1] ?? p, p) <= r);
    case "line":
    case "arrow":
      return segDist(x, y, a, b) <= r;
    case "rect": {
      const c: InkPoint[] = [a, [b[0], a[1], 0], b, [a[0], b[1], 0]];
      return c.some((p, i) => segDist(x, y, p, c[(i + 1) % 4] ?? p) <= r);
    }
    case "ellipse": {
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
      const rx = Math.abs(a[0] - b[0]) / 2, ry = Math.abs(a[1] - b[1]) / 2;
      if (rx < 0.5 || ry < 0.5) return segDist(x, y, a, b) <= r;
      // ponytail: Näherung über normierten Radius; genügt für Treffer-Toleranz
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      return Math.abs(d - 1) * Math.min(rx, ry) <= r;
    }
    case "axes": {
      const { axes, grid } = axesLines(it);
      return [...axes, ...grid].some((l) => l.some((p, i) => i > 0 && segDist(x, y, [...(l[i - 1] ?? p), 0], [...p, 0]) <= r));
    }
    case "text":
    case "image":
    case "highlight":
      return (it.kind === "highlight" ? pairs(it) : [box(it)])
        .some((bx) => x >= bx.x0 - tol && x <= bx.x1 + tol && y >= bx.y0 - tol && y <= bx.y1 + tol);
  }
}

/**
 * Ebene, in die ein Maus-Klick an (x, y) springt: eigenes Objekt (oberstes zuerst) → dessen Ebene; reiner PDF-Inhalt
 * (`onPdf`) → 1; sonst `null` = Ebene bleibt. EINZIGE Stelle der Automatik: `ok` (z. B. Ebenen-Sperre) überspringt Ebenen.
 */
export function autoLayerFor(items: Item[], x: number, y: number, tol: number, onPdf: boolean, ok: (l: Layer) => boolean = () => true): Layer | null {
  const own = items.findLast((it) => ok(layerOf(it)) && hitTest(it, x, y, tol));
  if (own) return layerOf(own);
  return onPdf && ok(1) ? 1 : null;
}

/** Ids von PDF-Absätzen (Ebene 1) im Auswahlsystem: `PARA0 - Index`; Original-Objekte haben `-1 - Index` */
export const PARA0 = -1_000_000;
export const isPara = (id: number) => id <= PARA0;

export function inPolygon(x: number, y: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] ?? [0, 0], [xj, yj] = poly[j] ?? [0, 0];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Punkte abbilden; s skaliert Breite/Schriftgröße mit. */
export const mapItem = (it: Item, f: (x: number, y: number) => [number, number], s = 1): Item => ({
  ...it,
  size: it.size * s,
  points: it.points.map(([x, y, p]) => [...f(x, y), p]),
});

export const moveItem = (it: Item, dx: number, dy: number) => mapItem(it, (x, y) => [x + dx, y + dy]);
/** Um (ox, oy) skalieren; Breite/Schriftgröße mit dem geometrischen Mittel. */
export const scaleItem = (it: Item, ox: number, oy: number, sx: number, sy = sx) =>
  mapItem(it, (x, y) => [ox + (x - ox) * sx, oy + (y - oy) * sy], Math.sqrt(sx * sy));
/** Abbildung als PDF-Matrix [a, b, c, d, e, f] (x' = a·x + c·y + e) für Original-Objekte */
export const scaleMatrix = (ox: number, oy: number, sx: number, sy: number) => [sx, 0, 0, sy, ox * (1 - sx), oy * (1 - sy)];
export function rotMatrix(cx: number, cy: number, deg: number) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}
/** Bild um (cx, cy) drehen: Mitte wandert mit, Bild dreht in sich (`rot`). */
export function rotateItem(it: Item, cx: number, cy: number, deg: number): Item {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = rotMatrix(cx, cy, deg), bx = box({ ...it, rot: 0 });
  const [mx, my] = [(bx.x0 + bx.x1) / 2, (bx.y0 + bx.y1) / 2];
  const [nx, ny] = [a * mx + c * my + e, b * mx + d * my + f];
  const rot = (((it.rot ?? 0) + deg) % 360 + 360) % 360;
  return { ...moveItem(it, nx - mx, ny - my), rot };
}

/** Zuschnitt `[l, t, r, b]` als Anteile 0…1 des ungedrehten Bilds. */
export type Crop = [number, number, number, number];
const CROP_MIN = 0.05;
/** Zuschnitt-Griff ziehen: `handle` wie HANDLES ("n", "se" …), dx/dy als Anteile; bleibt in 0…1, Mindestgröße. */
export function cropDrag([l, t, r, b]: Crop, handle: string, dx: number, dy: number): Crop {
  const cl = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  if (handle.includes("w")) l = cl(l + dx, 0, r - CROP_MIN);
  if (handle.includes("e")) r = cl(r + dx, l + CROP_MIN, 1);
  if (handle.includes("n")) t = cl(t + dy, 0, b - CROP_MIN);
  if (handle.includes("s")) b = cl(b + dy, t + CROP_MIN, 1);
  return [l, t, r, b];
}
/** Bild auf den Zuschnitt verkleinern (neue Pixel `b64`); der sichtbare Ausschnitt bleibt auf der Seite stehen. */
export function cropItem(it: Item, [l, t, r, b]: Crop, b64: string): Item {
  const bx = box({ ...it, rot: 0 }), [w, h] = [bx.x1 - bx.x0, bx.y1 - bx.y0];
  const rad = ((it.rot ?? 0) * Math.PI) / 180, [c, s] = [Math.cos(rad), Math.sin(rad)];
  // Versatz der neuen Mitte im Bild, gedreht wie das Bild (rotMatrix)
  const [ox, oy] = [((l + r) / 2 - 0.5) * w, ((t + b) / 2 - 0.5) * h];
  const [cx, cy] = [(bx.x0 + bx.x1) / 2 + c * ox - s * oy, (bx.y0 + bx.y1) / 2 + s * ox + c * oy];
  const [hw, hh] = [((r - l) * w) / 2, ((b - t) * h) / 2];
  return { ...it, image: b64, points: [[cx - hw, cy - hh, 0.5], [cx + hw, cy + hh, 0.5]] };
}

// Seitenoperationen: Objekte mitnehmen
export const afterInsert = (items: Item[], at: number, n: number) =>
  items.map((it) => (it.page >= at ? { ...it, page: it.page + n } : it));

export const afterDelete = (items: Item[], k: number) =>
  items.filter((it) => it.page !== k).map((it) => (it.page > k ? { ...it, page: it.page - 1 } : it));

/** Mehrere Seiten gelöscht (Objekte der Seiten weg, Rest nachgerückt). */
export const afterDeleteMany = (items: Item[], ks: number[]) => [...ks].sort((a, b) => b - a).reduce((its, k) => afterDelete(its, k), items);

/** Mehrfachauswahl der Miniaturen: Umschalt = Bereich ab `anchor`, Strg = Einzelne umschalten, sonst nur `i`. */
export function thumbPick(sel: number[], anchor: number, i: number, ctrl: boolean, shift: boolean): number[] {
  if (shift) {
    const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
    return Array.from({ length: b - a + 1 }, (_, k) => a + k);
  }
  if (ctrl) return (sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i]).sort((a, b) => a - b);
  return [i];
}

export function movedIndex(p: number, from: number, to: number) {
  if (p === from) return to;
  if (from < to && p > from && p <= to) return p - 1;
  if (from > to && p >= to && p < from) return p + 1;
  return p;
}
export const afterMove = (items: Item[], from: number, to: number) =>
  items.map((it) => ({ ...it, page: movedIndex(it.page, from, to) }));

/** Seite k um 90° im Uhrzeigersinn gedreht; h = Höhe vor dem Drehen. Text und Bilder bleiben waagrecht. */
export const afterRotate = (items: Item[], k: number, h: number) =>
  items.map((it) => (it.page === k ? mapItem(it, (x, y) => [h - y, x]) : it));

/**
 * Platz einfügen: Objekte der Seite, die bei `y` oder tiefer beginnen, um `dy` verschieben (negativ = Platz entfernen).
 * Begrenzt auf die Seite (0…h), nichts rutscht über den Rand. Liefert nur die verschobenen Objekte.
 */
export function makeSpace(items: Item[], page: number, y: number, dy: number, h: number): Item[] {
  const below = items.filter((it) => it.page === page && box(it).y0 >= y);
  if (!below.length) return [];
  const top = Math.min(...below.map((it) => box(it).y0)), bottom = Math.max(...below.map((it) => box(it).y1));
  const d = dy > 0 ? Math.min(dy, Math.max(0, h - bottom)) : Math.max(dy, Math.min(0, -top));
  return d ? below.map((it) => moveItem(it, 0, d)) : [];
}
