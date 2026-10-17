import { Check, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { T, tip } from "./i18n";

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

/** Passwort wie im Backend: 1–127 Byte (MuPDF-Grenze), kein Nullzeichen; `repeat` = zweite Eingabe. */
export const pwProblem = (pw: string, repeat = pw) =>
  !pw || pw.includes("\0") || new TextEncoder().encode(pw).length > 127 ? T.pwRule : pw !== repeat ? T.pwMismatch : undefined;

/** Modaler Dialog: Enter = `onOk`, Esc = `onCancel`; Tasten erreichen die Fenster-Kürzel nicht (kein Strg+W darunter). */
export function Dialog({ title, ok, onOk, onCancel, children }: { title: string; ok: string; onOk: () => void; onCancel: () => void; children: ReactNode }) {
  const ref = useRef<HTMLFormElement>(null);
  // Fokus in den Dialog, sonst wirken Esc/Enter nicht und Tasten landen bei den Fenster-Kürzeln
  useEffect(() => {
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
  }, []);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
      <form
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal
        aria-label={title}
        className="flex w-80 flex-col gap-2 rounded-xs border border-line bg-surface p-3 text-sm text-ink shadow-raised outline-none"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onCancel();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          onOk();
        }}
      >
        <div className="font-semibold">{title}</div>
        {children}
        <div className="flex justify-end gap-2">
          <IconBtn icon={X} label={T.cancel} keys="Esc" text onClick={onCancel} />
          <IconBtn type="submit" icon={Check} label={ok} keys="Enter" text className={BTN + on(true)} />
        </div>
      </form>
    </div>
  );
}

export const FIELD = "rounded-xs border border-line bg-sunken px-2 py-1 text-ink";
