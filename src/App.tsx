import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { DocView, PageState, toSnap, type DocApi, type Snap } from "./DocView";
import { captureBinding, describe, loadSettings, storeSettings, type Settings } from "./settings";
import {
  activeId, closeTab, cycle, EMPTY_TABS, focus, moveTab, openTab, samePath, setDirty, show, toggleSplit, type Pane, type Tab,
} from "./tabs";

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export default function App() {
  const [state, setState] = useState(EMPTY_TABS);
  const [inits, setInits] = useState(new Map<number, Snap>());
  const [ratio, setRatio] = useState(0.5);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [capture, setCapture] = useState<"lasso" | "eraser">();
  const [error, setError] = useState<string>();
  const [drop, setDrop] = useState<{ from: number; to: number }>();
  const nextId = useRef(1);
  const opening = useRef<string[]>([]);
  const [apis] = useState(() => new Map<number, DocApi>());
  const split = useRef<HTMLDivElement>(null);
  const tabDrag = useRef<{ from: number; x: number; moved: boolean }>(null);

  const { tabs, panes } = state;
  const current = tabs.find((t) => t.id === activeId(state));
  // Für Listener, die nur einmal registriert werden
  const live = useRef<{ tabs: Tab[]; openPath: (p: string) => Promise<void>; confirmLeave: (t: Tab) => Promise<boolean> }>({
    tabs, openPath: async () => {}, confirmLeave: async () => true,
  });

  const onDirty = useCallback((id: number, dirty: boolean) => setState((s) => setDirty(s, id, dirty)), []);

  /** true = weitermachen (gespeichert oder verworfen), false = abbrechen */
  async function confirmLeave(t: Tab) {
    if (!t.dirty) return true;
    const r = await message(`„${fileName(t.path)}" hat ungespeicherte Änderungen. Speichern?`, {
      title: "PDF Note", kind: "warning", buttons: { yes: "Speichern", no: "Verwerfen", cancel: "Abbrechen" },
    });
    if (r === "Speichern") return (apis.get(t.id)?.save() ?? Promise.resolve()).then(() => true, () => false);
    return r === "Verwerfen";
  }

  async function close(t: Tab) {
    if (!(await confirmLeave(t))) return;
    setState((s) => closeTab(s, t.id));
    setInits((m) => {
      const n = new Map(m);
      n.delete(t.id);
      return n;
    });
    void invoke("close_pdf", { id: t.id });
  }

  async function openPath(p: string) {
    const hit = live.current.tabs.find((t) => samePath(t.path, p));
    if (hit) return setState((s) => show(s, hit.id));
    // gleiche Datei kurz nacheinander (Start-Pfad + Drop) → nur einmal öffnen
    if (opening.current.some((o) => samePath(o, p))) return;
    opening.current.push(p);
    const id = nextId.current++;
    try {
      const snap = toSnap(PageState.parse(await invoke("open_pdf", { id, path: p })));
      setInits((m) => new Map(m).set(id, snap));
      setState((s) => openTab(s, id, p));
      setError(undefined);
    } catch (e) {
      setError(`Öffnen fehlgeschlagen: ${String(e)}`);
    } finally {
      opening.current = opening.current.filter((o) => o !== p);
    }
  }

  async function pickFile() {
    const p = await openDialog({ filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (typeof p === "string") await openPath(p);
  }

  /** Neue Notiz-PDF (eine leere A4-Seite) anlegen und öffnen. */
  async function newFile() {
    let p;
    try {
      p = await saveDialog({ defaultPath: "Notizen.pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (!p) return;
      await invoke("new_pdf", { path: p });
    } catch (e) {
      return setError(`Anlegen fehlgeschlagen: ${String(e)}`);
    }
    await openPath(p);
  }

  const updateSettings = (s: Settings) => {
    setSettings(s);
    storeSettings(s);
  };

  useEffect(() => {
    live.current = { tabs, openPath, confirmLeave };
  });

  // Titel mit * bei ungespeicherten Änderungen (aktiver Tab)
  useEffect(() => {
    void getCurrentWindow().setTitle(`${current?.dirty ? "* " : ""}${current ? `${fileName(current.path)} – ` : ""}PDF Note`);
  }, [current]);

  // Einmalig: „Öffnen mit" (auch bei laufender App), Drag & Drop, Beenden fragt für jedes ungespeicherte Dokument
  useEffect(() => {
    void invoke<string | null>("startup_path").then((p) => {
      if (p) void live.current.openPath(p);
    });
    const un = [
      // zweiter Start (Explorer-Doppelklick) bei laufender App → Pfad kommt von dort
      listen<string>("open-path", (e) => void live.current.openPath(e.payload)),
      getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type !== "drop") return;
        for (const p of e.payload.paths.filter((x) => x.toLowerCase().endsWith(".pdf"))) void live.current.openPath(p);
      }),
      getCurrentWindow().onCloseRequested(async (e) => {
        for (const t of live.current.tabs) {
          if (!(await live.current.confirmLeave(t))) return e.preventDefault();
        }
      }),
    ];
    return () => un.forEach((u) => void u.then((f) => f()));
    // liest alles über live.current
  }, []);

  // Stifttaste lernen: nächstes Ereignis mit gedrückter Zusatztaste
  useEffect(() => {
    if (!capture) return;
    const on = (e: PointerEvent) => {
      const b = captureBinding(e);
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      updateSettings({ ...settings, [capture]: b });
      setCapture(undefined);
    };
    window.addEventListener("pointerdown", on, true);
    window.addEventListener("pointermove", on, true);
    return () => {
      window.removeEventListener("pointerdown", on, true);
      window.removeEventListener("pointermove", on, true);
    };
  });

  // Tastatur: Strg+O, Strg+W, Strg+(Umschalt+)Tab; dokumentbezogene Tasten in DocView
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      const k = e.key.toLowerCase();
      const act: Record<string, () => void> = {
        o: () => void pickFile(),
        w: () => void (current && close(current)),
        tab: () => setState((s) => cycle(s, e.shiftKey ? -1 : 1)),
      };
      const f = act[k];
      if (f) {
        e.preventDefault();
        f();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Tabs per Zeiger umsortieren (wie Vorschaubilder: HTML5-Drag&Drop geht in Tauri bei aktivem Datei-Drop nicht)
  const tabDown = (i: number) => (e: React.PointerEvent) => {
    if (e.buttons === 1) tabDrag.current = { from: i, x: e.clientX, moved: false };
  };
  const barMove = (e: React.PointerEvent) => {
    const d = tabDrag.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.x) > 6) {
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (!d.moved) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-tab]");
    setDrop(el ? { from: d.from, to: Number(el.dataset.tab) } : undefined);
  };
  const barUp = () => {
    const d = tabDrag.current;
    tabDrag.current = null;
    if (d?.moved && drop && drop.to !== d.from) setState((s) => moveTab(s, d.from, drop.to));
    setDrop(undefined);
  };

  // Trennlinie ziehen
  const dividerMove = (e: React.PointerEvent) => {
    const r = split.current?.getBoundingClientRect();
    if (!r || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    setRatio(Math.min(0.8, Math.max(0.2, (e.clientX - r.left) / r.width)));
  };

  const paneOf = (id: number): Pane | undefined =>
    panes[0] === id ? 0 : state.split && panes[1] === id ? 1 : undefined;
  const paneStyle = (p: Pane) => ({ order: p * 2, flex: state.split ? `${p === 0 ? ratio : 1 - ratio} 1 0` : "1 1 0" });

  const btn = "rounded-xs px-2.5 py-1 text-sm text-ink-2 hover:bg-raised hover:text-ink disabled:opacity-40";
  const on = (b: boolean) => (b ? " bg-accent-soft text-ink" : "");

  return (
    <div className="flex h-full flex-col">
      <header className="relative flex items-center gap-1 border-b border-line bg-sunken px-2 py-1">
        <button className={btn} onClick={() => void newFile()} title="Neue Notiz-PDF anlegen">Neu</button>
        <button className={btn} onClick={() => void pickFile()} title="Strg+O">Öffnen</button>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto" onPointerMove={barMove} onPointerUp={barUp} onPointerCancel={barUp}>
          {tabs.map((t, i) => {
            const p = paneOf(t.id);
            const mark = drop?.to === i && i !== drop.from ? (i < drop.from ? " border-l-accent" : " border-r-accent") : "";
            return (
              <div
                key={t.id}
                data-tab={i}
                title={t.path}
                onPointerDown={tabDown(i)}
                onClick={() => setState((s) => show(s, t.id))}
                className={`flex shrink-0 cursor-default items-center gap-1 rounded-xs border-2 border-transparent py-0.5 pr-1 pl-2.5 text-sm select-none ${
                  p === state.active ? "bg-raised text-ink" : p !== undefined ? "bg-surface text-ink-2" : "text-ink-2 hover:bg-surface"
                }${mark}`}
              >
                <span className="max-w-48 truncate">{t.dirty && <span className="text-accent">* </span>}{fileName(t.path)}</span>
                <button
                  className="rounded-xs px-1 text-ink-3 hover:bg-line hover:text-ink"
                  title="Schließen (Strg+W)"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    void close(t);
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <button className={btn + on(state.split)} onClick={() => setState(toggleSplit)} title="Fenster teilen: zwei PDFs nebeneinander">Teilen</button>
        <button className={btn + on(settings.auto)} aria-pressed={settings.auto} onClick={() => updateSettings({ ...settings, auto: !settings.auto })}
          title={`Automatisch wechseln: Stift zeichnet mit dem Stift-Werkzeug (Punkt), Maus wählt aus und tippt (Rahmen) – ${settings.auto ? "an" : "aus"}`}>⇄</button>
        <button className={btn + on(showSettings)} onClick={() => setShowSettings((s) => !s)} title="Stifttasten und Druck">Stift …</button>
        {error && <span className="text-sm text-red-400">{error}</span>}
        {showSettings && (
          <div className="absolute top-full right-3 z-10 mt-1 flex w-80 flex-col gap-3 rounded-sm border border-line bg-raised p-4 text-sm text-ink-2 shadow-raised">
            {(["lasso", "eraser"] as const).map((k) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <span>{k === "lasso" ? "Auswahl" : "Radierer"}: <span className="font-mono text-xs text-ink">{describe(settings[k])}</span></span>
                <button className={btn + on(capture === k)} onClick={() => setCapture(capture === k ? undefined : k)}>
                  {capture === k ? "Taste jetzt drücken …" : "Ändern"}
                </button>
              </div>
            ))}
            <label className="flex flex-col gap-1">
              Druck-Maximum: <span className="font-mono text-xs text-ink">{settings.pressureMax.toFixed(2)}</span>
              <input
                type="range" min={0.3} max={1} step={0.05} value={settings.pressureMax}
                onChange={(e) => updateSettings({ ...settings, pressureMax: Number(e.target.value) })}
                className="accent-accent"
              />
            </label>
          </div>
        )}
      </header>
      {/* Alle Dokumente bleiben gemountet (eigener Undo/Zoom/Scroll); Position per CSS-order, damit
          Wechsel zwischen den Hälften nichts neu mountet. */}
      <div ref={split} className="flex min-h-0 flex-1">
        {tabs.map((t) => {
          const p = paneOf(t.id);
          const init = inits.get(t.id);
          return init && (
            <DocView
              key={t.id}
              id={t.id}
              path={t.path}
              init={init}
              visible={p !== undefined}
              active={p === state.active}
              marked={state.split && p === state.active}
              settings={settings}
              style={paneStyle(p ?? 0)}
              apis={apis}
              onDirty={onDirty}
              onFocus={() => p !== undefined && setState((s) => focus(s, p))}
            />
          );
        })}
        {([0, 1] as const).filter((p) => (p === 0 || state.split) && panes[p] === undefined).map((p) => (
          <div
            key={`leer-${p}`}
            style={paneStyle(p)}
            onPointerDownCapture={() => setState((s) => focus(s, p))}
            className={`grid min-w-0 place-items-center border-t-2 text-center text-ink-2 ${state.split && state.active === p ? "border-accent" : "border-transparent"}`}
          >
            <p>
              Keine PDF geöffnet
              <br />
              <span className="text-sm text-ink-3">Strg+O oder Datei hierher ziehen</span>
            </p>
          </div>
        ))}
        {state.split && (
          <div
            className="w-1.5 shrink-0 cursor-col-resize bg-line hover:bg-accent"
            style={{ order: 1, touchAction: "none" }}
            title="Trennlinie verschieben"
            onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
            onPointerMove={dividerMove}
          />
        )}
      </div>
    </div>
  );
}
