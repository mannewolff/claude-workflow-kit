---
name: implement-ready
description: Schritt 5 des 9-Schritt-Prozesses — arbeitet alle Issues in der Ready-Spalte sequenziell nach Issue-Nummer ab, committet lokal, pusht nicht. Nutze diesen Skill wenn der Nutzer /implement-ready aufruft, Ready-Issues umsetzen will oder das GO zur Implementierung gibt.
user-invocable: true
---

# Implement Ready

Schritt 5 des 9-Schritt-Prozesses: Die KI arbeitet die Ready-Issues sequenziell ab. Jedes Issue wird vollständig umgesetzt, lokal committet und nach In review verschoben, bevor das nächste beginnt.

## Vorbedingung

Lies `.claude/workflow.config.json`. Relevante Felder:
- `mainBranch`: Branch für lokale Commits (Default: `main`)

## Ablauf pro Issue (Reihenfolge: aufsteigend nach Issue-Nummer)

### 1. Issue nach In progress verschieben

```bash
gh project item-edit --id <ITEM-ID> --project-id <PROJECT-ID> \
  --field-id <STATUS-FIELD-ID> --single-select-option-id <IN-PROGRESS-OPTION-ID>
```

Alternativ per Label, wenn kein Board vorhanden:
```bash
gh issue edit <NR> --add-label "in-progress" --repo <owner>/<repo>
```

### 2. Issue vollständig lesen

Lies alle vier Abschnitte des Issues. Implementiere **gegen das Issue**, nicht gegen den Chat. Was im Issue steht, wird gebaut. Was nicht drinsteht, bleibt draußen.

### 3. Implementieren

- Code schreiben, Tests schreiben (TDD: erst Test, dann Code)
- Bestehende Muster und Funktionen wiederverwenden
- Kein Feature, keine Refactoring, keine Abstraktion die das Issue nicht verlangt
- Bei UI-Änderungen: Dev-Server starten, Golden Path und Edge Cases durchklicken

### 4. Lokal committen (nicht pushen)

```bash
git add <geänderte Dateien>
git commit -m "Kurztitel (Issue #N)

Beschreibung der Änderungen und Begründung.

Closes #N

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

Nur explizit veränderte Dateien stagen — kein `git add -A` oder `git add .`.

### 5. Issue nach In review verschieben + Abschlussbericht

Board-Status:
```bash
gh project item-edit --id <ITEM-ID> ... --single-select-option-id <IN-REVIEW-OPTION-ID>
```

Abschlussbericht als Issue-Kommentar im Format:

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

Sobald das Issue in In review liegt: nächste Issue-Nummer aus Ready abarbeiten. Wenn Ready leer ist: Vollzug melden.

## Verhalten bei leerem Ready

> "Ready ist leer. Alle Issues in In review. Ich warte auf dein GO für den nächsten Batch."

Kein eigenmächtiges Ziehen aus Backlog. Kein Raten, welches Issue sinnvoll wäre.

## Stop-Punkte

- Pushen: nie ohne explizite Trigger-Phrase `push main`
- Backlog nach Ready ziehen: nie — das ist Mannes GO
- Issues auf Done setzen: nie — das macht der Mensch nach seinem Test
