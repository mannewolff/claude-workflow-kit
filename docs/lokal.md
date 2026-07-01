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
  "local": { "issuesDir": "issues" }
}
```

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
