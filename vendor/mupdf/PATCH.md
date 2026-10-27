# mupdf 0.8.0 (crates.io, AGPL-3.0) – lokal gepatcht

Quelle: crates.io `mupdf-0.8.0` (https://github.com/messense/mupdf-rs), nur `src/`, `LICENSE`, `README.md`, `Cargo.toml`.

Änderungen (für PDF Note, 2026-10-14; Änderungsvermerk nach AGPL-3.0 §5a):
- `src/device/native.rs`: `align_of::<max_align_t>()` → `align_of::<u128>()` (MSVC kennt `max_align_t` nicht; beide = 16 Byte auf x86_64)
- `Cargo.toml`: `[[example]]`/`[[test]]`-Einträge entfernt (Dateien nicht mitkopiert)

Entfernen, sobald upstream unter MSVC baut: `[patch.crates-io]` in `src-tauri/Cargo.toml` + diesen Ordner löschen.
