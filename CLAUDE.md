# claude-workflow-kit

Der Prozess steht in `.claude/CLAUDE-workflow.md`, Release und Versionierung in `RELEASING.md`.

## Quelle und installierte Kopie

Dieses Repo ist das Kit selbst. Es trägt jede Kit-Datei zweimal:

- **Quelle:** `kit/` (`board.mjs`, `night.mjs`, `checks.mjs`, `einstellungen.mjs`), `skills/`, `templates/`. Nur hier wird geändert.
- **Installierte Kopie:** `.claude/kit/`, `.claude/skills/`, `.claude/CLAUDE-*.md`. Damit arbeitet der Prozess, deshalb nennen Skills und Kommandos `node .claude/kit/…`. Die Kopie wird **nie** bearbeitet: `node tools/sync-blobs.mjs` frischt `.claude/kit/` und `.claude/skills/` aus der Quelle auf (die `CLAUDE-*.md` der Installer), sie ist nicht versioniert, und Claude Code weist Schreibzugriffe unter `.claude/` als geschützt ab.

Nennt ein Arbeitspaket eine Datei unter `kit/`, ist die Quelle gemeint, auch wenn ein Prüfkommando die Kopie unter `.claude/kit/` aufruft. Weist Claude Code einen Schreibzugriff unter `.claude/` ab, ist das ein Zeichen für die falsche Datei und kein Hindernis, das über die Shell umgangen wird.
