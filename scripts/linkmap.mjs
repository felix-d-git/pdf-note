// Issue #10: welche MuPDF-Drittbibliotheken landen unter MSVC wirklich in pdf-note.exe?
// Wertet eine MSVC-Linker-Map (link /MAP) aus: Objektdateien je Bibliothek (Spalte „lib:objekt.obj“); die Objekte aus
// libmupdf/libthirdparty werden über die msbuild-Projekte von mupdf-sys ihrer Quelle (thirdparty-Ordner) zugeordnet.
// Aufruf: node scripts/linkmap.mjs pdf-note.map  → Markdown auf stdout (CI: Job-Zusammenfassung)
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

const map = process.argv[2];
if (!map) {
  console.error("Aufruf: node scripts/linkmap.mjs <datei.map>");
  process.exit(1);
}

// lib → Objekt-Basisnamen (ohne .obj); letzte Spalte „lib:objekt.obj“, lib ggf. mit Pfad/Endung
const libs = new Map();
for (const [, lib, obj] of readFileSync(map, "latin1").matchAll(/\s(?:\S*[\\/])?([^\s\\/]+?)(?:\.lib)?:([^\s:\\/]+)\.obj\s*$/gim)) {
  if (!libs.has(lib)) libs.set(lib, new Set());
  libs.get(lib).add(obj);
}

// Quelldatei-Basisname → Komponenten, aus den msbuild-Projekten, die mupdf-sys baut (libmupdf samt Projekt-Referenzen,
// libthirdparty): Komponente = thirdparty-Ordner, URW-Schriften oder „mupdf“
const meta = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1", "--locked", "--manifest-path", "src-tauri/Cargo.toml",
  "--filter-platform", "x86_64-pc-windows-msvc"], { encoding: "utf8", maxBuffer: 1 << 28 }));
const mupdf = join(dirname(meta.packages.find((p) => p.name === "mupdf-sys").manifest_path), "mupdf");
const win32 = join(mupdf, "platform", "win32");
const component = (path) => path.match(/thirdparty\\([^\\]+)/)?.[1] ?? (/resources\\fonts\\urw/.test(path) ? "urw-fonts" : "mupdf");
/** Projekt → Basisname → Komponenten, rekursiv über ProjectReference */
const index = (proj, seen = new Set()) => {
  const owner = new Map();
  if (seen.has(proj)) return owner;
  seen.add(proj);
  const xml = readFileSync(join(win32, proj), "utf8");
  for (const [, kind, path] of xml.matchAll(/<(\w+) Include="([^"]+)"/g)) {
    if (kind === "ProjectReference") {
      for (const [b, c] of index(path, seen)) for (const x of c) (owner.get(b) ?? owner.set(b, new Set()).get(b)).add(x);
    } else if (!["ProjectConfiguration", "ClInclude", "None", "Text", "Image", "ResourceCompile"].includes(kind) && path.startsWith("..\\")) {
      const base = basename(path.replaceAll("\\", "/"), extname(path));
      (owner.get(base) ?? owner.set(base, new Set()).get(base)).add(component(path));
    }
  }
  return owner;
};
const owners = { libmupdf: index("libmupdf.vcxproj"), libthirdparty: index("libthirdparty.vcxproj") };
const thirdparty = readdirSync(join(mupdf, "thirdparty"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
const built = new Set([...Object.values(owners)].flatMap((o) => [...o.values()].flatMap((c) => [...c])));

// Komponente → gelinkte Objekte; mehrdeutige Namen zählen bei jedem Kandidaten (lieber zu viel als zu wenig)
const comps = new Map();
const add = (c, obj) => (comps.get(c) ?? comps.set(c, new Set()).get(c)).add(obj);
const mupdfLibs = [...libs.keys()].filter((l) => l.toLowerCase() in owners);
if (!mupdfLibs.length) {
  console.error(`keine Objekte aus libmupdf/libthirdparty in ${map} – Map-Format geändert?`);
  process.exit(1);
}
for (const l of mupdfLibs) for (const obj of libs.get(l)) {
  const c = owners[l.toLowerCase()].get(obj);
  if (!c) add("(unbekannt)", obj);
  else for (const x of c) add(c.size > 1 ? `${x} (mehrdeutig)` : x, obj);
}

const sample = (s) => [...s].sort().slice(0, 6).join(", ") + (s.size > 6 ? ", …" : "");
const out = ["## Linker-Map: Bibliotheken in pdf-note.exe", "", "| Bibliothek | Objektdateien | Beispiele |", "|---|---|---|"];
for (const [l, s] of [...libs].sort((a, b) => b[1].size - a[1].size)) out.push(`| ${l} | ${s.size} | ${sample(s)} |`);
out.push("", "## MuPDF-thirdparty (aus libmupdf/libthirdparty)", "", "| Komponente | Objektdateien | Beispiele |", "|---|---|---|");
for (const [c, s] of [...comps].sort((a, b) => a[0].localeCompare(b[0]))) out.push(`| ${c} | ${s.size} | ${sample(s)} |`);
const linked = (t) => comps.has(t) || comps.has(`${t} (mehrdeutig)`);
const none = [...built].filter((t) => !linked(t)).sort();
out.push("", `**Gebaut, aber nicht gelinkt:** ${none.join(", ") || "–"}`);
out.push(`**Nicht gebaut:** ${thirdparty.filter((t) => !built.has(t)).join(", ") || "–"}`);
console.log(out.join("\n"));
