/**
 * Formeln für Markdown-Seiten: TeX → MathJax-SVG (gebündelt, offline) → PDF-Pfadoperatoren.
 * Maße in 1/1000 em, y nach oben, Ursprung = linker Rand auf der Grundlinie (Gegenstück: `Formula` in notebook.rs).
 */
import type { LiteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import type { LiteElement, LiteNode } from "mathjax-full/js/adaptors/lite/Element.js";

export type Formula = { tex: string; display: boolean; w: number; h: number; d: number; ops: string };

/**
 * Alle Formel-Kandidaten im Quelltext – Obermenge dessen, was notebook.rs als Formel liest (Blockregeln identisch).
 * ponytail: Inline-Formeln über Zitat-Zeilengrenzen (`> `) passen nicht zusammen → dort roh als Code.
 */
export function extract(src: string): { tex: string; display: boolean }[] {
  const out: { tex: string; display: boolean }[] = [];
  const lines = src.split(/\r?\n/);
  const flat = lines.map((l) => l.trim()).join(" ");
  for (let i = flat.indexOf("$"); i >= 0; i = flat.indexOf("$", i + 1)) {
    const j = flat.indexOf("$", i + 1);
    if (j < 0) break;
    const tex = flat.slice(i + 1, j);
    if (tex && !/^\s|\s$/.test(tex)) out.push({ tex, display: false });
  }
  let code = false;
  let math: string[] | null = null;
  const block = (m: string[]) => out.push({ tex: m.filter((s) => s).join("\n"), display: true });
  for (const raw of lines) {
    const line = raw.trim();
    if (code) {
      if (line.startsWith("```")) code = false;
      continue;
    }
    if (math) {
      if (line.endsWith("$$")) {
        math.push(line.slice(0, -2).trim());
        block(math);
        math = null;
      } else math.push(line);
      continue;
    }
    if (line.startsWith("```")) code = true;
    else if (line.startsWith("$$")) {
      const rest = line.slice(2);
      if (rest.endsWith("$$")) block([rest.slice(0, -2).trim()]);
      else math = [rest.trim()];
    }
  }
  if (math) block(math);
  return out;
}

type Engine = { adaptor: LiteAdaptor; convert: (tex: string, display: boolean) => LiteElement };
let engine: Promise<Engine> | null = null;

function load(): Promise<Engine> {
  engine ??= (async () => {
    const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }] = await Promise.all([
      import("mathjax-full/js/mathjax.js"),
      import("mathjax-full/js/input/tex.js"),
      import("mathjax-full/js/output/svg.js"),
      import("mathjax-full/js/adaptors/liteAdaptor.js"),
      import("mathjax-full/js/handlers/html.js"),
      import("mathjax-full/js/input/tex/ams/AmsConfiguration.js"),
    ]);
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const doc = mathjax.document("", { InputJax: new TeX({ packages: ["base", "ams"] }), OutputJax: new SVG({ fontCache: "none" }) });
    return { adaptor, convert: (tex, display) => doc.convert(tex, { display }) as LiteElement };
  })();
  return engine;
}

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];

function transform(s: string | undefined): M {
  let m: M = [1, 0, 0, 1, 0, 0];
  for (const [, fn, args] of (s ?? "").matchAll(/(\w+)\(([^)]*)\)/g)) {
    const v = (args ?? "").split(/[\s,]+/).filter((x) => x).map(Number);
    const [a = NaN, b = NaN] = v;
    const t: M | null =
      fn === "translate" ? [1, 0, 0, 1, a, v.length > 1 ? b : 0]
      : fn === "scale" ? [a, 0, 0, v.length > 1 ? b : a, 0, 0]
      : fn === "matrix" && v.length === 6 ? (v as M)
      : null;
    if (!t || t.some((x) => !Number.isFinite(x))) throw new Error(`transform ${fn}`);
    m = mul(m, t);
  }
  return m;
}

/** SVG-Pfad (nur absolute M L H V Q T C Z, wie MathJax-Schriften) → PDF-Operatoren. */
function path(d: string, pt: (x: number, y: number) => string): string {
  const tok = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  let i = 0;
  const n = () => {
    const v = Number(tok[i++]);
    if (!Number.isFinite(v)) throw new Error("Pfadzahl");
    return v;
  };
  const isNum = () => i < tok.length && !/[A-Za-z]/.test(tok[i] ?? "");
  let out = "";
  let [x, y, sx, sy, qx, qy] = [0, 0, 0, 0, 0, 0];
  let cmd = "";
  // Quadratische Kurve als kubische (c1 = p0 + 2/3·(q−p0), c2 = p + 2/3·(q−p))
  const quad = (ax: number, ay: number, bx: number, by: number) => {
    out += `${pt(x + (2 / 3) * (ax - x), y + (2 / 3) * (ay - y))} ${pt(bx + (2 / 3) * (ax - bx), by + (2 / 3) * (ay - by))} ${pt(bx, by)} c `;
    [qx, qy, x, y] = [ax, ay, bx, by];
  };
  while (i < tok.length) {
    if (!isNum()) cmd = tok[i++] ?? "";
    const prev = cmd;
    switch (cmd) {
      case "M":
        [x, y] = [n(), n()];
        [sx, sy, qx, qy] = [x, y, x, y];
        out += `${pt(x, y)} m `;
        cmd = "L";
        break;
      case "L":
        [x, y] = [n(), n()];
        out += `${pt(x, y)} l `;
        break;
      case "H":
        x = n();
        out += `${pt(x, y)} l `;
        break;
      case "V":
        y = n();
        out += `${pt(x, y)} l `;
        break;
      case "Q": {
        const [ax, ay] = [n(), n()];
        quad(ax, ay, n(), n());
        break;
      }
      case "T":
        quad(2 * x - qx, 2 * y - qy, n(), n());
        break;
      case "C": {
        const [ax, ay, bx, by, cx, cy] = [n(), n(), n(), n(), n(), n()];
        out += `${pt(ax, ay)} ${pt(bx, by)} ${pt(cx, cy)} c `;
        [x, y] = [cx, cy];
        break;
      }
      case "Z":
      case "z":
        out += "h ";
        [x, y] = [sx, sy];
        break;
      default:
        throw new Error(`Pfadbefehl ${cmd}`);
    }
    if (!"QT".includes(prev)) [qx, qy] = [x, y];
    if ((cmd === "Z" || cmd === "z") && isNum()) throw new Error("Pfad");
  }
  return out;
}

const r1 = (v: number) => String(Math.round(v * 10) / 10);

/** MathJax-SVG → Formel; wirft bei TeX-Fehlern und allem, was nicht als gefüllte Fläche darstellbar ist. */
function toFormula(e: Engine, tex: string, display: boolean): Formula {
  const { adaptor: a } = e;
  const svg = a.childNodes(e.convert(tex, display)).find((c) => a.kind(c) === "svg") as LiteElement | undefined;
  if (!svg) throw new Error("kein SVG");
  const vb = String(a.getAttribute(svg, "viewBox") ?? "").split(/\s+/).map(Number);
  if (vb.length !== 4 || vb.some((v) => !Number.isFinite(v))) throw new Error("viewBox");
  const [vx = 0, vy = 0, vw = 0, vh = 0] = vb;
  let ops = "";
  const walk = (node: LiteNode, m: M) => {
    const kind = a.kind(node);
    if (kind === "#text" || kind === "#comment" || kind === "title" || kind === "desc") return;
    const el = node as LiteElement;
    if (a.getAttribute(el, "data-mml-node") === "merror") throw new Error("TeX-Fehler");
    const mm = mul(m, transform(a.getAttribute(el, "transform")));
    // PDF: x ab linkem Rand, y nach oben
    const pt = (x: number, y: number) => {
      const px = mm[0] * x + mm[2] * y + mm[4];
      const py = mm[1] * x + mm[3] * y + mm[5];
      return `${r1(px - vx)} ${r1(-py)}`;
    };
    if (kind === "path") {
      const d = a.getAttribute(el, "d");
      if (d) ops += `${path(String(d), pt)}f\n`;
    } else if (kind === "rect") {
      const [x = NaN, y = NaN, w = NaN, h = NaN] = ["x", "y", "width", "height"].map((k) => Number(a.getAttribute(el, k) ?? 0));
      if (![x, y, w, h].every(Number.isFinite)) throw new Error("rect");
      ops += `${pt(x, y)} m ${pt(x + w, y)} l ${pt(x + w, y + h)} l ${pt(x, y + h)} l h f\n`;
    } else if (kind === "g" || (kind === "svg" && node === svg)) {
      for (const c of a.childNodes(el)) walk(c, mm);
    } else throw new Error(`nicht unterstützt: ${kind}`); // ponytail: z. B. \text mit Umlauten (<text>) → roh als Code
  };
  walk(svg, [1, 0, 0, 1, 0, 0]);
  return { tex, display, w: vw, h: -vy, d: vh + vy, ops: ops.trim() };
}

const cache = new Map<string, Formula | null>();

/** Satzfertige Formeln für `extract(src)`; fehlerhafte fehlen (Rust setzt sie roh als Code). */
export async function formulas(src: string): Promise<Formula[]> {
  const want = extract(src);
  if (!want.length) return [];
  const e = await load();
  if (cache.size > 2000) cache.clear();
  const out: Formula[] = [];
  for (const { tex, display } of want) {
    const key = `${display}|${tex}`;
    if (!cache.has(key)) {
      let f: Formula | null;
      try {
        f = toFormula(e, tex, display);
      } catch {
        f = null;
      }
      cache.set(key, f);
    }
    const f = cache.get(key);
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}
