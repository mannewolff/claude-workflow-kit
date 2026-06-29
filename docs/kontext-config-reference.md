# `kontext.config.json` — Referenz

Konfiguriert den `/kontext`-Skill (Session-Start) und den `/document`-Skill (Session-Ende). Beide lesen dieselbe Datei.

---

## Speicherorte

| Pfad | Zweck |
|------|-------|
| `~/.claude/kontext.config.json` | Global — gilt für alle Projekte |
| `.claude/kontext.config.json` | Projektlokal — überschreibt einzelne Felder der globalen Config |

Die lokale Config wird mit der globalen gemergt. Fehlende Felder erbt sie von global. Wenn keine Config gefunden wird oder `vault` fehlt, laufen /kontext und /document im Degraded Mode (kein Abbruch, eingeschraenkter Output).

---

## Felder

| Feld | Typ | Pflicht | Beschreibung |
|------|-----|---------|--------------|
| `vault` | `string` | optional | Absoluter Pfad zum Memory-Vault. Ohne dieses Feld laufen /kontext und /document im Degraded Mode. |
| `always` | `string[]` | optional | Dateien relativ zum `vault`-Root, die immer gelesen werden |
| `projectDocs` | `string[]` | optional | Dateien oder Glob-Muster relativ zum Projektverzeichnis. Fallback: `["CLAUDE-*", ".claude/CLAUDE-*"]` |
| `project` | `string` | optional | Override fuer den Vault-Projektnamen (nur noetig wenn Repo-Name und Vault-Ordnername abweichen) |

---

## Glob-Muster in `projectDocs`

`projectDocs` unterstützt Glob-Muster. Der Skill expandiert sie per `find` im Projektverzeichnis:

```bash
find . -maxdepth 1 -name "CLAUDE-*" -type f
find .claude -maxdepth 1 -name "CLAUDE-*" -type f
```

Muster ohne Treffer werden leise übersprungen.

---

## Was passiert ohne Vault

Wenn `vault` nicht gesetzt ist oder keine Config gefunden wird, laufen beide Skills weiter:

- `/kontext` laedt offene Issues per `gh issue list` und liest `projectDocs`. Am Ende: "Kein Vault konfiguriert, arbeite ohne persistentes Memory."
- `/document` schreibt den Tageslog in `docs/session-log/YYYY-MM-DD.md` im Projektverzeichnis. Am Ende: "Kein Vault konfiguriert. Log ins Projektverzeichnis geschrieben."

Kein Fehler, kein Abbruch. Fuer persistentes Memory ueber Projekte hinweg: `vault`-Pfad eintragen.

---

## Projektnotiz auto-detektieren

Der Skill ermittelt die aktive Projektnotiz automatisch:

```bash
gh repo view --json name --jq '.name'
```

Ergebnis `{name}` → sucht `{vault}/Projekte/{name}/{name}.md`.

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
  "vault": "/pfad/zu/deinem/vault",
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
