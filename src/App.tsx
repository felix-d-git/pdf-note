import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  afterDelete, afterInsert, afterMove, afterRotate, DEFAULT_PRESET, fromData, ItemData, MARKERS, moveItem, newId,
  PRESETS, toData, type Item, type Preset,
} from "./ink";
import { PageView, Thumb } from "./PageView";
import { captureBinding, describe, loadSettings, storeSettings, type Settings, type Tool } from "./settings";

const Sizes = z.array(z.tuple([z.number().positive(), z.number().positive()])).min(1);
const PageState = z.object({
  sizes: Sizes, rev: z.number().int().nonnegative(), inserted: z.number().int().nonnegative(), items: z.array(ItemData),
});
const clampZoom = (z: number) => Math.min(6, Math.max(0.2, z));
const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const A4: [number, number] = [595, 842];

/** Ein Stand für Undo/Redo: Objekte + Seitenstand im Backend (rev) + Seitengrößen. */
interface Snap { items: Item[]; rev: number; sizes: [number, number][] }
interface History { list: Snap[]; at: number }
const HISTORY_MAX = 200;
const EMPTY: Snap = { items: [], rev: 0, sizes: [] };
const push = (h: History, s: Snap): History => {
  const list = [...h.list.slice(0, h.at + 1), s].slice(-HISTORY_MAX);
  return { list, at: list.length - 1 };
};

const TOOL_LABELS: [Tool, string, string][] = [
  ["pen", "Stift", "Stift"], ["marker", "Marker", "Textmarker"], ["eraser", "Radierer", "Radierer (nur eigene Objekte)"],
  ["lasso", "Lasso", "Auswählen, Verschieben, Skalieren"], ["text", "Text", "Textfeld"], ["line", "╱", "Linie"],
  ["arrow", "→", "Pfeil"], ["rect", "▭", "Rechteck"], ["ellipse", "◯", "Kreis/Ellipse"],
];

export default function App() {
  const [path, setPath] = useState<string>();
  const [hist, setHist] = useState<History>({ list: [EMPTY], at: 0 });
  const [saved, setSaved] = useState<Snap>(EMPTY);
  const [version, setVersion] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<Tool>("pen");
  const [preset, setPreset] = useState<Preset>(DEFAULT_PRESET);
  const [marker, setMarker] = useState<Preset>(MARKERS[0] ?? DEFAULT_PRESET);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [capture, setCapture] = useState<"lasso" | "eraser">();
  const [selection, setSelection] = useState<{ page: number; ids: number[] }>({ page: -1, ids: [] });
  const [current, setCurrent] = useState(0);
  const [jump, setJump] = useState("");
  const [error, setError] = useState<string>();
  const [drop, setDrop] = useState<{ from: number; to: number }>();
  const scroller = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const clip = useRef<Item[]>([]);
  const thumbDrag = useRef<{ from: number; x: number; y: number; moved: boolean }>(null);

  const snap = hist.list[hist.at] ?? EMPTY;
  const { items, sizes } = snap;
  const dirty = !!path && snap !== saved;
  const selItems = items.filter((it) => it.page === selection.page && selection.ids.includes(it.id));
  // Für Listener, die nur einmal registriert werden
  const live = useRef<{ dirty: boolean; save: () => Promise<void>; openPath: (p: string) => Promise<void> }>({
    dirty, save: async () => {}, openPath: async () => {},
  });

  const edit = (f: (items: Item[]) => Item[]) =>
    setHist((h) => {
      const s = h.list[h.at] ?? EMPTY;
      return push(h, { ...s, items: f(s.items) });
    });
  const clearSel = () => setSelection({ page: -1, ids: [] });

  async function save() {
    // während Seitenoperation/Undo passen die Objekte nicht zum Seitenstand im Backend
    if (!path || !dirty || busy.current) return;
    const s = snap;
    try {
      await invoke("save_pdf", { items: s.items.map(toData), target: null, flat: false });
      setSaved(s);
      setError(undefined);
    } catch (e) {
      setError(`Speichern fehlgeschlagen: ${String(e)}`);
      throw e;
    }
  }

  /** Speichern unter, flach: Objekte eingebrannt, nicht mehr bearbeitbar. Weitergearbeitet wird an der offenen PDF. */
  async function saveAs() {
    if (!path || busy.current) return;
    const target = await saveDialog({ filters: [{ name: "PDF", extensions: ["pdf"] }], defaultPath: path.replace(/\.pdf$/i, "") + "-flach.pdf" });
    if (!target) return;
    // flach über die offene Datei: eigene Objekte wären danach doppelt (eingebrannt + noch im Speicher)
    if (target.toLowerCase() === path.toLowerCase()) return setError("Flach nicht über die offene Datei speichern – anderen Namen wählen");
    try {
      await invoke("save_pdf", { items: items.map(toData), target, flat: true });
      setError(undefined);
    } catch (e) {
      setError(`Speichern unter fehlgeschlagen: ${String(e)}`);
    }
  }

  /** true = weitermachen (gespeichert oder verworfen), false = abbrechen */
  async function confirmLeave() {
    if (!live.current.dirty) return true;
    const r = await message("Ungespeicherte Änderungen speichern?", {
      title: "PDF Note", kind: "warning", buttons: { yes: "Speichern", no: "Verwerfen", cancel: "Abbrechen" },
    });
    if (r === "Speichern") return live.current.save().then(() => true, () => false);
    return r === "Verwerfen";
  }

  async function openPath(p: string) {
    if (!(await confirmLeave())) return;
    try {
      const r = PageState.parse(await invoke("open_pdf", { path: p }));
      const s: Snap = { items: r.items.map(fromData), rev: r.rev, sizes: r.sizes };
      const width = (scroller.current?.clientWidth ?? 800) - 48;
      setPath(p);
      setHist({ list: [s], at: 0 });
      setSaved(s);
      clearSel();
      setVersion((v) => v + 1);
      setZoom(clampZoom(width / Math.max(...s.sizes.map(([w]) => w))));
      setCurrent(0);
      setError(undefined);
      scroller.current?.scrollTo(0, 0);
    } catch (e) {
      setError(`Öffnen fehlgeschlagen: ${String(e)}`);
    }
  }

  async function pickFile() {
    const p = await openDialog({ filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (typeof p === "string") await openPath(p);
  }

  /** Seitenoperation im Backend; Objekte werden mit umnummeriert, Objekte einer eingefügten PDF kommen dazu. */
  async function pageOp(op: object, remap: (items: Item[], inserted: number) => Item[]) {
    if (busy.current || !path) return;
    busy.current = true;
    try {
      const r = PageState.parse(await invoke("page_op", { op }));
      setHist((h) => push(h, {
        items: [...remap((h.list[h.at] ?? EMPTY).items, r.inserted), ...r.items.map(fromData)], rev: r.rev, sizes: r.sizes,
      }));
      setVersion((v) => v + 1);
      clearSel();
      setError(undefined);
    } catch (e) {
      setError(`Seitenoperation fehlgeschlagen: ${String(e)}`);
    } finally {
      busy.current = false;
    }
  }

  const insertBlank = () => {
    const at = Math.min(current + 1, sizes.length);
    const [width, height] = sizes[current] ?? A4;
    void pageOp({ op: "blank", at, width, height }, (its) => afterInsert(its, at, 1));
  };
  const insertFile = async (at: number, name: string, extensions: string[]) => {
    const p = await openDialog({ filters: [{ name, extensions }] });
    if (typeof p === "string") await pageOp({ op: "insertFile", at, path: p }, (its, n) => afterInsert(its, at, n));
  };
  const rotate = () => {
    const k = current, h = sizes[k]?.[1] ?? A4[1];
    void pageOp({ op: "rotate", index: k }, (its) => afterRotate(its, k, h));
  };
  const deletePage = () => {
    const k = current;
    void pageOp({ op: "delete", index: k }, (its) => afterDelete(its, k));
  };
  const movePage = (from: number, to: number) => void pageOp({ op: "move", from, to }, (its) => afterMove(its, from, to));

  /** Undo/Redo: Seitenstand im Backend mitziehen, wenn er sich unterscheidet. */
  async function travel(to: number) {
    if (busy.current || to < 0 || to >= hist.list.length || to === hist.at) return;
    const target = hist.list[to];
    if (!target) return;
    if (target.rev !== snap.rev) {
      busy.current = true;
      try {
        await invoke("goto_rev", { rev: target.rev });
        setVersion((v) => v + 1);
      } catch (e) {
        return setError(`Rückgängig nicht möglich: ${String(e)}`);
      } finally {
        busy.current = false;
      }
    }
    setHist((h) => ({ ...h, at: to }));
    clearSel();
  }

  function applyZoom(z: number) {
    const el = scroller.current;
    const nz = clampZoom(z);
    if (!el || nz === zoom) return;
    const r = nz / zoom, top = el.scrollTop, left = el.scrollLeft;
    setZoom(nz);
    requestAnimationFrame(() => el.scrollTo(left * r, top * r));
  }

  function goTo(i: number) {
    scroller.current?.querySelector(`[data-page="${i}"]`)?.scrollIntoView({ block: "start" });
  }

  function paste() {
    if (!clip.current.length || !sizes.length) return;
    const page = Math.min(current, sizes.length - 1);
    const pasted = clip.current.map((it) => ({ ...moveItem(it, 10, 10), id: newId(), page }));
    clip.current = pasted; // nochmal einfügen → weiter versetzt
    edit((its) => [...its, ...pasted]);
    setSelection({ page, ids: pasted.map((it) => it.id) });
  }

  const removeSel = () => {
    if (!selItems.length) return;
    const ids = new Set(selItems.map((it) => it.id));
    edit((its) => its.filter((it) => !ids.has(it.id)));
    clearSel();
  };

  const updateSettings = (s: Settings) => {
    setSettings(s);
    storeSettings(s);
  };

  useEffect(() => {
    live.current = { dirty, save, openPath };
  });

  // Titel mit * bei ungespeicherten Änderungen
  useEffect(() => {
    void getCurrentWindow().setTitle(`${dirty ? "* " : ""}${path ? `${fileName(path)} – ` : ""}PDF Note`);
  }, [dirty, path]);

  // Einmalig: „Öffnen mit", Drag & Drop, Schließen-Nachfrage
  useEffect(() => {
    void invoke<string | null>("startup_path").then((p) => {
      if (p) void live.current.openPath(p);
    });
    const un = [
      getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type !== "drop") return;
        const p = e.payload.paths.find((x) => x.toLowerCase().endsWith(".pdf"));
        if (p) void live.current.openPath(p);
      }),
      getCurrentWindow().onCloseRequested(async (e) => {
        if (!(await confirmLeave())) e.preventDefault();
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

  // Tastatur: Strg+S/Strg+Umschalt+S, Strg+O, Strg+Z/Y, Strg+C/V, Entf, Esc, Strg +/− Zoom
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      const act: Record<string, () => void> = e.ctrlKey ? {
        s: () => void (e.shiftKey ? saveAs() : save().catch(() => {})),
        o: () => void pickFile(),
        z: () => void travel(e.shiftKey ? hist.at + 1 : hist.at - 1),
        y: () => void travel(hist.at + 1),
        c: () => void (clip.current = selItems),
        v: paste,
        "+": () => applyZoom(zoom * 1.2),
        "=": () => applyZoom(zoom * 1.2),
        "-": () => applyZoom(zoom / 1.2),
      } : { delete: removeSel, backspace: removeSel, escape: clearSel };
      const f = act[k];
      if (f) {
        e.preventDefault();
        f();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Strg+Mausrad zoomt (nicht-passiv, sonst zoomt WebView2 die ganze Oberfläche)
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      applyZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  // Finger: 1 = scrollen, 2 = Pinch-Zoom. Stift/Maus zeichnen in PageView.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number }>(null);
  const dist = () => {
    const [a, b] = [...touches.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const touchDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinch.current = touches.current.size === 2 ? { d: dist(), z: zoom } : null;
  };
  const touchMove = (e: React.PointerEvent) => {
    const t = touches.current.get(e.pointerId);
    if (!t) return;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // ponytail: Pinch zoomt um die Scroll-Position, nicht um den Fingermittelpunkt
    if (pinch.current && pinch.current.d > 0) applyZoom((pinch.current.z * dist()) / pinch.current.d);
    else if (touches.current.size === 1) scroller.current?.scrollBy(-dx, -dy);
  };
  const touchUp = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId);
    pinch.current = null;
  };

  // Vorschaubilder per Zeiger umsortieren (HTML5-Drag&Drop geht in Tauri bei aktivem Datei-Drop nicht)
  const thumbDown = (i: number) => (e: React.PointerEvent) => {
    if (e.pointerType === "touch" || e.buttons !== 1) return;
    thumbDrag.current = { from: i, x: e.clientX, y: e.clientY, moved: false };
  };
  const navMove = (e: React.PointerEvent) => {
    const d = thumbDrag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) {
      d.moved = true;
      // Capture erst beim Ziehen, sonst landet der Klick auf <nav> statt auf dem Vorschaubild
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (!d.moved) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-thumb]");
    setDrop(el ? { from: d.from, to: Number(el.dataset.thumb) } : undefined);
  };
  const navUp = () => {
    const d = thumbDrag.current;
    thumbDrag.current = null;
    if (d?.moved && drop && drop.to !== d.from) movePage(d.from, drop.to);
    setDrop(undefined);
  };

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 3;
    const pages = el.querySelectorAll<HTMLElement>("[data-page]");
    let i = 0;
    pages.forEach((p, n) => p.offsetTop <= mid && (i = n));
    setCurrent(i);
  };

  const btn = "rounded-xs px-2.5 py-1 text-sm text-ink-2 hover:bg-raised hover:text-ink disabled:opacity-40";
  const on = (b: boolean) => (b ? " bg-accent-soft text-ink" : "");
  const sep = <span className="mx-1 h-5 w-px bg-line" />;
  const palette = tool === "marker" ? MARKERS : PRESETS;
  const active = tool === "marker" ? marker : preset;

  return (
    <div className="flex h-full flex-col">
      <header className="relative flex flex-wrap items-center gap-1 border-b border-line bg-surface px-3 py-1.5">
        <button className={btn} onClick={() => void pickFile()} title="Strg+O">Öffnen</button>
        <button className={btn} onClick={() => void save().catch(() => {})} disabled={!dirty} title="Strg+S">Speichern</button>
        <button className={btn} onClick={() => void saveAs()} disabled={!path} title="Strg+Umschalt+S – Anmerkungen eingebrannt">Speichern unter (flach)</button>
        {sep}
        <button className={btn} onClick={() => void travel(hist.at - 1)} disabled={hist.at === 0} title="Strg+Z">↶</button>
        <button className={btn} onClick={() => void travel(hist.at + 1)} disabled={hist.at >= hist.list.length - 1} title="Strg+Y">↷</button>
        {sep}
        {TOOL_LABELS.map(([t, label, title]) => (
          <button key={t} className={btn + on(tool === t)} onClick={() => setTool(t)} title={title}>{label}</button>
        ))}
        {sep}
        {palette.map((p) => (
          <button
            key={p.name}
            title={p.name}
            onClick={() => (tool === "marker" ? setMarker(p) : setPreset(p))}
            className={`grid h-7 w-7 place-items-center rounded-pill ring-2 ${p === active ? "ring-accent" : "ring-transparent"}`}
          >
            <span className="block rounded-pill" style={{ width: Math.min(p.size * 3, 18), height: Math.min(p.size * 3, 18), background: `rgb(${p.color.map((c) => c * 255).join(",")})`, outline: "1px solid var(--line-2)" }} />
          </button>
        ))}
        {sep}
        <button className={btn} onClick={insertBlank} disabled={!path} title="Leere Seite nach der aktuellen">Seite +</button>
        <button className={btn} onClick={() => void insertFile(sizes.length, "PDF", ["pdf"])} disabled={!path} title="PDF hinten anhängen">PDF anhängen</button>
        <button className={btn} onClick={() => void insertFile(Math.min(current + 1, sizes.length), "Bild", ["png", "jpg", "jpeg"])} disabled={!path} title="Bild als Seite nach der aktuellen">Bild</button>
        <button className={btn} onClick={rotate} disabled={!path} title="Aktuelle Seite 90° drehen">⟳</button>
        <button className={btn} onClick={deletePage} disabled={!path || sizes.length < 2} title="Aktuelle Seite löschen">Seite −</button>
        {sep}
        <button className={btn} onClick={() => applyZoom(zoom / 1.2)} disabled={!path}>−</button>
        <span className="w-12 text-center font-mono text-xs text-ink-2">{Math.round(zoom * 100)} %</span>
        <button className={btn} onClick={() => applyZoom(zoom * 1.2)} disabled={!path}>+</button>
        {path && (
          <form
            className="flex items-center gap-1 text-sm text-ink-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(jump);
              if (n >= 1 && n <= sizes.length) goTo(n - 1);
              setJump("");
            }}
          >
            <input
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              placeholder={String(current + 1)}
              inputMode="numeric"
              aria-label="Seite"
              className="w-12 rounded-xs border border-line bg-sunken px-1.5 py-0.5 text-center font-mono text-xs text-ink"
            />
            / {sizes.length}
          </form>
        )}
        <button className={btn + on(showSettings)} onClick={() => setShowSettings((s) => !s)} title="Stifttasten und Druck">Stift …</button>
        {error && <span className="ml-auto text-sm text-red-400">{error}</span>}
        {showSettings && (
          <div className="absolute top-full right-3 z-10 mt-1 flex w-80 flex-col gap-3 rounded-sm border border-line bg-raised p-4 text-sm text-ink-2 shadow-raised">
            {(["lasso", "eraser"] as const).map((k) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <span>{k === "lasso" ? "Lasso" : "Radierer"}: <span className="font-mono text-xs text-ink">{describe(settings[k])}</span></span>
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
      <div className="flex min-h-0 flex-1">
        {path && (
          <nav
            data-scroll
            className="flex w-40 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-line bg-sunken py-3"
            onPointerMove={navMove}
            onPointerUp={navUp}
            onPointerCancel={navUp}
          >
            {sizes.map((s, i) => (
              <Thumb
                key={i}
                index={i}
                size={s}
                version={version}
                active={i === current}
                dropMark={drop?.to === i && i !== drop.from ? (i < drop.from ? "before" : "after") : undefined}
                onPointerDown={thumbDown(i)}
                onClick={() => goTo(i)}
              />
            ))}
          </nav>
        )}
        <main
          ref={scroller}
          data-scroll
          className="flex-1 overflow-auto"
          style={{ touchAction: "none" }}
          onScroll={onScroll}
          onPointerDown={touchDown}
          onPointerMove={touchMove}
          onPointerUp={touchUp}
          onPointerCancel={touchUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          {path ? (
            <div className="flex w-max min-w-full flex-col gap-4 p-6">
              {sizes.map((s, i) => (
                <PageView
                  key={i}
                  index={i}
                  size={s}
                  zoom={zoom}
                  version={version}
                  items={items.filter((x) => x.page === i)}
                  selected={selection.page === i ? selection.ids : []}
                  tool={tool}
                  preset={preset}
                  marker={marker}
                  settings={settings}
                  onAdd={(it) => edit((all) => [...all, it])}
                  onRemove={(ids) => edit((all) => all.filter((it) => !ids.includes(it.id)))}
                  onReplace={(next) => edit((all) => all.map((it) => next.find((n) => n.id === it.id) ?? it))}
                  onSelect={(page, ids) => setSelection({ page, ids })}
                />
              ))}
            </div>
          ) : (
            <div className="grid h-full place-items-center text-center text-ink-2">
              <p>
                Keine PDF geöffnet
                <br />
                <span className="text-sm text-ink-3">Strg+O oder Datei hierher ziehen</span>
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
