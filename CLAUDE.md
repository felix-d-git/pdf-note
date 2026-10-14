# PDF Note – Repo-Regeln

Plan + TODO: `C:\Users\lelif\Dokumente\AI\MEMORY\Wiki\Privates\Projekte\PDF-Note\` (Index `PDF-Note.md`, Aufgaben `TODO-Umsetzung.md`). Erledigtes dort abhaken, Entscheidungen in die passende Vault-Notiz.

## Git-Ablauf (Pflicht)
- Gearbeitet wird nur auf Branch `second`. Vor Start: `git switch second && git pull`.
- Nach jeder fertigen Aufgabe: Checks grün → `git add -A && git commit` → `git push origin second`.
- Merge nach `master` nur in der Abschluss-Aufgabe: `git switch master && git merge --no-ff second && git push origin master`, danach zurück auf `second`.
- Nie `git checkout --` / `git restore` / `git stash` bei uncommitteten Änderungen; nie Force-Push.

## Lizenz
- Projekt: AGPL-3.0 (`LICENSE`). Jede neue Abhängigkeit/Schrift/Asset mit Lizenz in `THIRD-PARTY-NOTICES.md` eintragen; nur AGPL-kompatible Lizenzen.
- Neue Quelldateien ohne Lizenzkopf (LICENSE im Root genügt).

## Grenzen
- Testdaten: `testdata/pdfs/` (gitignored, nie committen, Originale nie überschreiben – Kopien in Temp bearbeiten).
- GUI-/Stift-Tests nicht selbst klicken: als ⬜-Punkt mit Prüfschritten in die Vault-TODO.
- Kein Netzwerkzugriff in der App (kein `http`-Capability, CSP `default-src 'self'`).
