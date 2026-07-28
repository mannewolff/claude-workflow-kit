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
2. `node tools/changelog.mjs` — regeneriert `CHANGELOG.md` aus der Historie (liest die frisch gebumpte `VERSION` fuer den obersten Block).
3. Version-Commit: `chore: vX.Y.Z` (`install.mjs` **und** `CHANGELOG.md` zusammen).
4. Push auf `main`.

**Bei `merge production`** (ausgeloest durch `.claude/skills/merge-production/SKILL.md`, Schritt 3 "Projekt-eigene Release-Schritte"):
1. `node tools/version.mjs --minor`
2. `node tools/changelog.mjs` — regeneriert `CHANGELOG.md`.
3. Version-Commit: `chore: vX.Y.Z` (`install.mjs` **und** `CHANGELOG.md` zusammen).
4. Push auf `main`.
5. PR `main -> production` erstellen. **Den Merge macht der Mensch von Hand.**

Reihenfolge ist bindend: **erst** Bump (`version.mjs`), **dann** Changelog
(`changelog.mjs` liest die neue Version), **dann** der gemeinsame Commit. So
landet `CHANGELOG.md` immer im selben `chore:`-Commit wie der Bump.

`tools/sync-blobs.mjs` stempelt zusaetzlich die Kit-Version in die
`KIT_VERSION`-Konstante von `kit/board.mjs` und `kit/night.mjs`, bevor es die Blobs
backt — dadurch kann man einer installierten Kopie ansehen, aus welchem Kit-Stand
sie stammt (`node .claude/kit/board.mjs --version`). Das braucht **keinen** eigenen
Schritt in der Liste oben: Der Stempel entsteht beim naechsten `sync-blobs`-Lauf, und
`sync-blobs --check` ist ohnehin ein `buildCheck` dieses Repos. Nach einem Bump also
wie gewohnt `node tools/sync-blobs.mjs` laufen lassen — die geaenderten Kit-Dateien
gehoeren dann mit in den `chore:`-Commit.

Wichtig: Der Version-Commit aus `merge production` loest **keinen** zusaetzlichen
Patch-Bump aus — er ist Teil des Release-Schritts, nicht ein separates `push main`.

`x` (Major) wird ausschliesslich auf explizite Ansage erhoeht.
