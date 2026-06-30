# 5-Minuten-Guide

Du hast einen Prozess für die KI-gestützte Entwicklung, und du willst ihn in Claude Code ausführbar machen, ohne deine Stop-Punkte aufzugeben. Das Kit gibt dir zehn Skills, eine Config und einen Installer. In fünf Minuten läuft es.

## Voraussetzungen

- Node.js ab Version 22
- git
- Claude Code installiert
- Ein GitHub-Projekt mit Kanban-Board, fünf Spalten: Backlog, Ready, In progress, In review, Done

## Installieren

Lade den Installer herunter und starte ihn im Projektordner:

```bash
curl -O https://mwolff.org/claude-workflow-kit/install.mjs
node install.mjs
```

Oder in einem Schritt:

```bash
node <(curl -s https://mwolff.org/claude-workflow-kit/install.mjs)
```

Der Installer fragt fünf Dinge:

1. Global oder nur für dieses Projekt
2. Name des main-Branch
3. Name des production-Branch
4. Review-Umfang: `diff` oder `full`
5. Review-Modell

Danach liegen die zehn Skills in `.claude/skills/` (oder global in `~/.claude/skills/`), und eine `.claude/workflow.config.json` mit deinen Antworten steht im Repo. Starte Claude Code neu, dann tauchen die Skills in `/help` auf.

## Die zehn Skills

| Befehl | Wofür |
|--------|-------|
| `/kontext` | Kontext laden, Lageüberblick zu Session-Start |
| `/plan` | Plan aus der Anforderung, implementiert nichts |
| `/issues` | Plan in kleinteilige GitHub-Issues |
| `/implement-ready` | Ready-Issues abarbeiten, lokal committen |
| `/local-check` | Pflicht-Checks plus UI-Verifikation |
| `/review` | Review durch Opus in frischer Session |
| `/retro` | KI-Retrospektive, Memory konsolidieren |
| `/push-main` | Push auf main, nur du |
| `/merge-production` | PR nach production, nur du |
| `/document` | Session dokumentieren, Projektnotiz aktualisieren |

## Ein erster Durchlauf

```
/plan baue ein Login-Formular mit E-Mail und Passwort
```

Du liest den Plan. Passt er, gibst du frei:

```
/issues
```

Du ziehst die Issues am Board nach Ready. Das ist dein GO. Dann:

```
/implement-ready
/local-check
/review
```

Du prüfst das Review. Erst dann:

```
/push-main
```

Auf dem Test-Server kontrollierst du das Ergebnis. Stimmt es:

```
/merge-production
```

## Die drei Stellen, die du selbst machst

Das Ziehen nach Ready, der Push, der Merge. Diese drei automatisiert das Kit bewusst nicht. Sie sind der Punkt, an dem du die Verantwortung trägst. Alles andere nimmt dir die KI ab.

Mehr Details in der ausführlichen Dokumentation.
