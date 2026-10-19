import { invoke } from "@tauri-apps/api/core";
import { message, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties } from "react";
import {
  ArrowDown, ArrowUp, ArrowUpRight, Axis3d, BetweenHorizontalStart, Bookmark, BookmarkPlus, Check, Circle, File, FileCode,
  FileImage, FileMinus, Flame, FileOutput, FilePenLine, FilePlus, Files, Grid3x3, Grip, ImagePlus, ListIndentDecrease,
  ListIndentIncrease, LocateFixed, Lock, Palette, PanelLeftClose, PanelLeftOpen, Paperclip, Plus, Redo2, RotateCw,
  Rows3, Save, ScanText, Slash, Square, Trash, Type, Undo2, X, ZoomIn, ZoomOut, type LucideIcon,
} from "lucide-react";
import { z } from "zod";
import {
  afterDelete, afterInsert, afterMove, afterRotate, box, cropItem, DEFAULT_PRESET, fromData, imageItem, imageMime, ItemData, kindLayer,
  layerOf, moveItem, newId, textRect, toData, unionBox, type Item, type Layer, type Preset,
} from "./ink";
import { useDoc } from "./docstore";
import { BTN as btn, Dialog, FIELD, IconBtn, Menu, MenuItem, on, pwProblem } from "./ui";
import { T, tip } from "./i18n";
import { comboOf, KEYS, keyMap, LAYERS, TOOL_LABELS } from "./keys";
import * as ol from "./outline";
import type { DocStart } from "./session";
import { PageView, Thumb, type Cmd, type Hit, type NewField, type OrigEdit, type TextEdit, type TextSel } from "./PageView";
import { afterShape, initTools, loadPalettes, pickTool, SHAPE_TOOLS, storePalettes, type Settings, type Tool } from "./settings";

const Sizes = z.array(z.tuple([z.number().positive(), z.number().positive()])).min(1);
export const PageState = z.object({
  sizes: Sizes, rev: z.number().int().nonnegative(), inserted: z.number().int().nonnegative(), items: z.array(ItemData),
  warning: z.string().nullish(),
});
const clampZoom = (z: number) => Math.min(6, Math.max(0.2, z));
const SearchHit = z.object({ page: z.number().int(), rect: z.array(z.number()).length(4) });
type SearchHit = z.infer<typeof SearchHit>;
const NO_HITS: Hit[] = [];
// ponytail: feste Handballen-Schwellen, je nach Gerät nachjustieren
const PALM_MS = 500; // so lange nach dem letzten Stiftereignis zählt Finger als Handballen
const PALM_PX = 40; // breitere Berührung = Handballen
const A4: [number, number] = [595, 842];

/** Ein Stand für Undo/Redo: Objekte + Seitenstand im Backend (rev) + Seitengrößen. */
export interface Snap { items: Item[]; rev: number; sizes: [number, number][] }
interface History { list: Snap[]; at: number }
const HISTORY_MAX = 200;
const EMPTY: Snap = { items: [], rev: 0, sizes: [] };
const push = (h: History, s: Snap): History => {
  const list = [...h.list.slice(0, h.at + 1), s].slice(-HISTORY_MAX);
  return { list, at: list.length - 1 };
};
export const toSnap = (r: z.infer<typeof PageState>): Snap => ({ items: r.items.map(fromData), rev: r.rev, sizes: r.sizes });

/**
 * Zwischenablage über alle Tabs: Kopieren in einer PDF, Einfügen in einer anderen.
 * `text` = was beim Kopieren als Text in die System-Zwischenablage ging; steht dort noch dasselbe → eigene Objekte einfügen.
 */
const clip: { items: Item[]; text: string | null } = { items: [], text: null };

/** Werkzeug wählt seine Ebene; Auswahl, Radierer (außer auf 1) und Link behalten die aktuelle */
const TOOL_LAYER: Partial<Record<Tool, Layer>> = { pen: 3, marker: 3, line: 2, arrow: 2, rect: 2, ellipse: 2, axes: 2, form: 1 };
const SHAPES: [Item["kind"], LucideIcon, string][] = [
  ["rect", Square, T.rect], ["ellipse", Circle, T.ellipse], ["line", Slash, T.line], ["arrow", ArrowUpRight, T.arrow], ["axes", Axis3d, T.axes],
];
const PAGE_KINDS: [string, LucideIcon, string][] = [["blank", File, T.blank], ["lined", Rows3, T.lined], ["grid", Grid3x3, T.squared], ["dots", Grip, T.dots]];

const inField = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
const readUrl = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => rej(r.error ?? new Error("Lesen fehlgeschlagen"));
  r.readAsDataURL(b);
});
/** Bild aus der Zwischenablage → Base64; PNG/JPEG unverändert, andere Formate (GIF, SVG, BMP …) als PNG. */
async function blobToB64(b: Blob): Promise<string> {
  let url = await readUrl(b);
  if (!imageMime(url.slice(url.indexOf(",") + 1))) {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    [c.width, c.height] = [img.naturalWidth, img.naturalHeight];
    c.getContext("2d")?.drawImage(img, 0, 0);
    url = c.toDataURL("image/png");
  }
  return url.slice(url.indexOf(",") + 1);
}

/** Was App von einem Dokument braucht (Speichern-Nachfrage beim Schließen/Beenden). */
export interface DocApi {
  save: () => Promise<void>;
  /** Bild an Bildschirmstelle (client px) einfügen; ohne Stelle mittig. false = keine eigene Seite dort */
  dropImage: (b64: string, x?: number, y?: number) => Promise<boolean>;
  /** Ansicht für die Sitzung (Seite/Scroll, Zoom, Ebene, Werkzeug je Gerät) */
  state: () => DocStart;
}

/**
 * Ein offenes Dokument mit eigenem Undo, Zoom, Scroll und Werkzeug. Bleibt gemountet, solange der Tab offen ist;
 * versteckt (`visible` = false) gibt es seine Seitenbilder frei (IntersectionObserver in PageView).
 */
export function DocView({ id, view, path, init, start, visible, active, marked, settings, style, apis, sideOpen, onSide, onDirty, onFocus }: {
  /** `start` = Ansicht aus der letzten Sitzung, sonst Seitenbreite */
  id: number; view: string; path: string; init: Snap; start?: DocStart; visible: boolean; active: boolean; marked: boolean; settings: Settings;
  style: CSSProperties; apis: Map<string, DocApi>; sideOpen: boolean; onSide: () => void;
  onDirty: (id: number, dirty: boolean) => void; onFocus: () => void;
}) {
  // Undo, Speicherstand, Seitenstand und Sperre teilt sich jede Ansicht dieses Dokuments (gleiche PDF in beiden Hälften)
  const [doc, setDoc] = useDoc(id, () => ({ hist: { list: [init], at: 0 } as History, saved: init, version: 0, busy: { current: false } }));
  const { hist, saved, version, busy } = doc;
  const setHist = (f: (h: History) => History) => setDoc((d) => ({ ...d, hist: f(d.hist) }));
  const setSaved = (s: Snap) => setDoc((d) => ({ ...d, saved: s }));
  const setVersion = (f: (v: number) => number) => setDoc((d) => ({ ...d, version: f(d.version) }));
  const [zoom, setZoom] = useState(start?.zoom ?? 1);
  /** Werkzeug der Maus (bei `settings.auto`) bzw. aller Geräte; `penTool` = Werkzeug des Stifts bei `auto` */
  const [tools, setTools] = useState(() => ({ ...initTools(settings.auto), ...(start && { mouse: start.mouse, pen: start.pen }) }));
  const { mouse: tool, pen: penTool, locked } = tools;
  const setTool = (t: Tool) => setTools((s) => ({ ...s, mouse: t }));
  /** Tippen bei ausgewähltem Textfeld: PageView je Seite öffnet das Feld mit dem Zeichen am Ende */
  const typers = useRef(new Map<number, (id: number, ch: string) => void>()).current;
  const [layer, setLayer] = useState<Layer>(start?.layer ?? 3);
  /** markierter PDF-Text (Ebene 1), gilt nur für den Stand `v` */
  const [textSel, setTextSel] = useState<TextSel & { page: number; v: number } | null>(null);
  const [pal, setPal] = useState(loadPalettes);
  useEffect(() => storePalettes(pal), [pal]);
  const [preset, setPreset] = useState<Preset>(pal.pen.find((p) => p.name === DEFAULT_PRESET.name) ?? pal.pen[0] ?? DEFAULT_PRESET);
  const [marker, setMarker] = useState<Preset>(pal.marker[0] ?? DEFAULT_PRESET);
  /** Koordinatensystem: gilt fürs nächste Aufziehen */
  const [axes, setAxes] = useState({ xyz: false, grid: false });
  const [selection, setSelection] = useState<{ page: number; ids: number[] }>({ page: -1, ids: [] });
  const [current, setCurrent] = useState(0);
  const [jump, setJump] = useState("");
  const [error, setError] = useState<string>();
  /** Suche: `null` = zu; Treffer gelten nur für den Stand `v`, `done` = zuletzt gesuchter Begriff */
  const [find, setFind] = useState<{ q: string; done: string | null; hits: SearchHit[]; at: number; v: number } | null>(null);
  const findInput = useRef<HTMLInputElement>(null);
  /** Link-Werkzeug: gezogener Quell-Bereich, wartet auf Klick ins Ziel */
  const [linkFrom, setLinkFrom] = useState<{ page: number; rect: [number, number, number, number] }>();
  // Werkzeugwechsel bricht einen angefangenen Link ab
  if (linkFrom && tool !== "link") setLinkFrom(undefined);
  const [drop, setDrop] = useState<{ from: number; to: number }>();
  const [side, setSide] = useState<"pages" | "marks">("pages");
  const [marks, setMarks] = useState<ol.Mark[]>([]);
  const [markSel, setMarkSel] = useState(-1);
  const [renaming, setRenaming] = useState(-1);
  /** Markdown-Quelltext der aktuellen Seite (`null` = keine Markdown-Seite) und offener Editor. */
  const [md, setMd] = useState<string | null>(null);
  const [mdEdit, setMdEdit] = useState<{ page: number; source: string; insert: boolean }>();
  // Passwort nur in diesem Zustand, verworfen beim Schließen des Dialogs
  /** Adresse, die nach Rückfrage im Standard-Browser geöffnet wird */
  const [openUrl, setOpenUrl] = useState<string>();
  const [saveDlg, setSaveDlg] = useState<{ flat: boolean; encrypt: boolean; pw: string; pw2: string; error?: string }>();
  const scroller = useRef<HTMLDivElement>(null);
  const scrollPos = useRef({ left: start?.left ?? 0, top: start?.top ?? 0 });
  const thumbDrag = useRef<{ from: number; x: number; y: number; moved: boolean }>(null);

  const snap = hist.list[hist.at] ?? EMPTY;
  const { items, sizes } = snap;
  const dirty = snap !== saved;
  const selItems = items.filter((it) => it.page === selection.page && selection.ids.includes(it.id));

  const edit = (f: (items: Item[]) => Item[]) =>
    setHist((h) => {
      const s = h.list[h.at] ?? EMPTY;
      return push(h, { ...s, items: f(s.items) });
    });
  const clearSel = () => setSelection({ page: -1, ids: [] });
  const switchLayer = (l: Layer) => {
    if (l === layer) return;
    setLayer(l);
    clearSel();
    setTextSel(null);
  };
  const chooseTool = (t: Tool, dev: "pen" | "mouse" = "mouse") => {
    setTools((s) => pickTool(s, t, dev, settings.auto));
    const l = TOOL_LAYER[t] ?? (t === "eraser" && layer === 1 ? 3 : undefined);
    if (l) switchLayer(l);
  };

  async function save(force = false): Promise<void> {
    // während Seitenoperation/Undo passen die Objekte nicht zum Seitenstand im Backend
    if (!dirty || busy.current) return;
    const s = snap;
    try {
      await invoke("save_pdf", { id, items: s.items.map(toData), target: null, flat: false, force });
      setSaved(s);
      setError(undefined);
    } catch (e) {
      if (!force && String(e) === "EXTERN_GEAENDERT") {
        const r = await message(T.extern, { title: "PDF Note", kind: "warning", buttons: { ok: T.saveAnyway, cancel: T.cancel } });
        if (r === T.saveAnyway) return save(true);
        setError("Nicht gespeichert: Datei extern geändert");
      } else setError(`Speichern fehlgeschlagen: ${String(e)}`);
      throw e;
    }
  }

  /** Speichern unter: neue Datei, optional eingebrannt und/oder mit Passwort. Weitergearbeitet wird an der offenen PDF. */
  async function saveAs() {
    if (busy.current || !saveDlg) return;
    const { flat, encrypt, pw, pw2 } = saveDlg;
    const bad = encrypt ? pwProblem(pw, pw2) : undefined;
    if (bad) return setSaveDlg({ ...saveDlg, error: bad });
    const suffix = flat ? "-flach" : encrypt ? "-geschuetzt" : "-kopie";
    const target = await saveDialog({ filters: [{ name: "PDF", extensions: ["pdf"] }], defaultPath: path.replace(/\.pdf$/i, "") + suffix + ".pdf" });
    if (!target) return;
    // die offene Datei bleibt unberührt: eingebrannt wären Objekte doppelt, Passwort gilt nur für die neue Datei
    if (target.toLowerCase() === path.toLowerCase()) return setSaveDlg({ ...saveDlg, error: T.ownTarget });
    try {
      await invoke("save_pdf", { id, items: items.map(toData), target, flat, force: false, password: encrypt ? pw : null });
      setSaveDlg(undefined);
      setError(undefined);
    } catch (e) {
      setSaveDlg({ ...saveDlg, error: `Speichern unter fehlgeschlagen: ${String(e)}` });
    }
  }

  /** Seitenoperation im Backend; Objekte werden mit umnummeriert, Objekte einer eingefügten PDF kommen dazu. */
  async function pageOp(op: object, remap: (items: Item[], inserted: number) => Item[], keepSel = false): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    try {
      const r = PageState.parse(await invoke("page_op", { id, op }));
      setHist((h) => push(h, {
        items: [...remap((h.list[h.at] ?? EMPTY).items, r.inserted), ...r.items.map(fromData)], rev: r.rev, sizes: r.sizes,
      }));
      setVersion((v) => v + 1);
      // Original-Objekte nur verschoben/skaliert/gedreht: Indizes bleiben → Auswahl bleibt
      if (!keepSel) clearSel();
      setError(r.warning ? `Hinweis: ${r.warning}` : undefined);
      return true;
    } catch (e) {
      setError(`Seitenoperation fehlgeschlagen: ${String(e)}`);
      return false;
    } finally {
      busy.current = false;
    }
  }

  // Feldwerte nacheinander: pageOp verwirft Aufrufe, solange eine Operation läuft (Tab → nächstes Feld)
  const fieldQ = useRef(Promise.resolve());
  const fieldN = useRef(0);
  // Strg+S im Feld: erst Wert übernehmen, gespeichert wird im ersten Render mit dem neuen Stand
  const saveSoon = useRef(false);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const setField = (page: number, xref: number, value: string) => {
    fieldN.current++;
    fieldQ.current = fieldQ.current
      .then(async () => {
        // Undo/Einfügen läuft noch → warten statt den Wert zu verwerfen
        while (busy.current) await new Promise((r) => setTimeout(r, 50));
        await pageOp({ op: "field", page, xref, value }, (its) => its);
      })
      .finally(() => {
        if (--fieldN.current === 0 && saveSoon.current) rerender();
      });
  };
  useEffect(() => {
    if (!saveSoon.current || fieldN.current || busy.current) return;
    saveSoon.current = false;
    void save().catch(() => {});
  });

  const insertBlank = (template?: string) => {
    const at = Math.min(current + 1, sizes.length);
    const [width, height] = sizes[current] ?? A4;
    void pageOp({ op: "blank", at, width, height, template }, (its) => afterInsert(its, at, 1));
  };
  const saveMarkdown = async () => {
    if (!mdEdit) return;
    const { page, source, insert } = mdEdit;
    // Fehler → Editor bleibt offen, Text geht nicht verloren
    if (!(await pageOp({ op: "markdown", page, source, insert }, (its) => (insert ? afterInsert(its, page, 1) : its)))) return;
    setMdEdit(undefined);
    if (insert) requestAnimationFrame(() => goTo(page));
  };

  // Lesezeichen + Markdown-Quelltext nach jeder Seitenoperation/Undo neu lesen
  useEffect(() => {
    let live = true;
    invoke("outline", { id }).then((r) => live && setMarks(z.array(ol.Mark).parse(r)), (e: unknown) => live && setError(`Lesezeichen: ${String(e)}`));
    return () => void (live = false);
  }, [id, version]);
  useEffect(() => {
    let live = true;
    invoke("page_markdown", { id, index: current }).then((r) => live && setMd(z.string().nullable().parse(r)), () => live && setMd(null));
    return () => void (live = false);
  }, [id, version, current]);
  /** Geänderte Liste als Seitenoperation (Undo-fähig); `sel` = danach gewählter Eintrag. */
  const setOutline = async (next: ol.Mark[], sel = markSel) => {
    if (next === marks) return false;
    setMarkSel(sel);
    const ok = await pageOp({ op: "outline", marks: next }, (its) => its);
    if (ok) setMarks(next); // sofort, nicht erst nach dem Neulesen (Umbenennen-Feld direkt danach)
    return ok;
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
        await invoke("goto_rev", { id, rev: target.rev });
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

  /** Zur Seite springen; mit `y` (pt) die Stelle ins obere Drittel holen. */
  function goTo(i: number, y?: number) {
    const el = scroller.current, pg = el?.querySelector(`[data-page="${i}"]`);
    if (!el || !pg) return;
    if (y === undefined) return pg.scrollIntoView({ block: "start" });
    el.scrollTo({ top: el.scrollTop + pg.getBoundingClientRect().top - el.getBoundingClientRect().top + y * zoom - el.clientHeight / 3 });
  }

  /** Volltextsuche ohne Index: PDF-Text im Backend, eigene Textfelder hier. */
  async function search(q: string) {
    const t = q.trim();
    if (!t) return setFind({ q, done: q, hits: [], at: -1, v: version });
    try {
      const pdf = z.array(SearchHit).parse(await invoke("search", { id, query: t }));
      const low = t.toLowerCase();
      // ponytail: eigene Textfelder als ganze Box markiert, nicht das Wort
      const own = items.filter((it) => it.kind === "text" && it.text.toLowerCase().includes(low)).map((it) => {
        const b = box(it);
        return { page: it.page, rect: [b.x0, b.y0, b.x1, b.y1] };
      });
      const hits = [...pdf, ...own].sort((a, b) => a.page - b.page || (a.rect[1] ?? 0) - (b.rect[1] ?? 0));
      setFind({ q, done: q, hits, at: hits.length ? 0 : -1, v: version });
      if (hits[0]) goTo(hits[0].page, hits[0].rect[1]);
    } catch (e) {
      setError(`Suche fehlgeschlagen: ${String(e)}`);
    }
  }
  function step(d: number) {
    if (find && find.v !== version) return void search(find.q);
    if (!find?.hits.length) return;
    const at = (find.at + d + find.hits.length) % find.hits.length;
    const h = find.hits[at];
    setFind({ ...find, at });
    if (h) goTo(h.page, h.rect[1]);
  }
  // Treffer passen nach Seitenoperation/Undo nicht mehr → ausblenden; nach Objekt-Änderungen bleiben sie stehen (ponytail)
  const hits = find && find.v === version ? find.hits : [];

  /** Neue Objekte hinzufügen, auswählen, Lasso auf ihrer Ebene aktiv → gleich verschiebbar. */
  function place(added: Item[]) {
    const [first] = added;
    if (!first) return;
    const page = first.page;
    edit((its) => [...its, ...added]);
    switchLayer(layerOf(first));
    setSelection({ page, ids: added.map((it) => it.id) });
    setTool("lasso");
  }

  /** Mitte des sichtbaren Teils der aktuellen Seite in pt. */
  function viewCenter(): [page: number, x: number, y: number, w: number, h: number] | null {
    if (!sizes.length) return null;
    const page = Math.min(current, sizes.length - 1);
    const [w, h] = sizes[page] ?? A4;
    const pr = scroller.current?.querySelector(`[data-page="${page}"]`)?.getBoundingClientRect();
    const vr = scroller.current?.getBoundingClientRect();
    if (!pr || !vr) return [page, w / 2, h / 2, w, h];
    const clamp = (v: number, max: number) => Math.min(max * 0.9, Math.max(max * 0.1, v));
    return [page, clamp(((vr.left + vr.right) / 2 - pr.left) / zoom, w), clamp(((vr.top + vr.bottom) / 2 - pr.top) / zoom, h), w, h];
  }

  /** `at`: linke obere Ecke an diese Stelle (Rechtsklick-Menü), sonst 10 pt versetzt */
  function paste(at?: [page: number, x: number, y: number]) {
    if (!clip.items.length || !sizes.length) return;
    const page = at?.[0] ?? Math.min(current, sizes.length - 1);
    const b = unionBox(clip.items);
    const [dx, dy] = at ? [at[1] - b.x0, at[2] - b.y0] : [10, 10];
    const pasted = clip.items.map((it) => ({ ...moveItem(it, dx, dy), id: newId(), page }));
    clip.items = pasted; // nochmal einfügen → weiter versetzt
    place(pasted);
  }

  async function insertImage(b64: string, at?: [page: number, x: number, y: number]) {
    const c = viewCenter();
    if (!c) return;
    const [page, x, y] = at ?? c;
    const [w, h] = sizes[page] ?? A4;
    const img = new Image();
    img.src = `data:${imageMime(b64) ?? "image/png"};base64,${b64}`;
    await img.decode();
    // 1 px = 0,75 pt (96 dpi); höchstens 80 % der kürzeren Seitenkante
    place([imageItem(page, b64, img.naturalWidth * 0.75, img.naturalHeight * 0.75, x, y, 0.8 * Math.min(w, h))]);
  }

  /** ohne `at` mittig in der Ansicht, mit `at` linke obere Ecke dort */
  function insertText(text: string, at?: [page: number, x: number, y: number]) {
    const c = viewCenter();
    const ctx = document.createElement("canvas").getContext("2d");
    if (!c || !ctx) return;
    const [page, x, y] = at ?? c;
    const t = text.replace(/\r\n?/g, "\n").slice(0, 100_000);
    const points = textRect(ctx, t, pal.text, 0, 0);
    const [, [bw, bh] = [0, 0]] = points;
    place([moveItem({
      id: newId(), page, kind: "text", color: preset.color, opacity: 1, size: pal.text, simulated: false, points, text: t,
    }, at ? x : x - bw / 2, at ? y : y - bh / 2)]);
  }

  function insertShape(kind: Item["kind"]) {
    const c = viewCenter();
    if (!c) return;
    const [page, x, y] = c;
    const [dx, dy] = kind === "line" || kind === "arrow" ? [60, 0] : [60, 40];
    place([{
      id: newId(), page, kind, color: preset.color, opacity: 1, size: preset.size, simulated: false,
      points: [[x - dx, y - dy, 0.5], [x + dx, y + dy, 0.5]], text: "", ...(kind === "axes" ? axes : {}),
    }]);
  }

  async function insertImageFile(at?: [page: number, x: number, y: number]) {
    const p = await openDialog({ filters: [{ name: "Bild", extensions: ["png", "jpg", "jpeg"] }] });
    if (typeof p !== "string") return;
    try {
      await insertImage(await invoke<string>("read_image", { path: p }), at);
    } catch (e) {
      setError(`Bild einfügen fehlgeschlagen: ${String(e)}`);
    }
  }

  /** Drop aus dem Explorer: Seite unter (x, y) suchen; versteckte Tabs haben leere Rechtecke → kein Treffer. */
  async function dropImage(b64: string, x?: number, y?: number) {
    if (x === undefined || y === undefined) {
      await insertImage(b64);
      return true;
    }
    for (const el of scroller.current?.querySelectorAll<HTMLElement>("[data-page]") ?? []) {
      const r = el.getBoundingClientRect();
      if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        await insertImage(b64, [Number(el.dataset.page), (x - r.left) / zoom, (y - r.top) / zoom]);
        return true;
      }
    }
    return false;
  }

  /** Original-Objekte der PDF ändern; eigene Objekte ersetzen (`next`) bzw. entfernen (`drop`) im selben Schritt. */
  const origOp = (page: number, edits: OrigEdit[], next: Item[], drop: number[] = []) =>
    void pageOp({ op: "orig", page, edits }, (its) =>
      its.filter((it) => !drop.includes(it.id)).map((it) => next.find((n) => n.id === it.id) ?? it), !drop.length && edits.every((e) => "matrix" in e));

  const removeSel = (ownOnly = false) => {
    const orig = selection.ids.filter((i) => i < 0).map((i) => ({ index: -1 - i }));
    // Original-Objekte nur auf Ebene 1: sonst unsichtbar ausgewählt
    if (orig.length && !ownOnly && layer === 1) return origOp(selection.page, orig, [], selItems.map((it) => it.id));
    if (!selItems.length) return;
    const ids = new Set(selItems.map((it) => it.id));
    edit((its) => its.filter((it) => !ids.has(it.id)));
    clearSel();
  };

  /** Kopieren/Ausschneiden (Strg+C/X und Menü): interne Zwischenablage füllen; Ergebnis = Text fürs System, null = nichts */
  const copySel = (cut: boolean): string | null => {
    // markierter PDF-Text (auch OCR) → nur Text; Ausschneiden geht nicht
    if (!selItems.length && textSel?.text && textSel.v === version) {
      clip.text = null;
      return textSel.text;
    }
    if (!selItems.length) return null;
    clip.items = selItems;
    clip.text = selItems.map((it) => it.text).filter(Boolean).join("\n");
    if (cut) removeSel(true); // Original-Objekte nicht in der Zwischenablage → nicht ausschneiden
    return clip.text;
  };

  /** Einfügen aus dem Menü (kein paste-Event): System-Zwischenablage lesen wie Strg+V; ohne Leserecht die interne */
  async function pasteAt(at?: [page: number, x: number, y: number]) {
    let list: ClipboardItems;
    try {
      list = await navigator.clipboard.read();
    } catch {
      return paste(at);
    }
    for (const ci of list) {
      const type = ci.types.find((t) => t.startsWith("image/"));
      if (type) {
        try {
          return await insertImage(await blobToB64(await ci.getType(type)), at);
        } catch (err) {
          return setError(`Bild einfügen fehlgeschlagen: ${String(err)}`);
        }
      }
      if (!ci.types.includes("text/plain")) continue;
      const text = await (await ci.getType("text/plain")).text();
      if (clip.items.length && text === clip.text) return paste(at);
      if (text.trim()) return insertText(text, at);
    }
    paste(at);
  }

  /** Nach vorn/hinten = Zeichenreihenfolge; nur unter Objekten derselben Seite und Ebene */
  function order(front: boolean) {
    const [one] = selItems;
    if (!one) return;
    const ids = new Set(selItems.map((it) => it.id));
    const peer = (it: Item) => !ids.has(it.id) && it.page === one.page && layerOf(it) === layerOf(one);
    const reorder = (all: Item[]) => {
      const rest = all.filter((it) => !ids.has(it.id));
      const k = front ? rest.findLastIndex(peer) + 1 : rest.findIndex(peer);
      return [...rest.slice(0, k), ...all.filter((it) => ids.has(it.id)), ...rest.slice(k)];
    };
    // schon ganz vorn/hinten (oder allein) → kein leerer Undo-Schritt
    if (!items.some(peer) || reorder(items).every((it, i) => it === items[i])) return;
    edit(reorder);
  }

  function pageCmd(page: number, c: Cmd, at?: [number, number]) {
    const where = at && ([page, ...at] as [number, number, number]);
    switch (c) {
      case "cut":
      case "copy": {
        const t = copySel(c === "cut");
        if (t !== null) void navigator.clipboard.writeText(t).catch(() => {});
        break;
      }
      case "paste": return void pasteAt(where);
      case "delete": return removeSel();
      case "front":
      case "back": return order(c === "front");
      case "image": return void insertImageFile(where);
      case "space": return chooseTool("space");
      case "notes": return switchLayer(3);
    }
  }

  /** Kontextmenü-Taste/Umschalt+F10: Menü an der Auswahl bzw. Ansichtsmitte (synthetisches contextmenu an der Seite) */
  function openMenu() {
    const c = viewCenter();
    const page = selection.page >= 0 ? selection.page : c?.[0] ?? 0;
    const el = scroller.current?.querySelector(`[data-page="${page}"]`);
    if (!el) return;
    const b = selItems.length ? unionBox(selItems) : null;
    const [w, h] = sizes[page] ?? A4;
    const [x, y] = b ? [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] : c?.[0] === page ? [c[1], c[2]] : [w / 2, h / 2];
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + x * zoom, clientY: r.top + y * zoom }));
  }

  useEffect(() => {
    apis.set(view, { save, dropImage, state: () => ({ zoom, ...scrollPos.current, layer, mouse: tool, pen: penTool }) });
  });
  useEffect(() => () => void apis.delete(view), [apis, view]);
  useEffect(() => onDirty(id, dirty), [onDirty, id, dirty]);

  // Beim Öffnen auf Seitenbreite zoomen (wiederhergestellte Sitzung behält ihren Zoom)
  useLayoutEffect(() => {
    if (start) return;
    const width = (scroller.current?.clientWidth || 800) - 48;
    setZoom(clampZoom(width / Math.max(...init.sizes.map(([w]) => w))));
  }, [init, start]);

  // Versteckt verliert das Element seine Scroll-Position → beim Wiederanzeigen zurücksetzen
  useLayoutEffect(() => {
    if (visible) scroller.current?.scrollTo(scrollPos.current.left, scrollPos.current.top);
  }, [visible]);

  // Tastatur nur für die aktive Hälfte: Strg+S/Strg+Umschalt+S, Strg+Z/Y, Strg+A, Entf, Esc, Strg +/− Zoom,
  // Werkzeug-Kürzel ohne Strg. Strg+C/X/V laufen über die copy/cut/paste-Ereignisse unten (System-Zwischenablage).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const c = comboOf(e);
      if (c === KEYS.save && e.target instanceof HTMLElement && e.target.closest("[data-field]")) {
        e.preventDefault();
        e.target.blur(); // übernimmt den Wert (blur → setField, synchron)
        if (fieldN.current || busy.current) saveSoon.current = true;
        else void save().catch(() => {});
        return;
      }
      if (inField(e.target) || e.altKey || e.metaKey) return;
      // Tippen bei genau einem ausgewählten Textfeld → Cursor ans Ende, Zeichen einfügen (statt Werkzeug-Kürzel)
      const [one] = selItems;
      if (!e.ctrlKey && e.key.length === 1 && selItems.length === 1 && one?.kind === "text") {
        e.preventDefault();
        typers.get(selection.page)?.(one.id, e.key);
        return;
      }
      const nudge = (dx: number, dy: number, n: number) => () =>
        edit((all) => all.map((it) => it.page === selection.page && selection.ids.includes(it.id) ? moveItem(it, dx * n, dy * n) : it));
      const act = keyMap([
        [KEYS.save, () => void save().catch(() => {})],
        [KEYS.saveAs, () => setSaveDlg({ flat: false, encrypt: false, pw: "", pw2: "" })],
        [KEYS.undo, () => void travel(hist.at - 1)],
        [KEYS.redo, () => void travel(hist.at + 1)],
        [KEYS.selectAll, () => {
          const page = Math.min(current, sizes.length - 1);
          setTool("lasso");
          if (layer !== 1) return setSelection({ page, ids: items.filter((it) => it.page === page && layerOf(it) === layer).map((it) => it.id) });
          const v = version;
          invoke<number[][]>("orig_objects", { id, index: page }).then(
            (b) => v === version && setSelection({ page, ids: b.map((_, i) => -1 - i) }), () => {});
        }],
        [KEYS.zoomIn, () => applyZoom(zoom * 1.2)],
        [KEYS.zoomOut, () => applyZoom(zoom / 1.2)],
        [KEYS.search, () => {
          setFind((f) => f ?? { q: "", done: null, hits: [], at: -1, v: version });
          requestAnimationFrame(() => findInput.current?.select());
        }],
        [KEYS.del, removeSel],
        [KEYS.escape, () => {
          setLinkFrom(undefined);
          setTools((s) => ({ ...s, locked: false, mouse: settings.auto ? "lasso" : s.mouse }));
          clearSel();
          setTextSel(null);
        }],
        [KEYS.image, () => void insertImageFile()],
        [KEYS.menu, openMenu],
        ...TOOL_LABELS.map(([t, , , key]): [string, () => void] => [key, () => chooseTool(t)]),
        ...LAYERS.map(([l]): [string, () => void] => [String(l), () => switchLayer(l)]),
        // Pfeiltasten schieben eigene ausgewählte Objekte (Umschalt = 10 pt)
        ...(selItems.length ? ([["←", -1, 0], ["→", 1, 0], ["↑", 0, -1], ["↓", 0, 1]] as const).flatMap(([key, dx, dy]): [string, () => void][] =>
          [[key, nudge(dx, dy, 1)], [`Umschalt+${key}`, nudge(dx, dy, 10)]]) : []),
      ]);
      const f = act[c];
      if (f) {
        e.preventDefault();
        f();
      }
    };
    const onCopy = (e: ClipboardEvent) => {
      if (inField(e.target) || !e.clipboardData) return;
      const t = copySel(e.type === "cut");
      if (t === null) return;
      e.preventDefault();
      e.clipboardData.setData("text/plain", t);
    };
    // Reihenfolge: Bild → eigene Objekte (Text unverändert seit dem Kopieren) → Text als Textfeld
    const onPaste = (e: ClipboardEvent) => {
      const d = e.clipboardData;
      if (inField(e.target) || !d) return;
      e.preventDefault();
      const file = [...d.files].find((f) => f.type.startsWith("image/"));
      if (file) {
        return void blobToB64(file).then(insertImage).catch((err: unknown) => setError(`Bild einfügen fehlgeschlagen: ${String(err)}`));
      }
      const text = d.getData("text/plain");
      if (clip.items.length && text === clip.text) return paste();
      if (text.trim()) insertText(text);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCopy);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCopy);
      document.removeEventListener("paste", onPaste);
    };
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

  // Finger: 1 = scrollen, 2 = Pinch-Zoom um den Fingermittelpunkt + verschieben. Stift/Maus zeichnen in PageView.
  // Palm-Rejection: solange der Stift aufliegt (und PALM_MS danach) und bei breiter Auflage zählen Finger nicht.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  /** Abstand und Zoom beim Aufsetzen, dazu der Inhaltspunkt (CSS-px bei Zoom 1) unter dem Mittelpunkt */
  const pinch = useRef<{ d: number; z: number; cx: number; cy: number }>(null);
  const pen = useRef({ down: false, at: -Infinity });
  const fingers = () => [...touches.current.values()];
  const dist = () => {
    const [a, b] = fingers();
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  /** Mittelpunkt der zwei Finger relativ zum Scroll-Container */
  const mid = () => {
    const [a, b] = fingers(), r = scroller.current?.getBoundingClientRect();
    return a && b && r ? { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top } : { x: 0, y: 0 };
  };
  const penEvent = (e: React.PointerEvent) => {
    if (e.pointerType !== "pen") return;
    if (e.type === "pointerdown") {
      // Stift setzt auf → laufende Finger-Geste (Handballen) abbrechen
      touches.current.clear();
      pinch.current = null;
    }
    pen.current = { down: e.type === "pointerdown" || (pen.current.down && e.type === "pointermove"), at: performance.now() };
  };
  const touchDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    if (pen.current.down || performance.now() - pen.current.at < PALM_MS || e.width > PALM_PX) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const el = scroller.current, m = mid();
    pinch.current = touches.current.size === 2 && el
      ? { d: dist(), z: zoom, cx: (el.scrollLeft + m.x) / zoom, cy: (el.scrollTop + m.y) / zoom } : null;
  };
  const touchMove = (e: React.PointerEvent) => {
    const t = touches.current.get(e.pointerId);
    if (!t) return;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pc = pinch.current, el = scroller.current;
    if (pc && pc.d > 0 && el) {
      // ponytail: Seitenränder/Abstände skalieren nicht mit → Punkt unter den Fingern wandert leicht
      const nz = clampZoom((pc.z * dist()) / pc.d), m = mid();
      setZoom(nz);
      requestAnimationFrame(() => el.scrollTo(pc.cx * nz - m.x, pc.cy * nz - m.y));
    } else if (touches.current.size === 1) el?.scrollBy(-dx, -dy);
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
    if (!el || !visible) return;
    scrollPos.current = { left: el.scrollLeft, top: el.scrollTop };
    const mid = el.scrollTop + el.clientHeight / 3;
    const pages = el.querySelectorAll<HTMLElement>("[data-page]");
    let i = 0;
    pages.forEach((p, n) => p.offsetTop <= mid && (i = n));
    setCurrent(i);
  };

  const sep = <span className="mx-1 h-5 w-px bg-line" />;
  const mk = tool === "marker";
  const palette = mk ? pal.marker : pal.pen;
  const pick = mk ? marker : preset;
  const setPick = mk ? setMarker : setPreset;
  const same = (a: Preset, b: Preset) => a.name === b.name && a.size === b.size && a.color.every((c, k) => c === b.color[k]);
  const setPalette = (list: Preset[]) => setPal((p) => (mk ? { ...p, marker: list } : { ...p, pen: list }));
  const hex = (c: Preset["color"]) => "#" + c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");

  return (
    <div
      className={`min-w-0 flex-col border-t-2 ${marked ? "border-accent" : "border-transparent"} ${visible ? "flex" : "hidden"}`}
      style={style}
      onPointerDownCapture={onFocus}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface px-3 py-1.5">
        <IconBtn icon={sideOpen ? PanelLeftClose : PanelLeftOpen} label={T.sidebar} onClick={onSide} aria-pressed={sideOpen} />
        <IconBtn icon={Save} label={T.save} keys={KEYS.save} onClick={() => void save().catch(() => {})} disabled={!dirty} />
        <IconBtn icon={FileOutput} label={T.saveAs} keys={KEYS.saveAs} onClick={() => setSaveDlg({ flat: false, encrypt: false, pw: "", pw2: "" })} />
        {sep}
        <IconBtn icon={Undo2} label={T.undo} keys={KEYS.undo} onClick={() => void travel(hist.at - 1)} disabled={hist.at === 0} />
        <IconBtn icon={Redo2} label={T.redo} keys={KEYS.redo} onClick={() => void travel(hist.at + 1)} disabled={hist.at >= hist.list.length - 1} />
        {sep}
        {/* Bei „Automatisch wechseln": Rahmen = Maus-Werkzeug, Punkt = Stift-Werkzeug; Doppelklick auf Form = Schloss */}
        {TOOL_LABELS.map(([t, icon, label, key]) => (
          <IconBtn
            key={t}
            icon={icon}
            label={label}
            keys={key}
            className={`${btn} relative${settings.auto ? (tool === t ? " ring-1 ring-inset ring-accent text-ink" : "") : on(tool === t)}`}
            onClick={(e) => chooseTool(t, (e.nativeEvent as PointerEvent).pointerType === "pen" ? "pen" : "mouse")}
            onDoubleClick={() => SHAPE_TOOLS.includes(t) && setTools((s) => ({ ...s, locked: true }))}
          >
            {locked && (tool === t || (settings.auto && penTool === t)) && <Lock size={10} aria-label={T.locked} className="absolute bottom-0.5 right-0.5" />}
            {settings.auto && penTool === t && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-pill bg-accent" aria-label={T.penMark} />}
          </IconBtn>
        ))}
        {sep}
        {LAYERS.map(([l, icon, label]) => (
          <IconBtn key={l} icon={icon} label={label} keys={String(l)} className={btn + on(layer === l)} onClick={() => switchLayer(l)} aria-pressed={layer === l}>
            <sub className="font-mono">{l}</sub>
          </IconBtn>
        ))}
        <IconBtn icon={ImagePlus} label={T.image} keys={KEYS.image} onClick={() => void insertImageFile()} />
        <Menu icon={Plus} label={T.insert} keys={KEYS.paste}>
          <MenuItem icon={ImagePlus} label={T.imageFile} onClick={() => void insertImageFile()} />
          <MenuItem icon={Type} label={T.textBox} onClick={() => insertText("Text")} />
          {SHAPES.map(([k, icon, l]) => <MenuItem key={k} icon={icon} label={l} onClick={() => insertShape(k)} />)}
          <MenuItem icon={BetweenHorizontalStart} label={T.space} onClick={() => chooseTool("space")} />
        </Menu>
        {sep}
        {palette.map((p) => (
          <button
            key={p.name}
            title={p.name} aria-label={p.name}
            onClick={() => setPick(p)}
            className={`grid h-7 w-7 place-items-center rounded-pill ring-2 ${same(p, pick) ? "ring-accent" : "ring-transparent"}`}
          >
            <span className="block rounded-pill" style={{ width: Math.min(p.size * 3, 18), height: Math.min(p.size * 3, 18), background: `rgb(${p.color.map((c) => c * 255).join(",")})`, outline: "1px solid var(--line-2)" }} />
          </button>
        ))}
        {/* Zahnrad: Stärke/Farbe stufenlos, wirkt sofort aufs aktive Werkzeug; Presets speichern/überschreiben */}
        <Menu icon={Palette} label={T.style} panel="w-56 gap-2 p-3">
            <label className="flex flex-col gap-1">
              {tool === "lasso" ? `${T.textSize} ${pal.text} pt` : `${T.size} ${pick.size.toFixed(1)}`}
              <input type="range" aria-label={T.size}
                min={tool === "lasso" ? 6 : 0.5} max={tool === "lasso" ? 72 : mk ? 40 : 20} step={tool === "lasso" ? 1 : 0.1}
                value={tool === "lasso" ? pal.text : pick.size}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (tool === "lasso") setPal((p) => ({ ...p, text: v }));
                  else setPick({ ...pick, size: v });
                }} />
            </label>
            <label className="flex items-center justify-between">
              {T.color}
              <input type="color" aria-label={T.color} value={hex(pick.color)}
                onChange={(e) => {
                  const n = parseInt(e.target.value.slice(1), 16);
                  setPick({ ...pick, color: [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] });
                }} />
            </label>
            <IconBtn icon={Plus} label={T.presetAdd} text onClick={() => {
              const p = { ...pick, name: `${T.custom} ${palette.length + 1}` };
              setPalette([...palette, p]);
              setPick(p);
            }} />
            <IconBtn icon={Save} label={T.presetSet} text disabled={!palette.some((p) => p.name === pick.name)}
              onClick={() => setPalette(palette.map((p) => (p.name === pick.name ? pick : p)))} />
            {(tool === "axes" || penTool === "axes") && (
              <div className="flex flex-col gap-1 border-t border-line pt-2">
                <div className="flex gap-1">
                  {([[false, T.axesXy], [true, T.axesXyz]] as const).map(([v, l]) => (
                    <button key={l} className={btn + on(axes.xyz === v)} onClick={() => setAxes((a) => ({ ...a, xyz: v }))}>{l}</button>
                  ))}
                </div>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={axes.grid} onChange={(e) => setAxes((a) => ({ ...a, grid: e.target.checked }))} />
                  {T.grid}
                </label>
              </div>
            )}
        </Menu>
        {sep}
        <Menu icon={FilePlus} label={T.pageAdd}>
          {PAGE_KINDS.map(([k, icon, l]) => <MenuItem key={k} icon={icon} label={l} onClick={() => insertBlank(k === "blank" ? undefined : k)} />)}
          <MenuItem icon={FileCode} label={T.markdownPage}
            onClick={() => setMdEdit({ page: Math.min(current + 1, sizes.length), source: `# ${T.title}\n\n`, insert: true })} />
        </Menu>
        {md !== null && <IconBtn icon={FilePenLine} label={T.markdownEdit} onClick={() => setMdEdit({ page: current, source: md, insert: false })} />}
        <IconBtn icon={Paperclip} label={T.appendPdf} onClick={() => void insertFile(sizes.length, "PDF", ["pdf"])} />
        <IconBtn icon={FileImage} label={T.imagePage} onClick={() => void insertFile(Math.min(current + 1, sizes.length), "Bild", ["png", "jpg", "jpeg"])} />
        <IconBtn icon={RotateCw} label={T.rotate} onClick={rotate} />
        <IconBtn icon={ScanText} label={T.ocr} onClick={() => void pageOp({ op: "ocr" }, (its) => its)} />
        <IconBtn icon={FileMinus} label={T.pageDelete} onClick={deletePage} disabled={sizes.length < 2} />
        {sep}
        <IconBtn icon={ZoomOut} label={T.zoomOut} keys={KEYS.zoomOut} onClick={() => applyZoom(zoom / 1.2)} />
        <span className="w-12 text-center font-mono text-xs text-ink-2">{Math.round(zoom * 100)} %</span>
        <IconBtn icon={ZoomIn} label={T.zoomIn} keys={KEYS.zoomIn} onClick={() => applyZoom(zoom * 1.2)} />
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
            aria-label={T.page}
            title={T.page}
            className="w-12 rounded-xs border border-line bg-sunken px-1.5 py-0.5 text-center font-mono text-xs text-ink"
          />
          / {sizes.length}
        </form>
        {find && (
          <form
            className="flex items-center gap-1 text-sm text-ink-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (find.done !== find.q || find.v !== version) void search(find.q);
              else step(1);
            }}
          >
            <input
              ref={findInput}
              autoFocus
              value={find.q}
              onChange={(e) => setFind({ ...find, q: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Escape") setFind(null);
                else if (e.key === "Enter" && e.shiftKey) {
                  e.preventDefault();
                  step(-1);
                }
              }}
              placeholder={`${T.search} …`}
              aria-label={T.search}
              title={tip(T.search, "Strg+F")}
              className="w-40 rounded-xs border border-line bg-sunken px-1.5 py-0.5 text-xs text-ink"
            />
            <span className="w-14 font-mono text-xs">{find.done === null ? "" : `${find.at + 1}/${hits.length}`}</span>
            <IconBtn icon={X} label={T.searchClose} keys={KEYS.escape} onClick={() => setFind(null)} />
          </form>
        )}
        {tool === "link" && linkFrom && <span className="text-sm text-accent">{T.linkTarget}</span>}
        {error && <span className="ml-auto text-sm text-red-400">{error}</span>}
      </div>
      <div className="relative flex min-h-0 flex-1">
        {sideOpen && <div className="flex shrink-0 flex-col border-r border-line bg-sunken">
        <div className="flex gap-1 border-b border-line p-1">
          <IconBtn icon={Files} label={T.pages} className={btn + on(side === "pages") + " flex-1 justify-center"} onClick={() => setSide("pages")} />
          <IconBtn icon={Bookmark} label={T.marks} className={btn + on(side === "marks") + " flex-1 justify-center"} onClick={() => setSide("marks")} />
        </div>
        {side === "marks" ? (
          <div className="flex min-h-0 w-56 flex-1 flex-col">
            <div className="flex flex-wrap gap-0.5 border-b border-line p-1">
              <IconBtn
                icon={BookmarkPlus}
                label={T.markAdd}
                onClick={() => {
                  const [next, i] = ol.add(marks, `${T.page} ${current + 1}`, current);
                  void setOutline(next, i).then((ok) => ok && setRenaming(i));
                }}
              />
              <IconBtn icon={ArrowUp} label={T.up} disabled={markSel < 0} onClick={() => void setOutline(...ol.moveUp(marks, markSel))} />
              <IconBtn icon={ArrowDown} label={T.down} disabled={markSel < 0} onClick={() => void setOutline(...ol.moveDown(marks, markSel))} />
              <IconBtn icon={ListIndentDecrease} label={T.outdent} disabled={markSel < 0} onClick={() => void setOutline(...ol.outdent(marks, markSel))} />
              <IconBtn icon={ListIndentIncrease} label={T.indent} disabled={markSel < 0} onClick={() => void setOutline(ol.indent(marks, markSel))} />
              <IconBtn icon={LocateFixed} label={T.markTarget} disabled={markSel < 0}
                onClick={() => void setOutline(marks.map((m, k) => (k === markSel ? { ...m, page: current } : m)))} />
              <IconBtn icon={Trash} label={T.del} disabled={markSel < 0} onClick={() => void setOutline(ol.remove(marks, markSel), -1)} />
            </div>
            <ul data-scroll className="flex-1 overflow-y-auto py-1 text-sm">
              {marks.length === 0 && <li className="px-3 py-2 text-ink-2">{T.noMarks}</li>}
              {marks.map((m, i) => (
                <li key={i} style={{ paddingLeft: 8 + 14 * m.level }} className={`pr-2 ${i === markSel ? "bg-accent-soft" : ""}`}>
                  {renaming === i ? (
                    <input
                      autoFocus
                      defaultValue={m.title}
                      aria-label={T.title}
                      className="w-full rounded-xs border border-line bg-surface px-1 text-ink"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        // Esc: alten Titel zurück, dann blur → onBlur speichert nichts
                        if (e.key === "Escape") {
                          e.currentTarget.value = m.title;
                          e.currentTarget.blur();
                        }
                      }}
                      onBlur={(e) => {
                        const t = e.currentTarget.value.trim();
                        setRenaming(-1);
                        if (t && t !== m.title) void setOutline(marks.map((x, k) => (k === i ? { ...x, title: t } : x)));
                      }}
                    />
                  ) : (
                    <button
                      className="w-full truncate py-0.5 text-left text-ink-2 hover:text-ink"
                      title={m.page >= 0 ? `${m.title} – ${T.page} ${m.page + 1}` : m.title}
                      onClick={() => {
                        setMarkSel(i);
                        if (m.page >= 0) goTo(m.page);
                      }}
                      onDoubleClick={() => setRenaming(i)}
                    >{m.title || "–"}</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
        <nav
          data-scroll
          className="flex w-40 min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto border-r border-line bg-sunken py-3"
          onPointerMove={navMove}
          onPointerUp={navUp}
          onPointerCancel={navUp}
        >
          {sizes.map((s, i) => (
            <Thumb
              key={i}
              doc={id}
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
        </div>}
        {openUrl && (
          <Dialog title={T.openBrowser} ok={T.open} onOk={() => { void invoke("open_url", { url: openUrl }).catch(() => {}); setOpenUrl(undefined); }} onCancel={() => setOpenUrl(undefined)}>
            <div className="break-all font-mono text-xs text-muted">{openUrl}</div>
          </Dialog>
        )}
        {saveDlg && (
          <Dialog title={T.saveAs} ok={T.chooseTarget} onOk={() => void saveAs()} onCancel={() => setSaveDlg(undefined)}>
            <div className="flex gap-1">
              <IconBtn icon={Flame} label={T.burnIn} aria-pressed={saveDlg.flat} className={btn + on(saveDlg.flat)}
                onClick={() => setSaveDlg({ ...saveDlg, flat: !saveDlg.flat, error: undefined })} />
              <IconBtn icon={Lock} label={T.encrypt} aria-pressed={saveDlg.encrypt} className={btn + on(saveDlg.encrypt)}
                onClick={() => setSaveDlg({ ...saveDlg, encrypt: !saveDlg.encrypt, error: undefined })} />
            </div>
            {saveDlg.encrypt && <>
              <input type="password" autoFocus aria-label={T.password} placeholder={T.password} className={FIELD} value={saveDlg.pw}
                onChange={(e) => setSaveDlg({ ...saveDlg, pw: e.target.value, error: undefined })} />
              <input type="password" aria-label={T.passwordRepeat} placeholder={T.passwordRepeat} className={FIELD} value={saveDlg.pw2}
                onChange={(e) => setSaveDlg({ ...saveDlg, pw2: e.target.value, error: undefined })} />
            </>}
            {saveDlg.error && <div role="alert" className="text-red-400">{saveDlg.error}</div>}
          </Dialog>
        )}
        {mdEdit && (
          <div className="absolute inset-4 z-20 flex flex-col gap-2 rounded-xs border border-line bg-surface p-3">
            <div className="text-sm text-ink-2">
              {mdEdit.insert ? `Neue Markdown-Seite nach Seite ${mdEdit.page}` : `Markdown-Seite ${mdEdit.page + 1}`} – # Überschrift, - Liste, 1. Liste, &gt; Zitat, ``` Code, ---
            </div>
            <textarea
              autoFocus
              value={mdEdit.source}
              aria-label="Markdown"
              spellCheck={false}
              className="flex-1 resize-none rounded-xs border border-line bg-sunken p-2 font-mono text-sm text-ink"
              onChange={(e) => setMdEdit({ ...mdEdit, source: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.ctrlKey) void saveMarkdown();
                if (e.key === "Escape") setMdEdit(undefined);
              }}
            />
            <div className="flex justify-end gap-2">
              <IconBtn icon={X} label={T.cancel} keys="Esc" text onClick={() => setMdEdit(undefined)} />
              <IconBtn icon={Check} label={T.apply} keys="Strg+Enter" text className={btn + on(true)} onClick={() => void saveMarkdown()} />
            </div>
          </div>
        )}
        <main
          ref={scroller}
          data-scroll
          className="flex-1 overflow-auto"
          style={{ touchAction: "none" }}
          onScroll={onScroll}
          onPointerDownCapture={penEvent}
          onPointerMoveCapture={penEvent}
          onPointerUpCapture={penEvent}
          onPointerCancelCapture={penEvent}
          onPointerDown={touchDown}
          onPointerMove={touchMove}
          onPointerUp={touchUp}
          onPointerCancel={touchUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="flex w-max min-w-full flex-col gap-4 p-6">
            {sizes.map((s, i) => (
              <PageView
                key={i}
                doc={id}
                index={i}
                size={s}
                zoom={zoom}
                version={version}
                items={items.filter((x) => x.page === i)}
                selected={selection.page === i ? selection.ids : []}
                tool={tool}
                penTool={settings.auto ? penTool : tool}
                typers={typers}
                preset={preset}
                marker={marker}
                axes={axes}
                textSize={pal.text}
                settings={settings}
                layer={layer}
                textSel={textSel?.page === i && textSel.v === version ? textSel : null}
                onTextSel={(t) => {
                  clearSel();
                  setTextSel(t && { ...t, page: i, v: version });
                }}
                onAdd={(it) => edit((all) => [...all, { ...it, layer: layer === 1 ? kindLayer(it.kind) : layer }])}
                onShape={(it) => {
                  edit((all) => [...all, { ...it, layer: layer === 1 ? kindLayer(it.kind) : layer }]);
                  setTextSel(null);
                  setSelection({ page: i, ids: [it.id] });
                  setTools(afterShape);
                }}
                onRemove={(ids) => edit((all) => all.filter((it) => !ids.includes(it.id)))}
                onReplace={(next) => edit((all) => all.map((it) => next.find((n) => n.id === it.id) ?? it))}
                onCrop={(cid, f) => {
                  const img = items.find((it) => it.id === cid);
                  if (img) invoke<string>("crop_image", { image: img.image, frac: f })
                    .then((b64) => edit((all) => all.map((it) => it.id === cid ? cropItem(it, f, b64) : it)))
                    .catch((e: unknown) => setError(`Zuschneiden fehlgeschlagen: ${String(e)}`));
                }}
                onSelect={(page, ids) => {
                  setTextSel(null);
                  setSelection({ page, ids });
                }}
                onOrig={(edits, next) => origOp(i, edits, next)}
                onText={(edit: TextEdit) => void pageOp({ op: "text", page: i, edit }, (its) => its)}
                onField={(xref, value) => setField(i, xref, value)}
                onNewField={(field: NewField) => void pageOp({ op: "newField", page: i, field }, (its) => its)}
                hits={hits.length ? hits.flatMap((h, k) => h.page === i ? [{ rect: h.rect, active: k === find?.at }] : []) : NO_HITS}
                linking={tool === "link" && !!linkFrom}
                onLinkFrom={(rect) => setLinkFrom({ page: i, rect })}
                onLinkTo={(x, y) => {
                  if (!linkFrom) return;
                  setLinkFrom(undefined);
                  void pageOp({ op: "link", from: linkFrom.page, rect: linkFrom.rect, to: i, x, y }, (its) => its);
                }}
                onJump={goTo}
                onOpenUrl={setOpenUrl}
                onUnlink={(n) => void pageOp({ op: "unlink", page: i, n }, (its) => its)}
                onCmd={(c, at) => pageCmd(i, c, at)}
                onSpace={(moved) => {
                  if (moved.length) edit((all) => all.map((it) => moved.find((n) => n.id === it.id) ?? it));
                  setTools(afterShape);
                }}
              />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
