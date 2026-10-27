// Lizenzsammlung für den Installer (Issue #7) → THIRD-PARTY-LICENSES/, per bundle.resources nach <Installationsordner>\licenses.
// Läuft in beforeBuildCommand nach `vite build` und wird bei jedem Build neu erzeugt (Dependabot ändert die Liste laufend):
// Rust-Crates (cargo-about), gebündelte npm-Pakete (Vite build.license), Schriften (OFL), MuPDF mit thirdparty-Lizenzen
// aus mupdf-sys, Lizenz von PDF Note, SOURCE.md. Texte ohne Quelle im Build (STATIC) liegen eingecheckt im selben Ordner.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const OUT = "THIRD-PARTY-LICENSES";
/** eingecheckt (siehe .gitignore und LIESMICH.txt), alles andere in OUT ist erzeugt */
const STATIC = /^(LIESMICH\.txt|leptonica-|libjpeg-|freetype-|webview2-|URW-)/;
/** MuPDF-thirdparty, die libmupdf unter MSVC nicht referenziert (nur Viewer mupdf-gl / Netzwerk) */
const MUPDF_SKIP = new Set(["curl", "freeglut"]);
const LICENSE_FILE = /^(COPYING|LICEN[CS]E|NOTICE)/i;

const fail = (msg) => {
  console.error(`licenses: ${msg}`);
  process.exit(1);
};
const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "inherit"] });
  } catch (e) {
    fail(`${cmd} ${args.slice(0, 2).join(" ")} fehlgeschlagen (${e.message.split("\n")[0]})`);
  }
};

for (const f of readdirSync(OUT)) if (!STATIC.test(f)) rmSync(join(OUT, f));

// Rust: alle Crates der Windows-Binary; about.toml lässt nur geprüfte Lizenzen zu
try {
  execFileSync("cargo", ["about", "--version"], { stdio: "ignore" });
} catch {
  fail("cargo-about fehlt – einmalig: cargo install cargo-about --locked --features cli");
}
run("cargo", ["about", "generate", "--locked", "--manifest-path", "src-tauri/Cargo.toml", "-c", "src-tauri/about.toml",
  "-o", join(OUT, "rust-crates.html"), "src-tauri/about.hbs"]);

// npm: nur, was tatsächlich im Bundle landet (inkl. Lizenztexte)
const npm = "dist/.vite/license.md";
if (!existsSync(npm)) fail(`${npm} fehlt – erst vite build (build.license in vite.config.ts)`);
copyFileSync(npm, join(OUT, "npm-bundle.md"));

// Schriften: Vites Lizenzliste erfasst nur JS, die Fontsource-Pakete kommen über CSS
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
for (const name of Object.keys(pkg.dependencies).filter((d) => d.startsWith("@fontsource")))
  copyFileSync(join("node_modules", name, "LICENSE"), join(OUT, `font-${name.split("/")[1]}-OFL.txt`));

// MuPDF: COPYING + thirdparty/*/{COPYING,LICENSE*,NOTICE*} aus dem mupdf-sys-Quellpaket
const meta = JSON.parse(run("cargo", ["metadata", "--format-version", "1", "--locked", "--manifest-path", "src-tauri/Cargo.toml",
  "--filter-platform", "x86_64-pc-windows-msvc"]));
const sys = meta.packages.find((p) => p.name === "mupdf-sys");
if (!sys) fail("mupdf-sys nicht in cargo metadata");
const mupdf = join(dirname(sys.manifest_path), "mupdf");
copyFileSync(join(mupdf, "COPYING"), join(OUT, "mupdf-COPYING.txt"));
for (const lib of readdirSync(join(mupdf, "thirdparty"))) {
  const dir = join(mupdf, "thirdparty", lib);
  if (MUPDF_SKIP.has(lib) || !statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir).filter((f) => LICENSE_FILE.test(f)))
    copyFileSync(join(dir, f), join(OUT, `mupdf-${lib}-${f}${f.includes(".") ? "" : ".txt"}`));
}

// eigenes Werk + Quellcode-Angebot (Issue #8) mit Version aus package.json bzw. Cargo.lock
copyFileSync("LICENSE", join(OUT, "PDF-Note-LICENSE-AGPL-3.0.txt"));
writeFileSync(join(OUT, "SOURCE.md"), readFileSync("SOURCE.md", "utf8").replaceAll("<Version>", pkg.version).replaceAll("<mupdf-sys>", sys.version));

// Selbstprüfung: jede erwartete Datei da und nicht leer
const want = ["rust-crates.html", "npm-bundle.md", "mupdf-COPYING.txt", "PDF-Note-LICENSE-AGPL-3.0.txt", "SOURCE.md",
  "leptonica-LICENSE.txt", "libjpeg-IJG-README.txt", "freetype-GPLv2.TXT", "webview2-sdk-LICENSE.txt",
  "URW-Base35-OFL-1.1.txt", "URW-Base35-AGPL-Font-Exception.txt"];
const files = readdirSync(OUT);
for (const f of want) if (!files.includes(f) || !statSync(join(OUT, f)).size) fail(`${f} fehlt oder ist leer`);
if (!files.some((f) => f.startsWith("font-"))) fail("keine Schriftlizenz gefunden");
console.log(`licenses: ${files.length} Dateien in ${OUT}/`);
