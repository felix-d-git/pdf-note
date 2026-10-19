import { describe, expect, it } from "vitest";
import { scrollAfterZoom, wheelFactor } from "./zoom";

describe("Zoom per Wheel", () => {
  it("Faktor proportional zu deltaY, Richtung stimmt", () => {
    expect(wheelFactor(0)).toBe(1);
    expect(wheelFactor(-5)).toBeGreaterThan(1);
    expect(wheelFactor(5)).toBeLessThan(1);
    expect(wheelFactor(-4) * wheelFactor(-4)).toBeCloseTo(wheelFactor(-8), 10);
    expect(wheelFactor(-100)).toBe(wheelFactor(-15));
    expect(wheelFactor(-1, 1)).toBe(wheelFactor(-16));
  });
  it("Punkt unter dem Zeiger bleibt stehen", () => {
    for (const [scroll, p, r] of [[0, 300, 1.5], [420, 120, 0.7], [1000, 0, 2]] as const) {
      const content = scroll + p; // Inhaltspunkt unter dem Zeiger
      expect(content * r - scrollAfterZoom(scroll, p, r)).toBeCloseTo(p, 10);
    }
  });
});
