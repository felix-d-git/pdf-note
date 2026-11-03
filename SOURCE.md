# Quellcode / Source code – PDF Note v<Version>

PDF Note steht unter der GNU Affero General Public License v3.0 (`AGPL-3.0-only`). Dieses Angebot des vollständigen
Quellcodes (Corresponding Source, AGPL-3.0 §6) gilt für den Installer von PDF Note v<Version>.
PDF Note is licensed under the GNU AGPL v3.0 only. This is the offer of the Corresponding Source (AGPL-3.0 §6)
for the PDF Note v<Version> installer.

- Quellcode dieses Releases / source of this release: https://github.com/felix-d-git/pdf-note/tree/v<Version>
  (inkl. / incl. `vendor/mupdf` mit Patch, `src-tauri/Cargo.lock`, `package-lock.json`)
- MuPDF-C-Quellen / MuPDF C sources: Crate `mupdf-sys` <mupdf-sys>, als Release-Asset `mupdf-sys-<mupdf-sys>.crate`
  und unter / and at https://crates.io/crates/mupdf-sys/<mupdf-sys>
- MuPDF vollständig (inkl. `resources/cmaps`, `resources/icc`, Generator-Skripte – in `mupdf-sys` nur als Auszug) /
  complete MuPDF (the `mupdf-sys` crate holds an excerpt only): MuPDF 1.27.2, https://github.com/ArtifexSoftware/mupdf/tree/1.27.2,
  eingebunden über mupdf-rs / via mupdf-rs https://github.com/messense/mupdf-rs/tree/deaacc87c4cea6a2146e90e00e0d5658c911277b.
  Beim Build ändert `mupdf-sys` (`build.rs`, `msbuild.rs`) `source/fitz/font.c` (System-Fallback für Noto-Schriften),
  `source/fitz/store.c` (Reap nach `fz_filter_store`), `source/fitz/geometry.c` (MSVC: `NAN`) und
  `platform/win32/libresources.vcxproj` (ohne Schriften han/droid/noto/sil) / `mupdf-sys` patches these files at build time.
  Build-Defines für MuPDF zusätzlich in `.cargo/config.toml` (`_CL_`) / additional MuPDF defines in `.cargo/config.toml`.
- Alle übrigen Rust-Crates und npm-Pakete in den Versionen der Lockfiles: https://crates.io, https://www.npmjs.com
- Build: Windows, MSVC, LLVM (für bindgen), `cargo install cargo-about --locked --features cli`, dann
  `npm ci && npm run tauri build`

Dieses Angebot gilt mindestens drei Jahre ab Veröffentlichung des Releases.
This offer is valid for at least three years from the release date.
