---
name: implement-test
description: Ersetzt Schritt 5 durch eine feinere Gangart (Teil 1 von 2) — schreibt gegen das naechste Ready-Issue nur die Tests (rot) und stoppt vor der Implementierung. Nutze diesen Skill wenn der Nutzer /implement-test aufruft oder testgetrieben zuerst nur die roten Tests sehen will, bevor implementiert wird.
user-invocable: true
---

# Implement Test

Ersetzt Schritt 5 durch eine feinere Gangart (Teil 1 von 2): Tests gegen ein Ready-Issue schreiben, rot laufen lassen, stoppen. Für Neulinge, die den Rot→Grün-Übergang bewusst sehen wollen, statt Test und Implementierung in einem Rutsch wie bei `/implement-ready`.

## Vorbedingung

### 0. Läuft bereits ein Issue?

```bash
node .claude/kit/board.mjs issue list --status in_progress
```

Steht dort bereits ein Issue: stoppen.

> "Issue #N liegt bereits in In progress (Tests vermutlich schon geschrieben). Erst `/implement-done` dafür laufen lassen, bevor ein neues Issue startet."

Kein zweites Issue parallel anfassen — ein Issue in Arbeit zur Zeit.

## Ablauf

### 1. Ready-Issues laden

```bash
node .claude/kit/board.mjs issue list --status ready
```

Issue mit der niedrigsten ID nehmen. Diese Auswahl ist verbindlich, kein Raten, welches Issue sinnvoller wäre.

### 2. Issue nach In progress verschieben

```bash
node .claude/kit/board.mjs issue move <id> in_progress
```

### 3. Issue vollständig lesen

Lies alle Abschnitte des Issues. Die Tests entstehen gegen das Issue, nicht gegen den Chat.

### 4. Nur die Tests schreiben

- Testdatei(en) gegen das Akzeptanzkriterium schreiben — so, dass sie beim jetzigen Stand des Codes fehlschlagen (rot).
- Keine Produktionslogik. Kein Stub, keine Mock-Implementierung, die den Test schon grün macht.
- Bestehende Test-Muster und -Helfer des Projekts wiederverwenden.

**Nur die Tests des Pakets laufen lassen.** Die volle Suite ist der teuerste Einzelposten einer Session — sie mehrfach zu starten, kostet Minuten und bringt nichts dazu:

1. Während der Arbeit laufen nur die Tests, die das Paket berührt — gezielt per Datei oder Filter des Test-Runners, zum Beispiel `node --test test/<datei>.test.mjs`. Dazu gehören auch die Tests dessen, was von der geänderten Datei abhängt — nicht nur die der Datei selbst. Gibt es die dafür nur als vollständige Gruppe, fährt die Session sie über `node .claude/kit/checks.mjs run --bereich <name>`; das ist dann kein Verstoß gegen die Zehn-Minuten-Marke, sondern der vorgesehene Weg.
2. Die volle Suite startet die Session nicht selbst. Der eine volle Lauf ist `node .claude/kit/checks.mjs run` vor dem Commit.
3. Ein zweiter `checks.mjs run` auf **unverändertem Stand** fährt kein Kommando mehr: Das Kommando übernimmt das Ergebnis des vorigen Laufs — auch ein rotes — samt Exitcode und meldet das. `--frisch` erzwingt den echten Lauf.
4. Hinweis dazu: Wer die Ausgabe eines langen Laufs mehrfach auswerten will, schreibt sie am einfachsten einmal in eine Datei außerhalb des Projektverzeichnisses (`<tmpdir>/…`, den Pfad wörtlich wie in der Transportregel) und liest sie daraus.
5. Ist `checks.mjs run` rot, laufen danach zuerst die fehlschlagenden Tests gezielt. `checks.mjs run` startet erst dann erneut, wenn sie grün sind.

Das rote Laufenlassen der neuen Tests aus Schritt 4 ist genau so ein gezielter Lauf: nur die geschriebene Testdatei, nicht die Suite. Den vollen Lauf holt `/implement-done` vor dem Commit nach.

### 5. Kein Commit

Die roten Tests bleiben unstaged im Working Tree. Das ist der Stopp-Punkt — der nächste Schritt (`/implement-done`) committet Tests und Implementierung gemeinsam.

### 6. Abschluss-Ausgabe

Liste die geschriebenen Testdateien als anklickbare Markdown-Links, damit sie sich direkt in der IDE öffnen lassen:

```
### Tests geschrieben (rot) — Issue #N

- [DateiTest.java](pfad/zur/DateiTest.java:1)
- [AnotherTest.java](pfad/zur/AnotherTest.java:1)

Tests stehen rot. Weiter mit /implement-done.
```

## Stop-Punkte

- Kein Produktionscode: dieser Skill schreibt ausschließlich Tests.
- Kein Commit: der entsteht erst in `/implement-done`.
- Kein zweites Issue parallel starten, solange eins in In progress liegt.
- Pushen, Backlog nach Ready ziehen, Issues auf Done setzen: wie bei `/implement-ready` nie eigenmächtig — inklusive der dortigen Ausnahme fuer die Umsetzungsstufe der Nacht-Kette unter Variante B, die den Nacht-Runner betrifft, nicht diesen Skill.
