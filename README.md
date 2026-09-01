# claude-workflow-kit

Eine Bibliothek aus Claude-Code-Skills, die den 9-Schritt-Prozess zur KI-gestuetzten Softwareentwicklung ausfuehrbar macht. Claude plant, schreibt Issues, implementiert und bereitet das Review vor — drei Schritte bleiben bewusst menschlich: das GO, der Push und der Merge.

GitHub, GitLab und ein vollstaendig lokaler Modus werden unterstuetzt — lokal liegen die Issues als Markdown-Dateien im Repo.

## Installation

Voraussetzungen: [Claude Code](https://claude.ai/code), Node.js 18+, `gh` CLI (GitHub) oder `glab` CLI (GitLab).

```bash
node install.mjs
```

Oder direkt aus GitHub:

```bash
npx github:mannewolff/claude-workflow-kit
```

## An diesem Repo mitarbeiten

Nach einem frischen Klon fehlen `.claude/skills/` und die `CLAUDE*.md`-Dateien — sie stehen bewusst nicht im Repo. Alles, was `install.mjs` schreibt, ist Generat: Der Installer ueberschreibt es beim naechsten Lauf ohnehin, und wer klont, soll selbst entscheiden, ob er installiert.

Der erste Schritt nach dem Klonen ist deshalb:

```bash
node install.mjs
```

Erst danach stehen `/kontext`, `/plan`, `/issues` und die uebrigen Skills in Claude Code zur Verfuegung.

Zum Entwickeln kommt ein zweiter Schritt dazu:

```bash
npm ci
```

Damit steht ESLint bereit — einer der Pflicht-Checks aus `buildChecks` ist
`npx eslint kit tools test install.mjs`, und ohne `node_modules` liefe er aus dem
falschen Grund rot. **Die ausgelieferten Werkzeuge selbst bleiben
abhaengigkeitsfrei:** `install.mjs`, `kit/` und `tools/` laufen mit blossem Node,
die Abhaengigkeiten sind reine `devDependencies` (Issue #399).

Gepflegt wird immer die **Quelle**, nie die Kopie unter `.claude/`:

| Quelle im Repo | Kopie beim Nutzer |
|---|---|
| `skills/<name>/SKILL.md` | `.claude/skills/<name>/SKILL.md` |
| `templates/CLAUDE-workflow.md` | `.claude/CLAUDE-workflow.md` |
| `templates/CLAUDE-Fachplan.md` | `.claude/CLAUDE-Fachplan.md` |
| `templates/CLAUDE-Plan.md` | `.claude/CLAUDE-Plan.md` |
| `kit/board.mjs`, `kit/night.mjs` | `.claude/kit/` |

Nach jeder Aenderung an einer Quelle muessen die eingebetteten Blobs in `install.mjs` neu gebacken werden:

```bash
node tools/sync-blobs.mjs
```

`node tools/sync-blobs.mjs --check` ist ein Pflicht-Check und geht rot, wenn das jemand vergisst.

Zwei Dateien unter `.claude/` liegen trotzdem im Repo, beide aus einem eigenen Grund: `workflow.config.json` wird vom Installer **gemergt** statt ueberschrieben und ist Team-Einstellung; `launch.json` legt er gar nicht erst an.

## Bereichsbezogene Pruefungen

Ein `buildChecks`-Eintrag kann sagen, fuer welche Bereiche des Projekts er zustaendig ist (`areas`), und der Block `checkAreas` ordnet diesen Bereichen Pfadmuster zu. Dann laeuft eine Pruefung nur, wenn ihr Bereich beruehrt wurde; im Zweifel laeuft alles, und ohne `checkAreas` aendert sich nichts. Die Formen, die beiden Pruef-Anker und die Zweifelsregel stehen im Kapitel „Bereichsbezogene Pruefungen" in [`docs/dokumentation.md`](docs/dokumentation.md) — hier bewusst kein zweiter vollstaendiger Text, zwei Orte fuer dieselbe Aussage driften auseinander.

## Dokumentation

Ausfuehrliche Anleitung, Konfigurationsreferenz und den vollstaendigen 9-Schritt-Prozess findest du hier:

**[docs.mwolff.org](https://docs.mwolff.org)**
