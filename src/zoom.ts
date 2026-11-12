/** Zoom-Faktor je Wheel-Ereignis: proportional zu deltaY (Touchpad-Pinch = viele kleine Ereignisse, Mausrad-Raste ≈ ±16 %). */
const K = 0.01, MAX_DELTA = 15;
const LINE_PX = 16;

export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const d = deltaMode === 1 ? deltaY * LINE_PX : deltaY;
  return Math.exp(-Math.max(-MAX_DELTA, Math.min(MAX_DELTA, d)) * K);
}

/**
 * Scroll-Korrektur (eine Achse) nach dem Zoomen: Seite liegt jetzt bei `pageAt` (Bildschirm-px), der gemerkte Seitenpunkt `u`
 * (CSS-px bei Zoom 1) soll wieder unter dem Zeiger `p` stehen. Über die Seite statt über den Container gerechnet,
 * weil Seitenabstände und Rand nicht mitskalieren.
 */
export const anchorShift = (pageAt: number, u: number, zoom: number, p: number) => pageAt + u * zoom - p;
