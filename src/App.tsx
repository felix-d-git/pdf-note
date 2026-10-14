import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message, open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { DEFAULT_PRESET, PRESETS, savedWidth, type Preset, type Stroke } from "./ink";
import { PageView, Thumb } from "./PageView";

const Sizes = z.array(z.tuple([z.number().positive(), z.number().positive()])).min(1);
const clampZoom = (z: number) => Math.min(6, Math.max(0.2, z));
const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export default function App() {
  const [path, setPath] = useState<string>();
  const [sizes, setSizes] = useState<[number, number][]>([]);
  const [version, setVersion] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [preset, setPreset] = useState<Preset>(DEFAULT_PRESET);
  const [current, setCurrent] = useState(0);
  const [jump, setJump] = useState("");
  const [error, setError] = useState<string>();
  const scroller = useRef<HTMLDivElement>(null);
  const dirty = strokes.length > 0;
  // Für Listener, die nur einmal registriert werden
  const live = useRef<{ dirty: boolean; save: () => Promise<void>; openPath: (p: string) => Promise<void> }>({
    dirty, save: async () => {}, openPath: async () => {},
  });

  async function save() {
    if (!path || !dirty) return;
    try {
      const out = strokes.map((s) => ({
        page: s.page, color: s.color, opacity: s.opacity, width: savedWidth(s), points: s.points.map(([x, y]) => [x, y]),
      }));
      await invoke("save_pdf", { strokes: out });
      // nur die gespeicherten entfernen: während des Speicherns gezeichnete Striche bleiben
      setStrokes((all) => all.filter((s) => !strokes.includes(s)));
      setVersion((v) => v + 1);
      setError(undefined);
    } catch (e) {
      setError(`Speichern fehlgeschlagen: ${String(e)}`);
      throw e;
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
      const s = Sizes.parse(await invoke("open_pdf", { path: p }));
      const width = (scroller.current?.clientWidth ?? 800) - 48;
      setPath(p);
      setSizes(s);
      setStrokes([]);
      setVersion((v) => v + 1);
      setZoom(clampZoom(width / Math.max(...s.map(([w]) => w))));
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

  // Tastatur: Strg+S speichern, Strg+O öffnen, Strg+Z letzten Strich zurück, Strg +/−/0 Zoom
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || (e.key.toLowerCase() === "z" && e.target instanceof HTMLInputElement)) return;
      const k = e.key.toLowerCase();
      const act: Record<string, () => void> = {
        s: () => void save().catch(() => {}),
        o: () => void pickFile(),
        z: () => setStrokes((s) => s.slice(0, -1)),
        "+": () => applyZoom(zoom * 1.2),
        "=": () => applyZoom(zoom * 1.2),
        "-": () => applyZoom(zoom / 1.2),
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

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-1.5">
        <button className={btn} onClick={() => void pickFile()} title="Strg+O">Öffnen</button>
        <button className={btn} onClick={() => void save().catch(() => {})} disabled={!dirty} title="Strg+S">Speichern</button>
        <span className="mx-1 h-5 w-px bg-line" />
        {PRESETS.map((p) => (
          <button
            key={p.name}
            title={p.name}
            onClick={() => setPreset(p)}
            className={`grid h-7 w-7 place-items-center rounded-pill ring-2 ${p === preset ? "ring-accent" : "ring-transparent"}`}
          >
            <span className="block rounded-pill" style={{ width: p.size * 3, height: p.size * 3, background: `rgb(${p.color.map((c) => c * 255).join(",")})`, outline: "1px solid var(--line-2)" }} />
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-line" />
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
        {error && <span className="ml-auto text-sm text-red-400">{error}</span>}
      </header>
      <div className="flex min-h-0 flex-1">
        {path && (
          <nav data-scroll className="flex w-40 shrink-0 flex-col items-center gap-3 overflow-y-auto border-r border-line bg-sunken py-3">
            {sizes.map((s, i) => (
              <Thumb key={i} index={i} size={s} version={version} active={i === current} onClick={() => goTo(i)} />
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
                  strokes={strokes.filter((x) => x.page === i)}
                  preset={preset}
                  onStroke={(st) => setStrokes((all) => [...all, st])}
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
