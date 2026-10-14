import { getStroke } from "perfect-freehand";

/** Punkt in pt relativ zur linken oberen Seitenecke, p = Druck 0–1. */
export type InkPoint = [x: number, y: number, p: number];

export interface Stroke {
  page: number;
  color: [number, number, number];
  opacity: number;
  /** Grundbreite in pt */
  size: number;
  /** Maus: Druck wird simuliert */
  simulated: boolean;
  points: InkPoint[];
}

export interface Preset {
  name: string;
  color: [number, number, number];
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

const THINNING = 0.5;
// Stift-Test FELIXHP: Druck erreicht nur ~0,7 → darauf normieren. Regler kommt mit den Einstellungen.
export const PRESSURE_MAX = 0.75;

export const normPressure = (p: number) => Math.min(1, Math.max(0.05, p / PRESSURE_MAX));

/** Gefüllter Umriss (perfect-freehand) in pt; Zeichenkontext skaliert auf Zoom. */
export function outline(s: Stroke): Path2D {
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
 * Breite der gespeicherten Ink-Annotation: PDF-Ink kennt nur eine Breite je Strich →
 * mittlerer Durchmesser nach perfect-freehand-Formel (Radius = size·(0,5 − thinning·(0,5 − p))).
 */
export function savedWidth(s: Stroke): number {
  if (s.simulated || !s.points.length) return s.size;
  const p = s.points.reduce((a, q) => a + q[2], 0) / s.points.length;
  return s.size * (1 - THINNING * (1 - 2 * p));
}

export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], zoom: number) {
  const dpr = devicePixelRatio;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, 0, 0);
  for (const s of strokes) {
    ctx.globalAlpha = s.opacity;
    ctx.fillStyle = `rgb(${s.color.map((c) => Math.round(c * 255)).join(",")})`;
    ctx.fill(outline(s));
  }
  ctx.globalAlpha = 1;
}
