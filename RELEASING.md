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

## Einrichtung (einmalig je Klon)

Das Commit-Gate liegt versioniert unter `.githooks/`, aktiviert wird es aber ueber
lokale git-Config — die wandert nicht mit dem Klon:

```bash
git config core.hooksPath .githooks
```

Ohne diesen Schritt weist nichts einen Commit ohne Pruefnachweis ab; es bleibt allein
die nachtraegliche Wertung im Nacht-Runner (Issue #471).

Die Rueckmeldung zur Windows-Pruefung (Issue #1129) laeuft als Hook in
`.claude/settings.json`. Die Datei ist nicht versioniert, und schreiben darf sie nur der
Mensch. Deshalb stehen die beiden Eintraege hier, wortgetreu unter `"hooks"`:

```json
"SessionStart": [
  { "hooks": [{ "type": "command", "command": "node tools/windows-pruefung.mjs --hook" }] }
],
"UserPromptSubmit": [
  { "hooks": [{ "type": "command", "command": "node tools/windows-pruefung.mjs --hook" }] }
]
```

### Rueckmeldung zur Windows-Pruefung

Fuer die Windows-Pruefung des Kit-Repositorys sind #316 und #1129 abgeloest: `push main`
wartet vor dem Push auf sie (Abschnitt "Vor dem Push" unten, Issue #1154). Ein roter Job
`check (windows-latest)` faellt damit vor der Veroeffentlichung auf, nicht erst beim CI-Gate
in `/merge-production`. Der Hook bleibt als Netz fuer Pushes ausserhalb von `push main`,
etwa einen Push von Hand. Gemeldet wird dann beim naechsten Schritt: Der Hook
fragt `code ci-status` fuer `origin/main` ab, ohne Fetch und mit einer Frist von fuenf
Sekunden. Ein rotes Ergebnis meldet er einmal je Sitzung und bei jedem Sitzungsstart
erneut. Ergebnis und Abfragezeit haelt er in `.claude/windows-pruefung.json`. Laeuft der Job
noch, fragt er fruehestens nach zwei Minuten wieder. Scheitert die Abfrage, schweigt er.

## Vor dem Push

Ein Vor-Push-Schritt: `push main` faehrt ihn nach seinem Commit und vor dem Push auf
`main`, im Hintergrund, und wartet auf sein Ende (Plan #1150, E6 bis E8):

```bash
node tools/windows-pruefung.mjs --vorab
```

Das Werkzeug prueft den fertigen Commit in der gehosteten Pruefung unter Windows. Liegt fuer
ihn schon ein Ergebnis vor, gilt es ohne Push. Sonst legt es den Stand auf den Wegwerf-Zweig
`windows-vorab` (loeschen, dann neu anlegen, ohne Force-Push), fragt alle 30 Sekunden ab und
schreibt je Abfrage eine Fortschrittszeile. Die Frist betraegt 30 Minuten ab dem Start des
Windows-Jobs; danach endet es von selbst.

- Exit 0 — gruen, `push main` pusht.
- Exit 1 — rot, gepusht wird nur nach ausdruecklicher Freigabe des Menschen.
- Jeder andere Exit — kein verwertbares Ergebnis (Frist abgelaufen, Abfrage oder Vorab-Push
  gescheitert): Halt ohne Push, mit der Meldung des Werkzeugs.

Zielprojekte bekommen diesen Schritt nicht: Er steht nur in dieser Datei, und `push main`
faehrt allgemein jeden Vor-Push-Schritt, den eine `RELEASING.md` nennt.

## Ablauf

Die Listen unten fuehren nur die **Erzeugungsschritte**. Prueflauf, Festschreiben und
Veroeffentlichen kommen aus dem Skill (`push-main` bzw. `merge-production`): Er faehrt
alles bis zum ersten festschreibenden Schritt, dann genau einen Prueflauf ueber den
fertigen Stand, dann genau einen Commit. Deshalb ordnet diese Datei weder das
Festschreiben noch das Veroeffentlichen noch den Prueflauf an — taete sie es, gaebe es
zwei Stellen, die dasselbe anordnen, und eine fremde `RELEASING.md` braeuchte Wissen
ueber das Commit-Gate. Einzige Ausnahme ist der Vor-Push-Schritt (Abschnitt "Vor
dem Push" oben): Er veroeffentlicht nichts auf `main`, sondern legt den Stand auf einen
Wegwerf-Zweig fuer die gehostete Pruefung.

**Bei `push main`** (ausgeloest durch `.claude/skills/push-main/SKILL.md`):
1. `node tools/version.mjs --patch`
2. `node tools/sync-blobs.mjs` — stempelt die neue Version in die Kit-Dateien.
3. `node tools/changelog.mjs --marke vX.Y.Z` — mit der Kennung aus Schritt 1.

**Bei `merge production`** (ausgeloest durch `.claude/skills/merge-production/SKILL.md`):
1. `node tools/version.mjs --minor`
2. `node tools/sync-blobs.mjs`
3. `node tools/changelog.mjs --marke vX.Y.Z`

PR, Tag-Kommando und Release-Kommando kommen ebenfalls aus dem Skill. **Den Merge macht
der Mensch von Hand.**

### Warum der Changelog vor dem Commit entsteht und die Marke mitbekommt

`changelog.mjs` leitet die Versionsmarken aus den `chore:`-Commits ab. Lief es frueher
**vor** dem Version-Commit, kannte es die Marke nicht, die dieser Commit gerade setzt —
die eben geschriebene Datei war in dem Moment veraltet, in dem sie committet wurde, und
`--check` schlug direkt danach fehl (Issue #265, belegt beim Release v1.36.0: die
veroeffentlichte Version fehlte im Changelog). Die Antwort darauf war ein zweiter Commit
per `--amend`.

`--marke vX.Y.Z` loest dasselbe Problem ohne den zweiten Commit: Der Lauf bekommt die
Kennung gesagt, die gleich committet wird, und traegt sie mit dem lokalen Datum ein, statt
sie aus der Historie ableiten zu wollen (Issue #657). Danach ist `CHANGELOG.md` fertig,
bevor irgendetwas festgeschrieben wird — und geht in denselben Commit wie Bump und Stempel.

**Nicht umdrehen:** Erst Bump, dann Stempel, dann Changelog mit der Marke — und erst
danach der eine Lauf und der eine Commit. Wer den Changelog ohne `--marke` faehrt, bekommt
den Fehler aus Issue #265 zurueck.

**Warum ein Lauf genuegt:** Der Nachweis gehoert zum Commit, nicht zum Push — daran hat
sich nichts geaendert. Frueher gab es auf diesem Weg aber mehrere Commits, und jeder
brauchte seinen eigenen Lauf; bis zu vier bei `push main`. Jetzt entstehen erst alle
Dateien des Wegs, dann misst ein Lauf den fertigen Stand, dann traegt ein Commit ihn und
seinen Nachweis.

Dieser eine Lauf faehrt die **Push-Stufe**, und die faehrt den **vollen Umfang**: jede
faellige Pruefung, auch bei unberuehrten Bereichen und auch bei leerem Paket. Vor dem
Veroeffentlichen wird der Stand gemessen, der hinausgeht.

Der Lauf traegt trotzdem den **Batch-Anker** — `--since` mit dem `git merge-base` gegen
`origin/<mainBranch>`; die Kommandozeile steht im Skill. Nicht den ankerlosen Aufruf: Der
Anker entscheidet zwar nicht mehr, WAS laeuft, wohl aber, welchen Stand die
Zusammenfassung **bezeugt** — `basis`, `geaendert` und die Blob-Hashes, gegen die das
Commit-Gate den Index prueft. Ohne `--since` nimmt `planen` in `kit/checks.mjs` `HEAD` als
Basis, und der Nachweis spraeche dann ueber das letzte Stueck statt ueber den Batch. Der
Anker ist derselbe wie in `/local-check`: der letzte gepushte Stand, also genau der Batch,
der gleich hinausgeht.

`tools/sync-blobs.mjs` stempelt zusaetzlich die Kit-Version in die
`KIT_VERSION`-Konstante von `kit/board.mjs`, `kit/night.mjs`, `kit/checks.mjs`
und `kit/einstellungen.mjs`, bevor es die Blobs backt — dadurch kann man einer installierten Kopie ansehen, aus welchem Kit-Stand
sie stammt (`node .claude/kit/board.mjs --version`). Deshalb steht es als Schritt 2
in den Listen oben — vor dem Version-Commit, damit die gestempelten Kit-Dateien mit
hineingehen. `sync-blobs --check` ist ohnehin ein `buildCheck` dieses Repos und
schlaegt an, wenn der Stempel fehlt. `kit/einstellungen.mjs` ist Download, nicht
Installation: Sie wird gestempelt und bekommt das Schema eingebettet, aber nicht nach
`.claude/kit/` gespiegelt.

Wichtig: Der Version-Commit aus `merge production` loest **keinen** zusaetzlichen
Patch-Bump aus — er ist Teil des Release-Schritts, nicht ein separates `push main`.

`x` (Major) wird ausschliesslich auf explizite Ansage erhoeht.

### Frischer Checkout in der Push-Stufe

Die Push-Stufe prueft in diesem Repo zusaetzlich den **frischen Checkout**:
`node tools/frischer-checkout.mjs` ist ein `buildCheck` mit `stufe: "push"` und faehrt die
Suite in einem Worktree, der nur Versioniertes enthaelt, ohne die installierte Kopie unter
`.claude/` (Issue #1012, Plan #1035). Beim Abschluss eines Pakets und in der Merge-Stufe
laeuft die Pruefung nicht.

Ein **Fund** heisst: Ein Test haengt an etwas Unversioniertem. Entweder ist er im frischen
Checkout rot, oder er ist dort gruen und hat trotzdem eine Datei gesucht, die nur im
Arbeitsverzeichnis liegt (der stille Fall). Die Meldung nennt je Testdatei den fehlenden
Pfad. Ein Fund haelt den Push an wie jede andere rote Pflichtpruefung. So waere der Fall
vom 2026-09-04 (Issue #472) vor dem Push aufgefallen.

**Behoben wird ein Fund, indem der Test auf die Quelle umgestellt wird** (`kit/`,
`skills/`, `templates/`), nicht indem die Datei versioniert wird. Die installierte Kopie
bleibt unversioniert.

Ein Pfad kommt nur dann auf die Ausnahmeliste `AUSNAHMEN` in `tools/frischer-checkout.mjs`,
wenn er **bestimmungsgemaess optional** ist, also auch im Arbeitsverzeichnis fehlen darf
(etwa `.claude/workflow.config.local.json`), und zwar mit Grund. Eine echte Abhaengigkeit
wird so nie zum Schweigen gebracht.

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
