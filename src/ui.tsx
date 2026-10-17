import type { LucideIcon } from "lucide-react";
import { useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { tip } from "./i18n";

export const BTN = "inline-flex items-center gap-1.5 rounded-xs p-1.5 text-sm text-ink-2 hover:bg-raised hover:text-ink disabled:opacity-40";
export const on = (b: boolean) => (b ? " bg-accent-soft text-ink" : "");

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; keys?: string; text?: boolean };

/** Symbol-Knopf: Tooltip „Name (Taste)", aria-label = Name; `text` zeigt den Namen zusätzlich (Menüs, Dialoge). */
export function IconBtn({ icon: I, label, keys, text, className = BTN, children, ...p }: Props) {
  return (
    <button type="button" title={tip(label, keys)} aria-label={label} className={className} {...p}>
      <I size={16} aria-hidden />
      {text && label}
      {children}
    </button>
  );
}

/** Aufklappmenü hinter einem Symbol; Klick auf einen Eintrag mit `data-close` schließt es. */
export function Menu({ icon: I, label, keys, panel = "min-w-44 p-1", children }: { icon: LucideIcon; label: string; keys?: string; panel?: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details
      ref={ref}
      className="relative"
      onClick={(e) => (e.target as HTMLElement).closest("[data-close]") && ref.current?.removeAttribute("open")}
    >
      <summary className={BTN + " list-none cursor-pointer"} title={tip(label, keys)} aria-label={label}>
        <I size={16} aria-hidden />
      </summary>
      <div className={`absolute left-0 top-full z-20 mt-1 flex flex-col gap-1 rounded-xs border border-line bg-surface text-sm shadow-lg ${panel}`}>
        {children}
      </div>
    </details>
  );
}

export const MenuItem = (p: Omit<Props, "text">) => <IconBtn data-close text className={BTN + " w-full px-2"} {...p} />;
