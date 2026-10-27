# Quellcode / Source code – PDF Note v<Version>

PDF Note steht unter der GNU Affero General Public License v3.0 (`AGPL-3.0-only`). Dieses Angebot des vollständigen
Quellcodes (Corresponding Source, AGPL-3.0 §6) gilt für den Installer von PDF Note v<Version>.
PDF Note is licensed under the GNU AGPL v3.0 only. This is the offer of the Corresponding Source (AGPL-3.0 §6)
for the PDF Note v<Version> installer.

- Quellcode dieses Releases / source of this release: https://github.com/felix-d-git/pdf-note/tree/v<Version>
  (inkl. / incl. `vendor/mupdf` mit Patch, `src-tauri/Cargo.lock`, `package-lock.json`)
- MuPDF-C-Quellen / MuPDF C sources: Crate `mupdf-sys` <mupdf-sys>, als Release-Asset `mupdf-sys-<mupdf-sys>.crate`
  und unter / and at https://crates.io/crates/mupdf-sys/<mupdf-sys>
- Alle übrigen Rust-Crates und npm-Pakete in den Versionen der Lockfiles: https://crates.io, https://www.npmjs.com
- Build: Windows, MSVC, LLVM (für bindgen), `cargo install cargo-about --locked --features cli`, dann
  `npm ci && npm run tauri build`

Dieses Angebot gilt mindestens drei Jahre ab Veröffentlichung des Releases.
This offer is valid for at least three years from the release date.
