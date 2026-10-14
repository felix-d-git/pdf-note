# PDF Note – Repo-Regeln

Plan + TODO: `C:\Users\lelif\Dokumente\AI\MEMORY\Wiki\Privates\Projekte\PDF-Note\` (Index `PDF-Note.md`, Aufgaben `TODO-Umsetzung.md`). Erledigtes dort abhaken, Entscheidungen in die passende Vault-Notiz. Maßstab für Änderungen: `GRUNDSAETZE.md`.

## Git-Ablauf (Pflicht)
- Gearbeitet wird nur auf Branch `second`. Vor Start: `git switch second && git pull`.
- Nach jeder fertigen Aufgabe: Checks grün → `git add -A && git commit` → `git push origin second`.
- Merge nach `master` nur in der Abschluss-Aufgabe: `git switch master && git merge --no-ff second && git push origin master`, danach zurück auf `second`.
- Nie `git checkout --` / `git restore` / `git stash` bei uncommitteten Änderungen; nie Force-Push.

## Build & Checks
- Struktur: Frontend (Vite + React + TS strict + Tailwind 4) im Root, Tauri/Rust in `src-tauri/`, gepatchte `mupdf`-Crate in `vendor/mupdf/`.
- `npm install` → `npm run tauri dev` (Vite auf `localhost:1420`, nur Dev) / `npm run tauri build` (NSIS-Installer).
- Checks (alle drei vor jedem Commit grün):
  - `npm run check` – tsc + eslint + vitest
  - `cargo test --manifest-path src-tauri/Cargo.toml`
  - `npm run test:data` – Speichern → Neu-Öffnen gegen `testdata/pdfs/` (gitignored, fehlt in CI → dort nicht lauffähig)
- `cargo` ist in Git Bash/PowerShell nicht im PATH → `$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"` bzw. `export PATH="$HOME/.cargo/bin:$PATH"`.

## Laufzeitfallen
- `.cargo/config.toml` setzt `LIBCLANG_PATH` (LLVM per winget) und `target-dir` nach `%LOCALAPPDATA%\Temp\pdf-note-target` – Build-Artefakte nie in den Nextcloud-Pfad. CI: `CARGO_TARGET_DIR` überschreibt.
- Erstbuild kompiliert die MuPDF-C-Bibliothek (~6 min); Befehle nicht mit kurzem Timeout starten.
- `mupdf` 0.8.0 baut unter MSVC nur gepatcht (`vendor/mupdf/PATCH.md`); Patch entfernen, sobald upstream behoben.
- `[profile.dev.package.mupdf-sys] opt-level = 3` nicht entfernen: sonst baut mupdf-sys die MSVC-Debug-CRT (`vcruntimed`) → LNK2005 `__CxxFrameHandler3` bei `cargo test`/`tauri dev`.
- `mupdf` ohne Default-Features: kein PDF-JavaScript, nur PDF/Bilder. Features nicht ohne Grund aktivieren (GRUNDSAETZE 2).
- CSP in `tauri.conf.json`: `default-src 'self' ipc: http://ipc.localhost` – `ipc.localhost` ist Tauris interner Kanal, kein Netzwerk. Keine externen URLs, Schriften/Icons nur aus `node_modules` bündeln.
- Capabilities (`src-tauri/capabilities/default.json`): nur `core:default`. Neue Rechte (Dialog, FS) einzeln und eng; nie `http`/`shell`.
- TypeScript 6: CSS-Imports brauchen `"types": ["vite/client"]` in `tsconfig.json`.
- Bash-Heredocs halbieren Backslashes → Windows-Pfade in TOML als Literal-String `'C:\…'`.

## Lizenz
- Projekt: AGPL-3.0 (`LICENSE`). Jede neue Abhängigkeit/Schrift/Asset mit Lizenz in `THIRD-PARTY-NOTICES.md` eintragen; nur AGPL-kompatible Lizenzen.
- Neue Quelldateien ohne Lizenzkopf (LICENSE im Root genügt).

## Grenzen
- Testdaten: `testdata/pdfs/` (gitignored, nie committen, Originale nie überschreiben – Kopien in Temp bearbeiten).
- GUI-/Stift-Tests nicht selbst klicken: als ⬜-Punkt mit Prüfschritten in die Vault-TODO.
- Kein Netzwerkzugriff in der App (kein `http`-Capability, CSP `default-src 'self'`).
- `.claude/settings.json` (Pfad-Verbotsliste) ist selbst schreibgeschützt; Änderungen nur durch den User.

## graphify
- Code-Struktur nicht im Vault, sondern per `graphify query "<Begriff>"` (sucht über Datei-/Funktionsnamen, nicht über Strings).
- `graphify.exe` liegt unter `C:\Users\lelif\AppData\Local\Python\pythoncore-3.14-64\Scripts\` (nicht im PATH).
- Nach Code-Änderungen: `graphify update .` (AST, ohne LLM). Kein Git-Hook (schreibt Log nach `~\.cache`).
- Nie `graphify install`/`graphify claude install`: schreibt nach `~\.claude` statt `CLAUDE_CONFIG_DIR`.
