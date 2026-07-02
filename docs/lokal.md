# Lokal arbeiten — ohne Remote-Repo, ohne Board

**git selbst ist immer Pflicht.** Das Kit setzt voraus, dass du dich in einem lokalen git-Repository befindest (`git init` reicht). Was optional ist: ein Remote-Repo (z.B. auf GitHub oder GitLab) und ein Board. Beides brauchst du im lokalen Modus nicht.

Du brauchst also: git (lokal), Node.js — und nichts weiter.

## Wann dieser Modus passt

- Privates Projekt ohne Remote-Repo
- Frühphase, noch kein Board eingerichtet
- Du willst das Kit ausprobieren, bevor du eine Plattform wählst
- Einzelperson, kein Team, kein PR-Prozess

## Installation

Installer starten, bei den Plattform-Fragen `local` wählen:

```
Global oder projektlokal? [global/projekt]: projekt
Code-Host (github/gitlab/local): local
Issue-Tracker (github/gitlab/local) [local]: local
Name des main-Branch [main]: main
Name des production-Branch [production]: production
Review-Umfang (diff/full) [diff]: diff
Review-Modell [claude-opus-4-8]:
```

Das Ergebnis in `.claude/workflow.config.json`:

```json
{
  "codeHost": "local",
  "issueTracker": "local",
  "mainBranch": "main",
  "productionBranch": "production",
  "reviewScope": "diff",
  "reviewModel": "claude-opus-4-8",
  "local": { "issuesDir": "issues" },
  "columns": {
    "backlog":     "Backlog",
    "ready":       "Ready",
    "in_progress": "In Progress",
    "in_review":   "In Review",
    "done":        "Done"
  }
}
```

Das `columns`-Feld steuert die Spaltennamen im Board. Die Schlüssel (`backlog`, `ready`, `in_progress`, `in_review`, `done`) sind fix — sie stehen im Frontmatter der Issue-Dateien. Die Werte sind die angezeigten Bezeichnungen und können frei geändert werden:

```json
"columns": {
  "backlog":     "Ideen",
  "ready":       "Los geht's",
  "in_progress": "In Arbeit",
  "in_review":   "Prüfen",
  "done":        "Fertig"
}
```

Bei GitHub entsprechen die Werte den Spaltennamen im Project Board. Bei GitLab sind es die Label-Namen die der Installer anlegt.

## Wie Issues gespeichert werden

Jedes Issue liegt als Datei in `issues/`:

```
issues/
  0001.md
  0002.md
  0003.md
```

Format einer Issue-Datei:

```markdown
---
id: "0001"
status: backlog
title: Login-Formular bauen
created: 2026-07-01
---

## Kontext
Nutzer können sich noch nicht anmelden.

## Aufgabe
E-Mail- und Passwort-Feld, Submit-Button, Validierung.

## Akzeptanzkriterium
- Formular rendert fehlerfrei
- Validierung zeigt Fehlermeldung bei leerem Feld
- Submit löst keinen JS-Fehler aus

## Abhängigkeiten
Keine.
```

Der Status (`backlog | ready | in_progress | in_review | done`) wird vom Board-Adapter direkt in der Datei gesetzt — kein API, kein Label, kein Board.

## Der Prozess im lokalen Modus

Die neun Schritte laufen genauso wie mit GitHub oder GitLab. Der einzige Unterschied: Statt Board-Karten zu bewegen, schreibt der Adapter den Status ins Frontmatter.

**GO (Schritt 3):** Du öffnest die Issue-Datei und änderst `status: backlog` auf `status: ready` — oder du nutzt den Adapter direkt:

```bash
node .claude/kit/board.mjs issue move 0001 ready
```

**Push (Schritt 7):** `/push-main` pusht auf `origin/main`. Wenn du kein Remote hast, schlägt das fehl. Stattdessen: du arbeitest nur auf `main` lokal und nutzt den Schritt als Checkpoint — oder du überspringst ihn bewusst.

**Merge (Schritt 9):** `/merge-production` erkennt `codeHost: local` und gibt stattdessen den manuellen Merge-Befehl aus:

```
Lokaler Modus: kein Pull Request.
Führe einen lokalen Merge durch:
  git checkout production
  git merge main
  git push
```

## Board starten

Die lokale Kanban-GUI zeigt alle Issues des Projekts als Board:

```bash
node .claude/kit/board-ui.mjs
```

Öffnet `http://localhost:3000`. Fünf Spalten: Backlog, Ready, In Progress, In Review, Done. Drag einer Karte nach Ready erzeugt automatisch einen GO-Commit — committet wird ausschließlich die Issue-Datei, bereits gestagte andere Änderungen bleiben unangetastet. Klick auf eine Karte öffnet eine Detailansicht mit dem vollen Issue-Text und einem Kommentarformular.

Port anpassen:

```bash
node .claude/kit/board-ui.mjs --port 4000
```

Was das Board nicht tut: kein Push, kein PR, kein Merge — die drei Stop-Punkte bleiben beim Menschen.

### Listenansicht

Der Button **Liste** oben rechts schaltet in eine volle-Breite-Listenansicht. Jeder Eintrag zeigt ID, Status, Titel und einen kurzen Textauszug. Klick öffnet die Detailansicht.

Filter-Buttons oben grenzen die Anzeige auf einzelne Statuses ein. **Archiv** ist standardmäßig ausgeblendet und muss explizit aktiviert werden.

Issues lassen sich in der Listenansicht per Drag am `⠿`-Handle umsortieren — ausgenommen Done und archivierte Issues. Die neue Reihenfolge wird als `priority`-Feld im Frontmatter gespeichert und gilt sofort auch für die Kartenreihenfolge im Board.

Die rechte Kontext-Spalte (Textauszug aus dem Issue-Body, bis zu 240 Zeichen) nimmt standardmäßig 50 % der Breite ein. Die Grenze zwischen Titel und Kontext lässt sich wie in Excel per Maus ziehen (zwischen 25 % und 75 %); die gewählte Breite merkt sich der Browser über Reloads und Filterwechsel hinweg.

### Automatisches Archivieren (Garbage Collector)

Issues die länger als drei Tage den Status `done` haben, werden beim Serverstart und stündlich automatisch nach `issues/archive/` verschoben. Sie verschwinden aus dem Board und aus der Listenansicht — außer du aktivierst den Archiv-Filter.

Das Archivieren ist nicht rückgängig zu machen über das Board; die Dateien in `issues/archive/` können aber manuell zurückbewegt werden.

## Docs-Site lokal starten

Die Dokumentation unter `docs.mwolff.org` kannst du auch lokal laufen lassen:

```bash
cd docs-site
npm run dev
```

Öffne dann `http://localhost:5173`. Änderungen in `docs/*.md` werden sofort ohne Reload sichtbar.

Zum Bauen der statischen Seite:

```bash
npm run build
```

## Issues per CLI verwalten

Der Board-Adapter lässt sich direkt aufrufen:

```bash
# Issue anlegen
node .claude/kit/board.mjs issue create --title "Titel" --body "## Kontext\n..."

# Alle Issues anzeigen
node .claude/kit/board.mjs issue list

# Nur Ready-Issues
node .claude/kit/board.mjs issue list --status ready

# Status ändern
node .claude/kit/board.mjs issue move 0001 ready

# Kommentar anhängen
node .claude/kit/board.mjs issue comment 0001 --text "Review abgeschlossen."
```

Die Dateien in `issues/` sind normales Markdown — du kannst sie auch direkt im Editor öffnen und bearbeiten.

## Wechsel zu GitHub oder GitLab später

Wenn du irgendwann doch ein Remote-Repo und ein Board einrichtest, reicht eine Config-Änderung:

```json
{
  "codeHost": "github",
  "issueTracker": "github",
  "github": { "projectNumber": 42 }
}
```

Die lokalen Issue-Dateien in `issues/` bleiben erhalten, werden aber nicht automatisch migriert. Du kannst sie manuell als GitHub-Issues anlegen oder einfach archivieren und neu beginnen.
