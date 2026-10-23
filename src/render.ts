import { invoke } from "@tauri-apps/api/core";

/**
 * Seitenbilder aller Tabs: eine Warteschlange vor dem (einzigen) Render-Thread, Cache mit Speichergrenze.
 * Reihenfolge je Durchgang neu geplant: sichtbare Seiten grob → scharf, dann Umgebung, dann Miniaturen.
 * Seiten, die aus dem Bild sind, fallen aus dem Plan und werden nie gerendert (= abgebrochen).
 */

/** `near` = sichtbarer Tab ± Seiten, `far` = versteckter Tab ± Seiten, `mb` = Speichergrenze dekodierter Bilder */
export interface Limits { near: number; far: number; mb: number }
export const DEFAULT_LIMITS: Limits = { near: 25, far: 5, mb: 1024 };
/** Grob-Bild: Anteil der Zielauflösung, gerendert bevor die sichtbare Seite scharf kommt */
export const COARSE = 0.25;
/** ± Seiten um die aktuelle, die als sichtbar gelten (grob zuerst) */
const SEEN = 2;
export const THUMB_W = 120;

export interface Entry { url: string; scale: number; version: number; bytes: number; used: number }
/** Eine Ansicht (DocView): `shown` = Tab ist sichtbar (auch Split-Hälfte), `dpr` für die Miniaturen */
export interface View { doc: number; center: number; sizes: [number, number][]; scale: number; dpr: number; version: number; shown: boolean }
export interface Job { key: string; doc: number; index: number; scale: number; version: number }

export const pageKey = (doc: number, i: number) => `${doc}:${i}`;
export const thumbKey = (doc: number, i: number) => `${doc}:t${i}`;
const stale = (e: Entry | undefined, scale: number, version: number) => !e || e.version !== version || Math.abs(e.scale / scale - 1) > 0.01;

/** Nächste Aufträge in Reihenfolge + alle Schlüssel, die behalten werden sollen. `room` = unter der Speichergrenze. */
export function plan(views: View[], entries: Map<string, Entry>, l: Limits, room: boolean) {
  const coarse: Job[] = [], seen: Job[] = [], near: [number, Job][] = [], far: [number, Job][] = [], thumbs: [number, Job][] = [];
  const wanted = new Set<string>();
  for (const v of views) {
    const n = v.shown ? l.near : l.far;
    const lo = Math.max(0, v.center - n), hi = Math.min(v.sizes.length - 1, v.center + n);
    for (let i = lo; i <= hi; i++) {
      const key = pageKey(v.doc, i), d = Math.abs(i - v.center), e = entries.get(key);
      wanted.add(key);
      if (!stale(e, v.scale, v.version)) continue;
      const job = { key, doc: v.doc, index: i, scale: v.scale, version: v.version };
      if (v.shown && d <= SEEN) {
        if (!e) coarse.push({ ...job, scale: v.scale * COARSE });
        seen.push(job);
      } else (v.shown ? near : far).push([d, job]);
    }
    if (!v.shown) continue;
    v.sizes.forEach(([w], i) => {
      const key = thumbKey(v.doc, i), scale = (THUMB_W / w) * v.dpr;
      wanted.add(key);
      if (stale(entries.get(key), scale, v.version)) thumbs.push([Math.abs(i - v.center), { key, doc: v.doc, index: i, scale, version: v.version }]);
    });
  }
  const by = (a: [number, Job][]) => a.sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  // gleiche Seite in zwei Ansichten (Split, selbes Dokument) nur einmal
  const jobs = [...coarse, ...seen, ...(room ? [...by(near), ...by(thumbs), ...by(far)] : [])];
  const seenJobs = new Set<string>();
  return { jobs: jobs.filter((j) => !seenJobs.has(`${j.key}@${j.scale}`) && !!seenJobs.add(`${j.key}@${j.scale}`)), wanted };
}

/** Zu verwerfende Schlüssel: Ungewolltes versteckter/geschlossener Tabs sofort, sonst am längsten Ungenutztes bis unter die Grenze. */
export function evict(entries: Map<string, Entry>, wanted: Set<string>, shownDocs: Set<number>, limit: number): string[] {
  const out: string[] = [];
  let total = 0;
  const lru: [string, Entry][] = [];
  for (const [k, e] of entries) {
    if (wanted.has(k)) total += e.bytes;
    else if (!shownDocs.has(Number(k.split(":")[0]))) out.push(k);
    else lru.push([k, e]);
  }
  lru.sort((a, b) => b[1].used - a[1].used);
  for (const [k, e] of lru) {
    if (total + e.bytes > limit) out.push(k);
    else total += e.bytes;
  }
  return out;
}

/** Breite × Höhe aus dem PNG-Kopf (IHDR) → Bytes dekodiert (RGBA) */
export const pngBytes = (buf: ArrayBuffer) => {
  const v = new DataView(buf);
  return buf.byteLength < 24 ? 0 : v.getUint32(16) * v.getUint32(20) * 4;
};

const entries = new Map<string, Entry>();
const views = new Map<string, View>();
const subs = new Set<() => void>();
let limits = DEFAULT_LIMITS;
let busy = false;
let render = (doc: number, index: number, scale: number) => invoke<ArrayBuffer>("render_page", { id: doc, index, scale });

const notify = () => subs.forEach((f) => f());
export const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));
export const imageOf = (key: string) => entries.get(key)?.url || undefined;
/** nur für Tests */
export const _test = { entries, setRender: (f: typeof render) => (render = f), idle: () => !busy };

function drop(keys: string[]) {
  for (const k of keys) {
    const e = entries.get(k);
    if (e?.url) URL.revokeObjectURL(e.url);
    entries.delete(k);
  }
  if (keys.length) notify();
}

/** Ansicht anmelden/aktualisieren (`null` = weg, z. B. Tab geschlossen) */
export function setView(name: string, v: View | null) {
  if (v) views.set(name, v);
  else views.delete(name);
  pump();
}

export function setLimits(l: Limits) {
  limits = l;
  pump();
}

// ponytail: ein Auftrag gleichzeitig, laufendes Rendern wird nicht abgebrochen (≤ 1 Seite Verzug); MuPDF-Cookie, wenn große Seiten hängen
function pump() {
  if (busy) return;
  const vs = [...views.values()];
  const limit = limits.mb * 2 ** 20;
  const first = plan(vs, entries, limits, true);
  const now = performance.now();
  for (const k of first.wanted) {
    const e = entries.get(k);
    if (e) e.used = now;
  }
  drop(evict(entries, first.wanted, new Set(vs.filter((v) => v.shown).map((v) => v.doc)), limit));
  let total = 0;
  entries.forEach((e) => (total += e.bytes));
  const job = plan(vs, entries, limits, total < limit).jobs[0];
  if (!job) return;
  busy = true;
  render(job.doc, job.index, job.scale)
    .then((buf) => ({ url: URL.createObjectURL(new Blob([buf], { type: "image/png" })), bytes: pngBytes(buf) }))
    // Fehler: leerer Eintrag, sonst plant jeder Durchgang dieselbe Seite neu
    .catch((e: unknown) => (console.error(e), { url: "", bytes: 0 }))
    .then(({ url, bytes }) => {
      // grob nur ohne Eintrag geplant; beim Zoom bleibt das alte (gestreckte) Bild bis zum scharfen stehen
      const old = entries.get(job.key);
      if (old?.url) URL.revokeObjectURL(old.url);
      entries.set(job.key, { url, scale: job.scale, version: job.version, bytes, used: performance.now() });
      notify();
    })
    .finally(() => {
      busy = false;
      pump();
    });
}
