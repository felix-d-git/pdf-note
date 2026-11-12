import { Eraser, Signature, Type } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { T } from "./i18n";
import { BTN, Dialog, IconBtn, on } from "./ui";
import { loadSign, type Sign } from "./settings";

/** Zeichenfeld in CSS-px; gespeichert wird in 3-facher Auflösung (bleibt beim Vergrößern scharf) */
const W = 560, H = 190, RES = 3;

/** Kleinstes Rechteck [x0, y0, x1, y1) um alle nicht transparenten Pixel (RGBA), `null` = leer */
export function inkBounds(data: ArrayLike<number>, w: number, h: number): [number, number, number, number] | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3]) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

/** Unterschrift bzw. Initialen einmal zeichnen; `onSave` mit PNG-Base64 (zugeschnitten) oder `undefined` = gelöscht */
export function SignPad({ kind: k0, onSave, onCancel }: {
  kind: keyof Sign; onSave: (kind: keyof Sign, b64: string | undefined) => void; onCancel: () => void;
}) {
  const [kind, setKind] = useState(k0);
  const [sign] = useState(loadSign);
  const cv = useRef<HTMLCanvasElement>(null);
  const last = useRef<[number, number] | null>(null);
  const ctx = () => cv.current?.getContext("2d") ?? null;

  // gespeicherte Fassung als Ausgangspunkt (mittig, Originalgröße)
  useEffect(() => {
    const c = ctx();
    if (!c) return;
    c.clearRect(0, 0, W * RES, H * RES);
    const b64 = sign[kind];
    if (!b64) return;
    const img = new Image();
    img.onload = () => c.drawImage(img, (W * RES - img.width) / 2, (H * RES - img.height) / 2);
    img.src = `data:image/png;base64,${b64}`;
  }, [kind, sign]);

  const at = (e: PointerEvent): [number, number] => {
    const r = cv.current?.getBoundingClientRect();
    return r ? [(e.clientX - r.left) * RES, (e.clientY - r.top) * RES] : [0, 0];
  };
  const line = (e: PointerEvent) => {
    const c = ctx(), a = last.current;
    if (!c || !a) return;
    const b = at(e);
    // Druck 0,5 = Maus → mittlere Breite
    c.lineWidth = RES * 2.4 * (0.5 + (e.pressure || 0.5));
    c.lineCap = c.lineJoin = "round";
    c.strokeStyle = "#111";
    c.beginPath();
    c.moveTo(...a);
    c.lineTo(...b);
    c.stroke();
    last.current = b;
  };

  function save() {
    const c = ctx();
    if (!c) return onCancel();
    const b = inkBounds(c.getImageData(0, 0, W * RES, H * RES).data, W * RES, H * RES);
    if (!b) return onSave(kind, undefined);
    const [x0, y0, x1, y1] = b;
    const out = document.createElement("canvas");
    out.width = x1 - x0;
    out.height = y1 - y0;
    out.getContext("2d")?.drawImage(c.canvas, -x0, -y0);
    onSave(kind, out.toDataURL("image/png").replace(/^data:image\/png;base64,/, ""));
  }

  return (
    <Dialog title={T.signEdit} ok={T.save} onOk={save} onCancel={onCancel} wide>
      <div className="flex gap-1">
        <IconBtn icon={Signature} label={T.sign} text className={BTN + on(kind === "sign")} onClick={() => setKind("sign")} aria-pressed={kind === "sign"} />
        <IconBtn icon={Type} label={T.initials} text className={BTN + on(kind === "initials")} onClick={() => setKind("initials")} aria-pressed={kind === "initials"} />
        <span className="flex-1" />
        <IconBtn icon={Eraser} label={T.signClear} text onClick={() => ctx()?.clearRect(0, 0, W * RES, H * RES)} />
      </div>
      {/* Seite ist immer weiß → Feld auch, damit die dunkle Tinte im Dunkelmodus sichtbar bleibt */}
      <canvas
        ref={cv} width={W * RES} height={H * RES} aria-label={kind === "sign" ? T.sign : T.initials}
        className="rounded-xs border border-line bg-white" style={{ width: W, height: H, touchAction: "none", cursor: "crosshair" }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          last.current = at(e.nativeEvent);
          line(e.nativeEvent); // Punkt
        }}
        onPointerMove={(e) => {
          if (!last.current) return;
          // Zwischenpunkte bei schneller Bewegung (wie beim Stift)
          for (const ev of e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]) line(ev);
        }}
        onPointerUp={() => (last.current = null)}
        onPointerCancel={() => (last.current = null)}
      />
      <div className="text-xs text-ink-2">{T.signHint}</div>
    </Dialog>
  );
}
