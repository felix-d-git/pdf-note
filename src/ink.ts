import { getStroke } from "perfect-freehand";
import { z } from "zod";

/** Punkt in pt relativ zur linken oberen Seitenecke, p = Druck 0–1. */
export type InkPoint = [x: number, y: number, p: number];
export type Rgb = [number, number, number];

export const KINDS = ["ink", "marker", "line", "arrow", "rect", "ellipse", "text"] as const;
export type Kind = (typeof KINDS)[number];

/**
 * Eigenes Objekt. Formen/Text: zwei Punkte (Ecken bzw. Anfang/Ende), damit Verschieben,
 * Skalieren und Seitendrehung für alle Arten gleich über die Punkte laufen.
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
}
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
});
export const fromData = (d: z.infer<typeof ItemData>): Item => ({
  id: newId(), page: d.page, kind: d.kind, color: d.color, opacity: d.opacity, size: d.size,
  simulated: d.simulated, points: d.points, text: d.text,
});

export interface Preset {
  name: string;
  color: Rgb;
  size: number;
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
});

const css = (c: Rgb) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
export const lineHeight = (size: number) => size * 1.2;
const TEXT_PAD = 2;

/** Rechteck aus zwei Punkten, normiert. */
export function box(it: Item) {
  const xs = it.points.map((p) => p[0]), ys = it.points.map((p) => p[1]);
  const pad = it.kind === "text" ? 0 : it.size / 2;
  return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
}

export function unionBox(items: Item[]) {
  const bs = items.map(box);
  return {
    x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)),
    x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)),
  };
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
      return ctx.stroke();
    }
    case "text": {
      const { x0, y0 } = box(it);
      ctx.font = `${it.size}px ${FONT}`;
      ctx.textBaseline = "top";
      it.text.split("\n").forEach((l, i) => ctx.fillText(l, x0 + TEXT_PAD, y0 + TEXT_PAD + i * lineHeight(it.size)));
    }
  }
}

export function drawItems(ctx: CanvasRenderingContext2D, items: Item[], zoom: number) {
  const dpr = devicePixelRatio;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, 0, 0);
  for (const it of items) drawItem(ctx, it);
  ctx.globalAlpha = 1;
}

/** Textfeld-Rechteck aus Text: Breite gemessen, etwas Luft, weil PDF-Helvetica anders läuft als die Canvas-Schrift. */
export function textRect(ctx: CanvasRenderingContext2D, text: string, size: number, x: number, y: number): InkPoint[] {
  ctx.font = `${size}px ${FONT}`;
  const lines = text.split("\n");
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) * 1.1 + 2 * TEXT_PAD + size * 0.5;
  const h = lines.length * lineHeight(size) + 2 * TEXT_PAD + size * 0.3;
  return [[x, y, 0.5], [x + w, y + h, 0.5]];
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
    case "text": {
      const bx = box(it);
      return x >= bx.x0 - tol && x <= bx.x1 + tol && y >= bx.y0 - tol && y <= bx.y1 + tol;
    }
  }
}

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
/** Gleichmäßig um (ox, oy) skalieren. */
export const scaleItem = (it: Item, ox: number, oy: number, s: number) =>
  mapItem(it, (x, y) => [ox + (x - ox) * s, oy + (y - oy) * s], s);

// Seitenoperationen: Objekte mitnehmen
export const afterInsert = (items: Item[], at: number, n: number) =>
  items.map((it) => (it.page >= at ? { ...it, page: it.page + n } : it));

export const afterDelete = (items: Item[], k: number) =>
  items.filter((it) => it.page !== k).map((it) => (it.page > k ? { ...it, page: it.page - 1 } : it));

export function movedIndex(p: number, from: number, to: number) {
  if (p === from) return to;
  if (from < to && p > from && p <= to) return p - 1;
  if (from > to && p >= to && p < from) return p + 1;
  return p;
}
export const afterMove = (items: Item[], from: number, to: number) =>
  items.map((it) => ({ ...it, page: movedIndex(it.page, from, to) }));

/** Seite k um 90° im Uhrzeigersinn gedreht; h = Höhe vor dem Drehen. Text bleibt waagrecht. */
export const afterRotate = (items: Item[], k: number, h: number) =>
  items.map((it) => (it.page === k ? mapItem(it, (x, y) => [h - y, x]) : it));
