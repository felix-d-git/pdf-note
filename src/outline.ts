import { z } from "zod";

/** Lesezeichen flach in Dokumentreihenfolge; `level` 0 = oberste Ebene, `page` −1 = ohne Ziel. */
export const Mark = z.object({ title: z.string(), page: z.number().int(), level: z.number().int().min(0) });
export type Mark = z.infer<typeof Mark>;

/** Ende (exklusiv) des Teilbaums ab `i`. */
export const subtreeEnd = (m: Mark[], i: number) => {
  const l = m[i]?.level ?? 0;
  let j = i + 1;
  while (j < m.length && (m[j]?.level ?? 0) > l) j++;
  return j;
};

const shift = (m: Mark[], i: number, d: number) => {
  const end = subtreeEnd(m, i);
  return m.map((x, k) => (k >= i && k < end ? { ...x, level: x.level + d } : x));
};

/** Vorheriges Geschwister (gleiche Ebene, gleicher Elternteil) oder −1. */
const prevSibling = (m: Mark[], i: number) => {
  const l = m[i]?.level ?? 0;
  for (let j = i - 1; j >= 0; j--) {
    const lj = m[j]?.level ?? 0;
    if (lj === l) return j;
    if (lj < l) return -1;
  }
  return -1;
};

/** Mit Teilbaum am vorherigen Geschwister vorbei nach oben; Rückgabe: neue Liste + neuer Index. */
export function moveUp(m: Mark[], i: number): [Mark[], number] {
  const p = prevSibling(m, i);
  if (p < 0) return [m, i];
  const end = subtreeEnd(m, i);
  return [[...m.slice(0, p), ...m.slice(i, end), ...m.slice(p, i), ...m.slice(end)], p];
}

export function moveDown(m: Mark[], i: number): [Mark[], number] {
  const end = subtreeEnd(m, i);
  if (m[end]?.level !== m[i]?.level) return [m, i];
  const [r] = moveUp(m, end);
  return [r, i + subtreeEnd(m, end) - end];
}

/** Einrücken nur unter ein vorheriges Geschwister (sonst würde eine Ebene übersprungen). */
export const indent = (m: Mark[], i: number) => (prevSibling(m, i) < 0 ? m : shift(m, i, 1));

/** Ausrücken: Teilbaum wandert hinter den Teilbaum des Elternteils (nachfolgende Geschwister bleiben dort); Rückgabe: Liste + neuer Index. */
export function outdent(m: Mark[], i: number): [Mark[], number] {
  const l = m[i]?.level ?? 0;
  if (l === 0) return [m, i];
  let p = i - 1;
  while (p > 0 && (m[p]?.level ?? 0) >= l) p--;
  const end = subtreeEnd(m, i);
  const pend = subtreeEnd(m, p);
  const s = shift(m, i, -1);
  return [[...s.slice(0, i), ...s.slice(end, pend), ...s.slice(i, end), ...s.slice(pend)], i + pend - end];
}

/** Löschen; Kinder rücken eine Ebene hoch. */
export const remove = (m: Mark[], i: number) => {
  const s = shift(m, i, -1);
  return [...s.slice(0, i), ...s.slice(i + 1)];
};

/** Neues Lesezeichen oberster Ebene vor dem ersten, das auf eine spätere Seite zeigt; Rückgabe: Liste + Index. */
export function add(m: Mark[], title: string, page: number): [Mark[], number] {
  let at = m.findIndex((x) => x.level === 0 && x.page > page);
  if (at < 0) at = m.length;
  return [[...m.slice(0, at), { title, page, level: 0 }, ...m.slice(at)], at];
}
