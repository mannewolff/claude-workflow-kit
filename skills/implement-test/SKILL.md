---
name: implement-test
description: Granulare Einsteiger-Variante von Schritt 5 (Teil 1) — schreibt gegen das naechste Ready-Issue nur die Tests (rot) und stoppt vor der Implementierung. Nutze diesen Skill wenn der Nutzer /implement-test aufruft oder testgetrieben zuerst nur die roten Tests sehen will, bevor implementiert wird.
user-invocable: true
---

# Implement Test

Granulare Variante von Schritt 5 (Teil 1 von 2): Tests gegen ein Ready-Issue schreiben, rot laufen lassen, stoppen. Für Neulinge, die den Rot→Grün-Übergang bewusst sehen wollen, statt Test und Implementierung in einem Rutsch wie bei `/implement-ready`.

## Vorbedingung

### 0. Läuft bereits ein Issue?

```bash
node .claude/kit/board.mjs issue list --status in_progress
```

Steht dort bereits ein Issue: stoppen.

> "Issue #N liegt bereits in In Progress (Tests vermutlich schon geschrieben). Erst `/implement-done` dafür laufen lassen, bevor ein neues Issue startet."

Kein zweites Issue parallel anfassen — ein Issue in Arbeit zur Zeit.

## Ablauf

### 1. Ready-Issues laden

```bash
node .claude/kit/board.mjs issue list --status ready
```

Issue mit der niedrigsten ID nehmen. Diese Auswahl ist verbindlich, kein Raten, welches Issue sinnvoller wäre.

### 2. Issue nach In Progress verschieben

```bash
node .claude/kit/board.mjs issue move <id> in_progress
```

### 3. Issue vollständig lesen

Lies alle vier Abschnitte. Die Tests entstehen gegen das Issue, nicht gegen den Chat.

### 4. Nur die Tests schreiben

- Testdatei(en) gegen das Akzeptanzkriterium schreiben — so, dass sie beim jetzigen Stand des Codes fehlschlagen (rot).
- Keine Produktionslogik. Kein Stub, keine Mock-Implementierung, die den Test schon grün macht.
- Bestehende Test-Muster und -Helfer des Projekts wiederverwenden.

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
- Kein zweites Issue parallel starten, solange eins in In Progress liegt.
- Pushen, Backlog nach Ready ziehen, Issues auf Done setzen: wie bei `/implement-ready` nie eigenmächtig.
