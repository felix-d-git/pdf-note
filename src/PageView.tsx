import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type RefObject } from "react";
import { drawStrokes, normPressure, type InkPoint, type Preset, type Stroke } from "./ink";

/**
 * Rendert die Seite nur, solange sie (± eine Bildschirmhöhe) sichtbar ist; sonst Bild freigeben.
 * Zoomwechsel: altes Bild wird per CSS gestreckt, Neu-Render gedrosselt.
 */
function usePageImage(ref: RefObject<HTMLElement | null>, index: number, scale: number, version: number) {
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
        const buf = await invoke<ArrayBuffer>("render_page", { index, scale });
        if (alive) setUrl(URL.createObjectURL(new Blob([buf], { type: "image/png" })));
      } catch (e) {
        console.error(e);
      }
    }, visible ? 120 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [visible, index, scale, version]);

  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return [url, visible] as const;
}

export function Thumb({ index, size, version, active, onClick }: {
  index: number; size: [number, number]; version: number; active: boolean; onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const w = 120;
  const [url] = usePageImage(ref, index, (w / size[0]) * devicePixelRatio, version);
  return (
    <button ref={ref} onClick={onClick} className="flex flex-col items-center gap-1 text-xs text-ink-3">
      <span
        className={`block rounded-xs bg-white ring-2 ${active ? "ring-accent" : "ring-transparent"}`}
        style={{ width: w, height: (w * size[1]) / size[0] }}
      >
        {url && <img src={url} alt="" className="h-full w-full rounded-xs" />}
      </span>
      {index + 1}
    </button>
  );
}

const HOLD_MS = 500;
const straighten = (s: Stroke, x: number, y: number) => {
  s.points = s.points.slice(0, 1).flatMap((a) => [a, [x, y, a[2]] as InkPoint]);
};
const HOLD_TOL = 2; // pt Bewegung, die das Ruhen nicht unterbricht

export function PageView({ index, size, zoom, version, strokes, preset, onStroke }: {
  index: number; size: [number, number]; zoom: number; version: number;
  strokes: Stroke[]; preset: Preset; onStroke: (s: Stroke) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cur = useRef<Stroke | null>(null);
  const hold = useRef<{ x: number; y: number; timer: number; straight: boolean }>(null);
  const [url, visible] = usePageImage(ref, index, zoom * devicePixelRatio, version);
  const [w, h] = [size[0] * zoom, size[1] * zoom];

  const redraw = () => {
    const ctx = canvas.current?.getContext("2d");
    if (ctx) drawStrokes(ctx, cur.current ? [...strokes, cur.current] : strokes, zoom);
  };
  useEffect(redraw);

  const pt = (e: PointerEvent | React.PointerEvent): InkPoint => {
    const r = e.currentTarget instanceof Element ? e.currentTarget.getBoundingClientRect() : canvas.current?.getBoundingClientRect() ?? new DOMRect();
    return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom, e.pointerType === "pen" ? normPressure(e.pressure) : 0.5];
  };

  // Shape-Hold: Stift ruht ≥ 500 ms → Strich wird zur geraden Linie vom Anfang bis zur Ruhestelle
  const armHold = (x: number, y: number) => {
    const hd = hold.current;
    if (!hd) return;
    clearTimeout(hd.timer);
    Object.assign(hd, { x, y, timer: setTimeout(() => {
      const s = cur.current;
      if (!s || s.points.length < 3) return;
      hd.straight = true;
      straighten(s, hd.x, hd.y);
      redraw();
    }, HOLD_MS) });
  };

  // Stift-Spitze (buttons 1) und linke Maustaste zeichnen; Finger geht an den Scroll-Container.
  const down = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" || e.buttons !== 1) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pt(e);
    cur.current = { page: index, color: preset.color, opacity: 1, size: preset.size, simulated: e.pointerType !== "pen", points: [p] };
    hold.current = { x: p[0], y: p[1], timer: 0, straight: false };
    armHold(p[0], p[1]);
  };
  const move = (e: React.PointerEvent) => {
    const s = cur.current, hd = hold.current;
    if (!s || !hd) return;
    for (const c of e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]) {
      const p = pt(c);
      if (hd.straight) straighten(s, p[0], p[1]);
      else {
        s.points.push(p);
        if (Math.hypot(p[0] - hd.x, p[1] - hd.y) > HOLD_TOL) armHold(p[0], p[1]);
      }
    }
    requestAnimationFrame(redraw);
  };
  const up = () => {
    const s = cur.current;
    if (hold.current) clearTimeout(hold.current.timer);
    cur.current = hold.current = null;
    if (s) onStroke(s);
  };

  return (
    <div ref={ref} data-page={index} className="relative mx-auto bg-white shadow-raised" style={{ width: w, height: h }}>
      {url && <img src={url} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none" />}
      {/* Canvas nur für sichtbare Seiten: volle Auflösung je Seite kostet sonst bei hohem Zoom zu viel Speicher */}
      {visible && <canvas
        ref={canvas}
        width={Math.round(w * devicePixelRatio)}
        height={Math.round(h * devicePixelRatio)}
        className="absolute inset-0 h-full w-full"
        style={{ touchAction: "none" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onContextMenu={(e) => e.preventDefault()}
      />}
    </div>
  );
}
