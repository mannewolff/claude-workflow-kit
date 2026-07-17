---
name: implement-done
description: Granulare Einsteiger-Variante von Schritt 5 (Teil 2) — implementiert gegen die von /implement-test vorbereiteten roten Tests, bis sie gruen sind, committet und verschiebt nach In review. Nutze diesen Skill wenn der Nutzer /implement-done aufruft oder nach /implement-test die Implementierung gegen die roten Tests fortsetzen will.
user-invocable: true
---

# Implement Done

Granulare Variante von Schritt 5 (Teil 2 von 2): gegen die von `/implement-test` geschriebenen, roten Tests implementieren, bis sie grün sind, committen, nach In review verschieben.

## Vorbedingung

### 0. Issue in In progress finden

```bash
node .claude/kit/board.mjs issue list --status in_progress
```

- Kein Issue dort: stoppen.
  > "Kein Issue in In progress. Erst `/implement-test` starten, um Tests für ein Issue zu schreiben."
- Mehr als ein Issue dort: stoppen, auflisten, Nutzer um Auswahl bitten. Nicht raten, welches gemeint ist.
- Genau ein Issue dort: das ist das aktuelle Issue.

## Ablauf

### 1. Issue vollständig lesen

Lies alle vier Abschnitte erneut. Das Akzeptanzkriterium ist der Maßstab für die Implementierung, nicht die bereits vorhandenen Tests allein.

### 2. Gegen die Tests implementieren

- Implementieren, bis die von `/implement-test` geschriebenen Tests grün sind.
- Testcode nicht anfassen — außer er ist nachweislich falsch formuliert (widerspricht dem Akzeptanzkriterium, testet das Falsche). Dann Rücksprache mit dem Menschen statt stillschweigender Änderung.
- Bestehende Muster und Funktionen wiederverwenden. Kein Feature, keine Refactoring, keine Abstraktion, die das Issue nicht verlangt.

### 3. Lokal committen (nicht pushen)

Gleiches Format wie `implement-ready` Schritt 4 — Tests und Implementierung zusammen in einem Commit:

```bash
git add <geänderte Dateien>
git commit -m "Kurztitel (Issue #N)

Beschreibung der Änderungen und Begründung.

Refs #N

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

Nur explizit veränderte Dateien stagen — kein `git add -A` oder `git add .`.

**Kein `Closes`/`Fixes`/`Resolves #N` im Commit.** Diese Keywords schließen das Issue automatisch beim Push/Merge, und die Board-Automation zieht es dann sofort nach Done — noch bevor der Mensch getestet hat. `Refs #N` verlinkt, ohne zu schließen. Das Schließen macht ausschließlich der Mensch.

### 4. Issue nach In review verschieben + Abschlussbericht

```bash
node .claude/kit/board.mjs issue move <id> in_review
```

Abschlussbericht als Issue-Kommentar, gleiches Format wie `implement-ready` Schritt 5:

```bash
node .claude/kit/board.mjs issue comment <id> --text "## Abschlussbericht Issue #N
..."
```

```
## Abschlussbericht Issue #N

### Änderungen
- `Datei.java` — kurze Beschreibung der Wirkung
- `DateiTest.java` — was getestet wird (von /implement-test vorbereitet)

### Tests und Checks
- <ausgeführtes Kommando> → <Ergebnis>

### Hinweise
- <verbleibende Risiken, offene Punkte, manuelle Folgeschritte>
```

## Stop-Punkte

- Pushen: nie ohne explizite Trigger-Phrase `push main`
- Backlog nach Ready ziehen: nie — das ist Mannes GO
- Issues auf Done setzen: nie — das macht der Mensch nach seinem Test
- Issue-schließende Commit-Keywords (`Closes`/`Fixes`/`Resolves #N`): nie — nur `Refs #N`
- Testcode stillschweigend ändern: nie — bei Zweifel Rücksprache statt eigenmächtiger Korrektur
