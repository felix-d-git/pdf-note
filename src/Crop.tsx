import { useEffect, useRef, useState } from "react";
import { box, cropDrag, type Crop, type Item } from "./ink";

export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export const HANDLE_CURSOR: Record<string, string> = { nw: "nwse", se: "nwse", ne: "nesw", sw: "nesw", n: "ns", s: "ns", e: "ew", w: "ew" };
/** Griff-Lage in % entlang einer Achse: `a`/`b` = Kennbuchstaben der Ränder (w/e bzw. n/s) */
const at = (k: string, a: string, b: string, lo: number, hi: number) => `${(k.includes(a) ? lo : k.includes(b) ? hi : (lo + hi) / 2) * 100}%`;

/**
 * Zuschnitt-Modus über einem Bild: Rand-/Eckgriffe, außerhalb abgedunkelt, dreht mit dem Bild.
 * ✓ / Enter / Klick daneben → `onDone(Ausschnitt)`, Esc → `onDone(null)`.
 */
export function CropBox({ item, zoom, onDone }: { item: Item; zoom: number; onDone: (f: Crop | null) => void }) {
  const [f, setF] = useState<Crop>([0, 0, 1, 1]);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ k: string; x: number; y: number; f: Crop }>(null);
  const b = box({ ...item, rot: 0 });
  const [W, H] = [(b.x1 - b.x0) * zoom, (b.y1 - b.y0) * zoom];
  const rad = ((item.rot ?? 0) * Math.PI) / 180;

  useEffect(() => {
    // Capture + stopPropagation: Esc/Enter sollen nicht zusätzlich Auswahl/Werkzeug von DocView ändern
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onDone(e.key === "Enter" ? f : null);
    };
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onDone(f);
    };
    addEventListener("keydown", key, true);
    addEventListener("pointerdown", outside, true);
    return () => {
      removeEventListener("keydown", key, true);
      removeEventListener("pointerdown", outside, true);
    };
  }, [f, onDone]);

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    // Bildschirm-Versatz ins ungedrehte Bild zurückdrehen
    const [dx, dy] = [e.clientX - d.x, e.clientY - d.y], [c, s] = [Math.cos(rad), Math.sin(rad)];
    setF(cropDrag(d.f, d.k, (dx * c + dy * s) / W, (-dx * s + dy * c) / H));
  };

  return (
    <div
      ref={root}
      className="absolute"
      style={{ left: ((b.x0 + b.x1) / 2) * zoom - W / 2, top: ((b.y0 + b.y1) / 2) * zoom - H / 2, width: W, height: H, transform: `rotate(${item.rot ?? 0}deg)` }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute" style={{ left: f[0] * W, top: f[1] * H, width: (f[2] - f[0]) * W, height: (f[3] - f[1]) * H, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.45)" }} />
      </div>
      <div className="pointer-events-none absolute border-2 border-accent" style={{ left: f[0] * W, top: f[1] * H, width: (f[2] - f[0]) * W, height: (f[3] - f[1]) * H }} />
      {HANDLES.map((k) => (
        <span key={k} data-crop={k}
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-xs border border-white bg-accent"
          style={{ left: at(k, "w", "e", f[0], f[2]), top: at(k, "n", "s", f[1], f[3]), cursor: `${HANDLE_CURSOR[k]}-resize`, touchAction: "none" }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { k, x: e.clientX, y: e.clientY, f };
          }}
          onPointerMove={move}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        />
      ))}
      <button
        type="button" title="Zuschneiden (Enter) – Esc bricht ab"
        className="absolute -translate-x-1/2 rounded-xs bg-accent px-2 text-sm text-white"
        style={{ left: `${((f[0] + f[2]) / 2) * 100}%`, top: `calc(${f[3] * 100}% + 8px)` }}
        onClick={() => onDone(f)}
      >✓</button>
    </div>
  );
}
