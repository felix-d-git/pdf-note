# PDF Note

Lokaler PDF-Editor für Windows (Tauri), 100 % offline. Jede PDF bearbeiten, mit Notizseiten erweitern, als Notizbuch nutzen – alles bleibt in der PDF, keine Zusatzdateien.

## Lizenz

Copyright (C) 2026 felix-d-git

GNU Affero General Public License v3.0 (nur diese Version, `AGPL-3.0-only`) – siehe [LICENSE](LICENSE). Ohne jede Gewährleistung.
Zusätzliche Erlaubnis nach §7 für das Linken mit Microsofts WebView2 Loader: [LICENSE-ADDITIONAL-PERMISSION.md](LICENSE-ADDITIONAL-PERMISSION.md).
Lizenzen von Abhängigkeiten (u. a. MuPDF, AGPL-3.0; Schriften Manrope/IBM Plex Mono, SIL OFL 1.1; URW-Schriften, SIL OFL 1.1 oder AGPL-3.0 mit Font-Ausnahme) werden in `THIRD-PARTY-NOTICES.md` geführt, die Lizenztexte liegen in `THIRD-PARTY-LICENSES/`.

Der Installer enthält im Ordner `licenses` die Lizenztexte aller ausgelieferten Komponenten; `npm run tauri build` erzeugt sie bei jedem Build neu (`scripts/licenses.mjs`, braucht einmalig `cargo install cargo-about --locked --features cli`). Quellcode-Angebot nach AGPL-3.0 §6: [SOURCE.md](SOURCE.md) – jedes Release verlinkt seinen Quellstand und trägt die MuPDF-C-Quellen (`mupdf-sys`) als Asset.
