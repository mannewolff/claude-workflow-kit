---
name: kontext
description: Lädt den Memory-Vault und gibt einen kurzen Session-Start-Stand. Nutze diesen Skill wenn der Nutzer /kontext aufruft oder die Session mit dem Projektstand starten will.
user-invocable: true
---

# Kontext

Session-Start: Vault laden, Projektstand holen, kurzen Überblick geben. Werkzeug neben dem Prozess — nützlich zu Beginn jeder Session, aber der Prozess läuft auch ohne.

## Vorbedingung: Config-Modus bestimmen

Beide Configs werden gelesen und **feldweise gemergt**, lokale Felder gewinnen:
1. `~/.claude/kontext.config.json` (global) — die Basis
2. `.claude/kontext.config.json` im aktuellen Projektverzeichnis — überschreibt einzelne Felder

Kein "erstes gefundenes gewinnt": Eine lokale Config, die nur `project`/`parentProject` setzt, erbt `vault` und `always` von global. Bei "erstes gewinnt" wäre der Vault-Pfad verloren.

Daraus ergibt sich einer von zwei Modi:

**Modus A (Vollmodus):** Nach dem Merge ist `vault` gesetzt. Normaler Ablauf mit Vault, Projektnotizen, always-Dateien.

**Modus B (Degraded Mode):** Nach dem Merge kein `vault` (kein Feld gesetzt oder gar keine Config gefunden). Vault-Schritte überspringen. Nur offene Issues und projectDocs laden. Am Ende Hinweis ausgeben: "Kein Vault konfiguriert, arbeite ohne persistentes Memory."

Kein harter Abbruch. Beide Modi liefern sinnvollen Output.

## Ablauf

### 1. Config lesen

Felder aus `kontext.config.json` (alle optional):
- `vault`: absoluter Pfad zum Memory-Vault
- `always`: Array von Dateipfaden relativ zum `vault`-Root (immer lesen)
- `projectDocs`: Array von Pfaden oder Glob-Mustern relativ zum Projektverzeichnis. Fallback wenn nicht gesetzt: `["CLAUDE-*", ".claude/CLAUDE-*"]`
- `project`: Override für den Vault-Projektnamen (nur nötig wenn Repo-Name ≠ Vault-Ordnername)
- `parentProject`: Dach-Projekt im Multi-Repo-Setup. Gesetzt, wenn dieses Repo ein Service eines größeren Systems ist — dann liegen die Service-Notizen im Ordner des Dach-Projekts und die Dach-Notiz kommt dazu
- `logPath`: Muster für die Tageslog-Datei relativ zum `vault`-Root, Default `Log/{date}.md`. Nur `/document` schreibt dorthin

### 2. Vault-Dateien lesen (nur Modus A)

Lies alle Dateien aus `always` relativ zum `vault`-Pfad. Typisch: `Index.md` (Struktur + aktive Projekte) und `Profil.md` (Nutzerprofil).

### 3. Projektnotizen lesen (nur Modus A)

Der Skill baut keine Vault-Pfade selbst zusammen. Ein Aufruf liefert sie:

```bash
node .claude/kit/board.mjs kontext paths
```

Relevante Felder im JSON:
- `parentNote`: absolute Datei der Dach-Notiz — nur gesetzt wenn `parentProject` konfiguriert ist, sonst `null`
- `projectNote`: absolute Datei der Notiz dieses Repos
- `project`, `parentProject`: für die Kopfzeile in Schritt 6

Lesereihenfolge: **`parentNote` zuerst** (sofern nicht `null`), **`projectNote` danach**. Die gemeinsame Klammer bildet den Rahmen, in den der Service-Kontext gehört — umgekehrt gelesen steht die Service-Sicht ohne System-Kontext da.

Fehlt eine der beiden Dateien im Vault: leise überspringen, kein Fehler. Nur die `always`-Dateien zeigen reicht.

**Der Fallback gilt genau einem Fall: unbekannte Achse `kontext`** — ein Projekt mit älterer `board.mjs`. Dann auf das bisherige Verhalten zurückfallen statt abzubrechen: Projektname über `node .claude/kit/board.mjs code repo-name` (letztes Segment ohne `.git`, `project`-Feld aus der Config gewinnt), Projektnotiz `{vault}/Projekte/{name}/{name}.md`, keine Dach-Notiz. Ein Session-Start darf daran nicht scheitern.

**Jeder andere Fehler wird sichtbar gemeldet**, insbesondere eine mehrdeutige Notiz (zwei Dateien, die sich nur in der Groß-/Kleinschreibung unterscheiden) und ein nicht lesbarer Notizordner. Die Meldung des Kommandos unverändert ausgeben und keinen Pfad selbst konstruieren. Wer hier zurückfällt, verdeckt genau den Befund, den das Kommando gerade gemeldet hat (Issue #286).

### 4. Projekt-spezifische Docs lesen (beide Modi)

Lies alle Dateien aus `projectDocs` relativ zum Projektverzeichnis. Einträge können konkrete Dateinamen oder Glob-Muster sein:

```bash
find . -maxdepth 1 -name "CLAUDE-*" -type f
```

Fehlende Dateien und Muster ohne Treffer leise überspringen (kein Fehler).

### 5. Offene Issues holen (beide Modi)

Offene Issues, Vorhaben und Repo-Name ueber den Board-Adapter:

```bash
node .claude/kit/board.mjs issue list
node .claude/kit/board.mjs issue epics
node .claude/kit/board.mjs code repo-name
```

`issue list` liefert **nur Arbeitspakete** — Vorhaben sind dort seit Issue #377
ausgeschlossen, unabhaengig vom Status-Filter. Sie kommen ueber `issue epics`, und
zwar mit Kuerzel und Fortschritt.

**Ein Fehlschlag von `issue epics` wird still uebersprungen**, nicht gemeldet:
GitHub und GitLab kennen keine Vorhaben, der Adapter weist das Kommando dort ab.
Ein Fehler ist bei diesen Trackern der Normalfall und kein Befund — wer ihn
ausgibt, produziert bei jedem Session-Start in einem GitHub-Projekt eine Warnung
ueber eine Faehigkeit, die es dort nie geben wird.

Wenn der Adapter bei den uebrigen Aufrufen einen Fehler zurueckgibt: Schritt
ueberspringen, kein harter Abbruch.

### 6. Zusammenfassung ausgeben

Kompakter Session-Start-Stand.

**Ohne `parentProject`** (Ein-Repo-Fall, eine Projektebene):

```
## Session-Start — {Projektname}

### Vorhaben
- #N [KUERZEL] Titel — done/total
- ...
(aus `issue epics`; Abschnitt weglassen, wenn der Tracker keine kennt)

### Aktive Issues
- #N Titel [Status]
- ...

### Letzte Entscheidungen / Zuletzt aktualisiert
(aus der Projektnotiz — nur Modus A)

### Was als nächstes kommt
(aus der Projektnotiz oder Board-Ready-Spalte)
```

**Mit `parentProject`** (Multi-Repo-Setup): Der Kopf benennt beide Ebenen, damit sofort sichtbar ist, in welchem Service man sitzt und zu welchem System er gehört. Wurden beide Notizen gelesen, bleiben systemweiter Stand und Stand dieses Service getrennt — eine zusammengerührte Liste wäre beim Einstieg wertlos, weil nicht mehr erkennbar ist, was für alle Services gilt:

```
## Session-Start — {parentProject} / {project}

### Vorhaben
- #N [KUERZEL] Titel — done/total
- ...
(aus `issue epics`; Abschnitt weglassen, wenn der Tracker keine kennt)

### Aktive Issues
- #N Titel [Status]
- ...

### Systemweiter Stand ({parentProject})
(aus der Dach-Notiz — Abschnitt weglassen wenn sie fehlt)

### Stand {project}
(aus der Projektnotiz — letzte Entscheidungen / zuletzt aktualisiert)

### Was als nächstes kommt
(aus der Projektnotiz oder Board-Ready-Spalte)
```

**Die Vorhaben stehen vor den Issues**, weil sie die Gliederung sind, unter der die
Arbeit haengt: Wer zuerst die Klammern sieht, liest die Nummernliste darunter als
Inhalt und nicht als Haufen. Ein Vorhaben ohne Fortschritt (`0/0`) bleibt stehen —
dass es leer ist, ist beim Einstieg eine Information.

Im Degraded Mode am Ende anfuegen:
> "Kein Vault konfiguriert, arbeite ohne persistentes Memory. Fuer Vollmodus: `~/.claude/kontext.config.json` anlegen mit vault-Pfad."

Keine vollstaendige Wiedergabe der Vault-Inhalte — nur was fuer den sofortigen Einstieg relevant ist.

## Was dieser Skill nicht tut

- Kein Schreiben in den Vault (das ist /document)
- Keine Code-Änderungen
- Kein eigenmächtiges Starten anderer Skills
