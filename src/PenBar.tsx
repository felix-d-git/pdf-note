import { useEffect, useRef, useState } from "react";
import { Highlighter, Pen as PenIcon, Plus, Trash } from "lucide-react";
import { ColorPicker } from "./ColorPicker";
import { T } from "./i18n";
import { DEFAULT_PENS, type Pen, type Rgb } from "./ink";
import { QUICK } from "./keys";
import { movePen } from "./settings";
import { BTN as btn, Dialog, IconBtn, on } from "./ui";

const rgb = (c: Rgb) => `rgb(${c.map((v) => v * 255).join(",")})`;
const max = (k: Pen["kind"]) => (k === "marker" ? 40 : 20);

/** Farbe + Breite mit Probestrich; jede Änderung wirkt sofort */
function PenForm({ pen, onChange }: { pen: Pen; onChange: (p: Pen) => void }) {
  return (
    <>
      <ColorPicker value={pen.color} onPreview={(c) => c && onChange({ ...pen, color: c })} onCommit={(c) => c && onChange({ ...pen, color: c })} />
      <label className="flex flex-col gap-1 text-sm text-ink-2">
        {T.size} <span className="font-mono text-xs text-ink">{pen.size.toFixed(1)}</span>
        <input type="range" aria-label={T.size} className="accent-accent" min={0.5} max={max(pen.kind)} step={0.1} value={pen.size}
          onChange={(e) => onChange({ ...pen, size: Number(e.target.value) })} />
      </label>
      <svg width="100%" height="44" viewBox="0 0 200 44" aria-hidden className="rounded-xs bg-white">
        <path d="M10 30 C 50 6, 90 40, 130 18 S 180 14, 190 22" fill="none" stroke={rgb(pen.color)} strokeWidth={pen.size} strokeLinecap="round"
          opacity={pen.kind === "marker" ? 0.4 : 1} />
      </svg>
    </>
  );
}

/**
 * Leiste nur aus Stiften (Spitze) und Markern (Balken): Klick wählt, Rechtsklick öffnet Farbe/Breite/Entfernen,
 * „+“ legt einen neuen an, Ziehen ordnet um. `act` = aktiv für Maus bzw. Stift (Rahmen bzw. Punkt bei `auto`).
 */
export function PenBar({ pens, auto, act, onPick, onEdit, onPens }: {
  pens: Pen[]; auto: boolean; act: (p: Pen, dev: "mouse" | "pen") => boolean;
  onPick: (p: Pen, dev: "mouse" | "pen") => void; onEdit: (old: Pen, next: Pen | null) => void; onPens: (list: Pen[]) => void;
}) {
  const [open, setOpen] = useState<number>();
  const [add, setAdd] = useState<Pen>();
  const drag = useRef<number>(undefined);
  const pop = useRef<HTMLDivElement>(null);
  // Klick daneben schließt (Änderungen sind schon übernommen)
  useEffect(() => {
    if (open === undefined) return;
    const off = (e: PointerEvent) => !pop.current?.contains(e.target as Node) && setOpen(undefined);
    document.addEventListener("pointerdown", off, true);
    return () => document.removeEventListener("pointerdown", off, true);
  }, [open]);
  const edit = (i: number, next: Pen | null) => {
    const old = pens[i];
    if (!old) return;
    onEdit(old, next);
    onPens(next ? pens.map((p, k) => (k === i ? next : p)) : pens.filter((_, k) => k !== i));
    if (!next) setOpen(undefined);
  };
  const nth = pens.map((p, i) => pens.slice(0, i).filter((q) => q.kind === p.kind).length);
  return (
    <span className="relative inline-flex items-center gap-0.5" title={T.penHint}>
      {pens.map((p, i) => {
        const q = QUICK.find(([k, n]) => k === p.kind && n === nth[i]);
        return (
          <IconBtn
            key={i}
            icon={p.kind === "pen" ? PenIcon : Highlighter}
            label={q?.[2] ?? (p.kind === "pen" ? T.pen : T.marker)}
            keys={q?.[3]}
            draggable
            onDragStart={() => (drag.current = i)}
            onDragEnd={() => (drag.current = undefined)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (drag.current !== undefined) onPens(movePen(pens, drag.current, i));
              drag.current = undefined;
            }}
            className={`${btn} relative${auto ? (act(p, "mouse") ? " ring-1 ring-inset ring-accent text-ink" : "") : on(act(p, "mouse"))}`}
            style={{ color: rgb(p.color) }}
            onClick={(e) => onPick(p, (e.nativeEvent as PointerEvent).pointerType === "pen" ? "pen" : "mouse")}
            onContextMenu={(e) => {
              e.preventDefault();
              setOpen(i);
            }}
          >
            {auto && act(p, "pen") && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-pill bg-accent" aria-label={T.penMark} />}
          </IconBtn>
        );
      })}
      <IconBtn icon={Plus} label={T.penAdd} className={`${btn} px-1`} onClick={() => setAdd({ kind: "pen", color: [0.07, 0.07, 0.07], size: 2.2 })} />
      {open !== undefined && pens[open] && (
        <div ref={pop} role="dialog" aria-label={T.style} className="absolute left-0 top-full z-30 mt-1 flex w-60 flex-col gap-2 rounded-sm border border-line bg-surface p-3 shadow-raised">
          <PenForm pen={pens[open]} onChange={(n) => edit(open, n)} />
          <IconBtn icon={Trash} label={T.penRemove} text onClick={() => edit(open, null)} />
        </div>
      )}
      {add && (
        <Dialog title={T.penAdd} ok="OK" onCancel={() => setAdd(undefined)} onOk={() => {
          onPens([...pens, add]);
          onPick(add, "mouse");
          setAdd(undefined);
        }}>
          <div className="flex gap-1">
            {(["pen", "marker"] as const).map((k) => (
              <button key={k} type="button" className={btn + on(add.kind === k)}
                onClick={() => setAdd({ ...add, kind: k, size: DEFAULT_PENS.find((p) => p.kind === k)?.size ?? add.size })}>{k === "pen" ? T.pen : T.marker}</button>
            ))}
          </div>
          <PenForm pen={add} onChange={setAdd} />
        </Dialog>
      )}
    </span>
  );
}
