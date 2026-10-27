# Lizenztexte von Drittkomponenten

Unveränderte Kopien der Originale. Übersicht und Bewertung: `THIRD-PARTY-NOTICES.md`, `docs/LIZENZ-AUDIT.md`.
Die vollständige Sammlung für den Installer entsteht mit #7 (R1).

| Datei | Gilt für | Herkunft (Original) | SHA-256 |
|---|---|---|---|
| `Microsoft-WebView2-SDK.txt` | `WebView2LoaderStatic.lib`, statisch in `pdf-note.exe` (über `webview2-com-sys` 0.39.1) | `LICENSE.txt` im NuGet-Paket `Microsoft.Web.WebView2` 1.0.3800.47 (`api.nuget.org`). Die `.lib`-Dateien in `webview2-com-sys` 0.39.1 sind bitidentisch mit diesem Paket (x64, x86, arm64). | `0af8f1b8…6eca55` |
| `URW-Base35-OFL-1.1.txt` | URW-Base-14-Schriften in MuPDF (`resources/fonts/urw/*.cff`) | `resources/fonts/urw/OFL.txt` in ArtifexSoftware/mupdf (seit Commit `2514431`, 2016). Fehlt in der Crate `mupdf-sys`. | `3b709798…0253ca` |
| `URW-Base35-AGPL-Font-Exception.txt` | dieselben Schriften (alternative Lizenz) | `LICENSE` in ArtifexSoftware/urw-base35-fonts (Commit `9927f3c`, 2017-08-17); SPDX: `PS-or-PDF-font-exception-20170817`. Den AGPL-Text selbst enthält `LICENSE` im Wurzelverzeichnis. | `772b1b47…2a2e3f` |
