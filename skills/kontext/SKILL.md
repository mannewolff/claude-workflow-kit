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

**Modus B (Degraded Mode):** Nach dem Merge kein `vault` (kein Feld gesetzt oder gar keine Config gefunden). Vault-Schritte überspringen. Nur Vorhaben und projectDocs laden. Am Ende Hinweis ausgeben: "Kein Vault konfiguriert, arbeite ohne persistentes Memory."

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
- `project`, `parentProject`: für die Kopfzeile in Schritt 7

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

### 5. Vorhaben holen (beide Modi)

Vorhaben und Repo-Name ueber den Board-Adapter:

```bash
node .claude/kit/board.mjs issue epics
node .claude/kit/board.mjs code repo-name
```

**Welche Vorhaben erscheinen.** Ein Vorhaben erscheint, wenn mindestens eines
seiner Arbeitspakete noch nicht erledigt ist (`done` kleiner als `total`).
Ausgeblendet wird damit beides: was alle seine Arbeitspakete erledigt hat und
was gar keine hat (`0/0`) — ein Vorhaben ohne Arbeitspakete ist nicht begonnen
worden und traegt den Einstieg nicht. Erfuellt kein Vorhaben die Regel,
entfaellt der Abschnitt `### Vorhaben` ganz.

**Ein Fehlschlag von `issue epics` wird still uebersprungen**, nicht gemeldet:
GitHub und GitLab kennen keine Vorhaben, der Adapter weist das Kommando dort ab.
Ein Fehler ist bei diesen Trackern der Normalfall und kein Befund — wer ihn
ausgibt, produziert bei jedem Session-Start in einem GitHub-Projekt eine Warnung
ueber eine Faehigkeit, die es dort nie geben wird.

Wenn der Adapter bei den uebrigen Aufrufen einen Fehler zurueckgibt: Schritt
ueberspringen, kein harter Abbruch.

### 6. Zustand des Spec-Index prüfen (beide Modi)

Lies `.claude/workflow.config.json` im Projektverzeichnis. Trägt sie einen Top-Level-Block `spec`, wird geprüft, ob `specs/INDEX.md` fehlt oder veraltet ist; trifft eines zu, erscheint in Schritt 7 die Hinweiszeile, sonst nichts. Der Inhalt des Index wird nicht gelesen.

**Das ist die Workflow-Config, nicht `kontext.config.json`.** Dieser Skill liest sonst ausschließlich seine eigene Config; der Schalter für Spec-Driven Development wohnt aber in der Workflow-Config, die alle anderen Skills lesen. Gemergt wird nichts: Es zählt allein, ob der Block im Projektverzeichnis vorhanden ist.

**Veralteten Index erkennen.** Veraltet ist der Index, wenn eine Bereichsdatei jünger ist als `specs/INDEX.md`. Gemessen wird mit:

```bash
find specs -type f -name '*.md' -not -path 'specs/vorhaben/*' -not -name INDEX.md -newer specs/INDEX.md
```

Nicht leere Ausgabe heißt veraltet. Ein still falscher Index ist schlechter als keiner — deshalb ist diese Meldung der wichtigere Teil des Schritts. Sie nennt nur ein Kommando; ausgeführt wird es hier nicht.

**`specs/vorhaben/` zählt nicht mit.** Die Notizen dort entstehen weiterhin beim Planen — `/techplan` legt sie als wartende Datei unter `.claude/` ab, und der nächste `push main` hebt sie nach `specs/vorhaben/` auf. Sie stehen nicht im Index; ohne die Ausnahme meldete `/kontext` nach jedem Push mit einer aufgehobenen Notiz einen Index als veraltet, der stimmt. Ein Fehlalarm nach `git pull` bleibt möglich (alle Dateien bekommen den Checkout-Zeitpunkt) und ist hinnehmbar: Die Meldung schlägt ein Kommando vor und hält nichts auf.

**Fehlt nur die Index-Datei** — Block gesetzt, `specs/` vorhanden, `specs/INDEX.md` nicht —, gilt dasselbe wie beim veralteten Index: In Schritt 7 erscheint die Hinweiszeile.

Fehlt dagegen die Config, der `spec`-Block oder der Ordner `specs/`, entfällt der Schritt **leise**, wie die übrigen optionalen Schritte — nichts wird gemeldet, und in Schritt 7 steht dazu keine Zeile.

### 7. Zusammenfassung ausgeben

Kompakter Session-Start-Stand.

**Ohne `parentProject`** (Ein-Repo-Fall, eine Projektebene):

```
## Session-Start — {Projektname}

### Vorhaben
- #N [KUERZEL] Titel — done/total
- ...
(aus `issue epics`; Abschnitt weglassen, wenn der Tracker keine kennt)

> Index veraltet — neu bauen mit: node .claude/kit/spec.mjs index
(nur wenn `specs/INDEX.md` fehlt oder veraltet ist; sonst steht hier nichts)

### Letzte Entscheidungen / Zuletzt aktualisiert
(aus der Projektnotiz — nur Modus A; nur der jüngste dokumentierte Tag)

### Was als nächstes kommt
(aus der Projektnotiz)
```

**Mit `parentProject`** (Multi-Repo-Setup): Der Kopf benennt beide Ebenen, damit sofort sichtbar ist, in welchem Service man sitzt und zu welchem System er gehört. Wurden beide Notizen gelesen, bleiben systemweiter Stand und Stand dieses Service getrennt — eine zusammengerührte Liste wäre beim Einstieg wertlos, weil nicht mehr erkennbar ist, was für alle Services gilt:

```
## Session-Start — {parentProject} / {project}

### Vorhaben
- #N [KUERZEL] Titel — done/total
- ...
(aus `issue epics`; Abschnitt weglassen, wenn der Tracker keine kennt)

> Index veraltet — neu bauen mit: node .claude/kit/spec.mjs index
(nur wenn `specs/INDEX.md` fehlt oder veraltet ist; sonst steht hier nichts)

### Systemweiter Stand ({parentProject})
(aus der Dach-Notiz — Abschnitt weglassen wenn sie fehlt)

### Stand {project}
(aus der Projektnotiz — letzte Entscheidungen / zuletzt aktualisiert; nur der jüngste dokumentierte Tag)

### Was als nächstes kommt
(aus der Projektnotiz)
```

**Nur der jüngste dokumentierte Tag.** Unter den letzten Entscheidungen steht, was am jüngsten in der Notiz dokumentierten Tag festgehalten wurde — auch dann, wenn dieser Tag keine Entscheidung enthält.
- Maßgeblich sind ausschließlich Datumsangaben der Form `JJJJ-MM-TT`, die einen Eintrag einleiten, gesucht in der ganzen Notiz und nicht nur im ersten `## Zuletzt aktualisiert`-Abschnitt. Eine Notiz kann mehrere solcher Abschnitte tragen.
- Ein Datum leitet einen Eintrag ein, wenn es am Zeilenanfang steht, allenfalls nach einem Listenpunkt, und ihm ein `:` oder ein Klammerzusatz folgt — die Form, in der `/document` schreibt: `- JJJJ-MM-TT: …` oder `- JJJJ-MM-TT (Abend): …`.
- Datumsnennungen im Fließtext eines Eintrags zählen nicht, ebenso wenig ein Datum in anderer Form wie `**Stand JJJJ-MM-TT**`.
- Gehören mehrere Einträge zum jüngsten Tag, gehören sie alle dazu; ein Zusatz wie „(Abend)" ist eine Tageszeit, kein anderer Tag.
- Trägt die Notiz keine Datumsangabe, die einen Eintrag einleitet, erscheint ihr zuletzt geschriebener Abschnitt so, wie er dasteht — die Verdichtungsregel gilt für diesen Rückfall nicht.
- Werden zwei Notizen gelesen, wird der Tag je Notiz getrennt bestimmt.

**Die Vorhaben stehen oben**, weil sie die Gliederung sind, unter der die Arbeit
haengt: Wer sie zuerst sieht, hat den Rahmen, in den alles Weitere gehoert. Die
einzelnen Arbeitspakete stehen auf dem Board und werden hier nicht wiederholt —
was der Session-Start ausgibt, steht danach im Kontextfenster der ganzen Sitzung
und fehlt dort fuer die eigentliche Arbeit.

Im Degraded Mode am Ende anfuegen:
> "Kein Vault konfiguriert, arbeite ohne persistentes Memory. Fuer Vollmodus: `~/.claude/kontext.config.json` anlegen mit vault-Pfad."

Keine vollstaendige Wiedergabe der Vault-Inhalte — nur was fuer den sofortigen Einstieg relevant ist.

## Was dieser Skill nicht tut

- Kein Schreiben in den Vault (das ist /document)
- Keine Code-Änderungen
- Kein eigenmächtiges Starten anderer Skills
