# Grundsätze

Maßstab für jeden Beitrag – Mensch oder KI-Werkzeug. Was dagegen verstößt, kommt nicht rein, auch wenn es technisch gut gemacht ist. Die **Prüffragen** lassen sich an einem Diff beantworten.

Technische Absicherung: Tauri-Capabilities + CSP (`src-tauri/`), Pfad-Verbotsliste (`.claude/settings.json`).

## 1. Privat

Die PDF verlässt den Rechner nicht. Die App öffnet keine Netzwerkverbindung – kein Update-Check, keine Telemetrie, kein Fehlerdienst, keine Schrift oder Icons vom CDN. Tauri bekommt kein `http`-Recht, die CSP erlaubt nur `'self'` (plus Tauri-internes `ipc:`, kein Netzwerk).

Geschrieben wird nur die PDF, die der Nutzer speichert, und die App-Einstellungen in `%APPDATA%`. Keine Sidecar-, Index-, Cache- oder Sperrdateien neben der PDF.

→ **Spricht das eine Adresse an, die mir nicht gehört? Legt das eine Datei an, die nicht die PDF ist?**

## 2. Sicher – die PDF ist fremde Eingabe

Jede geöffnete PDF kann manipuliert sein. MuPDF läuft ohne JavaScript-Unterstützung (`default-features = false`), PDF-Aktionen (Links, Launch, Formular-Submit) werden nie ausgeführt. Daten aus der PDF und aus dem Frontend werden an der Grenze geprüft (Zod im Frontend, Typen in Rust). Speichern darf die Original-PDF nie halb zerstört zurücklassen (temp-Datei + Umbenennen).

→ **Hält das, wenn die PDF absichtlich kaputt ist? Bleibt das Original heil, wenn mittendrin der Strom ausfällt?**

## 3. Kostenlos

Keine Abos, keine Freikontingente, keine kostenpflichtigen Dienste. Code-Signing kostet → Installer bleibt unsigniert (Eigengebrauch).

→ **Kostet das jetzt oder später Geld?**

## 4. Rechtlich sauber

Kein übernommener Fremdcode; eine Spezifikation umzusetzen ist erlaubt, eine Bibliothek nachzubilden nicht. Repo: AGPL-3.0. Neue Abhängigkeiten nur bei echtem Komplexitätsgewinn, bevorzugt MIT/Apache-2.0; AGPL-kompatibel ist Pflicht (MuPDF selbst ist AGPL). Jede Abhängigkeit, Schrift und jedes Asset steht mit Lizenz in `THIRD-PARTY-NOTICES.md`.

→ **Woher stammt dieser Code, und was hängt lizenzrechtlich daran?**

## 5. Eigenes Design

Tokens aus App-Design1 (`src/index.css`): Akzent `#0FB5A6`, Radien, 160 ms, Manrope + IBM Plex Mono lokal gebündelt, Dark als Default. Keine eigenen Paletten, kein Standard-KI-Aussehen.

→ **Erkennt man an drei Screenshots, dass das dieselbe App ist?**

## 6. Sparsam

Nur sichtbare Seiten rendern, Bitmaps sofort freigeben, im Leerlauf ≈ 0 % CPU, kein Hintergrund-Indexer. Ziel: RAM < 200 MB bei einer 100-Seiten-PDF.

→ **Läuft das auch, wenn niemand hinsieht? Wächst der Speicher mit der Seitenzahl?**

## 7. Es muss laufen

Fertig heißt übersetzt **und** gegen echte PDFs getestet: `npm run check`, `cargo test` **und** `npm run test:data`. Nur das erste sagt fast nichts darüber, ob eine PDF nach dem Speichern noch stimmt.

→ **Ist die Prüfung gegen die echten Test-PDFs gelaufen?**

## 8. Nachvollziehbar echt

Ein Beitrag wird angenommen, wenn das Problem am bestehenden Code zeigbar ist und eine neue Prüfung **ohne** den Fix fehlschlägt. Eine Beschreibung ist kein Nachweis. Besondere Vorsicht bei Diffs an Konfiguration, Rechten (Capabilities, CSP), Abhängigkeiten oder Build-Schritten: Netzwerkaufrufe, `eval`, Prozessstarts, neue Einträge in `package.json`/`Cargo.toml` oder den Lockfiles durchsehen.

→ **Schlägt eine Prüfung ohne diese Änderung fehl?**
