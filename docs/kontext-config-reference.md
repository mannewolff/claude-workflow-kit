# `kontext.config.json` — Referenz

Konfiguriert den `/kontext`-Skill (Session-Start) und den `/document`-Skill (Session-Ende). Beide lesen dieselbe Datei.

---

## Speicherorte

| Pfad | Zweck |
|------|-------|
| `~/.claude/kontext.config.json` | Global — gilt für alle Projekte |
| `.claude/kontext.config.json` | Projektlokal — überschreibt einzelne Felder der globalen Config |

Die lokale Config wird mit der globalen gemergt. Fehlende Felder erbt sie von global. Wenn keine Config gefunden wird, laufen `/kontext` und `/document` im Degraded Mode weiter (Issues per CLI, Log ins Projektverzeichnis).

---

## Felder

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| `vault` | `string` | Absoluter Pfad zum Memory-Vault |
| `always` | `string[]` | Dateien relativ zum `vault`-Root, die immer gelesen werden |
| `projectDocs` | `string[]` | Dateien oder Glob-Muster relativ zum Projektverzeichnis |
| `project` | `string` | Optionaler Override für den Vault-Projektnamen (nur nötig wenn Repo-Name ≠ Vault-Ordnername) |

---

## Glob-Muster in `projectDocs`

`projectDocs` unterstützt Glob-Muster. Der Skill expandiert sie per `find` im Projektverzeichnis:

```bash
find . -maxdepth 1 -name "CLAUDE-*" -type f
find .claude -maxdepth 1 -name "CLAUDE-*" -type f
```

Muster ohne Treffer werden leise übersprungen.

---

## Projektnotiz auto-detektieren

Der Skill ermittelt die aktive Projektnotiz automatisch:

```bash
node .claude/kit/board.mjs code repo-name
```

Gibt `{ "repoName": "owner/repo" }` zurück. Das letzte Segment wird als Projektname genutzt, sucht `{vault}/Projekte/{name}/{name}.md`.

Wenn Repo-Name und Vault-Ordnername nicht übereinstimmen (z.B. Repo `ebdc-react`, Vault-Notiz `Projekte/EBDC/EBDC.md`), `project`-Feld in der lokalen Config setzen.

---

## Installer

Der Installer (`install.mjs`) legt die globale Config automatisch an, wenn bei der Installation ein Vault-Pfad angegeben wird:

```
Pfad zum Memory-Vault für /kontext (leer = überspringen): /Users/mustermann/Nextcloud/ClaudeMemory
```

Ergebnis in `~/.claude/kontext.config.json`:

```json
{
  "vault": "/Users/mustermann/Nextcloud/ClaudeMemory",
  "always": ["Index.md", "Profil.md"],
  "projectDocs": ["CLAUDE-*", ".claude/CLAUDE-*"]
}
```

Die lokale `.claude/kontext.config.json` muss manuell angelegt werden (nur bei Bedarf).

---

## Beispiele

**Globale Config** (einmal anlegen, gilt überall):

```json
{
  "vault": "/Users/manfredwolff/Nextcloud/ClaudeMemory",
  "always": ["Index.md", "Profil.md"],
  "projectDocs": ["CLAUDE-*", ".claude/CLAUDE-*"]
}
```

**Lokale Config** (nur wenn Repo-Name ≠ Vault-Projektname):

```json
{
  "project": "EBDC"
}
```

**Lokale Config** (komplett eigenständig, ohne globale Config):

```json
{
  "vault": "/Users/mustermann/Nextcloud/ClaudeMemory",
  "always": ["Index.md", "Profil.md"],
  "projectDocs": ["CLAUDE-*", ".claude/CLAUDE-*"],
  "project": "MeinProjekt"
}
```
