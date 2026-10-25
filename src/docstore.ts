import { useCallback, useSyncExternalStore } from "react";

/**
 * Dokumentzustand, den mehrere Ansichten derselben PDF teilen (Split View: gleiche PDF in beiden Hälften).
 * Je Dokument-id ein Eintrag; Zoom/Scroll/Werkzeug bleiben je Ansicht in React-State.
 */
interface Entry { state: unknown; subs: Set<() => void> }
const docs = new Map<number, Entry>();

const entry = (id: number, init: () => unknown) => {
  let e = docs.get(id);
  if (!e) docs.set(id, (e = { state: init(), subs: new Set() }));
  return e;
};

function update(id: number, f: (s: unknown) => unknown) {
  const e = docs.get(id);
  if (!e) return;
  e.state = f(e.state);
  e.subs.forEach((cb) => cb());
}

export function useDoc<T>(id: number, init: () => T): [T, (f: (s: T) => T) => void] {
  const sub = useCallback((cb: () => void) => {
    const e = entry(id, init);
    e.subs.add(cb);
    return () => void e.subs.delete(cb);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps -- init nur beim ersten Anlegen
  const state = useSyncExternalStore(sub, () => entry(id, init).state as T);
  const set = useCallback((f: (s: T) => T) => update(id, f as (s: unknown) => unknown), [id]);
  return [state, set];
}

/** Tab geschlossen → Zustand vergessen (die id wird nicht wiederverwendet) */
export const dropDoc = (id: number) => void docs.delete(id);
