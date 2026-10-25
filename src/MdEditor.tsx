import { invoke } from "@tauri-apps/api/core";
import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { T } from "./i18n";
import { formulas } from "./math";
import { BTN as btn, IconBtn, on } from "./ui";

/** Markdown-Editor: Quelltext links, entprellte Satz-Vorschau rechts. Esc/Fertig übernimmt, Abbrechen verwirft. */
export function MdEditor({ title, source, onChange, onApply, onCancel }: {
  title: string; source: string; onChange: (s: string) => void; onApply: () => void; onCancel: () => void;
}) {
  const [preview, setPreview] = useState<{ url?: string; error?: string }>({});
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void (async () => {
        try {
          // ohne MathJax wie beim Übernehmen: Formeln roh als Code
          const fs = await formulas(source).catch(() => []);
          const buf = await invoke<ArrayBuffer>("markdown_preview", { source, formulas: fs, scale: 1.5 });
          if (live) setPreview({ url: URL.createObjectURL(new Blob([buf], { type: "image/png" })) });
        } catch (e) {
          if (live) setPreview((p) => ({ url: p.url, error: String(e) }));
        }
      })();
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [source]);
  useEffect(() => () => void (preview.url && URL.revokeObjectURL(preview.url)), [preview.url]);

  return (
    <div className="absolute inset-4 z-20 flex flex-col gap-2 rounded-xs border border-line bg-surface p-3">
      <div className="text-sm text-ink-2">
        {title} – # Überschrift, - Liste, &gt; Zitat, ``` Code, **fett**, *kursiv*, `Code`, [Link](https://…), | Tabelle |, $Formel$, $$Block$$
      </div>
      <div className="flex min-h-0 flex-1 gap-2">
        <textarea
          autoFocus
          value={source}
          aria-label="Markdown"
          spellCheck={false}
          className="min-w-0 flex-1 resize-none rounded-xs border border-line bg-sunken p-2 font-mono text-sm text-ink"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" && e.ctrlKey) || e.key === "Escape") {
              e.preventDefault();
              onApply();
            }
          }}
        />
        <div aria-label={T.preview} className="min-w-0 flex-1 overflow-auto rounded-xs border border-line bg-sunken p-2">
          {preview.error && <div role="alert" className="mb-2 text-sm text-red-400">{preview.error}</div>}
          {preview.url && <img src={preview.url} alt={T.preview} className="w-full bg-white" />}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <IconBtn icon={X} label={T.cancel} text onClick={onCancel} />
        <IconBtn icon={Check} label={T.done} keys="Esc" text className={btn + on(true)} onClick={onApply} />
      </div>
    </div>
  );
}
