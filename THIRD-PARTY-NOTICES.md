# Third-Party Notices

## App (wird ausgeliefert)

| Komponente | Version | Lizenz | Verwendung |
|---|---|---|---|
| MuPDF / Rust-Crates `mupdf`, `mupdf-sys` (Artifex) | 0.8.0 | AGPL-3.0 | PDF-Engine; `mupdf` lokal gepatcht in `vendor/mupdf/` (siehe `PATCH.md`). Mitgebaute C-Bibliotheken aus MuPDF-`thirdparty/`: FreeType (FTL), HarfBuzz (MIT), jbig2dec (AGPL-3.0), lcms2 (MIT), libjpeg (IJG), OpenJPEG (BSD-2-Clause), zlib (Zlib); Feature `base14-fonts`: URW-Base-14-Schriften (Nimbus Sans/Roman/Mono, Standard Symbols, D050000L; AGPL-3.0 in der MuPDF-Distribution) |
| Tauri (`tauri`, `tauri-build`, `@tauri-apps/api`, `@tauri-apps/cli`) | 2.x | MIT OR Apache-2.0 | Desktop-Shell (WebView2) |
| Tauri Dialog-Plugin (`tauri-plugin-dialog`, `@tauri-apps/plugin-dialog`), darunter `rfd` 0.16 (MIT) | 2.8 | MIT OR Apache-2.0 | Datei-Öffnen-Dialog, Nachfrage beim Schließen |
| serde | 1.0 | MIT OR Apache-2.0 | Objekte vom Frontend deserialisieren |
| serde_json | 1.0 | MIT OR Apache-2.0 | eigene Objekte als JSON in der Annotation (`/PDFNote`) |
| perfect-freehand (Stephen Ruiz Ltd) | 1.2.3 | MIT | Ink-Glättung + Druckbreite |
| React, React DOM | 19.3 | MIT | UI |
| Zod | 4.6 | MIT | Validierung an Grenzen |
| Tailwind CSS | 4.3 | MIT | Styles (Build) |
| Manrope (Mikhail Sharanda), Paket `@fontsource-variable/manrope` | 5.3.0 | SIL OFL 1.1 (Schrift), MIT (Paket) | UI-Schrift, lokal gebündelt |
| IBM Plex Mono (IBM), Paket `@fontsource/ibm-plex-mono` | 5.3.0 | SIL OFL 1.1 (Schrift), MIT (Paket) | Mono-Schrift, lokal gebündelt |

Nur zur Entwicklung (nicht ausgeliefert): Vite, Vitest, TypeScript, ESLint, typescript-eslint (MIT bzw. Apache-2.0).

## Nur Spikes (`spikes/`, Wegwerfcode)

| Komponente | Version | Lizenz | Verwendung |
|---|---|---|---|
| `pdfium-render` | 0.9.4 | MIT OR Apache-2.0 | Vergleichs-Spike `spikes/pdfium-spike` |
| PDFium-Binary (bblanchon/pdfium-binaries) | 157.0.8100 | Apache-2.0 / BSD-3-Clause (PDFium), MIT (Build) | Vergleichs-Spike, nicht im Repo |
| perfect-freehand (Stephen Ruiz Ltd) | 1.2.3 | MIT | Ink-Glättung; inline in `spikes/ink-test.html` |
