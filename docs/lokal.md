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

## Das Board über Git teilen (mehrere Rechner)

Weil Issues normale Dateien im Repo sind, hängt ihre Portabilität nur an einer Frage: Ist `issues/` versioniert?

Standardmäßig ist es das — der Installer nimmt `issues/` **nicht** in die `.gitignore` auf. Das lokale Board ist damit Teil des Repos und wandert per `commit` / `push` / `pull` mit. Arbeitest du an einem Projekt von zwei Rechnern, siehst du auf beiden denselben Board-Stand:

```bash
# Rechner A
node .claude/kit/board.mjs issue move 0001 ready
git add issues/ && git commit -m "Board: #0001 nach ready" && git push

# Rechner B
git pull   # zieht den neuen Board-Stand
```

Das heißt aber auch: **Jeder Statuswechsel erzeugt einen Commit/Diff** in der Issue-Datei. Der Board-Verlauf wird Teil der Git-Historie — gewollt, aber die Historie wird geschwätziger.

**Board bewusst privat halten:** Willst du das Board pro Rechner lokal lassen (nicht teilen), nimm `issues/` in die `.gitignore` auf. Dann bleiben die Dateien maschinenlokal.

**Heads-up beim ersten Pull auf einem zweiten Rechner:** Liegen dort bereits eigene, untracked Issue-Dateien in `issues/`, bricht `git pull` mit *„untracked working tree files would be overwritten"* ab. Vorher sichern oder entfernen:

```bash
mv issues issues.backup   # oder löschen, falls identisch
git pull
```

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

## Board

Die frühere lokale Kanban-GUI (`board-ui.mjs`) ist eingestellt.
