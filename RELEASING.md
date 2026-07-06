# Release & Versionierung (Kit-intern)

Gilt **nur fuer das claude-workflow-kit-Repo selbst** — nicht fuer Projekte, die das
Kit nutzen. Zielprojekte fuehren ihren eigenen Prozess (`CLAUDE-workflow.md`) und haben
`tools/version.mjs` nicht.

## Versionskennung

Format `x.y.z`, gepflegt im Feld `version` von `.claude/workflow.config.json`
(Start: `1.4.0`). Die lokale Board-UI zeigt sie an. Gebumpt wird ueber das
Single-File-Tool `tools/version.mjs` (`--get`, `--patch`, `--minor`, `--major`).

## Bump-Regeln

| Trigger | Kommando | Wirkung |
|---|---|---|
| `push main` | `node tools/version.mjs --patch` | z + 1 |
| `merge production` | `node tools/version.mjs --minor` | y + 1, z = 0 |
| explizit angesagt | `node tools/version.mjs --major` | x + 1, y = 0, z = 0 |

## Ablauf

**Bei `push main`:**
1. `node tools/version.mjs --patch`
2. Version-Commit: `chore: vX.Y.Z`
3. Push auf `main`.

**Bei `merge production`:**
1. `node tools/version.mjs --minor`
2. Version-Commit: `chore: vX.Y.Z`
3. Push auf `main`.
4. PR `main -> production` erstellen. **Den Merge macht der Mensch von Hand.**

Wichtig: Der Version-Commit aus `merge production` loest **keinen** zusaetzlichen
Patch-Bump aus — er ist Teil des Release-Schritts, nicht ein separates `push main`.

`x` (Major) wird ausschliesslich auf explizite Ansage erhoeht.
