/** Tab- und Split-Zustand: welche Dokumente offen sind und welches in welcher Hälfte steht. Reine Funktionen. */
export interface Tab { id: number; path: string; dirty: boolean }
export type Pane = 0 | 1;
export interface Tabs {
  tabs: Tab[];
  /** Dokument je Hälfte; ohne Split zählt nur [0]. */
  panes: [number | undefined, number | undefined];
  split: boolean;
  active: Pane;
}

export const EMPTY_TABS: Tabs = { tabs: [], panes: [undefined, undefined], split: false, active: 0 };

// ponytail: Windows-Pfade ohne Groß/Klein und Trennzeichen verglichen; Symlinks/8.3-Namen gelten als andere Datei
export const samePath = (a: string, b: string) => a.replace(/\//g, "\\").toLowerCase() === b.replace(/\//g, "\\").toLowerCase();

export const activeId = (s: Tabs) => s.panes[s.active];
const other = (p: Pane): Pane => (p === 0 ? 1 : 0);
const setPane = (s: Tabs, p: Pane, id: number | undefined): Tabs => {
  const panes: Tabs["panes"] = [...s.panes];
  panes[p] = id;
  return { ...s, panes };
};

/** Tab anzeigen: steht er schon in der anderen Hälfte, wird diese aktiv; sonst in der aktiven Hälfte. */
export function show(s: Tabs, id: number): Tabs {
  if (s.split && s.panes[other(s.active)] === id) return { ...s, active: other(s.active) };
  return setPane(s, s.active, id);
}

/** Öffnen: bereits offene Datei springt zu ihrem Tab, sonst neuer Tab am Ende. */
export function openTab(s: Tabs, id: number, path: string): Tabs {
  const hit = s.tabs.find((t) => samePath(t.path, path));
  if (hit) return show(s, hit.id);
  return show({ ...s, tabs: [...s.tabs, { id, path, dirty: false }] }, id);
}

export function closeTab(s: Tabs, id: number): Tabs {
  const i = s.tabs.findIndex((t) => t.id === id);
  if (i < 0) return s;
  const tabs = s.tabs.filter((t) => t.id !== id);
  let next: Tabs = { ...s, tabs };
  for (const p of [0, 1] as const) {
    if (s.panes[p] !== id) continue;
    // Nachbar rechts, sonst links – aber nicht den, der schon in der anderen Hälfte steht
    const taken = next.split ? next.panes[other(p)] : undefined;
    const pick = [tabs[i], tabs[i - 1], ...tabs].find((t) => t && t.id !== taken);
    next = setPane(next, p, pick?.id);
  }
  return next;
}

/** Strg+Tab / Strg+Umschalt+Tab */
export function cycle(s: Tabs, dir: 1 | -1): Tabs {
  if (!s.tabs.length) return s;
  const i = s.tabs.findIndex((t) => t.id === activeId(s));
  const t = s.tabs[(i + dir + s.tabs.length) % s.tabs.length];
  return t ? show(s, t.id) : s;
}

export function toggleSplit(s: Tabs): Tabs {
  if (s.split) return { ...s, split: false, active: 0, panes: [activeId(s) ?? s.panes[0] ?? s.panes[1], undefined] };
  const second = s.tabs.find((t) => t.id !== s.panes[0]);
  return { ...s, split: true, active: second ? 1 : 0, panes: [s.panes[0], second?.id] };
}

export const focus = (s: Tabs, p: Pane): Tabs => (s.split && s.active !== p ? { ...s, active: p } : s);

export function moveTab(s: Tabs, from: number, to: number): Tabs {
  const tabs = [...s.tabs];
  const [t] = tabs.splice(from, 1);
  if (!t) return s;
  tabs.splice(to, 0, t);
  return { ...s, tabs };
}

export function setDirty(s: Tabs, id: number, dirty: boolean): Tabs {
  if (s.tabs.find((t) => t.id === id)?.dirty === dirty) return s;
  return { ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, dirty } : t)) };
}
