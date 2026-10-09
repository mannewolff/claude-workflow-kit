# claude-workflow-kit

Der Prozess steht in `.claude/CLAUDE-workflow.md`, Release und Versionierung in `RELEASING.md`.

## Quelle und installierte Kopie

Dieses Repo ist das Kit selbst. Es trägt jede Kit-Datei zweimal:

- **Quelle:** `kit/` (`board.mjs`, `night.mjs`, `checks.mjs`, `einstellungen.mjs`, die Prüfrollen unter `kit/rollen/`), `skills/`, `agents/`, `templates/`. Nur hier wird geändert.
- **Installierte Kopie:** `.claude/kit/`, `.claude/skills/`, `.claude/agents/`, `.claude/CLAUDE-*.md`. Damit arbeitet der Prozess, deshalb nennen Skills und Kommandos `node .claude/kit/…`. Die Kopie wird **nie** bearbeitet: `node tools/sync-blobs.mjs` frischt `.claude/kit/`, `.claude/skills/` und `.claude/agents/` aus der Quelle auf (die `CLAUDE-*.md` der Installer), sie ist nicht versioniert, und Claude Code weist Schreibzugriffe unter `.claude/` als geschützt ab.

Nennt ein Arbeitspaket eine Datei unter `kit/`, ist die Quelle gemeint, auch wenn ein Prüfkommando die Kopie unter `.claude/kit/` aufruft. Weist Claude Code einen Schreibzugriff unter `.claude/` ab, ist das ein Zeichen für die falsche Datei und kein Hindernis, das über die Shell umgangen wird.

## Doku zweisprachig

Die Doku unter `docs/` erscheint auf docs.mwolff.org auf Deutsch und auf Englisch. Deutsch ist die Quelle: `docs/<name>.md`; die englische Fassung liegt unter `docs/en/<name>.md`. Jede Änderung unter `docs/` bringt die englische Fassung im selben Commit mit.

Unter jeder englischen Überschrift steht ein Stempel `<!-- de: <hash> -->`, die ersten 12 Hex-Zeichen von SHA-256 über den deutschen Abschnitt. Ändert sich der deutsche Abschnitt, passt der Stempel nicht mehr. `tools/sprachfassungen.mjs` prüft das:

- `node tools/sprachfassungen.mjs --check` vergleicht jedes Seitenpaar (Stempel, Überschriften, Codeblöcke, Tabellenzeilen) und nennt jede Abweichung mit Seite, Abschnitt und erwartetem Stempel. Es läuft über `test/docs-sprachfassungen.test.mjs` in jedem Prüflauf vor dem Commit und vor dem Build in `deploy-docs.yml`.
- `node tools/sprachfassungen.mjs --erwartet <seite>` gibt die Stempel aller Abschnitte einer deutschen Seite aus, zum Übertragen in die englische Fassung.

Solange `englischAktiv` in `docs-site/sprachen.json` auf `false` steht, darf eine englische Seite fehlen oder nur ein lückenloses Anfangsstück der deutschen sein, und VitePress baut nichts Englisches. Die Seiten unter `historisch` bleiben deutsch; ihre englische Fassung ist ein kurzer Hinweis mit Verweis auf das Original.
