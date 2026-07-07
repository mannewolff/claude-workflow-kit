# Release & Versionierung (Kit-intern)

Gilt **nur fuer das claude-workflow-kit-Repo selbst** — nicht fuer Projekte, die das
Kit nutzen. Zielprojekte fuehren ihren eigenen Prozess (`CLAUDE-workflow.md`) und haben
`tools/version.mjs` nicht.

Diese Datei ist Hintergrund-Referenz. Der verbindliche Ablauf steht direkt in
`.claude/skills/push-main/SKILL.md` und `.claude/skills/merge-production/SKILL.md` —
dort wird der Bump-Schritt tatsaechlich ausgefuehrt, nicht nur beschrieben.

## Versionskennung

Zwei Versionskennungen, ein Zaehler:

- `.claude/workflow.config.json` (Feld `version`, Format `x.y.z`, Start: `1.4.0`).
  Die lokale Board-UI zeigt sie an. Wird bei **jedem** Bump aktualisiert.
- `install.mjs` (`const VERSION`). Repraesentiert den zuletzt veroeffentlichten
  (auf `production`/docs.mwolff.org befindlichen) Stand, nicht jeden internen
  `main`-Commit. Wird deshalb nur bei `--minor`/`--major` mitgezogen, nicht bei
  `--patch`.

Gebumpt wird ueber das Single-File-Tool `tools/version.mjs` (`--get`, `--patch`,
`--minor`, `--major`); `--minor`/`--major` synchronisieren beide Dateien in einem
Aufruf (Issue #0009).

## Bump-Regeln

| Trigger | Kommando | Wirkung | install.mjs |
|---|---|---|---|
| `push main` | `node tools/version.mjs --patch` | z + 1 | unveraendert |
| `merge production` | `node tools/version.mjs --minor` | y + 1, z = 0 | synchronisiert |
| explizit angesagt | `node tools/version.mjs --major` | x + 1, y = 0, z = 0 | synchronisiert |

## Ablauf

**Bei `push main`** (siehe `.claude/skills/push-main/SKILL.md`, Schritt 3):
1. `node tools/version.mjs --patch`
2. Version-Commit: `chore: vX.Y.Z` (nur `.claude/workflow.config.json`)
3. Push auf `main`.

**Bei `merge production`** (siehe `.claude/skills/merge-production/SKILL.md`, Schritt 3):
1. `node tools/version.mjs --minor`
2. Version-Commit: `chore: vX.Y.Z` (`.claude/workflow.config.json` und `install.mjs`)
3. Push auf `main`.
4. PR `main -> production` erstellen. **Den Merge macht der Mensch von Hand.**

Wichtig: Der Version-Commit aus `merge production` loest **keinen** zusaetzlichen
Patch-Bump aus — er ist Teil des Release-Schritts, nicht ein separates `push main`.

`x` (Major) wird ausschliesslich auf explizite Ansage erhoeht und synchronisiert
install.mjs ebenso wie `--minor`.
