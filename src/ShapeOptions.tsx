import { ColorButton } from "./ColorPicker";
import { T } from "./i18n";
import { SOLIDS, WALLS, type Dash, type ShapeOpts } from "./ink";
import type { Tool } from "./settings";
import { BTN as btn, on } from "./ui";

/** Werkzeuge mit Optionen (Zahnrad und Rechtsklick aufs Werkzeug) */
export const OPT_TOOLS: readonly Tool[] = ["line", "arrow", "rect", "ellipse", "axes", "solid", "eraser"];

const DASHES: [Dash | undefined, string][] = [[undefined, T.solidLine], ["dash", T.dashed], ["dot", T.dotted]];

/** Knopfreihe: genau ein Wert gewählt */
function Pick<V>({ list, value, set }: { list: [V, string][]; value: V; set: (v: V) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {list.map(([v, l]) => <button key={l} type="button" aria-pressed={value === v} className={btn + " ring-1 ring-inset ring-line" + on(value === v)} onClick={() => set(v)}>{l}</button>)}
    </div>
  );
}

/** Optionen des Werkzeugs `tool`; leer, wenn es keine hat */
export function ShapeOptions({ tool, o, set }: { tool: Tool; o: ShapeOpts; set: (o: ShapeOpts) => void }) {
  if (!OPT_TOOLS.includes(tool)) return null;
  if (tool === "eraser") {
    return (
      <div className="flex flex-col gap-2 border-t border-line pt-2">
        <Pick list={[[false, T.eraseWhole], [true, T.erasePart]]} value={o.partial} set={(partial) => set({ ...o, partial })} />
      </div>
    );
  }
  const check = (k: "square" | "circle", label: string) => (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={o[k]} onChange={(e) => set({ ...o, [k]: e.target.checked })} />
      {label}
    </label>
  );
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-2">
      {tool === "axes" && (
        <>
          <Pick list={[[false, T.axesXy], [true, T.axesXyz]]} value={o.xyz} set={(xyz) => set({ ...o, xyz })} />
          <span className="text-ink-3">{T.grid}</span>
          {o.xyz ? (
            <div className="flex flex-wrap gap-1">
              {WALLS.map((w) => {
                const act = o.walls.includes(w);
                return (
                  <button key={w} type="button" aria-pressed={act} title={T[`wall_${w}`]} className={btn + " ring-1 ring-inset ring-line" + on(act)}
                    onClick={() => set({ ...o, walls: act ? o.walls.filter((v) => v !== w) : [...o.walls, w] })}>
                    {w.toUpperCase().split("").join("-")}
                  </button>
                );
              })}
            </div>
          ) : <Pick list={[[false, T.off], [true, T.grid]]} value={o.grid} set={(grid) => set({ ...o, grid })} />}
        </>
      )}
      {tool === "solid" && <Pick list={SOLIDS.map((s) => [s, T[s]])} value={o.solid} set={(solid) => set({ ...o, solid })} />}
      {tool === "rect" && check("square", T.square)}
      {tool === "ellipse" && check("circle", T.circle)}
      {(tool === "rect" || tool === "ellipse") && (
        <label className="flex items-center justify-between">
          {T.fill}
          <ColorButton label={T.fill} value={o.fill} none onPreview={() => {}} onCommit={(fill) => set({ ...o, fill })} />
        </label>
      )}
      {tool !== "axes" && (
        <>
          <span className="text-ink-3">{T.lineStyle}</span>
          <Pick list={DASHES} value={o.dash} set={(dash) => set({ ...o, dash })} />
        </>
      )}
    </div>
  );
}
