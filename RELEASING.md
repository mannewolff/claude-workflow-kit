# Release & Versionierung (Kit-intern)

Gilt **nur fuer das claude-workflow-kit-Repo selbst** — nicht fuer Projekte, die das
Kit nutzen. Zielprojekte fuehren ihren eigenen Prozess (`CLAUDE-workflow.md`) und haben
`tools/version.mjs` nicht.

Diese Datei ist keine reine Hintergrund-Referenz mehr, sondern wird automatisch
ausgefuehrt: Die generischen Skills `push-main` und `merge-production` (Schritt
"Projekt-eigene Release-Schritte") pruefen bei jedem Lauf, ob eine `RELEASING.md`
im Projekt-Root existiert, und folgen dann dem hier beschriebenen Ablauf, bevor
gepusht bzw. der PR erstellt wird. Existiert keine `RELEASING.md`, ueberspringen
die Skills diesen Schritt ersatzlos — die Konvention ist projekt-opt-in und nicht
auf dieses Kit beschraenkt (siehe docs/dokumentation.md).

## Versionskennung

Eine einzige Versionskennung: `install.mjs` (`const VERSION`, Format `x.y.z`).
Repraesentiert sowohl den internen `main`-Stand als auch den zuletzt auf
`production`/docs.mwolff.org veroeffentlichten Stand — `workflow.config.json`
traegt kein eigenes `version`-Feld mehr, install.mjs ist alleinige Quelle.

Gebumpt wird ueber das Single-File-Tool `tools/version.mjs` (`--get`, `--patch`,
`--minor`, `--major`).

## Bump-Regeln

| Trigger | Kommando | Wirkung |
|---|---|---|
| `push main` | `node tools/version.mjs --patch` | z + 1 |
| `merge production` | `node tools/version.mjs --minor` | y + 1, z = 0 |
| explizit angesagt | `node tools/version.mjs --major` | x + 1, y = 0, z = 0 |

## Ablauf

**Bei `push main`** (ausgeloest durch `.claude/skills/push-main/SKILL.md`, Schritt 3 "Projekt-eigene Release-Schritte"):
1. `node tools/version.mjs --patch`
2. Version-Commit: `chore: vX.Y.Z` (nur `install.mjs`)
3. Push auf `main`.

**Bei `merge production`** (ausgeloest durch `.claude/skills/merge-production/SKILL.md`, Schritt 3 "Projekt-eigene Release-Schritte"):
1. `node tools/version.mjs --minor`
2. Version-Commit: `chore: vX.Y.Z` (`install.mjs`)
3. Push auf `main`.
4. PR `main -> production` erstellen. **Den Merge macht der Mensch von Hand.**

Wichtig: Der Version-Commit aus `merge production` loest **keinen** zusaetzlichen
Patch-Bump aus — er ist Teil des Release-Schritts, nicht ein separates `push main`.

`x` (Major) wird ausschliesslich auf explizite Ansage erhoeht.
