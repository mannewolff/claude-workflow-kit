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
2. `node tools/sync-blobs.mjs` — stempelt die neue Version in die Kit-Dateien.
3. Version-Commit: `chore: vX.Y.Z` (`install.mjs` und die gestempelten Kit-Dateien).
4. `node tools/changelog.mjs` — **jetzt**, nachdem die Marke existiert.
5. `git add CHANGELOG.md && git commit --amend --no-edit` — der Changelog wandert in
   denselben Commit.
6. Push auf `main`.

**Bei `merge production`** (ausgeloest durch `.claude/skills/merge-production/SKILL.md`, Schritt 3 "Projekt-eigene Release-Schritte"):
1. `node tools/version.mjs --minor`
2. `node tools/sync-blobs.mjs`
3. Version-Commit: `chore: vX.Y.Z`
4. `node tools/changelog.mjs`
5. `git add CHANGELOG.md && git commit --amend --no-edit`
6. Push auf `main`.
7. PR `main -> production` erstellen. **Den Merge macht der Mensch von Hand.**

### Warum der Changelog erst nach dem Commit entsteht

`changelog.mjs` leitet die Versionsmarken aus den `chore:`-Commits ab. Lief es
**vor** dem Version-Commit, kannte es die Marke nicht, die dieser Commit gerade
setzt — die eben geschriebene Datei war in dem Moment veraltet, in dem sie
committet wurde, und `--check` schlug direkt danach fehl (Issue #265, belegt beim
Release v1.36.0: die veroeffentlichte Version fehlte im Changelog).

Der `--amend` passiert **lokal vor dem Push** und braucht deshalb keinen
Force-Push. Er aendert weder Betreff noch Datum des Commits — und nur an denen
haengt das Generat, weshalb `--check` danach stabil gruen bleibt.

**Nicht umdrehen:** Erst Bump, dann Commit, dann Changelog, dann Amend. Wer den
Changelog wieder vor den Commit zieht, bekommt denselben Fehler zurueck.

`tools/sync-blobs.mjs` stempelt zusaetzlich die Kit-Version in die
`KIT_VERSION`-Konstante von `kit/board.mjs` und `kit/night.mjs`, bevor es die Blobs
backt — dadurch kann man einer installierten Kopie ansehen, aus welchem Kit-Stand
sie stammt (`node .claude/kit/board.mjs --version`). Deshalb steht es als Schritt 2
in den Listen oben — vor dem Version-Commit, damit die gestempelten Kit-Dateien mit
hineingehen. `sync-blobs --check` ist ohnehin ein `buildCheck` dieses Repos und
schlaegt an, wenn der Stempel fehlt.

Wichtig: Der Version-Commit aus `merge production` loest **keinen** zusaetzlichen
Patch-Bump aus — er ist Teil des Release-Schritts, nicht ein separates `push main`.

`x` (Major) wird ausschliesslich auf explizite Ansage erhoeht.

## Git-Tags

**Kein Release-Schritt erzeugt einen Tag.** Weder `push main` noch
`merge production` setzen oder pushen einen; wer hier nach der Tag-Logik sucht,
findet keine, weil es keine gibt.

Der Tag wird **vom Menschen** gesetzt, nach dem Merge nach `production`.
`merge-production` gibt dafuer am Ende seines Laufs die fertige Kommandozeile aus,
mit dem Hash des `chore: vX.Y.Z`-Commits:

```
git tag -a vX.Y.Z <hash> -m "Release vX.Y.Z" && git push origin vX.Y.Z
```

Beim `push main`-Trigger entsteht bewusst kein Tag: Dort entstehen interne
Patch-Staende, die niemand veroeffentlicht.

Unberuehrt davon bleibt `tools/changelog.mjs` — es leitet die Versionsmarken
weiterhin aus den `chore: vX.Y.Z`-Commits ab, nicht aus Tags.
