import { describe, expect, it } from "vitest";
import { anchorShift, wheelFactor } from "./zoom";

describe("Zoom per Wheel", () => {
  it("Faktor proportional zu deltaY, Richtung stimmt", () => {
    expect(wheelFactor(0)).toBe(1);
    expect(wheelFactor(-5)).toBeGreaterThan(1);
    expect(wheelFactor(5)).toBeLessThan(1);
    expect(wheelFactor(-4) * wheelFactor(-4)).toBeCloseTo(wheelFactor(-8), 10);
    expect(wheelFactor(-100)).toBe(wheelFactor(-15));
    expect(wheelFactor(-1, 1)).toBe(wheelFactor(-16));
  });
  it("Punkt unter dem Zeiger bleibt stehen, auch mit nicht skalierenden Seitenabständen", () => {
    // Seite 50 bei Zoom 1: oben 50·(800+16) + 24 Rand; Zeiger 300 px unter dem Containerrand, Container auf scroll 40 000
    const top = (z: number, i: number) => 24 + i * (800 * z + 16);
    for (const [z0, z1] of [[1, 1.5], [1.5, 0.7], [2, 6]] as const) {
      const scroll = top(z0, 50) - 100, p = 300, u = (scroll + p - top(z0, 50)) / z0;
      const scroll2 = scroll + anchorShift(top(z1, 50) - scroll, u, z1, p);
      expect((scroll2 + p - top(z1, 50)) / z1).toBeCloseTo(u, 10);
    }
  });
});
