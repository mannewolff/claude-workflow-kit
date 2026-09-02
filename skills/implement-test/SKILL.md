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

Lies alle Abschnitte des Issues — bei gesetztem `spec`-Block auch `## Spec-Wirkung`; daraus stammen die IDs fuer die Testnamen. Die Tests entstehen gegen das Issue, nicht gegen den Chat.

### 4. Nur die Tests schreiben

- Testdatei(en) gegen das Akzeptanzkriterium schreiben — so, dass sie beim jetzigen Stand des Codes fehlschlagen (rot).
- Keine Produktionslogik. Kein Stub, keine Mock-Implementierung, die den Test schon grün macht.
- Bestehende Test-Muster und -Helfer des Projekts wiederverwenden.

**Aussage-ID in den Testnamen (nur mit `spec`-Block).** Traegt `.claude/workflow.config.json` einen `spec`-Block, fuehrt jedes Arbeitspaket den Abschnitt `## Spec-Wirkung`. Fuer jede Aussage, die das Paket dort als `NEU` oder `GEAENDERT` fuehrt, traegt **mindestens ein Test** die Aussage-ID in der Form `[<ID>]`. Die ID-Form ist `<bereich>-<N>`; vergeben hat sie `/issues`, und sie steht in der Wirkungszeile. Beispiel: `test("[board-7] issue create lehnt ein Paket ohne Spec-Wirkung ab", …)`.

- **„Im Testnamen" heisst:** im Titel-String des Tests — `test("[<ID>] …")`, `it("[<ID>] …")`. Wo der Testname ein Bezeichner ist und keine eckigen Klammern erlaubt (JUnit, pytest), steht der Verweis in `@DisplayName` bzw. im Docstring. Massgeblich ist, dass `spec.testPattern` ihn im **Dateitext** findet.
- Belegt ein Test mehrere Aussagen, steht jede ID in einer eigenen Klammer: `[board-7] [board-8]`.
- Bei **`GEAENDERT`** wird der vorhandene Test mit `[<ID>]` an den neuen Aussage-Text angepasst; ein zweiter Verweis ist nicht noetig, aber ein **unveraenderter Test ist kein Beleg**. Der Verweis allein sagt bei `GEAENDERT` nichts — er stuende sonst ueber einem Test, der noch das alte Verhalten prueft, und das Gate saehe die Aussage als belegt.
- **`ENTFAELLT` braucht keinen** neuen Verweis.
- Gesucht wird mit `spec.testPattern` (regulaerer Ausdruck mit dem Platzhalter `<ID>`, Default `\[<ID>\]`) in den Dateien aus `spec.testGlobs` — beide Felder stehen im `spec`-Block der `.claude/workflow.config.json`.
- Bei einem Paket mit `KEINE` und in Projekten ohne `spec`-Block aendert sich nichts.

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
- Pushen, Backlog nach Ready ziehen, Issues auf Done setzen: wie bei `/implement-ready` nie eigenmächtig.
