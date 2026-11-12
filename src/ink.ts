import { z } from "zod";

/** Punkt in pt relativ zur linken oberen Seitenecke, p = Druck 0–1. */
export type InkPoint = [x: number, y: number, p: number];
export type Rgb = [number, number, number];

export const KINDS = ["ink", "marker", "line", "arrow", "rect", "ellipse", "text", "image", "highlight", "axes", "solid"] as const;
export const SOLIDS = ["cuboid", "cube", "cylinder"] as const;
export type Solid = (typeof SOLIDS)[number];
export type Dash = "dash" | "dot";
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
  /** xyz-Gitter: Ebenen; fehlt bei `grid` → nur y-z-Rückwand (Dateien bis v1.2) */
  planes?: "xz" | "all";
  /** Linie/Pfeil/Rechteck/Ellipse/Körper: Strichart; fehlt → durchgezogen */
  dash?: Dash;
  /** Körper (kind "solid") als Schrägbild; fehlt → Quader */
  solid?: Solid;
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
  planes: z.enum(["xz", "all"]).optional(),
  dash: z.enum(["dash", "dot"]).optional(),
  solid: z.enum(SOLIDS).optional(),
  fill: z.tuple([num, num, num]).optional(),
});
export const fromData = (d: z.infer<typeof ItemData>): Item => ({
  id: newId(), page: d.page, kind: d.kind, color: d.color, opacity: d.opacity, size: d.size,
  simulated: d.simulated, points: d.points, text: d.text, ...(d.image ? { image: d.image } : {}),
  layer: d.layer === 2 || d.layer === 3 ? d.layer : kindLayer(d.kind), ...(d.rot ? { rot: d.rot } : {}),
  ...(d.xyz ? { xyz: true } : {}), ...(d.grid ? { grid: true } : {}),
  ...(d.fill ? { fill: d.fill } : {}), ...opt(d),
});
/** Optionale Aufzählungs-Felder, nur wenn gesetzt */
const opt = (d: Pick<Item, "planes" | "dash" | "solid">) => ({
  ...(d.planes ? { planes: d.planes } : {}), ...(d.dash ? { dash: d.dash } : {}), ...(d.solid ? { solid: d.solid } : {}),
});

/** Strichart: Farbe + Grundbreite (Formen nutzen den aktiven Stift) */
export interface Preset {
  color: Rgb;
  size: number;
}
/** Stift der Werkzeugleiste; Druck und Glättung gelten global (Einstellungen) */
export interface Pen extends Preset {
  kind: "pen" | "marker";
}

export const DEFAULT_PRESET: Preset = { color: [0.07, 0.07, 0.07], size: 2.2 };

/** Start-Leiste: `Q W E` = erste drei Stifte, `Umschalt+Q W E` = erste drei Marker */
export const DEFAULT_PENS: Pen[] = [
  { kind: "pen", color: [0.84, 0.18, 0.18], size: 2.2 },
  { kind: "pen", color: [0.06, 0.6, 0.45], size: 2.2 },
  { kind: "pen", color: [0.12, 0.36, 0.85], size: 2.2 },
  { kind: "pen", ...DEFAULT_PRESET },
  { kind: "marker", color: [1, 0.35, 0.35], size: 12 },
  { kind: "marker", color: [0.45, 0.9, 0.35], size: 12 },
  { kind: "marker", color: [0.4, 0.7, 1], size: 12 },
];
export const MARKER_OPACITY = 0.35;
export const TEXT_SIZE = 14;
export const FONT = "Helvetica, Arial, sans-serif";

// Druck bis v1.2: Breite = size·(1 − THINNING·(1 − 2p)); neue Striche haben p = 0,5 → konstant `size`
const THINNING = 0.5;

/** Glättung beim Aufnehmen (live = gespeichert): neuer Punkt läuft um `s` (0–0,9) nach; 0 = exakt wie gezeichnet. */
export const smoothPt = (prev: InkPoint | undefined, q: InkPoint, s: number): InkPoint =>
  prev && s > 0 ? [prev[0] + (q[0] - prev[0]) * (1 - s), prev[1] + (q[1] - prev[1]) * (1 - s), q[2]] : q;

type Xy = [number, number];
/**
 * Freihand-Mittellinie als quadratische Bézier-Kurven durch die Punkt-Mittelpunkte (Kontrollpunkt = echter Punkt):
 * knickfrei (Tangente stetig), weicht je Punkt nur |2p − Vor − Nach|/8 ab → bei Stift-Punktdichte < 0,1 pt.
 * Keine Glättung über mehrere Punkte, also keine Formverfremdung; live, fertig und gespeichert gleich.
 * Rückgabe: Start + Segmente [Kontrollpunkt, Ende] (Kontrollpunkt = Ende → gerade).
 */
export function curve(pts: InkPoint[]): { start: Xy; segs: [Xy, Xy][] } {
  const xy = pts.map(([x, y]): Xy => [x, y]);
  const [start = [0, 0]] = xy, last = xy.at(-1) ?? start;
  const segs = xy.slice(1, -1).map((p, i): [Xy, Xy] => {
    const n = xy[i + 2] ?? p;
    return [p, [(p[0] + n[0]) / 2, (p[1] + n[1]) / 2]];
  });
  // Einzelpunkt: winziges Stück, damit die runde Kappe einen Punkt zeichnet
  segs.push(xy.length > 1 ? [last, last] : [[start[0] + 0.01, start[1]], [start[0] + 0.01, start[1]]]);
  return { start, segs };
}

function curvePath(ctx: CanvasRenderingContext2D, pts: InkPoint[]) {
  const { start, segs } = curve(pts);
  ctx.beginPath();
  ctx.moveTo(...start);
  for (const [c, e] of segs) ctx.quadraticCurveTo(c[0], c[1], e[0], e[1]);
}

/**
 * Breite des Strichs (Bildschirm und PDF-Ink, das nur eine Breite je Strich kennt). Neue Striche: konstant `size`.
 * Alte Stift-Striche mit Druck: mittlerer Durchmesser der früheren Druckbreite, wie ihr PDF-Erscheinungsbild.
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
  ...(it.fill ? { fill: it.fill } : {}), ...opt(it),
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
    // Schrägbild-x: Karo-Diagonale halb verkürzt (Schritt KARO/2 nach links und unten)
    const [nr, nu, nf] = [n(x1 - len - o[0]), n(o[1] - y0 - len), n((Math.SQRT2 * d - len) / (KARO * Math.SQRT1_2))];
    const [r, u, f]: [Pt, Pt, Pt] = [[KARO, 0], [0, -KARO], [-KARO / 2, KARO / 2]];
    const at = (p: Pt, i: number, q: Pt, j: number): Pt => [o[0] + i * p[0] + j * q[0], o[1] + i * p[1] + j * q[1]];
    const plane = (p: Pt, np: number, q: Pt, nq: number) => {
      for (let k = 1; k <= np; k++) grid.push([at(p, k, q, 0), at(p, k, q, nq)]);
      for (let k = 1; k <= nq; k++) grid.push([at(q, k, p, 0), at(q, k, p, np)]);
    };
    const planes = it.xyz ? it.planes : undefined;
    if (planes !== "xz") plane(r, nr, u, nu); // xy-System, y-z-Rückwand
    if (planes) plane(f, nf, u, nu); // x-z
    if (planes === "all") plane(f, nf, r, nr); // x-y-Boden
  }
  return { axes, grid };
}

/** Strichmuster wie in der PDF (`/D`, stumpfe Enden); leer = durchgezogen */
export const dashPattern = (dash: Dash | undefined, w: number) => (dash === "dash" ? [3 * w, 2 * w] : dash === "dot" ? [w, w] : []);

/**
 * Körper als Schrägbild (wie `solid_lines` in Rust – beide gleich halten): sichtbare und verdeckte Kanten je Polylinie.
 * Quader/Würfel: Tiefe 45° nach hinten-rechts, halb verkürzt; Zylinder: stehend, Grundkreise als flache Ellipsen.
 */
export function solidLines(it: Item): { vis: Pt[][]; hid: Pt[][] } {
  const [a = ORIGIN, b = a] = it.points;
  const [x0, x1, y0, y1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  const [w, h] = [x1 - x0, y1 - y0];
  if (it.solid === "cylinder") {
    const rx = w / 2, ry = Math.min(rx * 0.35, h / 4), cx = x0 + rx, [top, bot] = [y0 + ry, y1 - ry];
    // halbe Ellipse ab Winkel t0 (0 = vordere/untere Hälfte, π = hintere)
    const arc = (cy: number, t0: number) => Array.from({ length: 25 }, (_, i): Pt => [cx + rx * Math.cos(t0 + (i * Math.PI) / 24), cy + ry * Math.sin(t0 + (i * Math.PI) / 24)]);
    return { vis: [[...arc(top, 0), ...arc(top, Math.PI).slice(1)], arc(bot, 0), [[x0, top], [x0, bot]], [[x1, top], [x1, bot]]], hid: [arc(bot, Math.PI)] };
  }
  // Versatz der Tiefe je Richtung = Kante·½·cos 45°; Würfel: Kante = Vorderseite
  const m = Math.min(w, h), q = Math.SQRT2 / 4, k = it.solid === "cube" ? (m / (1 + q)) * q : m * 0.25;
  const [A, B, C, D]: [Pt, Pt, Pt, Pt] = [[x0, y1], [x1 - k, y1], [x1 - k, y0 + k], [x0, y0 + k]];
  const back = ([x, y]: Pt): Pt => [x + k, y - k];
  const [A2, B2, C2, D2] = [back(A), back(B), back(C), back(D)];
  return { vis: [[A, B, C, D, A], [D, D2, C2, B2, B], [C, C2]], hid: [[D2, A2, B2], [A, A2]] };
}

/** Werkzeug-Optionen (Zahnrad/Rechtsklick), gelten fürs nächste Aufziehen; Sitzungszustand */
export interface ShapeOpts {
  xyz: boolean;
  /** xy: aus/an ("all"); xyz: aus / x-z-Ebene / alle drei Ebenen */
  grid: "off" | "xz" | "all";
  square: boolean;
  circle: boolean;
  fill?: Rgb;
  dash?: Dash;
  solid: Solid;
}
export const SHAPE_OPTS: ShapeOpts = { xyz: false, grid: "off", square: false, circle: false, solid: "cuboid" };

/** Optionen → Felder eines neuen Elements dieser Art */
export function shapeProps(kind: Kind, o: ShapeOpts): Partial<Item> {
  const dash = o.dash && { dash: o.dash };
  if (kind === "axes") return { xyz: o.xyz, grid: o.grid !== "off", ...(o.xyz && o.grid !== "off" && { planes: o.grid }) };
  if (kind === "solid") return { solid: o.solid, ...dash };
  if (kind === "rect" || kind === "ellipse") return { ...dash, ...(o.fill && { fill: o.fill }) };
  if (kind === "line" || kind === "arrow") return { ...dash };
  return {};
}

/** Quadrat/Kreis/Würfel: Endpunkt auf gleiche Breite und Höhe (größere gewinnt), Richtung bleibt */
export function constrain(kind: Kind, o: ShapeOpts, a: InkPoint, b: InkPoint): InkPoint {
  const eq = (kind === "rect" && o.square) || (kind === "ellipse" && o.circle) || (kind === "solid" && o.solid === "cube");
  if (!eq) return b;
  const dx = b[0] - a[0], dy = b[1] - a[1], m = Math.max(Math.abs(dx), Math.abs(dy));
  return [a[0] + (dx < 0 ? -m : m), a[1] + (dy < 0 ? -m : m), b[2]];
}

function polylines(ctx: CanvasRenderingContext2D, lines: Pt[][]) {
  ctx.beginPath();
  for (const l of lines) l.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}

function drawItem(ctx: CanvasRenderingContext2D, it: Item) {
  const dash = dashPattern(it.dash, it.size);
  ctx.setLineDash(dash);
  ctx.globalAlpha = it.opacity;
  ctx.fillStyle = ctx.strokeStyle = css(it.color);
  ctx.lineWidth = it.size;
  ctx.lineCap = ctx.lineJoin = "round";
  if (dash.length) ctx.lineCap = "butt";
  const [a = ORIGIN, b = a] = it.points;
  switch (it.kind) {
    case "ink":
    case "marker":
      ctx.lineWidth = savedWidth(it);
      curvePath(ctx, it.points);
      return ctx.stroke();
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
        polylines(ctx, lines);
      }
      return;
    }
    case "solid": {
      const { vis, hid } = solidLines(it);
      polylines(ctx, vis);
      ctx.setLineDash(dashPattern("dash", it.size));
      ctx.lineCap = "butt";
      return polylines(ctx, hid);
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
    // gefüllt: auch die Fläche trifft – sonst fällt der Klick durch auf die PDF (Ebene 1) und die Form wirkt eingebrannt
    case "rect": {
      const bx = box(it);
      if (it.fill && x >= bx.x0 && x <= bx.x1 && y >= bx.y0 && y <= bx.y1) return true;
      const c: InkPoint[] = [a, [b[0], a[1], 0], b, [a[0], b[1], 0]];
      return c.some((p, i) => segDist(x, y, p, c[(i + 1) % 4] ?? p) <= r);
    }
    case "ellipse": {
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
      const rx = Math.abs(a[0] - b[0]) / 2, ry = Math.abs(a[1] - b[1]) / 2;
      if (rx < 0.5 || ry < 0.5) return segDist(x, y, a, b) <= r;
      // ponytail: Näherung über normierten Radius; genügt für Treffer-Toleranz
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      return (it.fill !== undefined && d <= 1) || Math.abs(d - 1) * Math.min(rx, ry) <= r;
    }
    case "axes":
    case "solid": {
      const lines = it.kind === "axes" ? Object.values(axesLines(it)).flat() : Object.values(solidLines(it)).flat();
      return lines.some((l) => l.some((p, i) => i > 0 && segDist(x, y, [...(l[i - 1] ?? p), 0], [...p, 0]) <= r));
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

export type ShapeKind = "line" | "arrow" | "root" | "rect" | "triangle" | "ellipse" | "curve";
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Douglas-Peucker: Eckpunkte eines Zugs mit Toleranz `eps` */
function corners(p: Pt[], eps: number): Pt[] {
  const a = p[0], b = p.at(-1);
  if (!a || !b || p.length < 3) return p;
  const len = dist(a, b) || 1;
  let far = 0, at = 0;
  p.forEach((q, i) => {
    const d = Math.abs((b[0] - a[0]) * (a[1] - q[1]) - (a[0] - q[0]) * (b[1] - a[1])) / len;
    if (d > far) [far, at] = [d, i];
  });
  return far <= eps ? [a, b] : [...corners(p.slice(0, at + 1), eps).slice(0, -1), ...corners(p.slice(at), eps)];
}
/** Knick an b in Grad (0 = geradeaus, 180 = Kehrtwende) */
const turn = (a: Pt, b: Pt, c: Pt) => {
  const [ux, uy, vx, vy] = [b[0] - a[0], b[1] - a[1], c[0] - b[0], c[1] - b[1]];
  return (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1)))) * 180) / Math.PI;
};

/**
 * Form-Erkennung beim Shape-Hold: Freihand-Zug → saubere Form als Punktfolge (bleibt ein Stift-Strich auf Ebene 3).
 * Offen: Linie, gerader Pfeil (Spitze = vom Start entferntester Punkt, Schaft gerade, Haken zurück) oder Wurzelzeichen;
 * sonst `null` (Kurve → erst langes Halten glättet, `smoothCurve`). Geschlossen (Ende nah am Anfang):
 * 3 Ecken → Dreieck, 4 → Rechteck (achsnah → achsparallel), sonst Kreis/Ellipse. Druck = Mittelwert.
 */
export function recognize(raw: InkPoint[]): { kind: ShapeKind; points: InkPoint[] } | null {
  // ponytail: Ecken-Zählung per Douglas-Peucker statt trainiertem Erkenner; reicht für die fünf Grundformen
  const pr = raw.reduce((s, q) => s + q[2], 0) / (raw.length || 1);
  const p = raw.map(([x, y]): Pt => [x, y]);
  const out = (kind: ShapeKind, q: Pt[]) => ({ kind, points: q.map(([x, y]): InkPoint => [x, y, pr]) });
  const a = p[0] ?? [0, 0], z = p.at(-1) ?? a;
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const D = Math.max(x1 - x0, y1 - y0);
  const line = out("line", [a, z]);
  if (D < 4) return line;
  if (dist(a, z) > 0.25 * D) {
    if (corners(p, 0.06 * D).length === 2) return line;
    // Pfeil: Spitze = erstes Maximum der Entfernung vom Start (Rückweg darf sie knapp überschreiten),
    // Schaft davor gerade, Haken danach läuft zurück
    const dm = Math.max(...p.map((q) => dist(q, a)));
    let k = p.findIndex((q) => dist(q, a) >= 0.95 * dm);
    while (k + 1 < p.length && dist(p[k + 1] ?? a, a) >= dist(p[k] ?? a, a)) k++;
    const tip = p[k] ?? z, shaft = dist(a, tip);
    const head = p.slice(k + 1), far = head.reduce((m, q) => (dist(q, tip) > dist(m, tip) ? q : m), tip), hl = dist(far, tip);
    if (corners(p.slice(0, k + 1), 0.06 * shaft).length === 2 && hl > 0.08 * shaft && hl < 0.6 * shaft && turn(a, tip, far) > 105) {
      const bl = Math.min(hl, 0.4 * shaft), ang = Math.atan2(a[1] - tip[1], a[0] - tip[0]);
      const barb = (d: number): Pt => [tip[0] + bl * Math.cos(ang + d), tip[1] + bl * Math.sin(ang + d)];
      return out("arrow", [a, tip, barb(0.49), tip, barb(-0.49)]);
    }
    // Wurzel: (Anstrich) ↘ kurz, ↗ lang und steil, → waagrecht; Dach wird exakt waagrecht
    const s = corners(p, 0.06 * D).filter((q, i, v) => i === 0 || dist(q, v[i - 1] ?? q) > 0.05 * D);
    const [v, t, e] = s.slice(-3), d0 = s.at(-4);
    if (d0 && v && t && e && s.length <= 5) {
      const [dx1, dy1, dx2, dy2, dx3, dy3] = [v[0] - d0[0], v[1] - d0[1], t[0] - v[0], t[1] - v[1], e[0] - t[0], e[1] - t[1]];
      if (dy1 > 0 && dx1 > -0.3 * dy1 && dy2 < 0 && -dy2 > dy1 && -dy2 > 0.5 * Math.abs(dx2) && dx3 > 0.3 * -dy2 && Math.abs(dy3) < 0.3 * dx3)
        return out("root", [...s.slice(0, -1), [e[0], t[1]]]);
    }
    return null;
  }
  // geschlossen: am entferntesten Punkt teilen, Ecken zyklisch, fast gerade Knicke und Doppelpunkte raus
  const k = p.reduce((m, q, i) => (dist(q, a) > dist(p[m] ?? a, a) ? i : m), 0);
  let v: Pt[] = [...corners(p.slice(0, k + 1), 0.08 * D).slice(0, -1), ...corners(p.slice(k), 0.08 * D).slice(0, -1)];
  for (let changed = true; changed && v.length > 2;) {
    changed = false;
    for (let i = 0; i < v.length; i++) {
      const pb = v[i] ?? a, pa = v[(i + v.length - 1) % v.length] ?? pb, pc = v[(i + 1) % v.length] ?? pb;
      if (dist(pa, pb) < 0.15 * D || turn(pa, pb, pc) < 30) {
        v = v.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  const v0 = v[0] ?? a;
  if (v.length === 3) return out("triangle", [...v, v0]);
  if (v.length === 4) {
    const axis = v.every((q, i) => {
      const r = v[(i + 1) % 4] ?? q, deg = (Math.abs(Math.atan2(r[1] - q[1], r[0] - q[0])) * 180) / Math.PI % 90;
      return Math.min(deg, 90 - deg) < 20;
    });
    return out("rect", axis ? [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]] : [...v, v0]);
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
  if (Math.abs(rx - ry) < 0.15 * Math.max(rx, ry)) rx = ry = (rx + ry) / 2;
  return out("ellipse", Array.from({ length: 49 }, (_, i): Pt => [cx + rx * Math.cos((i / 48) * 2 * Math.PI), cy + ry * Math.sin((i / 48) * 2 * Math.PI)]));
}

/**
 * Langes Halten auf einer Kurve (Funktionsgraph): Verlauf bleibt, nur das Zittern geht weg.
 * Gleichabständig neu abtasten, dann zweimal gleitender Mittelwert (Fenster ≈ 4 % der Länge), Enden fest.
 */
export function smoothCurve(raw: InkPoint[]): InkPoint[] {
  const pr = raw.reduce((s, q) => s + q[2], 0) / (raw.length || 1), P = raw.map(([x, y]): Pt => [x, y]);
  const len = P.slice(1).reduce((s, q, i) => s + dist(P[i] ?? q, q), 0);
  const n = Math.round(Math.min(200, Math.max(16, len / 2)));
  const out: Pt[] = [];
  for (let i = 0, j = 0, acc = 0; i <= n; i++) {
    const at = (len * i) / n;
    for (;;) {
      const q = P[j], r = P[j + 1];
      if (!q || !r) break;
      const l = dist(q, r);
      if (acc + l >= at) { const t = l ? (at - acc) / l : 0; out.push([q[0] + (r[0] - q[0]) * t, q[1] + (r[1] - q[1]) * t]); break; }
      acc += l;
      j++;
    }
    const z = P.at(-1);
    if (z && (i === n || out.length <= i)) out[i] = z;
  }
  const w = Math.max(2, Math.round(n * 0.04));
  let p = out;
  for (let pass = 0; pass < 2; pass++)
    p = p.map((_, i) => {
      const k = Math.min(w, i, p.length - 1 - i), win = p.slice(i - k, i + k + 1);
      return [win.reduce((s, r) => s + r[0], 0) / win.length, win.reduce((s, r) => s + r[1], 0) / win.length];
    });
  return p.map(([x, y]): InkPoint => [x, y, pr]);
}

/**
 * Nach der Erkennung weiterziehen: Form gleichmäßig skalieren, so dass der Haltepunkt `hold` dem Stift folgt.
 * Fixpunkt: geschlossene Formen → Mitte, offene → Startpunkt.
 */
export function dragShape(kind: ShapeKind, base: InkPoint[], hold: Pt, pen: Pt): InkPoint[] {
  const xs = base.map((q) => q[0]), ys = base.map((q) => q[1]), b0 = base[0];
  const o: Pt = kind === "rect" || kind === "triangle" || kind === "ellipse" || !b0
    ? [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2] : [b0[0], b0[1]];
  const s = Math.max(0.05, dist(o, pen) / Math.max(1, dist(o, hold)));
  return base.map(([x, y, pr]): InkPoint => [o[0] + (x - o[0]) * s, o[1] + (y - o[1]) * s, pr]);
}
