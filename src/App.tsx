import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { ArrowLeftRight, CircleHelp, Columns2, FileWarning, FolderOpen, Keyboard, Monitor, Moon, NotebookPen, Plus, Settings as Gear, Sun, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { dropDoc } from "./docstore";
import { DocView, PageState, toSnap, type DocApi, type Snap } from "./DocView";
import { Help } from "./help";
import { T } from "./i18n";
import { comboOf, KEYS, keyMap } from "./keys";
import { fromSession, loadSession, storeSession, toSession, type DocStart } from "./session";
import { applyTheme, captureBinding, describe, loadSettings, storeSettings, type Settings } from "./settings";
import {
  activeId, closeTab, cycle, EMPTY_TABS, focus, moveTab, openTab, samePath, pickDoc, setDirty, show, toggleSplit, toPane, viewActive, type Pane, type Tab,
} from "./tabs";
import { Tour, tourSeen } from "./tour";
import { BTN as btn, Dialog, FIELD, IconBtn, on, pwProblem, Toast } from "./ui";

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
/** Sitzung einmal je Programmstart wiederherstellen (StrictMode führt Effekte doppelt aus); Öffnen wartet darauf */
let restored: Promise<void> | undefined;
const NO_VIEW: DocStart = { zoom: 1, left: 0, top: 0, layer: 2, mouse: "lasso", pen: "pen" };

export default function App() {
  const [state, setState] = useState(EMPTY_TABS);
  const [inits, setInits] = useState(new Map<number, Snap>());
  /** Ansicht je Dokument aus der letzten Sitzung */
  const [starts, setStarts] = useState(new Map<number, DocStart>());
  /** beim Wiederherstellen nicht mehr gefundene Dateien (Hinweis-Symbol) */
  const [missing, setMissing] = useState<string[]>([]);
  const [help, setHelp] = useState(false);
  const [tour, setTour] = useState(() => !tourSeen());
  const [ratio, setRatio] = useState(0.5);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [capture, setCapture] = useState<"lasso" | "eraser">();
  const [error, setError] = useState<string>();
  const closeError = useCallback(() => setError(undefined), []);
  const [pwAsk, setPwAsk] = useState<{ file: string; wrong: boolean; done: (pw: string | null) => void }>();
  /** Tab-Ziehen: Ziel in der Tab-Leiste (`to`) oder Hälfte im Split View (`pane`) */
  const [drop, setDrop] = useState<{ from: number; to?: number; pane?: Pane }>();
  /** Seitenleiste im Split View: startet eingeklappt, Symbol holt sie zurück (ändert nicht die gespeicherte Wahl) */
  const [splitSide, setSplitSide] = useState({ split: false, open: false });
  if (splitSide.split !== state.split) setSplitSide({ split: state.split, open: false });
  const nextId = useRef(1);
  const opening = useRef<string[]>([]);
  /** je Ansicht: `${id}`, zweite Ansicht derselben PDF `${id}b` */
  const [apis] = useState(() => new Map<string, DocApi>());
  const split = useRef<HTMLDivElement>(null);
  /** trägt --r/--r2 für Hälften und ihre Tab-Leisten */
  const root = useRef<HTMLDivElement>(null);
  const tabDrag = useRef<{ from: number; x: number; y: number; moved: boolean }>(null);

  const { tabs, panes } = state;
  const current = tabs.find((t) => t.id === activeId(state));
  // Für Listener, die nur einmal registriert werden
  const live = useRef<{
    tabs: Tab[]; state: typeof state; ratio: number; side: boolean; openPath: (p: string) => Promise<void>; restore: () => Promise<void>; saveSession: () => Promise<void>;
    confirmLeave: (t: Tab) => Promise<boolean>; dropImages: (ps: string[], x: number, y: number) => Promise<void>;
  }>({
    tabs, state, ratio, side: false, openPath: async () => {}, restore: async () => {}, saveSession: async () => {}, confirmLeave: async () => true, dropImages: async () => {},
  });

  const onDirty = useCallback((id: number, dirty: boolean) => setState((s) => setDirty(s, id, dirty)), []);

  /** true = weitermachen (gespeichert oder verworfen), false = abbrechen */
  async function confirmLeave(t: Tab) {
    if (!t.dirty) return true;
    const r = await message(T.unsaved(fileName(t.path)), {
      title: "PDF Note", kind: "warning", buttons: { yes: T.save, no: T.discard, cancel: T.cancel },
    });
    if (r === T.save) return (apis.get(String(t.id))?.save() ?? Promise.resolve()).then(() => true, () => false);
    return r === T.discard;
  }

  /** Bilder aus dem Explorer: auf die Seite unter (x, y) (auch im geteilten Fenster), sonst mittig ins aktive Dokument. */
  async function dropImages(paths: string[], x: number, y: number) {
    for (const p of paths) {
      try {
        const b64 = await invoke<string>("read_image", { path: p });
        const hit = await Promise.all([...apis.values()].map((a) => a.dropImage(b64, x, y)));
        if (!hit.includes(true) && current) await apis.get(String(current.id))?.dropImage(b64);
      } catch (e) {
        setError(`Bild einfügen fehlgeschlagen: ${String(e)}`);
      }
    }
  }

  async function close(t: Tab) {
    if (!(await confirmLeave(t))) return;
    setState((s) => closeTab(s, t.id));
    dropDoc(t.id);
    setInits((m) => {
      const n = new Map(m);
      n.delete(t.id);
      return n;
    });
    void invoke("close_pdf", { id: t.id });
  }

  // Passwort-Abfragen nacheinander (mehrere verschlüsselte PDFs gleichzeitig gezogen)
  const pwQueue = useRef<Promise<unknown>>(Promise.resolve());
  function askPassword(file: string, wrong: boolean): Promise<string | null> {
    const p = pwQueue.current
      .then(() => new Promise<string | null>((done) => setPwAsk({ file, wrong, done })))
      .finally(() => setPwAsk(undefined));
    pwQueue.current = p.catch(() => {});
    return p;
  }

  /** PDF ins Backend laden; Passwort fragen, bis es passt. `undefined` = abgebrochen, Fehler werden geworfen. */
  async function load(p: string) {
    const id = nextId.current++;
    // Öffnen-Passwort lebt nur im RAM (hier + Backend)
    let password: string | null = null;
    for (;;) {
      try {
        return { id, snap: toSnap(PageState.parse(await invoke("open_pdf", { id, path: p, password }))) };
      } catch (e) {
        if (String(e) !== "PASSWORT_NOETIG" && String(e) !== "PASSWORT_FALSCH") throw e;
        password = await askPassword(fileName(p), String(e) === "PASSWORT_FALSCH");
        if (password === null) return;
      }
    }
  }

  async function openPath(p: string) {
    await restored;
    const hit = live.current.tabs.find((t) => samePath(t.path, p));
    if (hit) return setState((s) => show(s, hit.id));
    // gleiche Datei kurz nacheinander (Start-Pfad + Drop) → nur einmal öffnen
    if (opening.current.some((o) => samePath(o, p))) return;
    opening.current.push(p);
    try {
      const r = await load(p);
      if (!r) return;
      setInits((m) => new Map(m).set(r.id, r.snap));
      setState((s) => openTab(s, r.id, p));
      setError(undefined);
    } catch (e) {
      setError(`Öffnen fehlgeschlagen: ${String(e)}`);
    } finally {
      opening.current = opening.current.filter((o) => o !== p);
    }
  }

  /** Letzte Sitzung: fehlende/unlesbare Dateien still auslassen (Hinweis-Symbol), Passwort-Abbruch lässt den Tab weg. */
  async function restore() {
    const s = loadSession();
    if (!s) return;
    const gone: string[] = [];
    const got = await Promise.all(s.files.map((f) => load(f.path).catch(() => void gone.push(fileName(f.path)))));
    const next = fromSession(s, got.map((g) => g?.id));
    setInits((m) => new Map([...m, ...got.flatMap((g) => (g ? [[g.id, g.snap] as const] : []))]));
    setStarts(new Map(got.flatMap((g, i) => (g && s.files[i] ? [[g.id, s.files[i]] as const] : []))));
    setState(next);
    setRatio(s.ratio);
    setSplitSide({ split: next.split, open: s.side });
    setMissing(gone);
    // Öffnen danach (Explorer-Start) sieht die Tabs schon vor dem nächsten Rendern
    live.current.tabs = next.tabs;
  }

  /** Sitzung beim Beenden: Tabs + Ansicht je Dokument, Fenster (maximiert/minimiert → Größe davor) */
  async function saveSession() {
    const w = getCurrentWindow();
    let win = loadSession()?.win;
    try {
      if (!(await w.isMinimized())) {
        // setSize setzt die Innengröße, setPosition die äußere Lage
        const [pos, size, max] = await Promise.all([w.outerPosition(), w.innerSize(), w.isMaximized()]);
        const cur = { x: pos.x, y: pos.y, w: size.width, h: size.height, max: false };
        win = max ? { ...(win ?? cur), max: true } : cur;
      }
    } catch {
      // Fenster nicht abfragbar → letzte Lage behalten
    }
    const { state: st, ratio: r, side } = live.current;
    storeSession(toSession(st, r, (id) => apis.get(String(id))?.state() ?? NO_VIEW, win, side));
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
    live.current = { tabs, state, ratio, side: splitSide.open, openPath, restore, saveSession, confirmLeave, dropImages };
  });

  // Ansicht: System folgt Windows auch während die App läuft
  useLayoutEffect(() => {
    applyTheme(settings.theme);
    if (settings.theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: light)");
    const f = () => applyTheme("system");
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, [settings.theme]);

  // Titel mit * bei ungespeicherten Änderungen (aktiver Tab)
  useEffect(() => {
    void getCurrentWindow().setTitle(`${current?.dirty ? "* " : ""}${current ? `${fileName(current.path)} – ` : ""}PDF Note`);
  }, [current]);

  // Einmalig: „Öffnen mit" (auch bei laufender App), Drag & Drop, Beenden fragt für jedes ungespeicherte Dokument
  useEffect(() => {
    // erst die letzte Sitzung, dann die per Explorer übergebene PDF als aktiver Tab
    restored ??= live.current.restore().catch(() => {});
    void restored.then(() => invoke<string | null>("startup_path")).then((p) => {
      if (p) void live.current.openPath(p);
    });
    const un = [
      // zweiter Start (Explorer-Doppelklick) bei laufender App → Pfad kommt von dort
      listen<string>("open-path", (e) => void live.current.openPath(e.payload)),
      getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type !== "drop") return;
        const ext = (x: string) => x.toLowerCase().split(".").pop() ?? "";
        for (const p of e.payload.paths.filter((x) => ext(x) === "pdf")) void live.current.openPath(p);
        // Position in physischen Pixeln → CSS-Pixel
        const { x, y } = e.payload.position;
        void live.current.dropImages(e.payload.paths.filter((p) => ["png", "jpg", "jpeg"].includes(ext(p))), x / devicePixelRatio, y / devicePixelRatio);
      }),
      getCurrentWindow().onCloseRequested(async (e) => {
        for (const t of live.current.tabs) {
          if (!(await live.current.confirmLeave(t))) return e.preventDefault();
        }
        await live.current.saveSession();
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

  // Tastatur: Öffnen, Schließen, Tab wechseln, Hilfe; dokumentbezogene Tasten in DocView
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const act = keyMap([
        [KEYS.open, () => void pickFile()],
        [KEYS.close, () => void (current && close(current))],
        [KEYS.nextTab, () => setState((s) => cycle(s, 1))],
        [KEYS.prevTab, () => setState((s) => cycle(s, -1))],
        [KEYS.help, () => setHelp(true)],
      ]);
      const k = comboOf(e);
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
    if (e.buttons === 1) tabDrag.current = { from: i, x: e.clientX, y: e.clientY, moved: false };
  };
  const barMove = (e: React.PointerEvent) => {
    const d = tabDrag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) {
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (!d.moved) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-tab]");
    if (el) return setDrop({ from: d.from, to: Number(el.dataset.tab) });
    // im Split View: auf eine Hälfte ziehen
    const r = split.current?.getBoundingClientRect();
    const inside = r && state.split && e.clientY > r.top && e.clientY < r.bottom && e.clientX > r.left && e.clientX < r.right;
    setDrop(inside ? { from: d.from, pane: e.clientX < r.left + r.width * ratio ? 0 : 1 } : undefined);
  };
  const barUp = (e: React.PointerEvent) => {
    const d = tabDrag.current;
    tabDrag.current = null;
    const t = d && tabs[d.from];
    if (d?.moved && drop?.to !== undefined && drop.to !== d.from) setState((s) => moveTab(s, d.from, drop.to ?? d.from));
    // Strg beim Loslassen: in beiden Hälften zeigen
    if (d?.moved && t && drop?.pane !== undefined) setState((s) => toPane(s, t.id, drop.pane ?? 0, e.ctrlKey));
    setDrop(undefined);
  };

  // Trennlinie ziehen: nur CSS-Variable setzen (kein React-Render je Bewegung → bleibt flüssig über Seitenbildern),
  // beim Loslassen übernehmen
  const ratioAt = (e: React.PointerEvent) => {
    const r = split.current?.getBoundingClientRect();
    return r ? Math.min(0.8, Math.max(0.2, (e.clientX - r.left) / r.width)) : ratio;
  };
  const dividerMove = (e: React.PointerEvent) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const r = ratioAt(e);
    root.current?.style.setProperty("--r", String(r));
    root.current?.style.setProperty("--r2", String(1 - r));
  };
  const dividerUp = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) setRatio(ratioAt(e));
  };

  const paneOf = (id: number): Pane | undefined =>
    panes[0] === id ? 0 : state.split && panes[1] === id ? 1 : undefined;
  const paneStyle = (p: Pane) => ({ order: p * 2, flex: `${state.split ? `var(--r${p === 0 ? "" : "2"})` : 1} 1 0` });
  const sideOpen = state.split ? splitSide.open : settings.side;
  const toggleSide = () => (state.split ? setSplitSide((s) => ({ ...s, open: !s.open })) : updateSettings({ ...settings, side: !settings.side }));
  const view = (t: Tab, p: Pane, dup: boolean) => {
    const init = inits.get(t.id);
    return init && (
      <DocView
        key={dup ? `${t.id}b` : t.id}
        id={t.id}
        view={dup ? `${t.id}b` : String(t.id)}
        path={t.path}
        init={init}
        start={starts.get(t.id)}
        visible={dup || paneOf(t.id) !== undefined}
        active={viewActive(state, p, dup || paneOf(t.id) !== undefined)}
        marked={state.split && p === state.active}
        settings={settings}
        style={paneStyle(p)}
        apis={apis}
        sideOpen={sideOpen}
        onSide={toggleSide}
        onDirty={onDirty}
        onFocus={() => paneOf(t.id) !== undefined && setState((s) => focus(s, p))}
      />
    );
  };

  /** Tab-Leiste: ohne `pane` die eine Leiste im Kopf, sonst die einer Split-Hälfte (zeigt alle Dokumente, Klick nur für diese Hälfte) */
  const tabBar = (pane?: Pane) => (
    <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto" onPointerMove={barMove} onPointerUp={barUp} onPointerCancel={() => {
      tabDrag.current = null;
      setDrop(undefined);
    }}>
      {tabs.map((t, i) => {
        // ohne Split: Hälfte 0; mit Split: nur das Dokument dieser Leiste
        const shown = pane === undefined ? paneOf(t.id) !== undefined : panes[pane] === t.id;
        const lit = shown && (pane ?? 0) === state.active;
        const mark = drop?.to === i && i !== drop.from ? (i < drop.from ? " border-l-accent" : " border-r-accent") : "";
        return (
          <div
            key={t.id}
            data-tab={i}
            title={t.path}
            onPointerDown={tabDown(i)}
            onClick={() => setState((s) => (pane === undefined ? show(s, t.id) : pickDoc(s, t.id, pane)))}
            className={`flex shrink-0 cursor-default items-center gap-1 rounded-xs border-2 border-transparent py-0.5 pr-1 pl-2.5 text-sm select-none ${
              lit ? "bg-raised text-ink" : shown ? "bg-surface text-ink-2" : "text-ink-2 hover:bg-surface"
            }${mark}`}
          >
            <span className="max-w-48 truncate">{t.dirty && <span className="text-accent">* </span>}{fileName(t.path)}</span>
            <IconBtn
              icon={X}
              label={T.close}
              keys={KEYS.close}
              className="rounded-xs p-0.5 text-ink-3 hover:bg-line hover:text-ink"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void close(t);
              }}
            />
          </div>
        );
      })}
    </div>
  );

  return (
    <div ref={root} className="flex h-full flex-col" style={{ "--r": ratio, "--r2": 1 - ratio } as React.CSSProperties}>
      <Toast msg={error} onClose={closeError} className="fixed" />
      <header className="relative flex items-center gap-1 border-b border-line bg-sunken px-2 py-1">
        <IconBtn icon={NotebookPen} label={T.newFile} onClick={() => void newFile()} />
        <IconBtn icon={FolderOpen} label={T.open} keys={KEYS.open} onClick={() => void pickFile()} />
        {state.split ? <div className="flex-1" /> : tabBar()}
        <IconBtn icon={Columns2} label={T.split} className={btn + on(state.split)} aria-pressed={state.split} onClick={() => setState(toggleSplit)} />
        <IconBtn icon={ArrowLeftRight} label={T.auto} className={btn + on(settings.auto)} aria-pressed={settings.auto}
          onClick={() => updateSettings({ ...settings, auto: !settings.auto })} />
        <IconBtn icon={Gear} label={T.settings} className={btn + on(showSettings)} aria-pressed={showSettings} onClick={() => setShowSettings((s) => !s)} />
        <IconBtn icon={CircleHelp} label={T.help} keys={KEYS.help} className={btn + on(help)} aria-pressed={help} onClick={() => setHelp(true)} />
        {missing.length > 0 && (
          <IconBtn icon={FileWarning} label={T.missing(missing.join(", "))} className={btn + " text-accent"} onClick={() => setMissing([])} />
        )}
        {showSettings && (
          <div className="absolute top-full right-3 z-10 mt-1 flex w-80 flex-col gap-3 rounded-sm border border-line bg-raised p-4 text-sm text-ink-2 shadow-raised">
            <div className="flex items-center justify-between gap-2">
              {T.view}
              <div className="flex gap-1" role="radiogroup" aria-label={T.view}>
                {([["light", Sun, T.light], ["dark", Moon, T.dark], ["system", Monitor, T.system]] as const).map(([k, icon, l]) => (
                  <IconBtn key={k} icon={icon} label={l} role="radio" aria-checked={settings.theme === k} className={btn + on(settings.theme === k)}
                    onClick={() => updateSettings({ ...settings, theme: k })} />
                ))}
              </div>
            </div>
            {(["lasso", "eraser"] as const).map((k) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <span>{k === "lasso" ? T.keyLasso : T.keyEraser}: <span className="font-mono text-xs text-ink">{capture === k ? T.pressKey : describe(settings[k])}</span></span>
                <IconBtn icon={Keyboard} label={T.learn} className={btn + on(capture === k)} aria-pressed={capture === k}
                  onClick={() => setCapture(capture === k ? undefined : k)} />
              </div>
            ))}
            <label className="flex flex-col gap-1">
              {T.pressure}: <span className="font-mono text-xs text-ink">{settings.pressureMax.toFixed(2)}</span>
              <input
                type="range" min={0.3} max={1} step={0.05} value={settings.pressureMax}
                onChange={(e) => updateSettings({ ...settings, pressureMax: Number(e.target.value) })}
                className="accent-accent"
              />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={settings.pressure} className="accent-accent"
                onChange={(e) => updateSettings({ ...settings, pressure: e.target.checked })} />
              {T.penPressure}
            </label>
            <label className="flex flex-col gap-1">
              {T.smooth}: <span className="font-mono text-xs text-ink">{settings.smooth ? settings.smooth.toFixed(1) : T.off}</span>
              <input
                type="range" min={0} max={0.9} step={0.1} value={settings.smooth}
                onChange={(e) => updateSettings({ ...settings, smooth: Number(e.target.value) })}
                className="accent-accent"
              />
            </label>
          </div>
        )}
      </header>
      {state.split && (
        <div className="flex border-b border-line bg-sunken">
          {([0, 1] as const).map((p) => (
            <div
              key={p}
              aria-label={p === 0 ? T.paneLeft : T.paneRight}
              style={paneStyle(p)}
              className={`flex min-w-0 items-center gap-1 border-t-2 px-2 py-1 ${state.active === p ? "border-accent" : "border-transparent"}`}
            >
              {tabBar(p)}
              <IconBtn icon={Plus} label={T.open} className={btn} onClick={() => {
                setState((s) => focus(s, p));
                void pickFile();
              }} />
            </div>
          ))}
          <div className="w-2 shrink-0" style={{ order: 1 }} />
        </div>
      )}
      {/* Alle Dokumente bleiben gemountet (eigener Undo/Zoom/Scroll); Position per CSS-order, damit
          Wechsel zwischen den Hälften nichts neu mountet. */}
      <div ref={split} className="relative flex min-h-0 flex-1">
        {tabs.map((t) => view(t, paneOf(t.id) ?? 0, false))}
        {/* gleiche PDF in beiden Hälften: zweite Ansicht, teilt Undo/Speicherstand über den Dokument-Speicher */}
        {state.split && panes[0] !== undefined && panes[0] === panes[1] && tabs.filter((t) => t.id === panes[1]).map((t) => view(t, 1, true))}
        {([0, 1] as const).filter((p) => (p === 0 || state.split) && panes[p] === undefined).map((p) => (
          <div
            key={`leer-${p}`}
            style={paneStyle(p)}
            onPointerDownCapture={() => setState((s) => focus(s, p))}
            className={`grid min-w-0 place-items-center border-t-2 text-center text-ink-2 ${state.split && state.active === p ? "border-accent" : "border-transparent"}`}
          >
            <p>
              {T.empty}
              <br />
              <span className="text-sm text-ink-3">{T.emptyHint}</span>
            </p>
          </div>
        ))}
        {state.split && (
          <div
            role="separator"
            aria-label={T.divider}
            className="w-2 shrink-0 cursor-col-resize bg-line select-none hover:bg-accent"
            style={{ order: 1, touchAction: "none" }}
            title={T.divider}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={dividerMove}
            onPointerUp={dividerUp}
            onLostPointerCapture={() => setRatio(Number(root.current?.style.getPropertyValue("--r")) || ratio)}
          />
        )}
        {drop?.pane !== undefined && (
          <div
            className="pointer-events-none absolute inset-y-0 z-30 border-2 border-accent bg-accent-soft opacity-60"
            style={drop.pane === 0 ? { left: 0, width: `${ratio * 100}%` } : { left: `${ratio * 100}%`, right: 0 }}
          />
        )}
      </div>
      {help && <Help onClose={() => setHelp(false)} onTour={() => {
        setHelp(false);
        setTour(true);
      }} />}
      {tour && <Tour onEnd={() => setTour(false)} />}
      {pwAsk && <PasswordPrompt {...pwAsk} />}
    </div>
  );
}

/** Passwort-Abfrage beim Öffnen; `done(null)` = Abbrechen (kein Tab). */
function PasswordPrompt({ file, wrong, done }: { file: string; wrong: boolean; done: (pw: string | null) => void }) {
  const [pw, setPw] = useState("");
  const [bad, setBad] = useState<string>();
  return (
    <Dialog title={T.pwFor(file)} ok={T.unlock} onCancel={() => done(null)} onOk={() => {
      const b = pwProblem(pw);
      if (b) setBad(b);
      else done(pw);
    }}>
      <input type="password" autoFocus aria-label={T.password} placeholder={T.password} className={FIELD} value={pw}
        onChange={(e) => {
          setPw(e.target.value);
          setBad(undefined);
        }} />
      {(bad ?? wrong) && <div role="alert" className="text-red-400">{bad ?? T.pwWrong}</div>}
    </Dialog>
  );
}
