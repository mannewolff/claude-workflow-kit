---
name: implement-ready
description: Schritt 5 des 9-Schritt-Prozesses — arbeitet alle Issues in der Ready-Spalte sequenziell nach Issue-Nummer ab, committet lokal, pusht nicht. Nutze diesen Skill wenn der Nutzer /implement-ready aufruft, Ready-Issues umsetzen will oder das GO zur Implementierung gibt.
user-invocable: true
---

# Implement Ready

Schritt 5 des 9-Schritt-Prozesses: Die KI arbeitet die Ready-Issues sequenziell ab. Jedes Issue wird vollständig umgesetzt, lokal committet und nach In review verschoben, bevor das nächste beginnt.

## Vorbedingung

Lies `.claude/workflow.config.json`. Relevantes Feld:
- `mainBranch`: Branch für lokale Commits (Default: `main`)

## Ablauf pro Issue (Reihenfolge: aufsteigend nach Issue-ID, wie vom Adapter geliefert)

### 0. Ready-Issues laden

```bash
node .claude/kit/board.mjs issue list --status ready
```

Gibt die Issues als JSON-Array, aufsteigend nach ID sortiert. Diese Reihenfolge ist verbindlich.

### 1. Issue nach In progress verschieben

```bash
node .claude/kit/board.mjs issue move <id> in_progress
```

### 2. Issue vollständig lesen

Lies alle vier Abschnitte des Issues. Implementiere **gegen das Issue**, nicht gegen den Chat. Was im Issue steht, wird gebaut. Was nicht drinsteht, bleibt draußen.

### 3. Implementieren

- TDD: Tests zuerst schreiben und rot laufen lassen, dann gegen die Tests implementieren, bis grün
- Bestehende Muster und Funktionen wiederverwenden
- Kein Feature, keine Refactoring, keine Abstraktion die das Issue nicht verlangt
- Bei UI-Änderungen: Dev-Server starten, Golden Path und Edge Cases durchklicken

Für eine granularere Variante mit explizitem Stopp zwischen rot und grün: `/implement-test` gefolgt von `/implement-done`.

### 4. Lokal committen (nicht pushen)

```bash
git add <geänderte Dateien>
git commit -m "Kurztitel (Issue #N)

Beschreibung der Änderungen und Begründung.

Refs #N

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

Nur explizit veränderte Dateien stagen — kein `git add -A` oder `git add .`.

**Kein `Closes`/`Fixes`/`Resolves #N` im Commit.** Diese Keywords schließen das Issue automatisch, sobald der Commit auf den Default-Branch gelangt (`push`/Merge), und die Board-Automation zieht geschlossene Issues sofort nach *Done* — noch bevor der Mensch testen konnte. `Refs #N` verlinkt das Issue, ohne es zu schließen. Das Schließen (→ Done) macht ausschließlich der Mensch nach seinem Test.

### 5. Issue nach In review verschieben + Abschlussbericht

```bash
node .claude/kit/board.mjs issue move <id> in_review
```

Abschlussbericht als Issue-Kommentar:

```bash
node .claude/kit/board.mjs issue comment <id> --text "## Abschlussbericht Issue #N
..."
```

Format des Abschlussberichts:

```
## Abschlussbericht Issue #N

### Änderungen
- `Datei.java` — kurze Beschreibung der Wirkung
- `DateiTest.java` — was getestet wird

### Tests und Checks
- <ausgeführtes Kommando> → <Ergebnis>

### Hinweise
- <verbleibende Risiken, offene Punkte, manuelle Folgeschritte>
```

### 6. Nächstes Issue

Sobald das Issue in In review liegt: naechste Issue-ID aus dem zuvor geladenen Ready-Array abarbeiten. Wenn Ready leer ist: Vollzug melden.

## Verhalten bei leerem Ready

> "Ready ist leer. Alle Issues in In review. Ich warte auf dein GO für den nächsten Batch."

Kein eigenmächtiges Ziehen aus Backlog. Kein Raten, welches Issue sinnvoll wäre.

## Stop-Punkte

- Pushen: nie ohne explizite Trigger-Phrase `push main`
- Backlog nach Ready ziehen: nie — das ist Mannes GO
- Issues auf Done setzen: nie — das macht der Mensch nach seinem Test
- Issue-schließende Commit-Keywords (`Closes`/`Fixes`/`Resolves #N`): nie — sie schließen das Issue beim Push/Merge und die Board-Automation zieht es nach Done, bevor getestet wurde. Nur `Refs #N` verwenden.
