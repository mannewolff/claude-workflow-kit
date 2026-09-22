---
name: implement-done
description: Ersetzt Schritt 5 durch eine feinere Gangart (Teil 2 von 2) — implementiert gegen die von /implement-test vorbereiteten roten Tests, bis sie gruen sind, committet und verschiebt nach In review. Nutze diesen Skill wenn der Nutzer /implement-done aufruft oder nach /implement-test die Implementierung gegen die roten Tests fortsetzen will.
user-invocable: true
---

# Implement Done

Ersetzt Schritt 5 durch eine feinere Gangart (Teil 2 von 2): gegen die von `/implement-test` geschriebenen, roten Tests implementieren, bis sie grün sind, committen, nach In review verschieben.

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

Lies alle Abschnitte des Issues erneut. Das Akzeptanzkriterium ist der Maßstab für die Implementierung, nicht die bereits vorhandenen Tests allein.

### 2. Gegen die Tests implementieren

- Implementieren, bis die von `/implement-test` geschriebenen Tests grün sind.
- Testcode nicht anfassen — außer er ist nachweislich falsch formuliert (widerspricht dem Akzeptanzkriterium, testet das Falsche). Dann Rücksprache mit dem Menschen statt stillschweigender Änderung.
- Bestehende Muster und Funktionen wiederverwenden. Kein Feature, keine Refactoring, keine Abstraktion, die das Issue nicht verlangt.

**Nur die Tests des Pakets laufen lassen.** Die volle Suite ist der teuerste Einzelposten einer Session — sie mehrfach zu starten, kostet Minuten und bringt nichts dazu:

1. Während der Arbeit laufen nur die Tests, die das Paket berührt — gezielt per Datei oder Filter des Test-Runners, zum Beispiel `node --test test/<datei>.test.mjs`.
2. Die volle Suite startet die Session nicht selbst. Der eine volle Lauf ist `node .claude/kit/checks.mjs run` vor dem Commit.
3. Wer die Ausgabe eines langen Laufs mehrfach auswerten will, schreibt sie einmal in eine Datei außerhalb des Projektverzeichnisses (`<tmpdir>/…`, den Pfad wörtlich wie in der Transportregel) und liest sie daraus. Ein zweiter Lauf nur für einen anderen Filter entfällt.
4. Ist `checks.mjs run` rot, laufen danach zuerst die fehlschlagenden Tests gezielt. `checks.mjs run` startet erst dann erneut, wenn sie grün sind.

### 3. Pruefungen vor dem Commit

```bash
node .claude/kit/checks.mjs run
```

Das Kommando waehlt die betroffenen `buildChecks` aus und fuehrt genau sie aus.
**Ohne `--since`** — den Anker bestimmt das Kommando (Default `HEAD`), der Skill
uebergibt nie selbst einen. Weil der Aufruf **vor** dem Commit steht, misst `HEAD`
genau dieses eine Arbeitspaket: Ein Fehlschlag gehoert dem Paket, das ihn ausgeloest
hat — in beiden Betriebsarten und auch dann, wenn eine Session mehrfach festschreibt.

**Gefahren wird die Paketstufe.** Auch `--stufe` uebergibt der Skill nie: Die Paketstufe
ist die Vorgabe, und sie ist hier die richtige — gemessen wird ein Arbeitspaket. Traegt
eine Pruefung im Projekt die Stufe `push` oder `merge`, erscheint sie darum in der Liste
`ausgelassen`, mit ihrer Stufe als Grund. Das ist **kein Mangel**, sondern ihr Zeitpunkt:
Sie laeuft in `/push-main` beziehungsweise `/merge-production`. Im Bericht steht sie wie
jede andere Auslassung.

Ein roter Lauf verhindert den Commit, wie bisher jeder rote Pflichtcheck.

Das Kommando nennt in seiner Ausgabe die **gelaufenen und die ausgelassenen**
Pruefungen, jeweils mit Grund. Beides gehoert in den Abschlussbericht (Schritt 5):
Nur die Laeufe zu nennen genuegt nicht — dann muesste man die Auslassungen indirekt
erschliessen, und ein verkuerzter Lauf saehe aus wie ein vollstaendiger. Meldet das
Kommando `leeresPaket`, steht das ausdruecklich als "keine Pruefung, weil nichts
veraendert wurde" im Bericht, nicht als leere Liste.

### 4. Lokal committen (nicht pushen)

Gleiches Format wie `implement-ready` Schritt 5 — Tests und Implementierung zusammen in einem Commit:

```bash
git add <geänderte Dateien>
git commit -m "Kurztitel (Issue #N)

Beschreibung der Änderungen und Begründung.

Refs #N

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

Nur explizit veränderte Dateien stagen — kein `git add -A` oder `git add .`.

**Kein `Closes`/`Fixes`/`Resolves #N` im Commit.** Diese Keywords schließen das Issue automatisch beim Push/Merge, und die Board-Automation zieht es dann sofort nach Done — noch bevor der Mensch getestet hat. `Refs #N` verlinkt, ohne zu schließen. Das Schließen macht ausschließlich der Mensch.

**Manuelle Pruefpunkte blockieren den Abschluss nicht.** Traegt das Issue einen Abschnitt `### Manuelle Pruefung (Mensch, nicht Teil des Session-Abschlusses)` (Konvention aus dem `issues`-Skill), wird das Issue abgeschlossen, sobald alle maschinellen Kriterien erfuellt sind. Die manuellen Punkte werden **unveraendert in den Abschlussbericht und den Board-Kommentar uebernommen**, damit der Mensch vor dem Done-Zug weiss, was noch aussteht. Sie sind kein Grund anzuhalten — headless antwortet niemand, und eine Session, die daran haengenbleibt, ist vom Runner nicht von einem Fehlschlag zu unterscheiden (Issue #215).

### 5. Issue nach In review verschieben + Abschlussbericht

```bash
node .claude/kit/board.mjs issue move <id> in_review
```

Abschlussbericht als Issue-Kommentar, gleiches Format wie `implement-ready` Schritt 6:

```bash
printenv TMPDIR
```

```bash
cat  > <tmpdir>/id-bericht.md <<'TEIL1'
## Abschlussbericht Issue #N
...
TEIL1
```

```bash
cat >> <tmpdir>/id-bericht.md <<'TEIL2'
… weitere Stuecke, je hoechstens 6.000 Zeichen …
TEIL2
```

```bash
node .claude/kit/board.mjs issue comment <id> --text-file <tmpdir>/id-bericht.md
```

Jeder Block ist ein **eigener** Werkzeugaufruf, und der Pfad steht woertlich — die Grenze von 6.000 Zeichen gilt je Aufruf, und eine Variable im Redirect-Ziel wird unbeaufsichtigt abgewiesen. Warum, steht in `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board". **Scheitert ein Dateischritt**, wird die unvollstaendige Datei nicht uebertragen; scheitert der Board-Aufruf, meldet der Skill den Fehler mit dem Pfad der Datei und endet ohne weitere Mutation.

```
## Abschlussbericht Issue #N

### Änderungen
- `Datei.java` — kurze Beschreibung der Wirkung
- `DateiTest.java` — was getestet wird (von /implement-test vorbereitet)

### Tests und Checks
- gelaufen: <Kommando> → <Ergebnis>
- ausgelassen: <Kommando> → <Grund>
- bei `leeresPaket`: keine Pruefung, weil nichts veraendert wurde

### Hinweise
- <verbleibende Risiken, offene Punkte, manuelle Folgeschritte>

### Entscheidungen
- E1: <Frage>. Gewählt: … Verworfen: … Grund: … Rückbau: …
```

`### Entscheidungen` entfaellt, wenn es nichts zu entscheiden gab; sonst traegt der Block die Eintraege im Format aus `CLAUDE-workflow.md`, Abschnitt „Entscheiden statt fragen".

## Stop-Punkte

- Pushen: nie ohne explizite Trigger-Phrase `push main`
- Backlog nach Ready ziehen: nie — das ist Mannes GO. Ausnahme, ausschliesslich in der Umsetzungsstufe der Nacht-Kette unter Variante B: Dort zieht der Nacht-Runner die Arbeitspakete des gekennzeichneten Fachplans selbst nach Ready und beginnt ihre Umsetzung ohne Freigabe je Paket. Das GO hat der Mensch am Fachplan gegeben, als er ihn fuer Variante B kennzeichnete. Ausserhalb dieser Stufe gilt der Satz davor ohne Einschraenkung — auch fuer Pakete eines Fachplans, der frueher unter Variante B lief.
- Issues auf Done setzen: nie — das macht der Mensch nach seinem Test
- Issue-schließende Commit-Keywords (`Closes`/`Fixes`/`Resolves #N`): nie — nur `Refs #N`
- Testcode stillschweigend ändern: nie — bei Zweifel Rücksprache statt eigenmächtiger Korrektur
