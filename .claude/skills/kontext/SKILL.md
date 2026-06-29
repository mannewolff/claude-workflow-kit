---
name: kontext
description: Schritt 0 des 9-Schritt-Prozesses — lädt den Memory-Vault und gibt einen kurzen Session-Start-Stand. Nutze diesen Skill wenn der Nutzer /kontext aufruft oder die Session mit dem Projektstand starten will.
user-invocable: true
---

# Kontext

Schritt 0: Session-Start. Vault laden, Projektstand holen, kurzen Überblick geben.

## Vorbedingung: Config-Modus bestimmen

Suche die Config in dieser Reihenfolge (erstes gefundenes gewinnt):
1. `.claude/kontext.config.json` im aktuellen Projektverzeichnis
2. `~/.claude/kontext.config.json` (global)

Daraus ergibt sich einer von drei Modi:

**Modus A (Vollmodus):** Config gefunden und `vault`-Feld gesetzt. Normaler Ablauf mit Vault, Projektnotiz, always-Dateien.

**Modus B (Degraded Mode):** Config gefunden aber kein `vault`-Feld, oder keine Config gefunden. Vault-Schritte überspringen. Nur offene Issues und projectDocs laden. Am Ende Hinweis ausgeben: "Kein Vault konfiguriert, arbeite ohne persistentes Memory."

Kein harter Abbruch. Beide Modi liefern sinnvollen Output.

## Ablauf

### 1. Config lesen

Felder aus `kontext.config.json` (alle optional):
- `vault`: absoluter Pfad zum Memory-Vault
- `always`: Array von Dateipfaden relativ zum `vault`-Root (immer lesen)
- `projectDocs`: Array von Pfaden oder Glob-Mustern relativ zum Projektverzeichnis. Fallback wenn nicht gesetzt: `["CLAUDE-*", ".claude/CLAUDE-*"]`

### 2. Vault-Dateien lesen (nur Modus A)

Lies alle Dateien aus `always` relativ zum `vault`-Pfad. Typisch: `Index.md` (Struktur + aktive Projekte) und `Profil.md` (Nutzerprofil).

### 3. Projektnotiz auto-detektieren (nur Modus A)

```bash
gh repo view --json name --jq '.name'
```

Ergebnis `{name}` → suche `{vault}/Projekte/{name}/{name}.md`. Wenn gefunden: lesen.

Wenn kein Repo oder kein Match: nur die `always`-Dateien zeigen, keinen Fehler werfen.

### 4. Projekt-spezifische Docs lesen (beide Modi)

Lies alle Dateien aus `projectDocs` relativ zum Projektverzeichnis. Einträge können konkrete Dateinamen oder Glob-Muster sein:

```bash
find . -maxdepth 1 -name "CLAUDE-*" -type f
```

Fehlende Dateien und Muster ohne Treffer leise überspringen (kein Fehler).

### 5. Offene Issues holen (beide Modi)

```bash
gh issue list --repo <owner>/<repo> --state open --json number,title,labels
```

Wenn kein GitHub-Repo erkennbar: Schritt überspringen.

### 6. Zusammenfassung ausgeben

Kompakter Session-Start-Stand:

```
## Session-Start — {Projektname}

### Aktive Issues
- #N Titel [Status]
- ...

### Letzte Entscheidungen / Zuletzt aktualisiert
(aus der Projektnotiz — nur Modus A)

### Was als nächstes kommt
(aus der Projektnotiz oder Board-Ready-Spalte)
```

Im Degraded Mode am Ende anfuegen:
> "Kein Vault konfiguriert, arbeite ohne persistentes Memory. Fuer Vollmodus: `~/.claude/kontext.config.json` anlegen mit vault-Pfad."

Keine vollstaendige Wiedergabe der Vault-Inhalte — nur was fuer den sofortigen Einstieg relevant ist.

## Was dieser Skill nicht tut

- Kein Schreiben in den Vault (das ist /document)
- Keine Code-Änderungen
- Kein eigenmächtiges Starten anderer Skills
