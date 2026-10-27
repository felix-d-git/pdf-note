# Lizenz-Audit PDF Note

Stand: 2026-10-27 · Issues: #4 (Sammel-Issue) mit #7–#14 · geprüfter Commit: `9e3b436` (`master` = `second`) · Version 1.2.0 · Nachtrag 2026-10-27: R3 entschieden (#9), Y4 geklärt (#11)
Ziel der Veröffentlichung: Repo öffentlich + Windows-Installer (NSIS) als GitHub-Release.

> Dies ist eine technische Compliance-Analyse, keine Rechtsberatung. Punkte mit **UNKLAR** brauchen eine manuelle (ggf. juristische) Prüfung.

## Ergebnis in einem Satz

Die Projektlizenz **AGPL-3.0-only** ist mit allen gefundenen Komponenten kompatibel – es gibt **keinen Copyleft-Konflikt im Quellcode**. Die Risiken liegen bei den **Pflichten der Binärverteilung**: Der Installer enthält keine Drittanbieter-Lizenztexte, es fehlt ein Quellcode-Angebot nach AGPL §6, und Microsofts quelloffen nicht verfügbare `WebView2LoaderStatic.lib` wird statisch in die AGPL-Binary gelinkt (als System Library eingeordnet, bewusst akzeptiertes Restrisiko – R3).

## Risiko-Matrix

| ID | Stufe | Befund | Status |
|---|---|---|---|
| R1 | 🔴 RED | Installer liefert außer `LICENSE` (AGPL) und `tessdata/LICENSE` **keine** Lizenztexte/Copyright-Hinweise der ~240 gebündelten Komponenten mit (MIT, BSD, ISC, Apache-2.0, OFL-1.1, Unicode-3.0, MPL-2.0, Zlib, IJG …). Das JS-Bundle enthält 0 Lizenzkommentare (Minifier entfernt sie). Verstoß gegen die Bedingung „copyright notice and permission notice shall be included“ bei jeder Binärweitergabe. | offen → #7 |
| R2 | 🔴 RED | **AGPL §6 – Corresponding Source** für jede Binär-Weitergabe: Repo ist privat, Releases verweisen nicht auf den Quellstand, MuPDF-C-Quellen kommen über `mupdf-sys` von crates.io. Muss vor der ersten öffentlichen Installer-Weitergabe gelöst sein. | offen → #8 |
| R3 | 🟡 YELLOW (akzeptiert) | `webview2-com-sys` linkt unter MSVC Microsofts **`WebView2LoaderStatic.lib`** (SDK 1.0.3800.47, BSD-artig, nur Binär) **statisch** in die Binary. AGPL §1/§6 verlangt Quellcode für das Gesamtwerk außer „System Libraries“. Der Loader dient nur dazu, die WebView2-Laufzeit von Windows zu nutzen (§1 (b) erfüllt). Strittig ist nur §1 (a), weil er mit dem SDK und nicht mit der Laufzeit kommt. Entscheidung: als System Library behandeln, Restrisiko gering; zusätzliche Erlaubnis nach §7 für den eigenen Code. | entschieden → #9, siehe „Entscheidung R3“ |
| Y1 | 🟡 YELLOW | `mupdf-sys` baut unter MSVC die **gesamte** `libmupdf`/`libthirdparty` (msbuild ignoriert die `make`-Feature-Schalter). Bisher nicht genannt: zxing-cpp (Apache-2.0), zint (BSD-3-Clause), gumbo-parser (Apache-2.0), MuJS (ISC), extract (AGPL-3.0), brotli (MIT), Leptonica-Lizenztext fehlt im Crate. Was der Linker tatsächlich übernimmt, ist **UNKLAR**. | Notices im PR ergänzt (#14) (konservativ); Verifikation → #10 |
| Y2 | 🟡 YELLOW | FreeType als „FTL“ aufgeführt. Die FTL ist wegen der Werbeklausel **GPL-inkompatibel**; im AGPL-Gesamtwerk gilt die Alternative **GPL-2.0-or-later**. | im PR korrigiert (#14) |
| Y3 | 🟡 YELLOW | Transitive Rust-Crates fehlen in `THIRD-PARTY-NOTICES.md`, darunter **MPL-2.0** (`cssparser`, `selectors`, `dtoa-short`, `option-ext` – MPL §3.2 verlangt Hinweis auf Bezugsquelle des Quellcodes), **Unicode-3.0** (ICU4X), BSD-3-Clause, Zlib, `tao` (nur Apache-2.0). | im PR zusammengefasst (#14); Volltexte → R1 (#7) |
| Y4 | 🟢 GREEN (geklärt) | URW-Base-14-Schriften werden **vollständig in Nutzer-PDFs eingebettet** (Textbearbeitung, Notizbuch, OCR-Ebene). Am Original belegt: `OFL-1.1 OR (AGPL-3.0-only WITH PS-or-PDF-font-exception-20170817)`. Beide Lizenzen erlauben das Einbetten, ohne dass die AGPL auf das Dokument übergreift. Lizenztexte in `THIRD-PARTY-LICENSES/`. | geklärt → #11, siehe „Ergebnis Y4“; Auslieferung der Texte → R1 (#7) |
| Y5 | 🟡 YELLOW | AGPL §5(d): Programme mit interaktiver Oberfläche sollen „Appropriate Legal Notices“ anzeigen (Copyright, keine Gewährleistung, Lizenz, Weg zum Lizenztext). Die App hat kein „Über/Lizenzen“. | offen → #12 |
| Y6 | 🟡 YELLOW | Kein Copyright-Vermerk des Projekts (weder `README`, `LICENSE` noch Quelltext). | im PR ergänzt (#14) |
| Y7 | 🟡 YELLOW | `spikes/ink-test.html` enthält perfect-freehand inline, aber nur „MIT, (c) …“ statt des vollständigen MIT-Hinweises. | im PR ergänzt (#14) |
| Y8 | 🟡 YELLOW | AGPL §5(a): geänderte Datei `vendor/mupdf/src/device/native.rs` ohne Änderungsvermerk/Datum; `PATCH.md` ohne Datum. | im PR ergänzt (#14) |
| Y9 | 🟡 YELLOW (UNKLAR) | Herkunft des App-Icons (`src-tauri/icons/*`) ist nicht dokumentiert (Datei-Symbol mit Kurve, Lucide-Stil). | offen → #13 |
| Y10 | 🟡 YELLOW | IJG-Lizenz (libjpeg) verlangt in der Dokumentation den Satz „This software is based in part on the work of the Independent JPEG Group“. Fehlte. | im PR ergänzt (#14) |
| G | 🟢 GREEN | Alle übrigen Komponenten: permissiv bzw. AGPL-kompatibel, keine Lizenz fehlt, keine NC/proprietären Lizenzen im Quellbaum. Dev-Abhängigkeiten (u. a. `lightningcss` MPL-2.0, `caniuse-lite` CC-BY-4.0) werden nicht ausgeliefert. Spikes (`pdfium-render`, PDFium) werden nicht ausgeliefert. | – |

## Phase 1 – Inventar

**Meta-Dateien**
- `LICENSE`: vollständiger AGPL-3.0-Text, `package.json`/`Cargo.toml`: `AGPL-3.0-only` – konsistent.
- `README.md`: verweist auf `LICENSE` und `THIRD-PARTY-NOTICES.md`; kein Copyright-Vermerk (→ Y6).
- `THIRD-PARTY-NOTICES.md`: gepflegt, listet aber nur direkte Abhängigkeiten (→ Y1, Y3).
- Kein `NOTICE`, keine SPDX-Header in eigenen Quelldateien (0 Treffer) – für AGPL nicht vorgeschrieben.
- `tauri.conf.json`: `bundle.licenseFile = ../LICENSE` (im NSIS-Installer angezeigt), `bundle.resources = resources/tessdata/*` (enthält `tessdata/LICENSE`). Sonst gehen keine Lizenzdateien in den Installer (→ R1).

**Paketmanager**
| Quelle | Umfang |
|---|---|
| `src-tauri/Cargo.lock` | 222 ausgelieferte Crates (Windows/MSVC, normal) + 23 reine Build-Crates – Anhang A/B |
| `package-lock.json` | 296 Einträge, davon 20 ohne `dev`-Flag, 11 tatsächlich im `dist`-Bundle – Anhang C/D |
| `spikes/*/Cargo.lock` | Wegwerf-Spikes, nicht ausgeliefert |

**Vendor / inline / native Bibliotheken**
| Pfad | Inhalt | Lizenz |
|---|---|---|
| `vendor/mupdf/` | mupdf-rs 0.8.0 (messense), 1 Zeile gepatcht | AGPL-3.0, `LICENSE` + `PATCH.md` vorhanden |
| `mupdf-sys` 0.8.0 (crates.io) | MuPDF-C-Quellen (Artifex) + `thirdparty/` | AGPL-3.0 + Drittlizenzen (Y1) |
| `webview2-com-sys` 0.39.1 | `WebView2LoaderStatic.lib` (Microsoft, Binär; bitidentisch mit NuGet `Microsoft.Web.WebView2` 1.0.3800.47) | Microsoft WebView2-SDK-Lizenz (BSD-artig, `THIRD-PARTY-LICENSES/webview2-sdk-LICENSE.txt`), **kein Quellcode** (R3, akzeptiert) |
| `spikes/ink-test.html` | perfect-freehand 1.2.3 inline | MIT (Y7) |

Gebaute MuPDF-Drittbibliotheken unter MSVC (`platform/win32/libmupdf.vcxproj` + Projekt-Referenzen): FreeType, HarfBuzz, jbig2dec, lcms2(mt), libjpeg, OpenJPEG, zlib, brotli, gumbo-parser, MuJS, extract, Tesseract, Leptonica, zxing-cpp, zint. Feature-Defines: `FZ_ENABLE_JS/HTML/EPUB/BROTLI/DOCX_OUTPUT = 0`, `FZ_ENABLE_BARCODE = 1` (Default), `FZ_ENABLE_HYPHEN = 0` (folgt aus deaktivierter HTML-Engine → Silbentrennungsmuster werden nicht genutzt). Die Fonts `han/droid/noto/sil` entfernt `mupdf-sys` aus `libresources`; es bleiben die URW-Base-14-Fonts.

**Nicht-Code-Assets**
| Asset | Herkunft | Lizenz | Status |
|---|---|---|---|
| `src-tauri/resources/tessdata/{deu,eng}.traineddata` | tesseract-ocr/tessdata_fast 4.1.0 | Apache-2.0, `LICENSE` liegt bei und wird ausgeliefert | 🟢 |
| Manrope (Variable), IBM Plex Mono 400/500 (woff/woff2 im `dist`) | Fontsource | OFL-1.1 – Lizenztext muss mitgeliefert werden | 🟡 → R1 |
| URW Nimbus Sans/Roman/Mono PS, Standard Symbols PS, Dingbats, NimbusBoxes | MuPDF `resources/fonts/urw` | OFL-1.1 OR (AGPL-3.0-only WITH PS-or-PDF-font-exception-20170817) – Lizenztext muss mitgeliefert werden | 🟢 Y4 → R1 |
| MathJax-TeX-Fontdaten | `mathjax-full` 3.2.2 | Apache-2.0 | 🟢 → R1 |
| Lucide-Icons (Tree-Shaking) | `lucide-react` 1.59 | ISC; ein Teil aus Feather (MIT) | 🟢 → R1 |
| App-Icon `src-tauri/icons/*` | nicht dokumentiert | **UNKLAR** | 🟡 Y9 |

## Phase 2 – Kategorisierung (ausgelieferte Komponenten)

| Kategorie | Komponenten |
|---|---|
| Permissiv | ~210 Rust-Crates (MIT, Apache-2.0, MIT OR Apache-2.0, BSD-2/3, ISC, Zlib, 0BSD, CC0/MIT-0, Unlicense OR MIT, Unicode-3.0); npm: React, React DOM, scheduler, Zod, perfect-freehand, lucide-react, @tauri-apps/*, mathjax-full; C: HarfBuzz, lcms2, libjpeg (IJG), OpenJPEG, zlib, brotli, gumbo, MuJS, zxing-cpp, zint, Tesseract, Leptonica; Tesseract-Modelle; NSIS-Installer-Stub (zlib/libpng-Lizenz) |
| Weak Copyleft | MPL-2.0: `cssparser`, `cssparser-macros`, `dtoa-short`, `selectors`, `option-ext` (keine „Incompatible With Secondary Licenses“-Markierung → mit AGPL kombinierbar) |
| Strong Copyleft | AGPL-3.0: MuPDF, `mupdf`, `mupdf-sys`, jbig2dec, extract; FreeType (gewählt: GPL-2.0-or-later) |
| Schrift | OFL-1.1: Manrope, IBM Plex Mono, URW-Base-14 (wahlweise AGPL-3.0 mit PS/PDF-Font-Ausnahme) |
| Proprietär / binär ohne Quelle | `WebView2LoaderStatic.lib` (Microsoft, BSD-artige Lizenz, kein Quellcode) – R3 (akzeptiert) |
| Ohne Lizenz / UNKLAR | App-Icon (Y9) |

## Phase 3 – Kompatibilität

- **Copyleft-Infektion:** Das Projekt ist selbst AGPL-3.0-only – die AGPL von MuPDF erzwingt nichts, was nicht ohnehin gilt. Konsequenz: der **gesamte** Quellcode muss bei jeder Weitergabe der Binary verfügbar sein (R2). §13 (Netzwerknutzung) ist für eine Offline-Desktop-App ohne Server nicht einschlägig.
- **Apache-2.0 + AGPL-3.0:** kompatibel (GPLv3-Familie). Kein GPL-2.0-only im Baum.
- **FreeType:** FTL ist GPL-inkompatibel → GPL-2.0-or-later-Option wählen (Y2, im PR dokumentiert).
- **MPL-2.0:** dateibasiertes Copyleft, AGPL ist zulässige „Secondary License“ → kompatibel; Pflicht: Hinweis, dass der MPL-Quellcode verfügbar ist (Y3).
- **OFL-1.1:** Fonts dürfen gebündelt werden, nicht einzeln verkauft; Lizenz + Copyright müssen beiliegen (R1). Die OFL greift nicht auf die Software über.
- **Unicode-3.0, Zlib, 0BSD, CC0, Unlicense:** permissiv, kompatibel.
- **Dual-/Multi-Lizenzen** (`MIT OR Apache-2.0` usw.): es darf eine gewählt werden; Empfehlung: beide Texte mitliefern.
- **Microsoft WebView2 Loader:** die Lizenz selbst ist GPL-kompatibel, es fehlt nur der Quellcode. Einzige Stelle, an der eine Unvereinbarkeit mit der AGPL denkbar ist – eingeordnet als System Library, siehe „Entscheidung R3“.
- **URW-Schriften in erzeugten PDFs:** OFL-1.1 bzw. die PS/PDF-Font-Ausnahme lassen eingebettete Schriften nicht auf das Dokument übergreifen (Y4).
- **Unlizenzierter Code:** keiner gefunden; alle 222 Crates und alle npm-Pakete haben ein SPDX-Feld.

## Phase 4 – Pflichten-Check

| Lizenz | Pflicht bei Binärweitergabe | erfüllt? |
|---|---|---|
| AGPL-3.0 (MuPDF, eigenes Werk) | Lizenztext beilegen; Corresponding Source anbieten (§6); geänderte Dateien kennzeichnen mit Datum (§5a); Appropriate Legal Notices in UI (§5d) | Text ✅ · Quelle ❌ R2 · Vermerk ✅ (PR) · UI ❌ Y5 |
| MIT / ISC / BSD / Zlib / Unicode-3.0 / 0BSD | Copyright + Lizenztext in Kopien/Doku | ❌ R1 |
| Apache-2.0 | Lizenztext beilegen; vorhandene `NOTICE`-Dateien weitergeben (§4d); Änderungen kennzeichnen | Text ❌ R1 · Upstream-`NOTICE`-Dateien: in keinem der 222 Crates, in `mupdf-sys/thirdparty` und in `mathjax-full` keine gefunden ✅ (tessdata_fast: nur `LICENSE` übernommen, Upstream-Repo gegenprüfen) · keine Änderungen ✅ |
| MPL-2.0 | Hinweis auf Bezugsquelle der Quellform + Lizenztext | ❌ R1 (Hinweis im PR) |
| OFL-1.1 (Manrope, IBM Plex Mono, URW) | Copyright + Lizenz bei jeder Kopie der Fonts | ❌ R1 (URW-Text liegt in `THIRD-PARTY-LICENSES/`) |
| IJG (libjpeg) | Satz „based in part on the work of the Independent JPEG Group“ in der Doku | ✅ (PR) |
| FreeType (GPL-2.0+) | GPL-Pflichten, über AGPL ohnehin erfüllt | ✅ mit R2 |
| Microsoft WebView2-SDK | Copyright + Lizenzbedingungen in der Doku wiedergeben | ❌ R1 (Text liegt in `THIRD-PARTY-LICENSES/`, muss in den Installer); Grundsatzfrage R3 entschieden |
| NSIS | keine Attributionspflicht für den Stub | ✅ |

## Phase 5 – Deliverables

### SBOM-Auszug (ausgelieferte Hauptkomponenten)

Vollständige Listen: Anhang A–D.

| Komponente | Version | Lizenz | Typ | Pfad / Herkunft | Status / Aktion |
|---|---|---|---|---|---|
| PDF Note (eigener Code) | 1.2.0 | AGPL-3.0-only | Strong Copyleft | `src/`, `src-tauri/src/` | 🟡 Copyright-Vermerk (Y6, PR), Legal Notices in UI (Y5) |
| MuPDF (C) | über mupdf-sys 0.8.0 | AGPL-3.0 | Strong Copyleft | crates.io `mupdf-sys` | 🔴 Quellangebot R2 |
| `mupdf` (Rust) | 0.8.0 | AGPL-3.0 | Strong Copyleft | `vendor/mupdf/` (gepatcht) | 🟡 Änderungsvermerk (Y8, PR) |
| jbig2dec | MuPDF-thirdparty | AGPL-3.0 | Strong Copyleft | mupdf-sys | 🟢 mit R2 |
| extract | MuPDF-thirdparty | AGPL-3.0 | Strong Copyleft | mupdf-sys (MSVC) | 🟡 Y1 Verlinkung prüfen |
| FreeType | MuPDF-thirdparty | FTL OR GPL-2.0-or-later → **GPL-2.0+** | Strong Copyleft | mupdf-sys | 🟡 Y2 (PR) |
| HarfBuzz | MuPDF-thirdparty | MIT („Old MIT“) | Permissiv | mupdf-sys | 🔴 R1 |
| lcms2 (lcms2mt) | MuPDF-thirdparty | MIT | Permissiv | mupdf-sys | 🔴 R1 |
| libjpeg | MuPDF-thirdparty | IJG | Permissiv | mupdf-sys | 🔴 R1, IJG-Satz (Y10, PR) |
| OpenJPEG | MuPDF-thirdparty | BSD-2-Clause | Permissiv | mupdf-sys | 🔴 R1 |
| zlib | MuPDF-thirdparty | Zlib | Permissiv | mupdf-sys | 🔴 R1 |
| Tesseract | MuPDF-thirdparty | Apache-2.0 | Permissiv | mupdf-sys | 🔴 R1 |
| Leptonica | MuPDF-thirdparty | BSD-2-Clause | Permissiv | mupdf-sys (Lizenzdatei fehlt im Crate) | 🔴 R1 – Text von Upstream holen |
| zxing-cpp | MuPDF-thirdparty | Apache-2.0 | Permissiv | mupdf-sys (MSVC, `FZ_ENABLE_BARCODE=1`) | 🟡 Y1 |
| zint (Backend) | MuPDF-thirdparty | BSD-3-Clause | Permissiv | mupdf-sys (MSVC) | 🟡 Y1 |
| gumbo-parser | MuPDF-thirdparty | Apache-2.0 | Permissiv | mupdf-sys (MSVC, HTML aus) | 🟡 Y1 |
| MuJS | MuPDF-thirdparty | ISC | Permissiv | mupdf-sys (MSVC, JS aus) | 🟡 Y1 |
| brotli (C) | MuPDF-thirdparty | MIT | Permissiv | mupdf-sys (MSVC, Brotli aus) | 🟡 Y1 |
| URW-Base-14-Fonts | MuPDF `resources/fonts/urw` | OFL-1.1 OR (AGPL-3.0-only WITH PS-or-PDF-font-exception-20170817) | Schrift | mupdf-sys | 🟢 Y4, Text → R1 |
| WebView2 Loader (static) | SDK 1.0.3800.47 in webview2-com-sys 0.39.1 | Microsoft (BSD-artig), nur Binär | Proprietär/Binär | crates.io | 🟡 R3 akzeptiert, Text → R1 |
| Tauri, wry, tao, Plugins | 2.12 / 0.57 / 0.37 | MIT OR Apache-2.0 (tao: Apache-2.0) | Permissiv | crates.io / npm | 🔴 R1 |
| windows, windows-sys, webview2-com | 0.62 / 0.60–0.61 / 0.39 | MIT OR Apache-2.0 / MIT | Permissiv | crates.io | 🔴 R1 |
| ICU4X (`icu_*`, `zerovec`, …) | 2.3 | Unicode-3.0 | Permissiv | crates.io (über `url`/`idna`) | 🔴 R1 |
| `cssparser`, `selectors`, `dtoa-short`, `option-ext` | 0.37 / 0.38 / 0.3 / 0.2 | MPL-2.0 | Weak Copyleft | crates.io (Tauri-Utils, `dirs`) | 🟡 Y3 (PR) + R1 |
| `serde`, `serde_json`, `base64` | 1.0 / 1.0 / 0.22 | MIT OR Apache-2.0 | Permissiv | crates.io | 🔴 R1 |
| `rfd` | 0.16 | MIT | Permissiv | crates.io | 🔴 R1 |
| React, React DOM, scheduler | 19.3 / 0.28 | MIT | Permissiv | npm, im Bundle | 🔴 R1 |
| Zod | 4.6.7 | MIT | Permissiv | npm, im Bundle | 🔴 R1 |
| perfect-freehand | 1.2.3 | MIT | Permissiv | npm, im Bundle; inline in Spike | 🔴 R1, Spike Y7 (PR) |
| lucide-react | 1.59 | ISC (+ MIT Feather) | Permissiv | npm, im Bundle | 🔴 R1 |
| mathjax-full | 3.2.2 | Apache-2.0 | Permissiv | npm, im Bundle | 🔴 R1 |
| @tauri-apps/api, plugin-dialog | 2.12 / 2.8 | MIT OR Apache-2.0 | Permissiv | npm, im Bundle | 🔴 R1 |
| Manrope | 5.3.0 (Fontsource) | OFL-1.1 | Schrift | npm, im Bundle | 🔴 R1 |
| IBM Plex Mono | 5.3.0 (Fontsource) | OFL-1.1 | Schrift | npm, im Bundle | 🔴 R1 |
| Tesseract-Modelle deu/eng | 4.1.0 | Apache-2.0 | Daten | `src-tauri/resources/tessdata/` | 🟢 Lizenz liegt bei |
| App-Icon | – | **UNKLAR** | Asset | `src-tauri/icons/` | 🟡 Y9 |
| pdfium-render, PDFium | 0.9.4 / 157 | MIT OR Apache-2.0 / Apache-2.0, BSD-3 | Permissiv | nur `spikes/` | 🟢 nicht ausgeliefert |

### Action Plan

**Vor dem Öffentlich-Stellen des Repos** (Quellcode-Veröffentlichung)
1. PR `second → master` mit den Korrekturen dieses Audits mergen (Y2, Y3, Y6, Y7, Y8, Y10, Y1 als konservative Liste).
2. Y9 klären: Icon-Herkunft (selbst gezeichnet? aus Lucide `file` + `spline` abgeleitet?) in `THIRD-PARTY-NOTICES.md` festhalten; bei Lucide-Ableitung ISC-Hinweis ergänzen.

**Vor der ersten öffentlichen Installer-Weitergabe** (Binärverteilung)
3. **R1 – Lizenzsammlung erzeugen und ausliefern**
   - Rust: `cargo about generate` (MIT OR Apache-2.0) mit `about.toml` (`accepted = [...]`, `targets = ["x86_64-pc-windows-msvc"]`) → `THIRD-PARTY-LICENSES/rust.html` o. ä.
   - npm: Vite-Option `build.license: true` (seit Vite 7, erzeugt `dist/.vite/license.md` aller gebündelten Pakete) oder `license-checker-rseidelsohn --production`.
   - MuPDF-C-Bibliotheken: Lizenzdateien aus `mupdf-sys-0.8.0/mupdf/thirdparty/*/{COPYING,LICENSE*}` sowie Leptonica-Lizenz von Upstream kopieren.
   - Fonts: `OFL.txt` von Manrope und IBM Plex Mono (`node_modules/@fontsource*/…/LICENSE`); URW: `THIRD-PARTY-LICENSES/URW-Base35-*.txt` (liegt bereits vor).
   - WebView2-SDK-Lizenztext: `THIRD-PARTY-LICENSES/webview2-sdk-LICENSE.txt` (liegt bereits vor).
   - Alles per `bundle.resources` in den Installer (z. B. `"../THIRD-PARTY-LICENSES/*": "licenses/"`) und im CI prüfen, dass die Dateien im NSIS-Paket landen.
4. **R2 – Corresponding Source**: Repo öffentlich, jedes Release mit Tag; im Release-Text und in der App: „Quellcode: https://github.com/felix-d-git/pdf-note/tree/vX.Y.Z“. Weil MuPDF über crates.io kommt, zusätzlich `mupdf-sys-0.8.0.crate` als Release-Asset anhängen oder ausdrücklich auf crates.io verweisen (AGPL §6(d) erlaubt Drittserver, wenn die Verfügbarkeit gesichert ist – ein eigenes Asset ist robuster). Vorlage `SOURCE.md` siehe unten.
5. ~~**R3 – WebView2 Loader**: Entscheidung treffen~~ – erledigt: Option „Risiko mit Begründung akzeptieren“, siehe „Entscheidung R3“. Die Einschätzung dort setzt voraus, dass R1 und R2 vor dem ersten öffentlichen Installer erledigt sind.
6. **Y1 – Verlinkung verifizieren**: Release-Build mit `/MAP` bzw. `dumpbin /SYMBOLS` auswerten, welche Drittbibliotheken tatsächlich in `pdf-note.exe` landen; Notices danach präzisieren (lieber zu viel als zu wenig nennen).
7. ~~**Y4 – URW-Fonts**: Lizenz belegen und zitieren~~ – erledigt, siehe „Ergebnis Y4“ und `THIRD-PARTY-NOTICES.md`.
8. **Y5 – „Über / Lizenzen“** in der App (Hilfe-Dialog): Copyright, „ohne jede Gewährleistung“, AGPL-3.0, Link/Datei zum Lizenztext, Quellcode-URL, Liste der Drittlizenzen (aus R1).

**Dauerhaft**
9. Dependabot-Updates ändern die Crate-/npm-Liste: Lizenzsammlung (R1) im Build erzeugen statt von Hand pflegen; im CI `cargo deny check licenses` mit Allowlist (AGPL-3.0, MPL-2.0, MIT, Apache-2.0, BSD-2/3-Clause, ISC, Zlib, 0BSD, CC0-1.0, MIT-0, Unicode-3.0, Unlicense, OFL-1.1) als Schranke gegen neue inkompatible Lizenzen.

### Vorlagen

**Copyright-Kopf für `README.md` / Über-Dialog**
```
PDF Note – Copyright (C) 2026 felix-d-git
This program comes with ABSOLUTELY NO WARRANTY. This is free software,
licensed under the GNU Affero General Public License v3.0 only.
Source code: https://github.com/felix-d-git/pdf-note
```

**`SOURCE.md` (Release-Asset / Installer)**
```
Corresponding Source (AGPL-3.0 §6) für PDF Note vX.Y.Z

- Quellcode dieses Releases: https://github.com/felix-d-git/pdf-note/tree/vX.Y.Z
  (inkl. vendor/mupdf mit Patch, Cargo.lock, package-lock.json)
- MuPDF-C-Quellen: mupdf-sys 0.8.0, als Release-Asset mupdf-sys-0.8.0.crate
  und unter https://crates.io/crates/mupdf-sys/0.8.0
- Build: npm ci && npm run tauri build (Windows, MSVC, LLVM für bindgen)
Dieses Angebot gilt mindestens drei Jahre ab Veröffentlichung des Releases.
```

**`about.toml` (cargo-about)**
```toml
accepted = ["AGPL-3.0", "MPL-2.0", "Apache-2.0", "MIT", "BSD-2-Clause", "BSD-3-Clause",
            "ISC", "Zlib", "0BSD", "CC0-1.0", "MIT-0", "Unicode-3.0", "Unlicense"]
targets = ["x86_64-pc-windows-msvc"]
ignore-build-dependencies = true
ignore-dev-dependencies = true
```

## Entscheidung R3 – Microsoft WebView2 Loader (#9)

Entschieden 2026-10-27: **Option 1 – den Loader als System Library behandeln und das Restrisiko bewusst akzeptieren.** Für den eigenen Code gilt zusätzlich die Erlaubnis in `LICENSE-ADDITIONAL-PERMISSION.md`.

### Befund (am Original geprüft)

- `webview2-com-sys` 0.39.1 enthält `x64/`, `x86/` und `arm64/WebView2LoaderStatic.lib`. Laut SHA-256 sind sie **bitidentisch** mit dem NuGet-Paket `Microsoft.Web.WebView2` **1.0.3800.47** (x64: `89c6b872…`). Die Prüfsumme der Crate stimmt mit `Cargo.lock` überein.
- Unter MSVC linkt `src/lib.rs` die Bibliothek mit `link(name = "WebView2LoaderStatic", kind = "static")`. `WebView2Loader.dll` wird nicht ausgeliefert.
- **Lizenz:** `LICENSE.txt` im NuGet-Paket, inhaltlich BSD-3-Clause („Copyright (C) Microsoft Corporation. All rights reserved.“). Weitergabe als Binärdatei ist erlaubt, wenn Copyright, Bedingungen und Haftungsausschluss in der Dokumentation wiedergegeben werden. Die Lizenz ist GPL-kompatibel, es fehlt nur der Quellcode. Kopie: `THIRD-PARTY-LICENSES/webview2-sdk-LICENSE.txt`. Die Crate selbst nennt nur „MIT“ und enthält keinen Microsoft-Lizenztext.
- **Inhalt:** Laut den Strings in der `.lib` enthält sie nur Microsoft-Code (`edge_embedded_browser/client/win/loader_impl.cc`, `environment_helper.cc` u. a.). Die Fremdkomponenten aus `NOTICE.txt` des SDK (Antlr, StringTemplate) gehören zu `wv2winrt` und stecken nicht im Loader.
- **Funktion:** Der Loader sucht die installierte WebView2-Laufzeit (Registry `EdgeUpdate\ClientState`) und startet `EmbeddedBrowserWebView.dll`. wry 0.57 ruft davon nur `CreateCoreWebView2EnvironmentWithOptions` und `GetAvailableCoreWebView2BrowserVersionString` auf.
- **Betroffen ist nur die Binärverteilung:** Repo und Quellcode-Release enthalten den Loader nicht, er kommt erst beim Bauen über crates.io dazu.

### Rechtliche Einordnung (AGPL-3.0 §1)

> The "System Libraries" of an executable work include anything, other than the work as a whole, that (a) is included in the normal form of packaging a Major Component, but which is not part of that Major Component, and (b) serves only to enable use of the work with that Major Component […]. A "Major Component" […] means a major essential component (kernel, window system, and so on) of the specific operating system […]

| Merkmal | Bewertung |
|---|---|
| WebView2-Laufzeit als „Major Component“ | vertretbar: fester Bestandteil von Windows 11, auf Windows 10 breit vorinstalliert, Windows-eigene Komponenten nutzen sie |
| (b) dient nur der Nutzung dieser Komponente | erfüllt: der Loader findet und startet die Laufzeit, sonst nichts |
| (a) in der üblichen Verpackung der Komponente enthalten | **Schwachpunkt:** er kommt mit dem SDK, nicht mit der Laufzeit. Das Gegenargument: Mit statischen Bibliotheken aus Windows-SDK und MSVC ist es genauso, und GPL-Programme linken sie üblicherweise, ohne dass das als Verstoß gilt. |

Die Freiheit, die das Copyleft schützt, bleibt erhalten: Jeder kann den Quellcode ändern und mit demselben frei erhältlichen SDK (automatisch über crates.io) neu bauen. Eine eindeutige Rechtslage gibt es trotzdem nicht.

### Verworfene Alternativen

- **Quelloffener Loader** (`jchv/OpenWebView2Loader`, ISC, 9 Commits, der Autor empfiehlt selbst den offiziellen Loader; der eingebaute Loader von `webview/webview`, MIT): Es gibt keine fertige Rust-Crate. Nötig wären ein Patch von `webview2-com-sys` und ein eigener Nachbau. Das widerspricht `GRUNDSAETZE.md` §4 („eine Bibliothek nachzubilden nicht“, „kein übernommener Fremdcode“). Außerdem hinge er an der **undokumentierten** internen Funktion `CreateWebViewEnvironmentWithOptionsInternal` von `EmbeddedBrowserWebView.dll`.
- **Bei Artifex nachfragen:** Eine Antwort deckt nur Artifex ab, nicht die Autoren von mupdf-rs oder FreeType, und eine formlose Auskunft ist keine Lizenz. Kann später nachgeholt werden, falls gewünscht.

### Risikoabschätzung

**Wer könnte etwas geltend machen?** Nur Rechteinhaber an Copyleft-Code in der Binary: Artifex (MuPDF, jbig2dec, extract), die Autoren von mupdf-rs (`mupdf`, `mupdf-sys`) und das FreeType-Projekt (GPL-2.0-or-later gewählt). Microsoft nicht: Dessen Lizenz ist erfüllt, *sobald* der Lizenztext mitgeliefert wird (R1). Nutzer und Dritte haben keine eigenen Ansprüche.

| Szenario | Wahrscheinlichkeit | Folge |
|---|---|---|
| 1. Niemand beanstandet etwas | sehr hoch | keine |
| 2. Formloser Hinweis eines Rechteinhabers (E-Mail, Issue) | gering | **AGPL §8 Abs. 4:** War es der erste Hinweis dieses Rechteinhabers und wird der Verstoß binnen **30 Tagen** behoben, gilt die Lizenz **dauerhaft** wieder. Abhilfe: Installer aus den Releases nehmen (der Quellcode ist nicht betroffen und bleibt online), danach mit dem Rechteinhaber klären oder umbauen. Kosten: keine. |
| 3. Förmliche Abmahnung durch einen Anwalt (in Deutschland üblicher Weg; die GPL ist hier gerichtlich durchsetzbar, LG München I, Az. 21 O 6123/04, 2004) | sehr gering | Gefordert werden Unterlassungserklärung (meist mit Vertragsstrafe) und Erstattung der Anwaltskosten. §8 beseitigt diese Ansprüche nicht automatisch. Bei einer ersten Abmahnung einer **natürlichen Person, die nicht gewerblich handelt**, deckelt § 97a Abs. 3 UrhG den Gegenstandswert für die Anwaltskosten auf 1.000 € (Gebühr im niedrigen dreistelligen Bereich; Ausnahme bei Unbilligkeit). Eine Unterlassungserklärung nicht ungeprüft unterschreiben. |
| 4. Schadensersatz für die vergangene Verbreitung | äußerst gering | §8 regelt nur die Zukunft. Theoretisch wäre eine Lizenzanalogie denkbar (Artifex hat in den USA gegen ein kommerzielles Produkt geklagt: Artifex v. Hancom, 2017, Vergleich 2018). Bei einer kostenlosen, quelloffenen App ohne Erlös ist der Schaden gering und eine solche Klage unrealistisch. |

**Gesamtbewertung:** Das Restrisiko ist **gering, aber nicht null**. Realistisch ist allenfalls Szenario 2, und das kostet nichts. Szenario 3 wäre der ungünstige Fall mit überschaubaren Kosten. Deshalb 🟡 statt 🔴.

**Die Einschätzung gilt nur unter diesen Bedingungen:**
1. **R1 (#7)** ist vor dem ersten öffentlichen Installer erledigt, insbesondere der Microsoft-Lizenztext. Ohne ihn verletzt der Installer klar die Microsoft-Lizenz und die übrigen Attributionspflichten; das ist dann keine Grauzone mehr.
2. **R2 (#8)** ist erledigt (Quellcode-Angebot). Ein klarer AGPL-Verstoß an anderer Stelle würde jede Kulanz zunichtemachen.
3. Die Verbreitung bleibt **nicht gewerblich**, kostenlos und ohne Werbung. Sonst entfällt der Deckel aus § 97a Abs. 3 UrhG, und die Interessenlage der Rechteinhaber ändert sich.
4. Hinweise sind erreichbar (GitHub-Issues offen) und werden **sofort** bearbeitet.
5. Bei jedem Update von `webview2-com-sys` werden SDK-Version und Lizenztext neu geprüft.

**Notfallplan bei Hinweis oder Abmahnung:** (1) Am selben Tag die Installer-Assets aus allen Releases entfernen. (2) Den Eingang bestätigen und die Abhilfe mitteilen. (3) Eine Abmahnung bzw. Unterlassungserklärung vor der Unterschrift prüfen lassen (ggf. modifizierte Erklärung). (4) Danach entscheiden: Erlaubnis beim Rechteinhaber einholen oder einen quelloffenen Loader einbauen.

## Ergebnis Y4 – URW-Schriften (#11)

Geklärt 2026-10-27. Lizenz der URW-Base-14-Schriften in MuPDF: **`OFL-1.1 OR (AGPL-3.0-only WITH PS-or-PDF-font-exception-20170817)`**.

**Belege**
- **Font-Ausnahme:** `LICENSE` in ArtifexSoftware/urw-base35-fonts (Commit `9927f3c`, 2017-08-17) – „As a special exception, permission is granted to include these font programs in a Postscript or PDF file that consists of a document that contains text to be displayed or printed using this font, regardless of the conditions or license applying to the document itself.“ SPDX führt den Text als `PS-or-PDF-font-exception-20170817` mit Verweis auf diese Datei. Kopie: `THIRD-PARTY-LICENSES/URW-Base35-AGPL-Font-Exception.txt`.
- **OFL-1.1:** MuPDF upstream enthält `resources/fonts/urw/OFL.txt` (seit Commit `2514431`, 2016): „Copyright 2016 by (URW)++ Design & Development. This Font Software is licensed under the SIL Open Font License, Version 1.1.“ In der Crate `mupdf-sys` fehlt die Datei. URW hat die Version-2.0-Schriften 2017 zusätzlich unter OFL-1.1 (ohne Reserved Font Name) und LPPL-1.3c veröffentlicht. Das Original-Repo `URWTypeFoundry/Core_35` ist gelöscht; belegt über das Archiv `twardoch/urw-core35-fonts`. Kopie: `THIRD-PARTY-LICENSES/URW-Base35-OFL-1.1.txt`.
- **Herkunft der Schriften in MuPDF:** Die `.cff`-Dateien in `mupdf-sys` 0.8.0 tragen Version `1.00` und „Copyright 2014 by (URW)++ Design & Development“, identisch mit `urw-base35-fonts`. MuPDF-Commit `72aaafb` (2018): „Update base 14 fonts to URW++ release from 2017-07-27“; die AFM-Dateien dort tragen „Creation Date: 7/27/2017“. `NimbusSans-Regular.t1` ist im Core-35-Archiv und in `urw-base35-fonts` bitidentisch. MuPDF erzeugt daraus CFF-Teilmengen (`tocff.sh`, `tx -cff … -g subset.mes`); beide Lizenzen erlauben das.

**Nutzung in der App** (`text.rs` `substitute()` → `doc.add_font()`, CID/Identity-H, ohne Subsetting): Nimbus Sans/Roman/Mono PS werden vollständig eingebettet, und zwar beim Bearbeiten von Text, im Notizbuch-Export (`notebook.rs`) und in der OCR-Textebene (`ocr.rs`, `3 Tr` = unsichtbar). Die OFL deckt alle drei Fälle ab („does not apply to any document created using the fonts“). Die AGPL-Ausnahme spricht von Text, der „displayed or printed“ wird; bei unsichtbarem OCR-Text ist das nicht wörtlich erfüllt, deshalb sind beide Lizenzwege angegeben.

**Pflicht:** Copyright und OFL-Text bei jeder Kopie der Schriften, also im Installer (R1, #7).

## Anhang – vollständige Listen

### A. Rust-Crates (ausgeliefert, Ziel `x86_64-pc-windows-msvc`, nur normale Abhängigkeiten)

Quelle: `cargo tree --target x86_64-pc-windows-msvc -e normal` auf `src-tauri/Cargo.lock` – 222 Crates. Proc-Macro-Crates (z. B. `serde_derive`, `*-derive`, `*-macros`) laufen nur beim Kompilieren, sind aber zur Vorsicht mit aufgeführt.

| Crate | Version | Lizenz (SPDX laut Cargo.toml) | Typ |
|---|---|---|---|
| `adler2` | 2.0.1 | 0BSD OR MIT OR Apache-2.0 | Permissiv |
| `aho-corasick` | 1.1.5 | Unlicense OR MIT | Permissiv |
| `alloc-no-stdlib` | 3.0.0 | BSD-3-Clause | Permissiv |
| `alloc-stdlib` | 0.3.0 | BSD-3-Clause | Permissiv |
| `anyhow` | 1.0.104 | MIT OR Apache-2.0 | Permissiv |
| `base64` | 0.22.1 | MIT OR Apache-2.0 | Permissiv |
| `base64` | 0.23.1 | MIT OR Apache-2.0 | Permissiv |
| `bit-set` | 0.8.0 | Apache-2.0 OR MIT | Permissiv |
| `bit-vec` | 0.8.0 | Apache-2.0 OR MIT | Permissiv |
| `bitflags` | 1.3.2 | MIT/Apache-2.0 | Permissiv |
| `bitflags` | 2.13.2 | MIT OR Apache-2.0 | Permissiv |
| `block-buffer` | 0.10.4 | MIT OR Apache-2.0 | Permissiv |
| `brotli` | 9.0.0 | BSD-3-Clause AND MIT | Permissiv |
| `brotli-decompressor` | 6.0.1 | BSD-3-Clause/MIT | Permissiv |
| `byteorder` | 1.5.0 | Unlicense OR MIT | Permissiv |
| `bytes` | 1.12.1 | MIT | Permissiv |
| `camino` | 1.2.6 | MIT OR Apache-2.0 | Permissiv |
| `cargo-platform` | 0.1.9 | MIT OR Apache-2.0 | Permissiv |
| `cargo_metadata` | 0.19.2 | MIT | Permissiv |
| `cfb` | 0.14.0 | MIT | Permissiv |
| `cfg-if` | 1.0.5 | MIT OR Apache-2.0 | Permissiv |
| `cookie` | 0.18.2 | MIT OR Apache-2.0 | Permissiv |
| `cpufeatures` | 0.2.17 | MIT OR Apache-2.0 | Permissiv |
| `crc32fast` | 1.5.2 | MIT OR Apache-2.0 | Permissiv |
| `crossbeam-channel` | 0.5.17 | MIT OR Apache-2.0 | Permissiv |
| `crossbeam-utils` | 0.8.23 | MIT OR Apache-2.0 | Permissiv |
| `crypto-common` | 0.1.7 | MIT OR Apache-2.0 | Permissiv |
| `cssparser` | 0.37.0 | MPL-2.0 | Weak Copyleft |
| `cssparser-macros` | 0.7.1 | MPL-2.0 | Weak Copyleft |
| `ctor` | 1.0.13 | Apache-2.0 OR MIT | Permissiv |
| `darling` | 0.24.1 | MIT | Permissiv |
| `darling_core` | 0.24.1 | MIT | Permissiv |
| `darling_macro` | 0.24.1 | MIT | Permissiv |
| `deranged` | 0.5.9 | MIT OR Apache-2.0 | Permissiv |
| `derive_more` | 2.1.1 | MIT | Permissiv |
| `derive_more-impl` | 2.1.1 | MIT | Permissiv |
| `digest` | 0.10.7 | MIT OR Apache-2.0 | Permissiv |
| `dirs` | 7.0.0 | MIT OR Apache-2.0 | Permissiv |
| `dirs-sys` | 0.5.0 | MIT OR Apache-2.0 | Permissiv |
| `displaydoc` | 0.2.7 | MIT OR Apache-2.0 | Permissiv |
| `dom_query` | 0.28.0 | MIT | Permissiv |
| `dpi` | 0.1.2 | Apache-2.0 AND MIT | Permissiv |
| `dtoa` | 1.0.11 | MIT OR Apache-2.0 | Permissiv |
| `dtoa-short` | 0.3.5 | MPL-2.0 | Weak Copyleft |
| `dunce` | 1.0.5 | CC0-1.0 OR MIT-0 OR Apache-2.0 | Permissiv |
| `dyn-clone` | 1.0.20 | MIT OR Apache-2.0 | Permissiv |
| `equivalent` | 1.0.3 | Apache-2.0 OR MIT | Permissiv |
| `erased-serde` | 0.4.10 | MIT OR Apache-2.0 | Permissiv |
| `fastrand` | 2.5.0 | Apache-2.0 OR MIT | Permissiv |
| `fdeflate` | 0.3.7 | MIT OR Apache-2.0 | Permissiv |
| `flate2` | 1.1.10 | MIT OR Apache-2.0 | Permissiv |
| `fnv` | 1.0.7 | Apache-2.0 / MIT | Permissiv |
| `foldhash` | 0.2.0 | Zlib | Permissiv |
| `form_urlencoded` | 1.2.2 | MIT OR Apache-2.0 | Permissiv |
| `generic-array` | 0.14.7 | MIT | Permissiv |
| `getrandom` | 0.3.4 | MIT OR Apache-2.0 | Permissiv |
| `getrandom` | 0.4.3 | MIT OR Apache-2.0 | Permissiv |
| `glob` | 0.3.4 | MIT OR Apache-2.0 | Permissiv |
| `hashbrown` | 0.12.3 | MIT OR Apache-2.0 | Permissiv |
| `hashbrown` | 0.17.1 | MIT OR Apache-2.0 | Permissiv |
| `heck` | 0.5.0 | MIT OR Apache-2.0 | Permissiv |
| `html5ever` | 0.39.0 | MIT OR Apache-2.0 | Permissiv |
| `http` | 1.5.0 | MIT OR Apache-2.0 | Permissiv |
| `ico` | 0.5.0 | MIT | Permissiv |
| `icu_collections` | 2.3.0 | Unicode-3.0 | Permissiv |
| `icu_locale_core` | 2.3.0 | Unicode-3.0 | Permissiv |
| `icu_normalizer` | 2.3.0 | Unicode-3.0 | Permissiv |
| `icu_normalizer_data` | 2.3.0 | Unicode-3.0 | Permissiv |
| `icu_properties` | 2.3.0 | Unicode-3.0 | Permissiv |
| `icu_properties_data` | 2.3.0 | Unicode-3.0 | Permissiv |
| `icu_provider` | 2.3.1 | Unicode-3.0 | Permissiv |
| `ident_case` | 1.0.1 | MIT/Apache-2.0 | Permissiv |
| `idna` | 1.1.0 | MIT OR Apache-2.0 | Permissiv |
| `idna_adapter` | 1.2.2 | Apache-2.0 OR MIT | Permissiv |
| `indexmap` | 1.9.3 | Apache-2.0 OR MIT | Permissiv |
| `indexmap` | 2.14.2 | Apache-2.0 OR MIT | Permissiv |
| `infer` | 0.22.0 | MIT | Permissiv |
| `itoa` | 1.0.18 | MIT OR Apache-2.0 | Permissiv |
| `json-patch` | 4.2.0 | MIT/Apache-2.0 | Permissiv |
| `jsonptr` | 0.7.1 | MIT OR Apache-2.0 | Permissiv |
| `keyboard-types` | 0.8.3 | MIT OR Apache-2.0 | Permissiv |
| `libc` | 0.2.190 | MIT OR Apache-2.0 | Permissiv |
| `litemap` | 0.8.3 | Unicode-3.0 | Permissiv |
| `lock_api` | 0.4.14 | MIT OR Apache-2.0 | Permissiv |
| `log` | 0.4.34 | MIT OR Apache-2.0 | Permissiv |
| `markup5ever` | 0.39.0 | MIT OR Apache-2.0 | Permissiv |
| `memchr` | 2.8.3 | Unlicense OR MIT | Permissiv |
| `mime` | 0.3.17 | MIT OR Apache-2.0 | Permissiv |
| `miniz_oxide` | 0.8.9 | MIT OR Zlib OR Apache-2.0 | Permissiv |
| `miniz_oxide` | 0.9.1 | MIT OR Zlib OR Apache-2.0 | Permissiv |
| `mio` | 1.2.4 | MIT | Permissiv |
| `muda` | 0.20.0 | Apache-2.0 OR MIT | Permissiv |
| `mupdf` | 0.8.0 | AGPL-3.0 | Strong Copyleft |
| `mupdf-sys` | 0.8.0 | AGPL-3.0 | Strong Copyleft |
| `new_debug_unreachable` | 1.0.6 | MIT | Permissiv |
| `num-conv` | 0.2.2 | MIT OR Apache-2.0 | Permissiv |
| `once_cell` | 1.21.4 | MIT OR Apache-2.0 | Permissiv |
| `option-ext` | 0.2.0 | MPL-2.0 | Weak Copyleft |
| `parking_lot` | 0.12.5 | MIT OR Apache-2.0 | Permissiv |
| `parking_lot_core` | 0.9.12 | MIT OR Apache-2.0 | Permissiv |
| `percent-encoding` | 2.3.2 | MIT OR Apache-2.0 | Permissiv |
| `phf` | 0.13.1 | MIT | Permissiv |
| `phf_generator` | 0.13.1 | MIT | Permissiv |
| `phf_macros` | 0.13.1 | MIT | Permissiv |
| `phf_shared` | 0.13.1 | MIT | Permissiv |
| `pin-project-lite` | 0.2.17 | Apache-2.0 OR MIT | Permissiv |
| `plist` | 1.10.1 | MIT | Permissiv |
| `png` | 0.17.16 | MIT OR Apache-2.0 | Permissiv |
| `png` | 0.18.1 | MIT OR Apache-2.0 | Permissiv |
| `potential_utf` | 0.1.6 | Unicode-3.0 | Permissiv |
| `powerfmt` | 0.2.1 | MIT OR Apache-2.0 | Permissiv |
| `precomputed-hash` | 0.1.1 | MIT | Permissiv |
| `proc-macro2` | 1.0.107 | MIT OR Apache-2.0 | Permissiv |
| `quick-xml` | 0.42.0 | MIT | Permissiv |
| `quote` | 1.0.47 | MIT OR Apache-2.0 | Permissiv |
| `raw-window-handle` | 0.6.2 | MIT OR Apache-2.0 OR Zlib | Permissiv |
| `regex` | 1.13.1 | MIT OR Apache-2.0 | Permissiv |
| `regex-automata` | 0.4.18 | MIT OR Apache-2.0 | Permissiv |
| `regex-syntax` | 0.8.11 | MIT OR Apache-2.0 | Permissiv |
| `rfd` | 0.16.0 | MIT | Permissiv |
| `rustc-hash` | 2.1.3 | Apache-2.0 OR MIT | Permissiv |
| `same-file` | 1.0.6 | Unlicense/MIT | Permissiv |
| `schemars` | 0.8.22 | MIT | Permissiv |
| `schemars_derive` | 0.8.22 | MIT | Permissiv |
| `scopeguard` | 1.2.0 | MIT OR Apache-2.0 | Permissiv |
| `selectors` | 0.38.0 | MPL-2.0 | Weak Copyleft |
| `semver` | 1.0.28 | MIT OR Apache-2.0 | Permissiv |
| `serde` | 1.0.229 | MIT OR Apache-2.0 | Permissiv |
| `serde-untagged` | 0.1.9 | MIT OR Apache-2.0 | Permissiv |
| `serde_core` | 1.0.229 | MIT OR Apache-2.0 | Permissiv |
| `serde_derive` | 1.0.229 | MIT OR Apache-2.0 | Permissiv |
| `serde_derive_internals` | 0.29.1 | MIT OR Apache-2.0 | Permissiv |
| `serde_json` | 1.0.154 | MIT OR Apache-2.0 | Permissiv |
| `serde_repr` | 0.1.21 | MIT OR Apache-2.0 | Permissiv |
| `serde_spanned` | 1.1.2 | MIT OR Apache-2.0 | Permissiv |
| `serde_with` | 3.24.0 | MIT OR Apache-2.0 | Permissiv |
| `serde_with_macros` | 3.24.0 | MIT OR Apache-2.0 | Permissiv |
| `serialize-to-javascript` | 0.1.2 | MIT OR Apache-2.0 | Permissiv |
| `serialize-to-javascript-impl` | 0.1.2 | MIT OR Apache-2.0 | Permissiv |
| `servo_arc` | 0.4.3 | MIT OR Apache-2.0 | Permissiv |
| `sha2` | 0.10.9 | MIT OR Apache-2.0 | Permissiv |
| `simd-adler32` | 0.3.10 | MIT | Permissiv |
| `siphasher` | 1.0.4 | MIT OR Apache-2.0 | Permissiv |
| `smallvec` | 1.16.3 | MIT OR Apache-2.0 | Permissiv |
| `socket2` | 0.6.5 | MIT OR Apache-2.0 | Permissiv |
| `softbuffer` | 0.4.8 | MIT OR Apache-2.0 | Permissiv |
| `stable_deref_trait` | 1.2.1 | MIT OR Apache-2.0 | Permissiv |
| `string_cache` | 0.9.0 | MIT OR Apache-2.0 | Permissiv |
| `strsim` | 0.11.1 | MIT | Permissiv |
| `syn` | 2.0.119 | MIT OR Apache-2.0 | Permissiv |
| `syn` | 3.0.9 | MIT OR Apache-2.0 | Permissiv |
| `synstructure` | 0.14.0 | MIT | Permissiv |
| `tao` | 0.37.1 | Apache-2.0 | Permissiv |
| `tauri` | 2.12.3 | Apache-2.0 OR MIT | Permissiv |
| `tauri-codegen` | 2.7.2 | Apache-2.0 OR MIT | Permissiv |
| `tauri-macros` | 2.7.2 | Apache-2.0 OR MIT | Permissiv |
| `tauri-plugin-dialog` | 2.8.3 | Apache-2.0 OR MIT | Permissiv |
| `tauri-plugin-fs` | 2.7.1 | Apache-2.0 OR MIT | Permissiv |
| `tauri-plugin-single-instance` | 2.5.4 | Apache-2.0 OR MIT | Permissiv |
| `tauri-runtime` | 2.12.1 | Apache-2.0 OR MIT | Permissiv |
| `tauri-runtime-wry` | 2.12.1 | Apache-2.0 OR MIT | Permissiv |
| `tauri-utils` | 2.10.1 | Apache-2.0 OR MIT | Permissiv |
| `tendril` | 0.5.1 | MIT OR Apache-2.0 | Permissiv |
| `thiserror` | 2.0.21 | MIT OR Apache-2.0 | Permissiv |
| `thiserror-impl` | 2.0.21 | MIT OR Apache-2.0 | Permissiv |
| `time` | 0.3.55 | MIT OR Apache-2.0 | Permissiv |
| `time-core` | 0.1.9 | MIT OR Apache-2.0 | Permissiv |
| `time-macros` | 0.2.32 | MIT OR Apache-2.0 | Permissiv |
| `tinystr` | 0.8.4 | Unicode-3.0 | Permissiv |
| `tokio` | 1.53.3 | MIT | Permissiv |
| `toml` | 1.1.8+spec-1.1.0 | MIT OR Apache-2.0 | Permissiv |
| `toml_datetime` | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 | Permissiv |
| `toml_parser` | 1.1.5+spec-1.1.0 | MIT OR Apache-2.0 | Permissiv |
| `toml_writer` | 1.1.3+spec-1.1.0 | MIT OR Apache-2.0 | Permissiv |
| `tracing` | 0.1.44 | MIT | Permissiv |
| `tracing-attributes` | 0.1.31 | MIT | Permissiv |
| `tracing-core` | 0.1.36 | MIT | Permissiv |
| `typeid` | 1.0.3 | MIT OR Apache-2.0 | Permissiv |
| `typenum` | 1.20.1 | MIT OR Apache-2.0 | Permissiv |
| `unicode-ident` | 1.0.27 | (MIT OR Apache-2.0) AND Unicode-3.0 | Permissiv |
| `unicode-segmentation` | 1.13.3 | MIT OR Apache-2.0 | Permissiv |
| `url` | 2.5.8 | MIT OR Apache-2.0 | Permissiv |
| `urlpattern` | 0.6.0 | MIT | Permissiv |
| `utf8_iter` | 1.0.4 | Apache-2.0 OR MIT | Permissiv |
| `uuid` | 1.28.0 | Apache-2.0 OR MIT | Permissiv |
| `walkdir` | 2.5.0 | Unlicense/MIT | Permissiv |
| `web-time` | 1.1.0 | MIT OR Apache-2.0 | Permissiv |
| `web_atoms` | 0.2.6 | MIT OR Apache-2.0 | Permissiv |
| `webview2-com` | 0.39.1 | MIT | Permissiv |
| `webview2-com-macros` | 0.8.1 | MIT | Permissiv |
| `webview2-com-sys` | 0.39.1 | MIT | Permissiv |
| `winapi-util` | 0.1.11 | Unlicense OR MIT | Permissiv |
| `window-vibrancy` | 0.8.1 | Apache-2.0 OR MIT | Permissiv |
| `windows` | 0.62.2 | MIT OR Apache-2.0 | Permissiv |
| `windows-collections` | 0.3.2 | MIT OR Apache-2.0 | Permissiv |
| `windows-core` | 0.62.2 | MIT OR Apache-2.0 | Permissiv |
| `windows-future` | 0.3.2 | MIT OR Apache-2.0 | Permissiv |
| `windows-implement` | 0.60.2 | MIT OR Apache-2.0 | Permissiv |
| `windows-interface` | 0.59.3 | MIT OR Apache-2.0 | Permissiv |
| `windows-link` | 0.2.1 | MIT OR Apache-2.0 | Permissiv |
| `windows-numerics` | 0.3.1 | MIT OR Apache-2.0 | Permissiv |
| `windows-result` | 0.4.1 | MIT OR Apache-2.0 | Permissiv |
| `windows-strings` | 0.5.1 | MIT OR Apache-2.0 | Permissiv |
| `windows-sys` | 0.60.2 | MIT OR Apache-2.0 | Permissiv |
| `windows-sys` | 0.61.2 | MIT OR Apache-2.0 | Permissiv |
| `windows-targets` | 0.53.5 | MIT OR Apache-2.0 | Permissiv |
| `windows-threading` | 0.2.1 | MIT OR Apache-2.0 | Permissiv |
| `windows-version` | 0.1.7 | MIT OR Apache-2.0 | Permissiv |
| `windows_x86_64_msvc` | 0.53.1 | MIT OR Apache-2.0 | Permissiv |
| `winnow` | 1.0.4 | MIT | Permissiv |
| `writeable` | 0.6.4 | Unicode-3.0 | Permissiv |
| `wry` | 0.57.0 | Apache-2.0 OR MIT | Permissiv |
| `yoke` | 0.8.3 | Unicode-3.0 | Permissiv |
| `yoke-derive` | 0.8.4 | Unicode-3.0 | Permissiv |
| `zerocopy` | 0.8.63 | BSD-2-Clause OR Apache-2.0 OR MIT | Permissiv |
| `zerocopy-derive` | 0.8.63 | BSD-2-Clause OR Apache-2.0 OR MIT | Permissiv |
| `zerofrom` | 0.1.8 | Unicode-3.0 | Permissiv |
| `zerofrom-derive` | 0.1.8 | Unicode-3.0 | Permissiv |
| `zerotrie` | 0.2.5 | Unicode-3.0 | Permissiv |
| `zerovec` | 0.11.8 | Unicode-3.0 | Permissiv |
| `zerovec-derive` | 0.11.6 | Unicode-3.0 | Permissiv |
| `zmij` | 1.0.23 | MIT | Permissiv |

### B. Rust-Build-Abhängigkeiten (nur Build, nicht in der Binary) – 23 Crates

| Crate | Version | Lizenz |
|---|---|---|
| `autocfg` | 1.5.1 | Apache-2.0 OR MIT |
| `bindgen` | 0.72.1 | BSD-3-Clause |
| `cargo_toml` | 1.0.1 | Apache-2.0 OR MIT |
| `cc` | 1.8.0 | MIT OR Apache-2.0 |
| `cexpr` | 0.6.0 | Apache-2.0/MIT |
| `clang-sys` | 1.9.1 | Apache-2.0 |
| `either` | 1.19.0 | MIT OR Apache-2.0 |
| `embed-resource` | 3.0.12 | MIT |
| `find-msvc-tools` | 0.1.14 | MIT OR Apache-2.0 |
| `itertools` | 0.13.0 | MIT OR Apache-2.0 |
| `libloading` | 0.8.9 | ISC |
| `minimal-lexical` | 0.2.1 | MIT/Apache-2.0 |
| `nom` | 7.1.3 | MIT |
| `phf_codegen` | 0.13.1 | MIT |
| `pkg-config` | 0.3.34 | MIT OR Apache-2.0 |
| `rustc_version` | 0.4.1 | MIT OR Apache-2.0 |
| `shlex` | 1.3.0 | MIT OR Apache-2.0 |
| `shlex` | 2.0.1 | MIT OR Apache-2.0 |
| `string_cache_codegen` | 0.6.1 | MIT OR Apache-2.0 |
| `tauri-build` | 2.7.2 | Apache-2.0 OR MIT |
| `tauri-plugin` | 2.7.1 | Apache-2.0 OR MIT |
| `tauri-winres` | 0.3.6 | MIT |
| `version_check` | 0.9.5 | MIT/Apache-2.0 |

### C. npm-Pakete mit `dev: false` im Lockfile

| Paket | Version | Lizenz | im `dist`-Bundle? |
|---|---|---|---|
| `@fontsource-variable/manrope` | 5.3.0 | OFL-1.1 | ja |
| `@fontsource/ibm-plex-mono` | 5.3.0 | OFL-1.1 | ja |
| `@tauri-apps/api` | 2.12.3 | Apache-2.0 OR MIT | ja |
| `@tauri-apps/plugin-dialog` | 2.8.2 | MIT OR Apache-2.0 | ja |
| `@types/react` | 19.3.0 | MIT | nein (nur Typen) |
| `@xmldom/xmldom` | 0.9.10 | MIT | nein |
| `commander` | 13.1.0 | MIT | nein |
| `csstype` | 3.2.3 | MIT | nein (nur Typen) |
| `esm` | 3.2.25 | MIT | nein |
| `lucide-react` | 1.59.0 | ISC | ja |
| `mathjax-full` | 3.2.2 | Apache-2.0 | ja |
| `mhchemparser` | 4.2.1 | Apache-2.0 | nein |
| `mj-context-menu` | 0.6.1 | Apache-2.0 | nein |
| `perfect-freehand` | 1.2.3 | MIT | ja |
| `react-dom` | 19.3.0 | MIT | ja |
| `react` | 19.3.0 | MIT | ja |
| `scheduler` | 0.28.0 | MIT | ja |
| `speech-rule-engine` | 4.1.4 | Apache-2.0 | nein |
| `wicked-good-xpath` | 1.3.0 | MIT | nein |
| `zod` | 4.6.7 | MIT | ja |

### D. npm-Entwicklungsabhängigkeiten (nicht ausgeliefert) – 276 Einträge

| Lizenz | Anzahl |
|---|---|
| MIT | 192 |
| MPL-2.0 | 24 |
| Apache-2.0 | 17 |
| Apache-2.0 OR MIT | 12 |
| ISC | 12 |
| BSD-2-Clause | 8 |
| BlueOak-1.0.0 | 4 |
| BSD-3-Clause | 3 |
| MIT-0 | 2 |
| CC-BY-4.0 | 1 |
| CC0-1.0 | 1 |
