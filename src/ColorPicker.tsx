import { Ban } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { T } from "./i18n";
import type { Rgb } from "./ink";

/** Farbwähler ohne Bestätigen: Hover = Vorschau, Klick bzw. Loslassen = übernehmen. Kein Windows-Dialog. */
export const PALETTE: Rgb[] = [
  [0.07, 0.07, 0.07], [0.4, 0.4, 0.4], [0.75, 0.75, 0.75], [1, 1, 1],
  [0.84, 0.18, 0.18], [0.95, 0.5, 0.1], [1, 0.86, 0.1], [0.45, 0.9, 0.35],
  [0.06, 0.6, 0.45], [0.12, 0.7, 0.85], [0.12, 0.36, 0.85], [0.55, 0.3, 0.85],
  [1, 0.45, 0.75], [0.55, 0.35, 0.2],
];

export function hsv2rgb(h: number, s: number, v: number): Rgb {
  const f = (n: number) => v - v * s * Math.max(0, Math.min(1, Math.min((n + h * 6) % 6, 4 - ((n + h * 6) % 6))));
  return [f(5), f(3), f(1)];
}

export function rgb2hsv([r, g, b]: Rgb): [number, number, number] {
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  const h = d === 0 ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, mx === 0 ? 0 : d / mx, mx];
}

const css = (c: Rgb) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
const same = (a?: Rgb, b?: Rgb) => (a && b ? a.every((v, i) => Math.abs(v - (b[i] ?? 0)) < 0.01) : a === b);

/** Fläche, die beim Ziehen (x, y in 0–1) laufend meldet und beim Loslassen `end` ruft. */
function Area({ move, end, className, style, label, children }: {
  move: (x: number, y: number) => void; end: () => void; className: string; style?: React.CSSProperties; label: string; children?: ReactNode;
}) {
  const drag = useRef(false);
  const at = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    move(Math.min(1, Math.max(0, (e.clientX - r.left) / (r.width || 1))), Math.min(1, Math.max(0, (e.clientY - r.top) / (r.height || 1))));
  };
  return (
    <div role="slider" aria-label={label} aria-valuenow={0} className={`relative cursor-crosshair touch-none ${className}`} style={style}
      onPointerDown={(e) => { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); at(e); }}
      onPointerMove={(e) => drag.current && at(e)}
      onPointerUp={() => { if (drag.current) { drag.current = false; end(); } }}>
      {children}
    </div>
  );
}

/**
 * `value` undefined = keine Farbe (nur mit `none`). `onPreview(c)` zeigt vorläufig, `onPreview(null)` nimmt die Vorschau zurück;
 * `onCommit` kommt genau einmal je Wahl (Klick bzw. Loslassen) → ein Undo-Schritt.
 */
export function ColorPicker({ value, none, onPreview, onCommit }: {
  value?: Rgb; none?: boolean; onPreview: (c: Rgb | undefined | null) => void; onCommit: (c: Rgb | undefined) => void;
}) {
  const [hsv, setHsv] = useState<[number, number, number]>(() => (value ? rgb2hsv(value) : [0, 1, 1]));
  const cur = useRef(value);
  const set = (n: [number, number, number]) => {
    setHsv(n);
    cur.current = hsv2rgb(...n);
    onPreview(cur.current);
  };
  const [h, s, v] = hsv;
  const swatch = "h-5 w-5 rounded-xs border border-line ring-2";
  return (
    <div data-pedit className="flex w-44 flex-col gap-2" onPointerLeave={() => onPreview(null)}>
      <div className="flex flex-wrap gap-1">
        {none && (
          <button type="button" title={T.noFill} aria-label={T.noFill} onPointerEnter={() => onPreview(undefined)} onClick={() => onCommit(undefined)}
            className={`${swatch} grid place-items-center bg-surface text-ink-2 ${value === undefined ? "ring-accent" : "ring-transparent"}`}><Ban size={14} aria-hidden /></button>
        )}
        {PALETTE.map((c, i) => (
          <button key={i} type="button" aria-label={css(c)} onPointerEnter={() => onPreview(c)} onClick={() => onCommit(c)}
            className={`${swatch} ${same(c, value) ? "ring-accent" : "ring-transparent"}`} style={{ background: css(c) }} />
        ))}
      </div>
      <Area label={T.color} className="h-24 rounded-xs" end={() => onCommit(cur.current)}
        style={{ background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,${css(hsv2rgb(h, 1, 1))})` }}
        move={(x, y) => set([h, x, 1 - y])}>
        <span className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }} />
      </Area>
      <Area label={T.hue} className="h-3 rounded-pill" end={() => onCommit(cur.current)}
        style={{ background: "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" }}
        move={(x) => set([Math.min(x, 0.999), s || 1, v || 1])}>
        <span className="pointer-events-none absolute top-1/2 h-4 w-2 -translate-x-1/2 -translate-y-1/2 rounded-xs border-2 border-white shadow" style={{ left: `${h * 100}%` }} />
      </Area>
    </div>
  );
}

/** Farbfeld, das den Wähler als Popover öffnet (Mini-Leiste/Zahnrad). */
export function ColorButton({ label, ...p }: { label: string; value?: Rgb; none?: boolean; onPreview: (c: Rgb | undefined | null) => void; onCommit: (c: Rgb | undefined) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button type="button" title={label} aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}
        className="h-7 w-7 rounded-xs border border-line" style={{ background: p.value ? css(p.value) : "repeating-conic-gradient(#ccc 0 25%,#fff 0 50%) 0 0/8px 8px" }} />
      {open && (
        <div className="absolute top-8 left-0 z-30 rounded-sm border border-line bg-surface p-2 shadow-raised"><ColorPicker {...p} /></div>
      )}
    </span>
  );
}
