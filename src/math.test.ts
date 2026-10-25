import { describe, expect, it } from "vitest";
import { extract, formulas } from "./math";

describe("math", () => {
  it("findet Inline- und Blockformeln wie notebook.rs", () => {
    const src = "Es gilt $a^2+b^2=c^2$ und $ x$ nicht, 5$ bis 6$.\n```\n$$\\code$$\n```\n$$\\frac{1}{2}$$\n$$\n\\begin{pmatrix} 1 \\\\\n 2 \\end{pmatrix}\n$$\n$$ offen";
    const f = extract(src);
    expect(f.filter((x) => x.display).map((x) => x.tex)).toEqual(["\\frac{1}{2}", "\\begin{pmatrix} 1 \\\\\n2 \\end{pmatrix}", "offen"]);
    const inl = f.filter((x) => !x.display).map((x) => x.tex);
    expect(inl).toContain("a^2+b^2=c^2");
    expect(inl).not.toContain(" x");
    expect(inl).not.toContain(" bis 6");
  });

  it("setzt Formeln als Pfade, Fehler fehlen", async () => {
    const src = "$a^2+b^2=c^2$\n\n$$\\frac{a}{b}$$\n\n$$\\sum_{i=1}^n i$$\n\n$$\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}$$\n\n$$\\frac{$$\n\n$$\\undefinedmacro$$";
    const fs = await formulas(src);
    const disp = fs.filter((f) => f.display);
    expect(disp.map((f) => f.tex)).toEqual(["\\frac{a}{b}", "\\sum_{i=1}^n i", "\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}"]);
    expect(fs.some((f) => !f.display && f.tex === "a^2+b^2=c^2")).toBe(true);
    for (const f of fs) {
      expect(f.w).toBeGreaterThan(0);
      expect(f.h).toBeGreaterThan(0);
      // nur Zahlen und Pfadoperatoren (prüft Rust nochmals)
      expect(f.ops.split(/\s+/).every((t) => ["m", "l", "c", "h", "f"].includes(t) || Number.isFinite(Number(t)))).toBe(true);
    }
    // Bruchstrich: rect → Rechteckpfad
    expect(disp[0]?.ops).toMatch(/ l h f/);
    // Grundlinie: Teile unterhalb (Index) bei der Summe
    expect(disp[1]?.d).toBeGreaterThan(0);
    expect(await formulas("ohne")).toEqual([]);
  });
});
