# `kontext.config.json` — Referenz

Konfiguriert den `/kontext`-Skill (Session-Start) und den `/document`-Skill (Session-Ende). Beide lesen dieselbe Datei.

---

## Speicherorte

| Pfad | Zweck |
|------|-------|
| `~/.claude/kontext.config.json` | Global — gilt für alle Projekte |
| `.claude/kontext.config.json` | Projektlokal — überschreibt einzelne Felder der globalen Config |

Die lokale Config wird mit der globalen **feldweise gemergt, lokale Felder gewinnen**. Fehlende Felder erbt sie von global. Wenn keine Config gefunden wird, laufen `/kontext` und `/document` im Degraded Mode weiter (Issues per CLI, Log ins Projektverzeichnis).

Der Merge ist kein Detail, sondern die Voraussetzung für das Multi-Repo-Setup weiter unten: Die lokale Config setzt dort nur `parentProject` und `project` und erbt den Vault-Pfad von global. Bei „erstes gefundenes gewinnt" wäre der Vault verloren.

---

## Felder

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| `vault` | `string` | Absoluter Pfad zum Memory-Vault |
| `always` | `string[]` | Dateien relativ zum `vault`-Root, die immer gelesen werden |
| `projectDocs` | `string[]` | Dateien oder Glob-Muster relativ zum Projektverzeichnis |
| `project` | `string` | Optionaler Override für den Vault-Projektnamen (nur nötig wenn Repo-Name ≠ Vault-Ordnername) |
| `logPath` | `string` | Template für die Tageslog-Datei, relativ zum `vault`-Root. Platzhalter `{date}` und `{project}`. Default: `"Log/{date}.md"` |
| `parentProject` | `string` | Dach-Projekt über mehreren Service-Repos. Gesetzt nur im Multi-Repo-Setup, siehe unten |

---

## Glob-Muster in `projectDocs`

`projectDocs` unterstützt Glob-Muster. Der Skill expandiert sie per `find` im Projektverzeichnis:

```bash
find . -maxdepth 1 -name "CLAUDE-*" -type f
find .claude -maxdepth 1 -name "CLAUDE-*" -type f
```

Muster ohne Treffer werden leise übersprungen.

---

## Pfade prüfen, ohne einen Skill zu starten

Die Zielpfade berechnet der Board-Adapter, nicht der Skill-Prompt:

```bash
node .claude/kit/board.mjs kontext paths
```

```json
{
  "mode": "full",
  "vault": "/Users/mustermann/Nextcloud/ClaudeMemory",
  "project": "auth-service",
  "parentProject": "ShopSystem",
  "log": "/Users/mustermann/Nextcloud/ClaudeMemory/Log/2026-08-06-auth-service.md",
  "projectNote": "/Users/mustermann/Nextcloud/ClaudeMemory/Projekte/ShopSystem/auth-service.md",
  "parentNote": "/Users/mustermann/Nextcloud/ClaudeMemory/Projekte/ShopSystem/ShopSystem.md",
  "always": ["/Users/mustermann/Nextcloud/ClaudeMemory/Index.md"],
  "projectDocs": ["CLAUDE-*", ".claude/CLAUDE-*"]
}
```

Das ist der schnellste Weg, eine neue Config zu prüfen: Stimmen die Pfade hier, stimmen sie auch im Skill. `--project` und `--date` überschreiben Projektname und Tagesdatum.

Der Projektname wird ermittelt in der Reihenfolge `--project` → `project` aus der Config → Repo-Name → Verzeichnisname. Weicht der Repo-Name vom Vault-Ordnernamen ab (z.B. Repo `ebdc-react`, Vault-Notiz `Projekte/EBDC/EBDC.md`), das `project`-Feld in der lokalen Config setzen.

Ohne `vault` liefert das Kommando `"mode": "degraded"` und alle Vault-Pfade als `null` — kein Fehler, sondern der dokumentierte Modus ohne persistentes Memory.

Dazu kommt:

```bash
node .claude/kit/board.mjs kontext last-log
```

Es liefert den jüngsten vorhandenen Log-Eintrag **desselben Projekts** (`{"path": …, "date": …}`) oder `{"path": null}`, wenn es keinen gibt. `/document` nutzt es, um an den vorherigen Eintrag anzuknüpfen statt bei null anzufangen. Der heutige Eintrag ist ausgeschlossen, damit eine zweite Session am selben Tag nicht sich selbst liest.

---

## Multi-Repo-Projekte (Microservices)

Mehrere Repos, ein System: Sie sollen sich einen Vault teilen, damit das Wissen über die Servicegrenzen hinweg an einem Ort liegt. Ohne weitere Konfiguration schreiben dann aber alle Sessions eines Tages in dieselbe Log-Datei — in einem synchronisierten Vault gibt das Konflikt-Kopien, bei parallelen Sessions einen überschriebenen Abschnitt.

Die Lösung sind zwei Felder in der **lokalen** Config jedes Service-Repos:

```json
{
  "parentProject": "ShopSystem",
  "project": "auth-service",
  "logPath": "Log/{date}-{project}.md"
}
```

`vault`, `always` und `projectDocs` bleiben in der **globalen** Config. Sie hier zu wiederholen ist der naheliegende Fehler — der Merge erledigt das.

Daraus entsteht diese Vault-Struktur:

```
ClaudeMemory/
├── Index.md                      ← geteilt
├── Profil.md                     ← geteilt
├── Wissen/                       ← geteilt
├── Log/
│   ├── 2026-08-06-auth-service.md
│   ├── 2026-08-06-payment-service.md
│   └── 2026-08-06-order-service.md
└── Projekte/
    └── ShopSystem/
        ├── ShopSystem.md         ← Dach: Architektur, Verträge zwischen Services
        ├── auth-service.md
        ├── payment-service.md
        └── order-service.md
```

`/kontext` lädt im Multi-Repo-Fall **beide** Notizen: erst die Dach-Notiz als Rahmen, dann die des Service, in dem du gerade sitzt.

### Warum die Service-Kennung in den Dateinamen gehört

`Log/{date}-{project}.md` ist die empfohlene Form, nicht `Projekte/{project}/Log/{date}.md`. Der Grund ist die Leserichtung: Mit der Kennung im Dateinamen liegen alle Einträge eines Tages nebeneinander, und die chronologische Sicht über das ganze System bleibt erhalten. Ein Unterordner je Service zerlegt sie in fünf getrennte Zeitleisten. Beide Formen funktionieren — das Template kann jede.

### Eine Datei, ein Schreiber

Die Dach-Notiz ist der einzige Ort, an dem sich mehrere Repos begegnen, und deshalb schreibt `/document` sie **nie automatisch**. Nur wenn eine Session Cross-Service-Wirkung hatte (geteiltes Datenmodell, geänderter API-Vertrag, gemeinsame Infrastruktur), fragt der Skill einmal nach — mit dem konkreten Eintragstext — und schreibt erst nach Zustimmung.

Ohne diese Regel wäre die Konfliktfläche nur vom Log in die Notiz verschoben.

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

**Lokale Config** (ein Service von mehreren, siehe Multi-Repo oben):

```json
{
  "parentProject": "ShopSystem",
  "project": "auth-service",
  "logPath": "Log/{date}-{project}.md"
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
