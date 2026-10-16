# Die erste Stunde

Am Ende dieser Stunde steht eine Karte in Done: aus einer Idee gemacht, von dir freigegeben, vom Runner allein umgesetzt, von einem zweiten Claude-Modell in frischer Sitzung geprüft und von dir durchgesehen. Die Stunde zählt ab einem Rechner mit macOS, Linux oder bereitstehendem WSL2. Unter Windows richtest du zuerst WSL2 nach [Windows über WSL2](/wsl2) ein; das dauert samt Neustart etwa 30 Minuten.

## Voraussetzungen

- macOS, Linux oder Windows mit WSL2
- git, Node.js ab Version 18 und curl
- Claude Code
- ein Claude-Zugang, mit dem du dich anmeldest
- deine git-Identität

Das lokale Board braucht kein weiteres Konto.

## Die Schritte

### 1. Werkzeuge prüfen

Dauer: etwa 5 Minuten.

```bash
git --version
node --version
claude --version
```

Gelungen, wenn jeder Befehl eine Versionsnummer ausgibt, `node` mindestens `v18`.

Sonst: Fehlt Node.js oder ist es älter, installiere es über [nvm](https://github.com/nvm-sh/nvm) mit `nvm install --lts`. Fehlt Claude Code, installiere es mit `npm install -g @anthropic-ai/claude-code`. git kommt aus dem Paketmanager deines Systems.

### 2. Bei Claude anmelden

Dauer: etwa 3 Minuten.

Rufe `claude` auf, melde dich an und beende die Sitzung wieder. Dann:

```bash
claude -p "Antworte nur mit OK"
```

Gelungen, wenn die Ausgabe `OK` ist; so startet auch der Runner seine Sitzungen.

Sonst: Rufe `claude` noch einmal auf und schließe die Anmeldung ab.

### 3. git-Identität setzen

Dauer: etwa 1 Minute.

```bash
git config --global user.name "Dein Name"
git config --global user.email "du@example.org"
```

Gelungen, wenn `git config user.email` deine Adresse ausgibt.

Sonst: Gibt der Befehl nichts aus, wiederhole die zweite Zeile.

### 4. Projekt anlegen

Dauer: etwa 1 Minute.

```bash
mkdir ~/erste-stunde && cd ~/erste-stunde && git init -b main
```

Gelungen, wenn `git status` den Zweig `main` nennt.

Sonst: Kennt git die Option `-b` nicht, ist es älter als 2.28. Aktualisiere git und rufe im Ordner `git init -b main` auf.

### 5. Kit installieren

Dauer: etwa 3 Minuten.

```bash
curl -O https://docs.mwolff.org/install.mjs
node install.mjs
```

Der Installer fragt nacheinander; für die erste Stunde antwortest du so:

| Frage | Antwort |
|---|---|
| Sprache | `de` |
| Skills global oder nur für dieses Projekt | `projekt` |
| Code-Host | `local` |
| Issue-Tracker | `local` |
| alle übrigen, auch das Commit-Gate | Enter |

Was jede Frage bedeutet, steht unter [Installation](/einrichtung#installation). Am Ende meldet der Installer `ACHTUNG: Es liegen uncommittete Dateien im Workspace`; das räumt Schritt 8 auf.

Gelungen, wenn `ls .claude/kit` unter anderem `board.mjs` zeigt.

Sonst: Prüfe die Netzverbindung und wiederhole den Schritt.

### 6. Das Board prüfen

Dauer: etwa 1 Minute.

Mit der Antwort `local` beim Issue-Tracker entsteht das lokale Board mit fünf Spalten von Backlog bis Done; Spalten und Labels legst du nicht an. Jede Karte ist eine Datei unter `issues/`.

```bash
node .claude/kit/board.mjs issue list
```

Gelungen, wenn die Ausgabe `[]` ist, ein leeres Board.

Sonst: Steht in `.claude/workflow.config.json` nicht `"issueTracker": "local"`, wiederhole Schritt 5 und antworte beim Issue-Tracker `local`.

### 7. Prüfkommando eintragen

Dauer: etwa 2 Minuten.

Der Runner setzt eine Karte nur um, wenn er danach prüfen kann. Ersetze in `.claude/workflow.config.json` die Zeile `"buildChecks": [],` durch:

```json
"buildChecks": ["node --test"],
```

Dann:

```bash
node .claude/kit/checks.mjs run --stage push
```

Gelungen, wenn die Ausgabe die Zeile `gelaufen: node --test → gruen` enthält.

Sonst: Meldet das Kommando einen Fehler in der Config, vergleiche die Zeile Zeichen für Zeichen mit der oben. Ohne diesen Eintrag hielte der Runner in Schritt 12 mit `Fehler: buildChecks in workflow.config.json traegt keine Pruefung` an.

### 8. Workspace sauber machen

Dauer: etwa 1 Minute.

```bash
git add -A
git commit -m "Kit eingerichtet"
git status --short
```

Gelungen, wenn `git status --short` nichts ausgibt.

Sonst: Weist git den Commit ab, weil Name oder E-Mail fehlen, wiederhole Schritt 3 und dann diesen Schritt.

### 9. Idee anlegen

Dauer: etwa 1 Minute.

```bash
node .claude/kit/board.mjs issue create --art idea --author-model mensch --title "Begrüßung als Funktion" --body 'Eine Datei gruss.mjs mit export function begruesse(name), die Hallo, <name>! zurückgibt, dazu ein Test mit node:test unter test/.'
```

Gelungen, wenn die Ausgabe eine `id` nennt, eine vierstellige Nummer; sie steht in den folgenden Befehlen für `<id>`.

Sonst: Meldet der Befehl `Kein Autor-Modell angegeben`, fehlt `--author-model mensch`, die Angabe, dass ein Mensch die Idee schrieb.

### 10. Idee durchsprechen

Dauer: etwa 10 Minuten.

Starte im Projekt `claude` und rufe in der Sitzung auf:

```
/triage <id>
```

`/triage` klärt offene Punkte mit dir und schlägt Bahn 3 vor, ein einzelnes Arbeitspaket. Bestätige; `/task` legt das Paket nach deiner Bestätigung an. Beende die Sitzung.

Gelungen, wenn `node .claude/kit/board.mjs issue list` eine Karte mit `[Task]` im Titel und `"status": "backlog"` zeigt. Ab hier steht `<id>` für ihre Nummer.

Sonst: Schlägt `/triage` eine andere Bahn vor, antworte, dass nichts abzuwägen ist, und wähle Bahn 3. Fehlt die Karte danach, rufe `/task <id>` mit der Nummer der Idee auf.

### 11. Karte freigeben

Dauer: etwa 1 Minute.

```bash
node .claude/kit/board.mjs issue move <id> ready
node .claude/kit/board.mjs issue label add <id> kit:nightrun
```

Das Ziehen nach Ready ist dein GO; das Label sagt dem Runner, dass er die Karte nehmen darf.

Gelungen, wenn `issue list` die Karte mit `"status": "ready"` und dem Label `kit:nightrun` zeigt.

Sonst: Gibt es die Karte nicht, hast du die Nummer der Idee genommen; nimm die der `[Task]`-Karte.

### 12. Runner starten

Dauer: etwa 15 Minuten, das meiste davon Warten.

```bash
git status --short
node .claude/kit/night.mjs --dry-run
node .claude/kit/night.mjs
```

`git status --short` ist leer oder zeigt nur `issues/`; Karten zählen für den Runner nicht als Änderung. Meldet der Trockenlauf `-> Session 1`, starte den Runner: Er setzt die Karte in einer frischen Sitzung um, prüft mit `node --test` und committet lokal.

Gelungen, wenn `issue list` die Karte mit `"status": "in_review"` zeigt und `git log --oneline` oben einen neuen Commit trägt.

Sonst:
- `Working Tree ist nicht sauber`: committe wie in Schritt 8 und starte erneut.
- `buildChecks in workflow.config.json traegt keine Pruefung`: zurück zu Schritt 7.
- `uebersprungen (kein Label 'kit:nightrun')`: zweiter Befehl aus Schritt 11.

### 13. Ergebnis prüfen lassen

Dauer: etwa 5 Minuten.

Starte eine frische Sitzung mit `claude` und schreibe in eine Nachricht:

```
/kit-review Karte <id>
```

Ein zweites Claude-Modell liest die Änderung ohne Kenntnis der Umsetzung und schreibt seinen Befund an die Karte. Im Team tritt an diese Stelle ein Prüfer aus einer anderen Modellfamilie.

Gelungen, wenn `node .claude/kit/board.mjs issue get <id>` einen Kommentar mit `## Code-Review (Schritt 6)` zeigt.

Sonst: Steht der Befund nur im Chat, nenne in derselben Sitzung noch einmal die Kartennummer.

### 14. Durchsehen und nach Done ziehen

Dauer: etwa 5 Minuten.

```bash
git show --stat HEAD
node --test
node .claude/kit/board.mjs issue move <id> done
```

Lies den Befund und sieh dir den Commit an. Das Ziehen nach Done ist deine Abnahme.

Gelungen, wenn `git show --stat HEAD` `gruss.mjs` und eine Datei unter `test/` nennt, `node --test` mit `fail 0` endet und `issue list` die Karte mit `"status": "done"` zeigt.

Sonst: Ziehe nicht nach Done. Schreibe den Mangel mit `issue comment <id> --text "…"` an die Karte, ziehe sie nach `ready` und starte Schritt 12 erneut.

## Wie es weitergeht

- Auf GitHub oder GitLab umsteigen: [Issue-Tracker und Code-Host](/einrichtung#issue-tracker-und-code-host).
- Veröffentlichen mit `push main` und `merge production`: [Push](/prozess#push-main) und [Merge](/prozess#merge-production).
- Prüfer aus einer anderen Modellfamilie, Team-Einstellungen: [Team-Config](/einrichtung#team-config-und-personliche-abweichungen), [Einstellungen](/einstellungen).
- Jeden Commit an einen grünen Prüflauf binden: [Das Commit-Gate](/einrichtung#das-commit-gate).
- Das Kit im eigenen Projekt: [Installation](/einrichtung#installation), ohne Remote [Lokal arbeiten](/lokal).
- Vorhaben mit Abwägung auf Bahn 2: [Drei Bahnen](./dokumentation.md#drei-bahnen).
- Der Runner mit Kette, mehreren Karten und ohne Aufsicht: [Die Kette](/runner#die-kette).
- Der Runner unter Windows: [Windows über WSL2](/wsl2#der-runner-unter-windows).
- Alle siebzehn Skills: [Die Skills](/prozess#die-skills).
