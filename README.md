# claude-workflow-kit

Eine Bibliothek aus Claude-Code-Skills, die den 9-Schritt-Prozess zur KI-gestuetzten Softwareentwicklung ausfuehrbar macht.

## Die Haltung dahinter

Alle Agenten-Tools addieren Autonomie. Stellwerk addiert bewusst **Stop-Punkte** an genau drei Stellen. Die KI plant, schreibt Issues, implementiert und bereitet das Review vor. Drei Schritte bleiben menschlich und tippbar:

1. **GO** — Issues nach Ready ziehen.
2. **push main** — Claude pusht den Commit-Batch.
3. **merge production** — Claude erstellt den PR.

Diese drei sind keine fehlende Funktion. Sie sind der Punkt, an dem der Mensch die Verantwortung uebernimmt.

---

## Installation

### Voraussetzungen

- [Claude Code](https://claude.ai/code) installiert
- Node.js 18+
- `gh` CLI (fuer Board- und Issue-Verwaltung)

### Einrichten

```bash
node install.mjs
```

Der Installer stellt fuenf Fragen und kopiert die Skills ans richtige Ziel.

Danach `workflow.config.json` anpassen (buildChecks, mutationCommand).

Oder direkt aus GitHub (nach Veroeffentlichung):

```bash
npx github:mannewolff/claude-workflow-kit
```

---

## Die acht Skills

Nach der Installation erscheinen alle Skills in `/help`.

| Skill | Schritt | Was er tut |
|-------|---------|------------|
| `/plan` | 2 | Erstellt einen Plan, stellt ihn zur Diskussion, implementiert nichts |
| `/issues` | 3 | Uebertraegt den Plan in kleinteilige GitHub-Issues (Vier-Abschnitt-Format) |
| `/implement-ready` | 5 | Arbeitet Ready-Issues sequenziell nach Nummer ab, committet lokal |
| `/local-check` | 6 | Fuehrt Pflicht-Checks aus der Config aus + manuelle UI-Notiz |
| `/review` | 7 | Startet Opus-Reviewer in frischer Session ohne Implementierungs-Kontext |
| `/retro` | 7.5 | KI-Retrospektive, Memory konsolidieren, Workflow-Regeln schaerfen |
| `/push-main` | 8 | Pusht den aktuellen Commit-Batch (**nur auf Trigger-Phrase**) |
| `/merge-production` | 9 | Erstellt PR main -> production (**nur auf Trigger-Phrase**) |

Die menschlichen Schritte (Anforderung, GO, Ready-Bewegung) haben bewusst keinen Skill.

---

## Config (.claude/workflow.config.json)

```json
{
  "buildChecks": ["mvn verify"],
  "mutationCommand": "mvn org.pitest:pitest-maven:mutationCoverage",
  "mainBranch": "main",
  "productionBranch": "production",
  "reviewScope": "diff",
  "reviewModel": "claude-opus-4-8",
  "triggers": { "go": "GO", "push": "push main", "merge": "merge production" }
}
```

| Feld | Typ | Default | Beschreibung |
|------|-----|---------|--------------|
| `buildChecks` | string[] | `[]` | Kommandos fuer `/local-check` |
| `mutationCommand` | string | `""` | Mutations-Test (optional) |
| `mainBranch` | string | `"main"` | Branch fuer lokale Commits und Push |
| `productionBranch` | string | `"production"` | Ziel-Branch fuer PR in Schritt 9 |
| `reviewScope` | `"diff"` / `"full"` | `"diff"` | Umfang des Review-Materials |
| `reviewModel` | string | `"claude-opus-4-8"` | Modell-ID fuer den Reviewer-Subagent |
| `triggers.push` | string | `"push main"` | Trigger-Phrase fuer Schritt 8 |
| `triggers.merge` | string | `"merge production"` | Trigger-Phrase fuer Schritt 9 |

---

## Kanban-Board (5 Spalten)

| Spalte | Wer bewegt |
|--------|-----------|
| Backlog | Beide |
| Ready | Nur Mensch (das GO) |
| In progress | KI beim Start |
| In review | KI beim Abschluss |
| Done | Nur Mensch (nach Test) |

---

## Bewusst nicht drin

- Kein Skill fuer GO und Ready-Bewegung (das sind die Verantwortungsschwellen)
- Keine Automatik fuer Push und Merge
- Keine Security-Gates im Kit (gehoeren ins CI: gitleaks, Semgrep)
- Keine Board-Automatik (kommt aus GitHub Projects)
- Kein Multi-Tool-Adapter in Version 1

---

## Hintergrund

Whitepaper: [Docs](docs/implementierungsplan-workflow-kit.md)
Motivation: [Das Werkzeug, das es nicht gibt](docs/werkzeug-das-es-nicht-gibt.md)
