import { z } from "zod";
import type { Layer } from "./ink";
import type { Tool } from "./settings";

/**
 * Ebenen-Sperre je Dokument (Schlüssel = Pfad), gerätelokal in localStorage – nie in der PDF, nie als Zusatzdatei.
 * Gesperrte Ebene: nichts wähl-/verschieb-/änderbar (Auswahl, Lasso, Radierer, Absatz-Editor); andere Ebenen bleiben bedienbar.
 */
const KEY = "pdfnote.locks";
const Store = z.record(z.string(), z.array(z.union([z.literal(1), z.literal(2), z.literal(3)])));

function load(): Record<string, Layer[]> {
  try {
    return Store.parse(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return {};
  }
}

export const lockedLayers = (docKey: string): Layer[] => load()[docKey] ?? [];
export const isLayerLocked = (docKey: string, layer: Layer) => lockedLayers(docKey).includes(layer);

export function setLayerLocked(docKey: string, layer: Layer, locked: boolean) {
  const all = { ...load(), [docKey]: [] as Layer[] };
  const rest = lockedLayers(docKey).filter((l) => l !== layer);
  const next = locked ? [...rest, layer].sort() : rest;
  all[docKey] = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(Object.entries(all).filter(([, v]) => v.length))));
  } catch {
    /* nur Komfort */
  }
}

/** Ebene, die ein Werkzeug bei aktiver Ebene `layer` berührt (`null` = keine, z. B. Platz einfügen); dort greift die Sperre. */
export function targetLayer(tool: Tool, layer: Layer): Layer | null {
  if (tool === "space") return null;
  if (tool === "lasso" || tool === "form" || tool === "link") return layer;
  const drawn = layer === 1 ? (tool === "pen" || tool === "marker" || tool === "eraser" ? 3 : 2) : layer; // wie onAdd/Radierer
  return drawn;
}
