# Implementierungsplan: claude-workflow-kit

Eine Skill-Bibliothek, die meinen 9-Schritt-Prozess in Claude Code ausführbar macht.
Stand der Entscheidungen: Review läuft über Opus in frischer Session, kein externes Codex.

## Ziel

Ein Quell-Repo als Single Source of Truth für die Workflow-Bibliothek, plus ein Installer, der die allgemeinen Skills global oder ins Projekt legt und die projekt-spezifische Schicht als Vorlage anlegt. Ergebnis: ein neues Projekt ist an einem Vormittag workflow-fähig.

## Architektur-Entscheidungen

**E1, generische Skills plus Config statt Templates.**
Die allgemeinen Skills bleiben projekt-unabhängig und lesen die projekt-spezifischen Werte aus einer `.claude/workflow.config.json` im Repo. Ein Skill-Update gilt damit überall, nur die Config ist projektlokal. Keine Platzhalter-Ersetzung bei Installation.

**E2, Skill-Format, nicht Legacy-Command.**
Alles als `.claude/skills/<name>/SKILL.md`, weil das die empfohlene Form ist. Die Release-Skills bekommen `disable-model-invocation`, damit die KI `/push-main` und `/merge-production` nie selbst zieht.

**E3, nur Claude Code zuerst.**
Codex-AGENTS.md und Cursor-Adapter halten wir als Ordnerstruktur offen, bauen sie aber jetzt nicht.

**E4, Review über Opus in frischer Session. ENTSCHIEDEN.**
`/review` startet einen Reviewer ohne Implementierungs-Kontext und bekommt entweder den Diff oder den ganzen Quelltext. Kein externes Tooling. Die frische Session ist die wichtigste Variable, nicht das Modell. Offene technische Wahl für Issue 1: Reviewer als Subagent mit eigenem Kontext und Opus-Pin, oder Headless-Aufruf von `claude -p` per Bash mit dem Diff als Eingabe. Tendenz: Subagent, weil null Extra-Tooling und sauber getrennter Kontext.

## Verzeichnis-Layout (Quell-Repo)

```
claude-workflow-kit/
  skills/
    plan/SKILL.md
    issues/SKILL.md
    implement-ready/SKILL.md
    local-check/SKILL.md
    review/SKILL.md
    retro/SKILL.md
    push-main/SKILL.md
    merge-production/SKILL.md
  templates/
    workflow.config.json
    CLAUDE-workflow.md
  install.mjs
  README.md
```

## Die acht allgemeinen Skills (Anforderung 1)

Gemappt auf die neun Schritte. Die menschlichen Schritte (GO, Ready-Bewegung) bekommen bewusst keinen Skill.

| Skill | Schritt | Was er tut | Stop-Punkt |
|-------|---------|------------|------------|
| `plan` | 2 | Erzeugt den Plan, stellt zur Diskussion, implementiert nichts | |
| `issues` | 3 | Überführt den Plan in kleinteilige GitHub-Issues, Vier-Abschnitt-Format | |
| `implement-ready` | 5 | Arbeitet Ready sequenziell nach Issue-Nummer ab, committet lokal, pusht nicht | |
| `local-check` | 6 | Fährt die Pflicht-Checks aus der Config plus die manuelle-UI-Notiz | |
| `review` | 7 | Startet Opus in frischer Session, Diff oder ganzer Quelltext | |
| `retro` | 7.5 | KI-Retrospektive, konsolidiert Memory, schärft Workflow-Regeln | |
| `push-main` | 8 | Pusht den aktuellen Commit-Batch | nur Mensch, `disable-model-invocation` |
| `merge-production` | 9 | Erstellt PR main nach production | nur Mensch, `disable-model-invocation` |

Keiner dieser Skills hartcodiert Projekt-Spezifisches. Alles Konkrete kommt aus der Config.

## Die projekt-spezifische Schicht (Anforderung 2)

Keine eigene Skill-Sammlung pro Projekt, sondern eine `.claude/workflow.config.json`:

```json
{
  "buildChecks": ["mvn verify", "npm run build"],
  "mutationCommand": "mvn org.pitest:pitest-maven:mutationCoverage",
  "mainBranch": "main",
  "productionBranch": "production",
  "reviewScope": "diff",
  "reviewModel": "claude-opus-4-8",
  "triggers": { "go": "GO", "push": "push main", "merge": "merge production" }
}
```

`reviewScope` ist `diff` oder `full`. `reviewModel` pinnt den Reviewer. Wenn ein Projekt echte Sonderfälle hat, kommt zusätzlich ein projekt-eigener Skill in `.claude/skills/` dazu. Das ist die Ausnahme, nicht die Regel.

## Der Installer (Anforderung 3)

Node-Script (`install.mjs`), aufgerufen per `npx` oder direkt. Node läuft auf Mac, Windows und Linux identisch. Ein Bash-Script würde auf Windows ohne WSL scheitern. Ein Skript, drei Plattformen.

Ablauf: erkennt Zielsystem, fragt fünf Dinge (global oder projekt, main-Branch, production-Branch, reviewScope, reviewModel), kopiert die acht Skills nach `~/.claude/skills/` oder `./.claude/skills/`, schreibt die `workflow.config.json` aus den Antworten, legt `CLAUDE-workflow.md` ab. Kopiert und konfiguriert nur, kein Daemon, keine Magie.

## Bewusst nicht drin

Kein Skill für GO, kein Skill für die Ready-Bewegung, keine Automatik für Push oder Merge. Das sind die Verantwortungsschwellen, sie bleiben menschlich und tippbar. Kein Multi-Tool-Adapter in Runde eins. Keine Board-Automatik im Kit, die kommt aus GitHub Projects selbst. Keine deterministischen Security-Gates im Kit, die gehören ins CI des Zielprojekts (gitleaks, Semgrep), nicht in die Skill-Bibliothek.

## Verifizierung

Fertig heißt: frisches Test-Repo, `npx`-Installer durchlaufen, alle acht Skills tauchen nach Session-Start in `/help` auf, `/plan` läuft und implementiert nichts, `/review` startet ohne Implementierungs-Kontext, `/push-main` wird von Claude nicht autonom gezogen.

## Vorschlag Issue-Schnitt

1. Repo-Skelett plus `review`-Skill (klärt die Subagent-gegen-Headless-Frage aus E4).
2. Die übrigen sieben Skills, jeweils gegen die Config geschrieben.
3. Config-Schema und Validierung.
4. `install.mjs` mit den fünf Fragen, plattformübergreifend.
5. README plus `CLAUDE-workflow.md`-Vorlage.
6. Erstes Praxis-Issue im Zielprojekt: das Setup selbst, als Durchlauf des ganzen Prozesses.
