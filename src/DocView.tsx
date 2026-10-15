import { invoke } from "@tauri-apps/api/core";
import { message, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties } from "react";
import { z } from "zod";
import {
  afterDelete, afterInsert, afterMove, afterRotate, box, DEFAULT_PRESET, fromData, imageItem, imageMime, ItemData, MARKERS,
  moveItem, newId, PRESETS, TEXT_SIZE, textRect, toData, type Item, type Preset,
} from "./ink";
import * as ol from "./outline";
import { PageView, Thumb, type Hit, type NewField, type OrigEdit, type TextEdit } from "./PageView";
import { type Settings, type Tool } from "./settings";

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

/** Werkzeug, Beschriftung, Tooltip, Kürzel */
const TOOL_LABELS: [Tool, string, string, string][] = [
  ["pen", "Stift", "Stift", "p"], ["marker", "Marker", "Textmarker", "m"], ["eraser", "Radierer", "Radierer (nur eigene Objekte)", "e"],
  ["lasso", "Lasso", "Auswählen, Verschieben, Skalieren", "a"], ["text", "Text", "Textfeld", "t"], ["line", "╱", "Linie", "l"],
  ["arrow", "→", "Pfeil", "f"], ["rect", "▭", "Rechteck", "r"], ["ellipse", "◯", "Kreis/Ellipse", "k"],
  ["pdftext", "PDF-Text", "Text der PDF: Klick bearbeitet den Absatz, Ziehen verschiebt ihn", "b"],
  ["form", "Formular", "Formularfelder ausfüllen (Tab = nächstes Feld), Ziehen auf freier Fläche legt ein neues Feld an", "o"],
  ["link", "Link", "Anker-Links: Rechteck ziehen, dann Zielstelle anklicken; Klick auf Link springt", "g"],
];
const SHAPES: [Item["kind"], string][] = [["rect", "Rechteck"], ["ellipse", "Kreis/Ellipse"], ["line", "Linie"], ["arrow", "Pfeil"]];

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
export interface DocApi { save: () => Promise<void> }

/**
 * Ein offenes Dokument mit eigenem Undo, Zoom, Scroll und Werkzeug. Bleibt gemountet, solange der Tab offen ist;
 * versteckt (`visible` = false) gibt es seine Seitenbilder frei (IntersectionObserver in PageView).
 */
export function DocView({ id, path, init, visible, active, marked, settings, style, apis, onDirty, onFocus }: {
  id: number; path: string; init: Snap; visible: boolean; active: boolean; marked: boolean; settings: Settings;
  style: CSSProperties; apis: Map<number, DocApi>; onDirty: (id: number, dirty: boolean) => void; onFocus: () => void;
}) {
  const [hist, setHist] = useState<History>({ list: [init], at: 0 });
  const [saved, setSaved] = useState<Snap>(init);
  const [version, setVersion] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<Tool>("pen");
  const [preset, setPreset] = useState<Preset>(DEFAULT_PRESET);
  const [marker, setMarker] = useState<Preset>(MARKERS[0] ?? DEFAULT_PRESET);
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
  const scroller = useRef<HTMLDivElement>(null);
  const scrollPos = useRef({ left: 0, top: 0 });
  const busy = useRef(false);
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
        const r = await message("Die PDF wurde seit dem Öffnen außerhalb von PDF Note geändert. Beim Speichern gehen diese Änderungen verloren.", {
          title: "PDF Note", kind: "warning", buttons: { ok: "Trotzdem speichern", cancel: "Abbrechen" },
        });
        if (r === "Trotzdem speichern") return save(true);
        setError("Nicht gespeichert: Datei extern geändert");
      } else setError(`Speichern fehlgeschlagen: ${String(e)}`);
      throw e;
    }
  }

  /** Speichern unter, flach: Objekte eingebrannt, nicht mehr bearbeitbar. Weitergearbeitet wird an der offenen PDF. */
  async function saveAs() {
    if (busy.current) return;
    const target = await saveDialog({ filters: [{ name: "PDF", extensions: ["pdf"] }], defaultPath: path.replace(/\.pdf$/i, "") + "-flach.pdf" });
    if (!target) return;
    // flach über die offene Datei: eigene Objekte wären danach doppelt (eingebrannt + noch im Speicher)
    if (target.toLowerCase() === path.toLowerCase()) return setError("Flach nicht über die offene Datei speichern – anderen Namen wählen");
    try {
      await invoke("save_pdf", { id, items: items.map(toData), target, flat: true, force: false });
      setError(undefined);
    } catch (e) {
      setError(`Speichern unter fehlgeschlagen: ${String(e)}`);
    }
  }

  /** Seitenoperation im Backend; Objekte werden mit umnummeriert, Objekte einer eingefügten PDF kommen dazu. */
  async function pageOp(op: object, remap: (items: Item[], inserted: number) => Item[]): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    try {
      const r = PageState.parse(await invoke("page_op", { id, op }));
      setHist((h) => push(h, {
        items: [...remap((h.list[h.at] ?? EMPTY).items, r.inserted), ...r.items.map(fromData)], rev: r.rev, sizes: r.sizes,
      }));
      setVersion((v) => v + 1);
      clearSel();
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

  /** Neue Objekte hinzufügen, auswählen, Lasso aktiv → gleich verschiebbar. */
  function place(added: Item[]) {
    const page = added[0]?.page;
    if (page === undefined) return;
    edit((its) => [...its, ...added]);
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

  function paste() {
    if (!clip.items.length || !sizes.length) return;
    const page = Math.min(current, sizes.length - 1);
    const pasted = clip.items.map((it) => ({ ...moveItem(it, 10, 10), id: newId(), page }));
    clip.items = pasted; // nochmal einfügen → weiter versetzt
    place(pasted);
  }

  async function insertImage(b64: string) {
    const c = viewCenter();
    if (!c) return;
    const [page, x, y, w, h] = c;
    const img = new Image();
    img.src = `data:${imageMime(b64) ?? "image/png"};base64,${b64}`;
    await img.decode();
    // 1 px = 0,75 pt (96 dpi); höchstens 80 % der kürzeren Seitenkante
    place([imageItem(page, b64, img.naturalWidth * 0.75, img.naturalHeight * 0.75, x, y, 0.8 * Math.min(w, h))]);
  }

  function insertText(text: string) {
    const c = viewCenter();
    const ctx = document.createElement("canvas").getContext("2d");
    if (!c || !ctx) return;
    const [page, x, y] = c;
    const t = text.replace(/\r\n?/g, "\n").slice(0, 100_000);
    const points = textRect(ctx, t, TEXT_SIZE, 0, 0);
    const [, [bw, bh] = [0, 0]] = points;
    place([moveItem({
      id: newId(), page, kind: "text", color: preset.color, opacity: 1, size: TEXT_SIZE, simulated: false, points, text: t,
    }, x - bw / 2, y - bh / 2)]);
  }

  function insertShape(kind: Item["kind"]) {
    const c = viewCenter();
    if (!c) return;
    const [page, x, y] = c;
    const [dx, dy] = kind === "line" || kind === "arrow" ? [60, 0] : [60, 40];
    place([{
      id: newId(), page, kind, color: preset.color, opacity: 1, size: preset.size, simulated: false,
      points: [[x - dx, y - dy, 0.5], [x + dx, y + dy, 0.5]], text: "",
    }]);
  }

  async function insertImageFile() {
    const p = await openDialog({ filters: [{ name: "Bild", extensions: ["png", "jpg", "jpeg"] }] });
    if (typeof p !== "string") return;
    try {
      await insertImage(await invoke<string>("read_image", { path: p }));
    } catch (e) {
      setError(`Bild einfügen fehlgeschlagen: ${String(e)}`);
    }
  }

  /** Original-Objekte der PDF ändern; eigene Objekte ersetzen (`next`) bzw. entfernen (`drop`) im selben Schritt. */
  const origOp = (page: number, edits: OrigEdit[], next: Item[], drop: number[] = []) =>
    void pageOp({ op: "orig", page, edits }, (its) =>
      its.filter((it) => !drop.includes(it.id)).map((it) => next.find((n) => n.id === it.id) ?? it));

  const removeSel = (ownOnly = false) => {
    const orig = selection.ids.filter((i) => i < 0).map((i) => ({ index: -1 - i }));
    // Original-Objekte nur im Lasso: sonst unsichtbar ausgewählt
    if (orig.length && !ownOnly && tool === "lasso") return origOp(selection.page, orig, [], selItems.map((it) => it.id));
    if (!selItems.length) return;
    const ids = new Set(selItems.map((it) => it.id));
    edit((its) => its.filter((it) => !ids.has(it.id)));
    clearSel();
  };

  useEffect(() => {
    apis.set(id, { save });
  });
  useEffect(() => () => void apis.delete(id), [apis, id]);
  useEffect(() => onDirty(id, dirty), [onDirty, id, dirty]);

  // Beim Öffnen auf Seitenbreite zoomen
  useLayoutEffect(() => {
    const width = (scroller.current?.clientWidth || 800) - 48;
    setZoom(clampZoom(width / Math.max(...init.sizes.map(([w]) => w))));
  }, [init]);

  // Versteckt verliert das Element seine Scroll-Position → beim Wiederanzeigen zurücksetzen
  useLayoutEffect(() => {
    if (visible) scroller.current?.scrollTo(scrollPos.current.left, scrollPos.current.top);
  }, [visible]);

  // Tastatur nur für die aktive Hälfte: Strg+S/Strg+Umschalt+S, Strg+Z/Y, Strg+A, Entf, Esc, Strg +/− Zoom,
  // Werkzeug-Kürzel ohne Strg. Strg+C/X/V laufen über die copy/cut/paste-Ereignisse unten (System-Zwischenablage).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "s" && e.target instanceof HTMLElement && e.target.closest("[data-field]")) {
        e.preventDefault();
        e.target.blur(); // übernimmt den Wert (blur → setField, synchron)
        if (fieldN.current || busy.current) saveSoon.current = true;
        else void save().catch(() => {});
        return;
      }
      if (inField(e.target) || e.altKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      const act: Record<string, () => void> = e.ctrlKey ? {
        s: () => void (e.shiftKey ? saveAs() : save().catch(() => {})),
        z: () => void travel(e.shiftKey ? hist.at + 1 : hist.at - 1),
        y: () => void travel(hist.at + 1),
        a: () => {
          const page = Math.min(current, sizes.length - 1);
          setSelection({ page, ids: items.filter((it) => it.page === page).map((it) => it.id) });
          setTool("lasso");
        },
        "+": () => applyZoom(zoom * 1.2),
        "=": () => applyZoom(zoom * 1.2),
        "-": () => applyZoom(zoom / 1.2),
        f: () => {
          setFind((f) => f ?? { q: "", done: null, hits: [], at: -1, v: version });
          requestAnimationFrame(() => findInput.current?.select());
        },
      } : {
        delete: removeSel, backspace: removeSel,
        escape: () => {
          setLinkFrom(undefined);
          clearSel();
        },
        ...Object.fromEntries(TOOL_LABELS.map(([t, , , key]) => [key, () => setTool(t)])),
      };
      const f = act[k];
      if (f) {
        e.preventDefault();
        f();
      }
    };
    const onCopy = (e: ClipboardEvent) => {
      if (inField(e.target) || !selItems.length || !e.clipboardData) return;
      e.preventDefault();
      clip.items = selItems;
      clip.text = selItems.map((it) => it.text).filter(Boolean).join("\n");
      e.clipboardData.setData("text/plain", clip.text);
      if (e.type === "cut") removeSel(true); // Original-Objekte nicht in der Zwischenablage → nicht ausschneiden
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

  const btn = "rounded-xs px-2.5 py-1 text-sm text-ink-2 hover:bg-raised hover:text-ink disabled:opacity-40";
  const on = (b: boolean) => (b ? " bg-accent-soft text-ink" : "");
  const sep = <span className="mx-1 h-5 w-px bg-line" />;
  const palette = tool === "marker" ? MARKERS : PRESETS;
  const pick = tool === "marker" ? marker : preset;

  return (
    <div
      className={`min-w-0 flex-col border-t-2 ${marked ? "border-accent" : "border-transparent"} ${visible ? "flex" : "hidden"}`}
      style={style}
      onPointerDownCapture={onFocus}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface px-3 py-1.5">
        <button className={btn} onClick={() => void save().catch(() => {})} disabled={!dirty} title="Strg+S">Speichern</button>
        <button className={btn} onClick={() => void saveAs()} title="Strg+Umschalt+S – Anmerkungen eingebrannt">Speichern unter (flach)</button>
        {sep}
        <button className={btn} onClick={() => void travel(hist.at - 1)} disabled={hist.at === 0} title="Strg+Z">↶</button>
        <button className={btn} onClick={() => void travel(hist.at + 1)} disabled={hist.at >= hist.list.length - 1} title="Strg+Y">↷</button>
        {sep}
        {TOOL_LABELS.map(([t, label, title, key]) => (
          <button key={t} className={btn + on(tool === t)} onClick={() => setTool(t)} title={`${title} (${key.toUpperCase()})`}>{label}</button>
        ))}
        <select
          value=""
          aria-label="Einfügen"
          title="Einfügen (auch Strg+V aus der Zwischenablage)"
          className="rounded-xs bg-transparent px-1.5 py-1 text-sm text-ink-2 hover:bg-raised hover:text-ink"
          onChange={(e) => {
            const v = e.target.value;
            if (v === "image") void insertImageFile();
            else if (v === "text") insertText("Text");
            else if (v) insertShape(v as Item["kind"]);
          }}
        >
          <option value="" disabled hidden>Einfügen …</option>
          <option value="image">Bild-Datei …</option>
          <option value="text">Textfeld</option>
          {SHAPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {sep}
        {palette.map((p) => (
          <button
            key={p.name}
            title={p.name}
            onClick={() => (tool === "marker" ? setMarker(p) : setPreset(p))}
            className={`grid h-7 w-7 place-items-center rounded-pill ring-2 ${p === pick ? "ring-accent" : "ring-transparent"}`}
          >
            <span className="block rounded-pill" style={{ width: Math.min(p.size * 3, 18), height: Math.min(p.size * 3, 18), background: `rgb(${p.color.map((c) => c * 255).join(",")})`, outline: "1px solid var(--line-2)" }} />
          </button>
        ))}
        {sep}
        <select
          value=""
          aria-label="Seite einfügen"
          title="Neue Seite nach der aktuellen"
          className="rounded-xs bg-transparent px-1.5 py-1 text-sm text-ink-2 hover:bg-raised hover:text-ink"
          onChange={(e) => {
            const v = e.target.value;
            if (v === "markdown") setMdEdit({ page: Math.min(current + 1, sizes.length), source: "# Titel\n\n", insert: true });
            else if (v) insertBlank(v === "blank" ? undefined : v);
          }}
        >
          <option value="" disabled hidden>Seite + …</option>
          <option value="blank">Leer</option>
          <option value="lined">Liniert</option>
          <option value="grid">Kariert</option>
          <option value="dots">Punkte</option>
          <option value="markdown">Markdown-Seite</option>
        </select>
        {md !== null && (
          <button className={btn} onClick={() => setMdEdit({ page: current, source: md, insert: false })} title="Markdown der aktuellen Seite bearbeiten">Markdown ✎</button>
        )}
        <button className={btn} onClick={() => void insertFile(sizes.length, "PDF", ["pdf"])} title="PDF hinten anhängen">PDF anhängen</button>
        <button className={btn} onClick={() => void insertFile(Math.min(current + 1, sizes.length), "Bild", ["png", "jpg", "jpeg"])} title="Bild als Seite nach der aktuellen">Bild</button>
        <button className={btn} onClick={rotate} title="Aktuelle Seite 90° drehen">⟳</button>
        <button className={btn} onClick={deletePage} disabled={sizes.length < 2} title="Aktuelle Seite löschen">Seite −</button>
        {sep}
        <button className={btn} onClick={() => applyZoom(zoom / 1.2)}>−</button>
        <span className="w-12 text-center font-mono text-xs text-ink-2">{Math.round(zoom * 100)} %</span>
        <button className={btn} onClick={() => applyZoom(zoom * 1.2)}>+</button>
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
              placeholder="Suchen …"
              aria-label="Suchen"
              title="Enter = nächster, Umschalt+Enter = vorheriger Treffer, Esc = schließen"
              className="w-40 rounded-xs border border-line bg-sunken px-1.5 py-0.5 text-xs text-ink"
            />
            <span className="w-14 font-mono text-xs">{find.done === null ? "" : `${find.at + 1}/${hits.length}`}</span>
            <button type="button" className={btn} onClick={() => setFind(null)} title="Suche schließen (Esc)">×</button>
          </form>
        )}
        {tool === "link" && linkFrom && <span className="text-sm text-accent">Ziel anklicken (Esc bricht ab)</span>}
        {error && <span className="ml-auto text-sm text-red-400">{error}</span>}
      </div>
      <div className="relative flex min-h-0 flex-1">
        <div className="flex shrink-0 flex-col border-r border-line bg-sunken">
        <div className="flex gap-1 border-b border-line p-1">
          <button className={btn + on(side === "pages") + " flex-1"} onClick={() => setSide("pages")}>Seiten</button>
          <button className={btn + on(side === "marks") + " flex-1"} onClick={() => setSide("marks")}>Lesezeichen</button>
        </div>
        {side === "marks" ? (
          <div className="flex min-h-0 w-56 flex-1 flex-col">
            <div className="flex flex-wrap gap-0.5 border-b border-line p-1">
              <button
                className={btn}
                title="Lesezeichen auf die aktuelle Seite"
                onClick={() => {
                  const [next, i] = ol.add(marks, `Seite ${current + 1}`, current);
                  void setOutline(next, i).then((ok) => ok && setRenaming(i));
                }}
              >+</button>
              <button className={btn} disabled={markSel < 0} title="Nach oben" onClick={() => void setOutline(...ol.moveUp(marks, markSel))}>↑</button>
              <button className={btn} disabled={markSel < 0} title="Nach unten" onClick={() => void setOutline(...ol.moveDown(marks, markSel))}>↓</button>
              <button className={btn} disabled={markSel < 0} title="Ausrücken" onClick={() => void setOutline(...ol.outdent(marks, markSel))}>←</button>
              <button className={btn} disabled={markSel < 0} title="Einrücken" onClick={() => void setOutline(ol.indent(marks, markSel))}>→</button>
              <button
                className={btn}
                disabled={markSel < 0}
                title="Ziel = aktuelle Seite"
                onClick={() => void setOutline(marks.map((m, k) => (k === markSel ? { ...m, page: current } : m)))}
              >⇥</button>
              <button className={btn} disabled={markSel < 0} title="Löschen (Unterpunkte rücken hoch)" onClick={() => void setOutline(ol.remove(marks, markSel), -1)}>×</button>
            </div>
            <ul data-scroll className="flex-1 overflow-y-auto py-1 text-sm">
              {marks.length === 0 && <li className="px-3 py-2 text-ink-2">Keine Lesezeichen</li>}
              {marks.map((m, i) => (
                <li key={i} style={{ paddingLeft: 8 + 14 * m.level }} className={`pr-2 ${i === markSel ? "bg-accent-soft" : ""}`}>
                  {renaming === i ? (
                    <input
                      autoFocus
                      defaultValue={m.title}
                      aria-label="Titel"
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
                      title={m.page >= 0 ? `${m.title} – Seite ${m.page + 1} (Doppelklick: umbenennen)` : `${m.title} – ohne Ziel`}
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
        </div>
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
              <button className={btn} onClick={() => setMdEdit(undefined)}>Abbrechen (Esc)</button>
              <button className={btn + on(true)} onClick={() => void saveMarkdown()}>Übernehmen (Strg+Enter)</button>
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
                preset={preset}
                marker={marker}
                settings={settings}
                onAdd={(it) => edit((all) => [...all, it])}
                onRemove={(ids) => edit((all) => all.filter((it) => !ids.includes(it.id)))}
                onReplace={(next) => edit((all) => all.map((it) => next.find((n) => n.id === it.id) ?? it))}
                onSelect={(page, ids) => setSelection({ page, ids })}
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
                onUnlink={(n) => void pageOp({ op: "unlink", page: i, n }, (its) => its)}
              />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
