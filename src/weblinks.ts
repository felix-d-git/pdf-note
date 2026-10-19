import type { CharLine, Rect } from "./textsel";

/** Strg+Klick-Ziel: Sprung im Dokument oder Adresse (nach Nachfrage im Browser). */
export type LinkTarget = { page: number; y: number } | { url: string };
type Anch = { rect: Rect; page: number; y: number; uri?: string | null };

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

/** Nur http/https, sonst undefined; `www.…` bekommt https://. Ergebnis ist `URL.href` (prozentkodiert, ASCII). */
export function webUrl(s: string): string | undefined {
  const t = s.trim();
  try {
    const u = new URL(/^www\./i.test(t) ? `https://${t}` : t);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** Adressen im Text (Satzzeichen am Ende gehören nicht dazu): [Start, Ende) in Zeichen, Adresse. */
export function urlsIn(text: string): [number, number, string][] {
  const out: [number, number, string][] = [];
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0].replace(/[.,;:!?)\]}]+$/, "");
    const url = webUrl(raw);
    const start = [...text.slice(0, m.index)].length;
    if (url) out.push([start, start + [...raw].length, url]);
  }
  return out;
}

const hit = ([x0, y0, x1, y1]: Rect, x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

/**
 * Was liegt unter (x, y)? Vorrang: Link-Annotation (zuletzt gezeichnete zuerst), Adresse im eigenen Textfeld
 * (`own` = Text des Felds unter dem Punkt; ponytail: bei mehreren Adressen die erste), Adresse im PDF-Text.
 */
export function targetAt(anchors: Anch[], chars: CharLine[], own: string | undefined, x: number, y: number): LinkTarget | undefined {
  const a = anchors.findLast((l) => (l.page >= 0 || webUrl(l.uri ?? "")) && hit(l.rect, x, y));
  if (a) {
    const url = a.uri ? webUrl(a.uri) : undefined;
    return url ? { url } : { page: a.page, y: a.y };
  }
  if (own !== undefined) {
    const u = urlsIn(own)[0];
    return u && { url: u[2] };
  }
  for (const l of chars) {
    const i = l.boxes.findIndex((b) => hit(b, x, y));
    if (i < 0) continue;
    const u = urlsIn(l.text).find(([s, e]) => i >= s && i < e);
    if (u) return { url: u[2] };
  }
  return undefined;
}
