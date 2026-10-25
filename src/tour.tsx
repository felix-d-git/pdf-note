import {
  ArrowLeftRight, Check, ChevronLeft, ChevronRight, CircleHelp, Copy, FileText, FolderOpen, NotebookPen, Save, Scissors, SlidersHorizontal, Trash, X,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { T } from "./i18n";
import { LAYERS, TOOL_LABELS } from "./keys";
import { BTN, IconBtn, on } from "./ui";

const KEY = "pdfnote.tour";

/** Tour schon gesehen (gerätelokal) */
export function tourSeen() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // gesperrter Speicher: Tour kommt beim nächsten Start wieder
  }
}

/**
 * Start-Tour über einer eigenen Beispiel-Oberfläche (nur im Speicher, wird nie gespeichert).
 * Schritt i hebt das Element `[data-tour=i]` hervor; Ende oder Überspringen merkt „gesehen".
 */
export function Tour({ onEnd }: { onEnd: () => void }) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<DOMRect>();
  const ref = useRef<HTMLDivElement>(null);
  const steps = T.tour;
  const last = i === steps.length - 1;
  const end = () => {
    markSeen();
    onEnd();
  };

  useLayoutEffect(() => {
    const measure = () => setBox(ref.current?.querySelector(`[data-tour="${i}"]`)?.getBoundingClientRect());
    measure();
    ref.current?.focus();
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  }, [i]);

  const [title, text] = steps[i] ?? ["", ""];
  const pad = 6;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal
      aria-label={T.tourStart}
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg p-8 text-sm text-ink outline-none"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") end();
        else if (e.target instanceof HTMLTextAreaElement) return;
        else if (e.key === "ArrowRight" || e.key === "Enter") {
          if (last) end();
          else setI(i + 1);
        }
        else if (e.key === "ArrowLeft") setI(Math.max(0, i - 1));
      }}
    >
      {/* Beispiel-Oberfläche: nur Attrappe, keine echten Aktionen */}
      <div className="flex h-full max-h-[640px] w-full max-w-4xl flex-col overflow-hidden rounded-sm border border-line bg-surface shadow-raised">
        <div className="flex items-center gap-1 border-b border-line p-1">
          <div data-tour="0" className="flex items-center gap-1">
            <span className={BTN}><FolderOpen size={18} /></span>
            <span className={BTN}><NotebookPen size={18} /></span>
            <span className={BTN + on(true) + " px-3"}><FileText size={16} />{T.sampleFile}</span>
          </div>
          <span className="flex-1" />
          <span data-tour="6" className={BTN}><CircleHelp size={18} /></span>
        </div>
        <div className="flex items-center gap-1 border-b border-line p-1">
          <div data-tour="1" className="flex items-center gap-0.5">
            <span className={BTN + on(true)}><ArrowLeftRight size={18} /></span>
            {TOOL_LABELS.map(([t, I]) => <span key={t} className={BTN + on(t === "lasso")}><I size={18} /></span>)}
          </div>
          <div data-tour="2" className="ml-2 flex items-center gap-0.5 border-l border-line pl-2">
            {LAYERS.map(([l, I]) => <span key={l} className={BTN + on(l === 3)}><I size={18} /></span>)}
          </div>
          <span className="flex-1" />
          <span data-tour="5" className={BTN}><Save size={18} /></span>
        </div>
        <div className="flex min-h-0 flex-1 justify-center overflow-hidden bg-sunken p-6">
          <div className="relative aspect-[1/1.414] h-full bg-white p-8 text-neutral-800 shadow-raised">
            <p className="mb-4 font-semibold">{T.tour[0]?.[0]}</p>
            <textarea data-tour="3" aria-label={T.sample} placeholder={T.sample} className="h-16 w-full resize-none bg-transparent outline-none" />
            <div data-tour="4" className="relative mt-16 w-48">
              <div className="absolute -top-10 left-0 flex gap-0.5 rounded-xs border border-line bg-surface p-0.5 text-ink shadow-raised">
                {[Copy, Scissors, Trash, SlidersHorizontal].map((I, k) => <span key={k} className={BTN}><I size={16} /></span>)}
              </div>
              <div className="h-16 border border-dashed border-accent" />
            </div>
          </div>
        </div>
      </div>
      {box && (
        <div
          className="pointer-events-none fixed rounded-sm ring-2 ring-accent transition-all"
          style={{ left: box.left - pad, top: box.top - pad, width: box.width + 2 * pad, height: box.height + 2 * pad, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.45)" }}
        />
      )}
      <div
        className="fixed w-80 rounded-sm border border-line bg-surface p-3 shadow-raised"
        style={box ? { left: Math.min(Math.max(8, box.left), innerWidth - 328), top: box.bottom + 160 > innerHeight ? box.top - 160 : box.bottom + 12 } : undefined}
      >
        <p className="mb-1 font-semibold">{title} <span className="font-normal text-ink-3">{i + 1}/{steps.length}</span></p>
        <p className="mb-2 text-ink-2">{text}</p>
        <div className="flex justify-end gap-1">
          <IconBtn icon={X} label={T.tourSkip} onClick={end} />
          <span className="flex-1" />
          <IconBtn icon={ChevronLeft} label={T.tourBack} disabled={i === 0} onClick={() => setI(i - 1)} />
          {last
            ? <IconBtn icon={Check} label={T.tourDone} className={BTN + on(true)} onClick={end} />
            : <IconBtn icon={ChevronRight} label={T.tourNext} className={BTN + on(true)} onClick={() => setI(i + 1)} />}
        </div>
      </div>
    </div>
  );
}
