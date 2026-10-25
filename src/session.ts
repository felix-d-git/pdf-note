import { z } from "zod";
import { TOOLS } from "./settings";
import type { Tabs } from "./tabs";

/** Ansicht eines Dokuments beim Wiederherstellen; Formwerkzeug-Sperre gehört bewusst nicht dazu (startet immer aus). */
export const DocStart = z.object({
  zoom: z.number().positive(), left: z.number(), top: z.number(), layer: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  mouse: z.enum(TOOLS), pen: z.enum(TOOLS),
});
export type DocStart = z.infer<typeof DocStart>;

/** Fenster in physischen Pixeln; `max` = maximiert, x/y/w/h dann die Größe davor */
const Win = z.object({ x: z.number().int(), y: z.number().int(), w: z.number().int().positive(), h: z.number().int().positive(), max: z.boolean() });
export type Win = z.infer<typeof Win>;
const Index = z.number().int().nonnegative().nullable();

/** Gerätelokal (localStorage), nie in der PDF. `panes` = Index in `files`; `side` = Seitenleiste im Split View (sonst in den Einstellungen). */
export const Session = z.object({
  win: Win.optional(),
  files: z.array(DocStart.extend({ path: z.string().min(1) })),
  panes: z.tuple([Index, Index]),
  split: z.boolean(),
  side: z.boolean().default(false),
  active: z.union([z.literal(0), z.literal(1)]),
  ratio: z.number().min(0.2).max(0.8),
});
export type Session = z.infer<typeof Session>;

const KEY = "pdfnote.session";

export function loadSession(): Session | undefined {
  try {
    const r = Session.safeParse(JSON.parse(localStorage.getItem(KEY) ?? "null"));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

export function storeSession(s: Session) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Speicher voll/gesperrt: nächster Start ohne Sitzung
  }
}

/** `doc` liefert die aktuelle Ansicht je Dokument-Nummer */
export const toSession = (t: Tabs, ratio: number, doc: (id: number) => DocStart, win?: Win, side = false): Session => {
  const at = (id: number | undefined) => {
    const i = t.tabs.findIndex((x) => x.id === id);
    return i < 0 ? null : i;
  };
  return {
    win, files: t.tabs.map((x) => ({ path: x.path, ...doc(x.id) })), panes: [at(t.panes[0]), t.split ? at(t.panes[1]) : null],
    split: t.split, side, active: t.active, ratio,
  };
};

/** Datei der aktiven Hälfte (beim Start zuerst laden) */
export const firstFile = (s: Session) => s.panes[s.active] ?? s.panes[0] ?? 0;

/**
 * Sitzung → Tab-Zustand. `ids[i]` = neue Dokument-Nummer von `files[i]`, `undefined` = übersprungen (fehlt, Passwort abgebrochen).
 * Fehlt das Dokument einer Hälfte, rückt der erste andere Tab nach; leere aktive Hälfte → die andere wird aktiv.
 */
export function fromSession(s: Session, ids: (number | undefined)[]): Tabs {
  const tabs = s.files.flatMap((f, i) => (ids[i] === undefined ? [] : [{ id: ids[i], path: f.path, dirty: false }]));
  const was = s.panes.map((p) => (p === null ? undefined : ids[p]));
  const a = was[0] ?? tabs.find((t) => t.id !== was[1])?.id;
  const b = s.split ? (was[1] ?? tabs.find((t) => t.id !== a)?.id) : undefined;
  const active = s.active === 1 ? (b === undefined ? 0 : 1) : a === undefined && b !== undefined ? 1 : 0;
  return { tabs, panes: [a, b], split: s.split, active };
}

interface Monitor { position: { x: number; y: number }; size: { width: number; height: number } }

/** Fenster wieder auf einen sichtbaren Bildschirm: liegt die Titelleiste auf keinem Monitor mehr, mittig auf den ersten. */
export function placeWindow(w: Win, monitors: Monitor[]): Win {
  const inside = (m: Monitor, x: number, y: number) =>
    x >= m.position.x && x < m.position.x + m.size.width && y >= m.position.y && y < m.position.y + m.size.height;
  const m = monitors[0];
  if (!m || monitors.some((n) => inside(n, w.x + w.w / 2, w.y + 20))) return w;
  const width = Math.min(w.w, m.size.width);
  const height = Math.min(w.h, m.size.height);
  return { ...w, w: width, h: height, x: m.position.x + Math.round((m.size.width - width) / 2), y: m.position.y + Math.round((m.size.height - height) / 2) };
}
