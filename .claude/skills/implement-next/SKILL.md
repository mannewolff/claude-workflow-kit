---
name: implement-next
description: Single-Issue-Variante von Schritt 5 — arbeitet genau das oberste Ready-Issue ab (Board-Reihenfolge), committet lokal, pusht nicht und endet danach. Nutze diesen Skill wenn der Nutzer /implement-next aufruft oder genau ein Ready-Issue umgesetzt werden soll (z. B. pro Session im Nachtbetrieb).
user-invocable: true
---

# Implement Next

Single-Issue-Variante von Schritt 5 des 9-Schritt-Prozesses: Genau das **oberste** Ready-Issue wird vollständig umgesetzt, lokal committet und nach In review verschoben — danach endet der Skill. Kernbaustein des Nachtbetriebs (der Nacht-Runner startet pro Issue eine frische Session mit diesem Skill), interaktiv genauso nutzbar („mach genau eins").

## Vorbedingung

Lies `.claude/workflow.config.json`. Relevantes Feld:
- `mainBranch`: Branch für lokale Commits (Default: `main`)

## Ablauf (genau ein Issue)

### 0. Oberstes Ready-Issue holen

```bash
node .claude/kit/board.mjs issue list --status ready
```

Gibt die Issues in der Reihenfolge der Ready-Spalte des Boards (oben zuerst; nur der lokale Datei-Tracker liefert numerisch nach ID). Das **erste** Element ist das Issue dieses Laufs — nicht numerisch umsortieren, keine eigene Auswahl treffen.

**Fachliche Issues überspringen (Leitplanke):** Trägt das oberste Issue das Titel-Präfix `[Fachlich]` (PO-Schleife), wird es **nicht implementiert** — es mit diesem Kommentar zurück nach Backlog verschieben und mit dem nächsten Ready-Issue fortfahren (bzw. ohne Fehler enden, wenn keines bleibt):

```
Fachliches Issue — wird nicht implementiert, bitte per /plan #N in technische Issues ueberfuehren.
```

Wenn Ready leer ist:

> "Ready ist leer. Nichts zu tun."

Ohne Fehler enden.

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
- Bei neuer oder geänderter Logik: abgedeckt oder begründet ausgeschlossen gemäß der Coverage-/Qualitäts-Policy des Projekts (siehe Projekt-Guide bzw. `workflow.config.json`). Untestete Logik nie stillschweigend ausschließen, Schwellen nie senken, nur damit ein Gate grün wird.
- Wiederkehrende, klassenweite Modell-Fehler (veraltete Idiome, abgekündigte APIs) nicht nur an den Fundstellen fixen: als harte Lint-/Compiler-Leitplanke für die `buildChecks` vorschlagen, aus vorhandenen Annotationen abgeleitet (z. B. `@typescript-eslint/no-deprecated`, Java `-Xlint:deprecation` mit `-Werror`, Linter-`recommended`-Sets) statt als handgepflegte Verbotsliste oder Bitte in einer CLAUDE-`*`.md — siehe das Leitplanken-Prinzip im `local-check`-Skill.

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

Abschlussbericht **direkt** als Issue-Kommentar posten — kein Zwischenschritt über eine Wrapper- oder Temp-Datei:

```bash
node .claude/kit/board.mjs issue comment <id> --text "## Abschlussbericht Issue #N
..."
```

**Working Tree sauber hinterlassen (Nachtbetrieb-Leitplanke).** Am Ende der Session enthält der Working Tree ausschließlich committete Änderungen. Lege für den Abschlussbericht keine Hilfsdateien an (kein `.tmp-report.md`, kein Node-Wrapper zum Posten) — der `issue comment --text`-Aufruf oben genügt. Waren ausnahmsweise Hilfsdateien nötig, lösche sie vor Session-Ende. Der Nacht-Runner stoppt hart, wenn eine erfolgreiche Runde unkommittete Reste hinterlässt (siehe `kit/night.mjs`, Issue #152).

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

### 6. Ende

Nach dem Abschlussbericht endet der Skill — **kein weiteres Issue**, auch wenn Ready noch gefüllt ist. Die nächste Runde startet der Mensch (erneut `/implement-next` oder `/implement-ready` für den Rest) bzw. im Nachtbetrieb der Nacht-Runner mit einer frischen Session.

## Stop-Punkte

- Fachliche Issues (`[Fachlich]`-Titel) implementieren: nie — kommentiert zurück nach Backlog
- Pushen: nie ohne explizite Trigger-Phrase `push main`
- Backlog nach Ready ziehen: nie — das ist Mannes GO
- Issues auf Done setzen: nie — das macht der Mensch nach seinem Test
- Issue-schließende Commit-Keywords (`Closes`/`Fixes`/`Resolves #N`): nie — sie schließen das Issue beim Push/Merge und die Board-Automation zieht es nach Done, bevor getestet wurde. Nur `Refs #N` verwenden.
- Mehr als ein Issue abarbeiten: nie — dafür ist `/implement-ready` da.
