# Third-Party Notices

## App (wird ausgeliefert)

| Komponente | Version | Lizenz | Verwendung |
|---|---|---|---|
| MuPDF / Rust-Crates `mupdf`, `mupdf-sys` (Artifex; Rust-Bindings: messense) | 0.8.0 | MuPDF-C-Code: AGPL-3.0-or-later (Dateiköpfe „version 3 … or (at your option) any later version“); Rust-Crates: `AGPL-3.0` laut `Cargo.toml` (Altkennung) | PDF-Engine; `mupdf` lokal gepatcht in `vendor/mupdf/` (siehe `PATCH.md`). Feature `base14-fonts`: URW-Base-14-Schriften, Lizenz siehe Abschnitt „URW-Schriften“ unten. Mitgebaute C-Bibliotheken aus MuPDF-`thirdparty/` siehe nächste Tabelle |
| Tesseract-Sprachdaten `deu.traineddata`, `eng.traineddata` (tesseract-ocr/tessdata_fast) | 4.1.0 | Apache-2.0 | OCR-Modelle Deutsch/Englisch, als App-Ressource gebündelt (`src-tauri/resources/tessdata/`) |
| Tauri (`tauri`, `tauri-build`, `@tauri-apps/api`, `@tauri-apps/cli`; Tauri Apps Contributors) | 2.x | MIT OR Apache-2.0 | Desktop-Shell (WebView2) |
| Tauri Dialog-Plugin (`tauri-plugin-dialog`, `@tauri-apps/plugin-dialog`), darunter `rfd` 0.17 (MIT) | 2.8 | MIT OR Apache-2.0 | Datei-Öffnen-Dialog, Nachfrage beim Schließen |
| Tauri Single-Instance-Plugin (`tauri-plugin-single-instance`) | 2.5 | MIT OR Apache-2.0 | eine Instanz: zweiter Start reicht den PDF-Pfad lokal an die laufende App |
| serde | 1.0 | MIT OR Apache-2.0 | Objekte vom Frontend deserialisieren |
| serde_json | 1.0 | MIT OR Apache-2.0 | eigene Objekte als JSON in der Annotation (`/PDFNote`) |
| base64 | 0.23 | MIT OR Apache-2.0 | Bilddaten (Stamp) zwischen Frontend und Rust |
| React, React DOM | 19.3 | MIT | UI |
| lucide-react (Lucide Contributors; teils aus Feather, MIT) | 1.64 | ISC | Icons, lokal gebündelt (nur genutzte Icons per Tree-Shaking) |
| Zod | 4.6 | MIT | Validierung an Grenzen |
| MathJax (`mathjax-full`, MathJax Consortium), inkl. MathJax-TeX-Schriftdaten | 3.2.2 | Apache-2.0 | Formeln auf Markdown-Seiten: TeX → SVG → PDF-Pfade, lokal gebündelt (nur TeX-Eingabe, SVG-Ausgabe, base+ams; Abhängigkeiten speech-rule-engine/mhchemparser/mj-context-menu nicht gebündelt) |
| Tailwind CSS (Tailwind Labs, Inc.) | 4.3 | MIT | Styles; Preflight- und Utility-CSS steckt im ausgelieferten Stylesheet (Lizenztext `tailwindcss-LICENSE.txt`) |
| Manrope (Mikhail Sharanda), Paket `@fontsource-variable/manrope` | 5.3.0 | SIL OFL 1.1 | UI-Schrift, lokal gebündelt |
| IBM Plex Mono (IBM), Paket `@fontsource/ibm-plex-mono` | 5.3.0 | SIL OFL 1.1 | Mono-Schrift, lokal gebündelt |

### MuPDF-Drittbibliotheken (in `mupdf-sys` 0.8.0 enthalten)

Unter Windows/MSVC baut `mupdf-sys` per msbuild die komplette `libmupdf` samt `libthirdparty`; die Feature-Schalter steuern dort nur Defines: `FZ_ENABLE_XPS/SVG/CBZ/IMG/HTML/EPUB/JS/BROTLI/DOCX_OUTPUT = 0`. **An bleiben** FB2, MOBI, TXT und Office und damit die HTML-Engine (gumbo, Layout); Barcode bleibt ebenfalls an. Die Silbentrennung schaltet `.cargo/config.toml` ab (`_CL_ = /DFZ_ENABLE_HYPHEN#0`). Welche Bibliotheken der Linker tatsächlich übernimmt, zeigt `scripts/linkmap.mjs` (Workflow „MuPDF-Linkmap“); bis zu dessen Lauf sind alle gebauten aufgeführt. Nach Quellenlage (Lizenz-Audit #20) werden MuJS, brotli, extract, zxing-cpp und zint gebaut, aber nicht referenziert.

| Bibliothek | Lizenz | Hinweis |
|---|---|---|
| FreeType | FTL **oder** GPL-2.0-or-later – hier **GPL-2.0-or-later** gewählt (die FTL ist mit der GPLv2 unvereinbar; mit GPLv3/AGPLv3 wäre sie zwar vereinbar, die GPL-Wahl hält das Gesamtwerk aber ohne Werbeklausel) | Schrift-Rasterung |
| HarfBuzz | MIT („Old MIT“); USE-Tabellen `src/ms-use`: MIT, Microsoft (`mupdf-harfbuzz-ms-use-COPYING.txt`) | Text-Shaping |
| jbig2dec | AGPL-3.0-or-later (`thirdparty/jbig2dec/LICENSE`) | JBIG2-Bilder |
| lcms2 (lcms2mt, Artifex-Fork) | MIT | Farbmanagement |
| libjpeg (IJG) | IJG | This software is based in part on the work of the Independent JPEG Group. |
| OpenJPEG | BSD-2-Clause | JPEG 2000 |
| zlib | Zlib | Kompression |
| Tesseract OCR | Apache-2.0 | Feature `tesseract` |
| Leptonica | BSD-2-Clause | Feature `tesseract`; Lizenztext fehlt im Crate, von Upstream (DanBloomberg/leptonica) übernehmen |
| zxing-cpp | Apache-2.0 | Barcode (`FZ_ENABLE_BARCODE` ist Default 1) |
| zint (Backend) | BSD-3-Clause | Barcode |
| extract (Artifex) | AGPL-3.0 | DOCX/ODT-Ausgabe, deaktiviert (`FZ_ENABLE_DOCX_OUTPUT=0`) |
| gumbo-parser | Apache-2.0 | HTML-Parser der HTML-Engine (für FB2/TXT/Office); unter MSVC gelinkt |
| MuJS (Artifex) | ISC | JavaScript, deaktiviert (`FZ_ENABLE_JS=0`) |
| brotli | MIT | deaktiviert (`FZ_ENABLE_BROTLI=0`) |

Silbentrennungsmuster (`resources/hyphen`, tex-hyphen; u. a. LPPL, LGPL, ein Muster ohne Lizenz) sind abgeschaltet: unter Linux/macOS mangels HTML-Engine, unter MSVC per `FZ_ENABLE_HYPHEN=0` aus `.cargo/config.toml` (ohne diesen Schalter landeten sie über die FB2/TXT/Office-Handler in der Binary; die Linkmap-Prüfung schlägt dann fehl). Die Schriften `han`, `droid`, `noto`, `sil` entfernt `mupdf-sys` aus dem Build.

### Fremdteile im MuPDF-Kern (gelinkt mit `libmupdf`)

Volltexte: `THIRD-PARTY-LICENSES/mupdf-core-NOTICES.txt`.

| Teil | Lizenz | Hinweis |
|---|---|---|
| Adobe CMaps (`source/pdf/cmaps/*.h`) | BSD-3-Clause, Copyright 1990–2019 Adobe Systems Incorporated | Zeichensatz-Tabellen für CJK-Schriften |
| Adobe Glyph List 2.0 (`source/fitz/glyphlist.h`) | BSD-3-Clause, Adobe Systems Incorporated | Glyphnamen → Unicode |
| UCDN (`source/fitz/ucdn.c`) | ISC, Copyright 2012 Grigori Goronzy | Unicode-Eigenschaften |
| Unicode-Daten (UCD 16.0) und Bidi-Referenzimplementierung | Unicode License v3 | `ucdn_db.h`, `utfdata.h`, `bidi-std.c` |
| Grisu2 (`source/fitz/ftoa.c`) | MIT, Copyright 2009 Florian Loitsch | Zahlen → Text |
| Open Iconic (`source/pdf/annotation-icons.h`) | MIT, Copyright 2014 Waybury | Symbole von Text-Anmerkungen |
| Arcfour (`source/fitz/crypt-arc4.c`) | BSD-artig, Copyright 1997 Kalle Kaukonen | PDF-Verschlüsselung (RC4) |
| AES (XySSL), MD5, SHA-2, getopt | BSD-artig ohne Binärhinweispflicht bzw. Public Domain | – |

### URW-Schriften (Base 14, in `mupdf-sys` 0.8.0)

Nimbus Sans, Nimbus Roman, Nimbus Mono PS, Standard Symbols PS, Dingbats, NimbusBoxes – Copyright (URW)++ Design & Development. MuPDF (`resources/fonts/urw/*.cff`) enthält sie als CFF-Teilmengen des URW-Releases vom 2017-07-27 (MuPDF-Commit `72aaafb`; Dingbats/Symbol aus dem Release von 2016).

**Lizenz:** `OFL-1.1 OR (AGPL-3.0-only WITH PS-or-PDF-font-exception-20170817)` – jede der beiden genügt:

- **SIL OFL 1.1** – `THIRD-PARTY-LICENSES/URW-Base35-OFL-1.1.txt` (= `resources/fonts/urw/OFL.txt` in MuPDF upstream; in der Crate `mupdf-sys` nicht enthalten). Die OFL gilt nicht für Dokumente, die mit den Schriften erstellt werden.
- **AGPL-3.0 mit Font-Ausnahme** – `THIRD-PARTY-LICENSES/URW-Base35-AGPL-Font-Exception.txt` (= `LICENSE` in ArtifexSoftware/urw-base35-fonts):
  > As a special exception, permission is granted to include these font programs in a Postscript or PDF file that consists of a document that contains text to be displayed or printed using this font, regardless of the conditions or license applying to the document itself.

Die App bettet Nimbus Sans/Roman/Mono PS vollständig in PDFs ein: als Ersatzschrift beim Bearbeiten von Text, im Notizbuch-Export und in der unsichtbaren OCR-Textebene. Die erzeugten PDFs stehen deshalb nicht unter der AGPL. Bei unsichtbarem OCR-Text deckt die OFL das eindeutig ab, die AGPL-Ausnahme spricht nur von Text, der „displayed or printed“ wird. Belege: `docs/LIZENZ-AUDIT.md`, „Ergebnis Y4“.

### Weitere ausgelieferte Rust-Crates (transitiv)

Vollständige Liste mit Versionen: `docs/LIZENZ-AUDIT.md`, Anhang A (Stand Version 1.2.0, 219 Crates für `x86_64-pc-windows-msvc`, davon 139 in der Binary gelinkt, der Rest nur Proc-Macros und deren Abhängigkeiten zur Compile-Zeit). Lizenzen dort: MIT OR Apache-2.0 (überwiegend), MIT, Apache-2.0 (`tao`), Unicode-3.0 (ICU4X: `icu_*`, `zerovec`, `yoke`, `tinystr`, … über `url`/`idna`), BSD-3-Clause (`alloc-no-stdlib`, `alloc-stdlib`, `brotli`), Zlib (`foldhash`), 0BSD/CC0-1.0/MIT-0/Unlicense als Wahlmöglichkeit, ISC.

**MPL-2.0:** `option-ext` (über `dirs`, gelinkt) sowie `cssparser`, `cssparser-macros`, `dtoa-short`, `selectors` (über `tauri-utils`, nur zur Compile-Zeit in `tauri-codegen`/`tauri-macros`) stehen unter der Mozilla Public License 2.0. Ihr Quellcode ist unverändert auf https://crates.io erhältlich (jeweilige Version laut `src-tauri/Cargo.lock`).

**Microsoft WebView2 Loader:** `webview2-com-sys` (MIT) linkt unter MSVC Microsofts `WebView2LoaderStatic.lib` aus dem WebView2-SDK 1.0.3800.47 statisch ein. Copyright (C) Microsoft Corporation, BSD-artige Lizenz: `THIRD-PARTY-LICENSES/webview2-sdk-LICENSE.txt`. Den Loader gibt es nur als Binärdatei. Er wird als System Library im Sinne von AGPL-3.0 §1 behandelt (bewusst akzeptiertes Restrisiko, Begründung: `docs/LIZENZ-AUDIT.md`, „Entscheidung R3“). Für den eigenen Code gilt zusätzlich die Erlaubnis in `LICENSE-ADDITIONAL-PERMISSION.md`.

### Weitere gebündelte npm-Pakete (transitiv)

`scheduler` 0.28 (MIT, Meta – Teil von React DOM); `tslib` (0BSD, Microsoft – in `@tauri-apps/api` eingebettet). `@tauri-apps/plugin-dialog` enthält nur `LICENSE.spdx`; sein Lizenztext (MIT OR Apache-2.0) ist derselbe wie bei `@tauri-apps/api` und beim Rust-Crate `tauri-plugin-dialog` (`rust-crates.html`). Die `mathjax-full`-Abhängigkeiten `speech-rule-engine`, `mhchemparser`, `mj-context-menu`, `@xmldom/xmldom`, `commander`, `wicked-good-xpath`, `esm` landen nicht im `dist`-Bundle (geprüft am Vite-Build).

### App-Icon

`src-tauri/icons/*`: eigenes Werk des Projektautors (felix-d-git), 2026 mit Google Gemini als KI-Bild erzeugt, danach bearbeitet (Ecken transparent, Größen per `tauri icon`). Keine fremde Vorlage, keine Lucide-Ableitung. Soweit schutzfähig: AGPL-3.0-only wie das Projekt.

### Installer

NSIS-Installer-Stub (zlib/libpng-Lizenz) und die Tauri-NSIS-Erweiterungen (MIT OR Apache-2.0) werden von `tauri build` erzeugt.

Nur zur Entwicklung (nicht ausgeliefert): Vite, Vitest, jsdom (DOM für Komponententests), TypeScript, ESLint, typescript-eslint (MIT bzw. Apache-2.0).

## Nur Spikes (`spikes/`, Wegwerfcode)

| Komponente | Version | Lizenz | Verwendung |
|---|---|---|---|
| `pdfium-render` | 0.9.4 | MIT OR Apache-2.0 | Vergleichs-Spike `spikes/pdfium-spike` |
| PDFium-Binary (bblanchon/pdfium-binaries) | 157.0.8100 | Apache-2.0 / BSD-3-Clause (PDFium), MIT (Build) | Vergleichs-Spike, nicht im Repo |
| perfect-freehand (Stephen Ruiz Ltd) | 1.2.3 | MIT | Ink-Glättung; inline in `spikes/ink-test.html` |
