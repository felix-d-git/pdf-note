import { z } from "zod";

/** Textzeile der PDF (Backend `text_chars`, inkl. OCR-Text): ein Rechteck je Zeichen, pt. */
export const CharLine = z.object({
  text: z.string(),
  boxes: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])),
});
export type CharLine = z.infer<typeof CharLine>;
/** Cursorstelle: Zeile, Zeichen davor (0 … Länge) */
export type Pos = [line: number, ch: number];
export type Rect = [number, number, number, number];

const lineBox = (l: CharLine): Rect => l.boxes.reduce<Rect>(
  ([a, b, c, d], [x0, y0, x1, y1]) => [Math.min(a, x0), Math.min(b, y0), Math.max(c, x1), Math.max(d, y1)],
  [Infinity, Infinity, -Infinity, -Infinity],
);

/** Stelle unter dem Punkt; `near`: sonst nächste Zeile (beim Ziehen), ohne `near` nur direkt auf Text. */
export function posAt(lines: CharLine[], x: number, y: number, near = false): Pos | null {
  let i = -1;
  let dmin = Infinity;
  for (const [n, l] of lines.entries()) {
    const [x0, y0, x1, y1] = lineBox(l);
    const d = Math.max(0, y0 - y, y - y1) * 4 + Math.max(0, x0 - x, x - x1);
    if ((near || d === 0) && d < dmin) [i, dmin] = [n, d];
  }
  if (i < 0) return null;
  const boxes = lines[i]?.boxes ?? [];
  const ch = boxes.findIndex(([x0, , x1]) => x < (x0 + x1) / 2);
  return [i, ch < 0 ? boxes.length : ch];
}

/** Markierung von `a` bis `b` (Richtung egal): ein Rechteck je Zeile + Text (Zeilen mit Umbruch). */
export function selRange(lines: CharLine[], a: Pos, b: Pos): { rects: Rect[]; text: string } {
  const [s, e] = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? [a, b] : [b, a];
  const rects: Rect[] = [];
  const text: string[] = [];
  for (let i = s[0]; i <= e[0]; i++) {
    const l = lines[i];
    if (!l) continue;
    const from = i === s[0] ? s[1] : 0;
    const to = i === e[0] ? e[1] : l.boxes.length;
    if (to <= from) continue;
    rects.push(lineBox({ text: "", boxes: l.boxes.slice(from, to) }));
    text.push([...l.text].slice(from, to).join(""));
  }
  return { rects, text: text.join("\n") };
}
