/** Zoom-Faktor je Wheel-Ereignis: proportional zu deltaY (Touchpad-Pinch = viele kleine Ereignisse, Mausrad-Raste ≈ ±16 %). */
const K = 0.01, MAX_DELTA = 15;
const LINE_PX = 16;

export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const d = deltaMode === 1 ? deltaY * LINE_PX : deltaY;
  return Math.exp(-Math.max(-MAX_DELTA, Math.min(MAX_DELTA, d)) * K);
}

/**
 * Scrollposition nach dem Zoomen um `r`, sodass der Inhaltspunkt unter dem Zeiger (`p` = Zeiger relativ zum Container) stehen bleibt.
 * ponytail: Seitenränder/Abstände skalieren nicht mit → Punkt wandert dort leicht.
 */
export const scrollAfterZoom = (scroll: number, p: number, r: number) => (scroll + p) * r - p;
