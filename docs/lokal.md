# Lokal arbeiten — ohne Remote-Repo, ohne Board

Im lokalen Modus brauchst du nur git und Node.js: kein Remote-Repo, kein Board, keine CLI eines Hosters. Ein lokales git-Repository ist Pflicht, `git init` reicht.

## Wann dieser Modus passt

- Privates Projekt ohne Remote-Repo
- Frühphase, noch kein Board eingerichtet
- Das Kit ausprobieren, bevor du eine Plattform wählst
- Einzelperson ohne Pull-Request-Prozess

## Installation

Den Aufruf des Installers zeigt der [Einstieg](/quickstart); dort wählst du für Code-Host und Issue-Tracker `local`. Die Config enthält danach:

```json
{
  "codeHost": "local",
  "issueTracker": "local",
  "local": { "issuesDir": "issues" }
}
```

`local.issuesDir` nennt das Verzeichnis der Karten, Vorgabe `issues`.

## Wie Karten gespeichert werden

Jede Karte ist eine Markdown-Datei mit vierstelliger Nummer:

```
issues/
  0001.md
  0002.md
```

```markdown
---
id: "0001"
type: task
status: backlog
title: Login-Formular bauen
created: 2026-07-01
---

## Kontext
Nutzer können sich noch nicht anmelden.

## Aufgabe
E-Mail- und Passwort-Feld, Submit-Button, Validierung.

## Akzeptanzkriterium
- Leeres Feld zeigt eine Fehlermeldung

## Abhaengigkeiten
Keine.
```

Der Board-Adapter setzt `status` (`backlog`, `ready`, `in_progress`, `in_review`, `done`) direkt in der Datei; Kommentare stehen in derselben Datei.

## Das Board über Git teilen

Der Installer trägt `issues/` nicht in die `.gitignore` ein. Die Karten gehören damit zum Repo und wandern mit `push` und `pull` auf jeden Rechner; jeder Statuswechsel ist eine Änderung in git:

```bash
node .claude/kit/board.mjs issue move 0001 ready
git add issues/ && git commit -m "Board: 0001 nach ready"
```

Soll das Board auf einem Rechner bleiben, trägst du `issues/` in die `.gitignore` ein. Liegen auf einem zweiten Rechner schon eigene, nicht versionierte Karten in `issues/`, bricht der erste `git pull` ab; sichere oder entferne sie vorher.

## Der Prozess im lokalen Modus

Die Schritte laufen wie mit GitHub oder GitLab.

- **GO:** `node .claude/kit/board.mjs issue move <id> ready` zieht eine Karte nach Ready; ebenso gut änderst du `status:` in der Datei.
- **Push:** `/push-main` pusht auf das Remote. Ohne Remote bleibt der Stand auf dem lokalen Hauptzweig.
- **Merge:** Ohne Code-Host gibt es keinen Pull Request; `/merge-production` nennt die git-Befehle für den lokalen Merge.
