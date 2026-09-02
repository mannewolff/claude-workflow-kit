---
name: implement-ready
description: Schritt 5 des 9-Schritt-Prozesses — arbeitet alle Issues in der Ready-Spalte sequenziell in Board-Reihenfolge ab, committet lokal, pusht nicht. Nutze diesen Skill wenn der Nutzer /implement-ready aufruft, Ready-Issues umsetzen will oder das GO zur Implementierung gibt.
user-invocable: true
---

# Implement Ready

Schritt 5 des 9-Schritt-Prozesses: Die KI arbeitet die Ready-Issues sequenziell ab. Jedes Issue wird vollständig umgesetzt, lokal committet und nach In review verschoben, bevor das nächste beginnt.

## Vorbedingung

Die Konfiguration liegt in `.claude/workflow.config.json` (im Repository, gilt fuer alle) und wird optional durch `.claude/workflow.config.local.json` ergaenzt (nicht im Repository, nur persoenliche Felder: `reviewModel`, `reviewCommand`, `reviewScope`, `triggers`, Token-Pfade). Issue #207.

Relevantes Feld:
- `mainBranch`: Branch für lokale Commits (Default: `main`)

## Ablauf pro Issue (Reihenfolge: wie vom Adapter geliefert = Board-Reihenfolge)

### 0. Ready-Issues laden

```bash
node .claude/kit/board.mjs issue list --status ready
```

Gibt die Issues als JSON-Array in der Reihenfolge der Ready-Spalte des Boards (oben zuerst; nur der lokale Datei-Tracker liefert numerisch nach ID). Diese Reihenfolge ist verbindlich — der Mensch legt sie vor dem GO per Drag&Drop in der Ready-Spalte fest. Nicht numerisch umsortieren.

**Fachliche Issues überspringen (Leitplanke):** Issues mit dem Titel-Präfix `[Fachlich]` (PO-Schleife) werden **nie implementiert**. Liegt eines in Ready, wird es mit diesem Kommentar zurück nach Backlog verschoben, und der Lauf geht mit dem nächsten Issue weiter:

```
Fachliches Issue — wird nicht implementiert, bitte per /plan #N in technische Issues ueberfuehren.
```

**Ideen überspringen (Leitplanke):** Genauso Issues mit dem Titel-Präfix `[Idee]` — eine rohe Idee ohne `/plan`-Zyklus ist kein implementierbares Issue. Auch sie wandert mit diesem Kommentar zurück nach Backlog, der Lauf geht mit dem nächsten Issue weiter:

```
Idee — braucht erst /plan #N + /issues, wird nicht implementiert.
```

**Plandokumente überspringen (Leitplanke):** Genauso Issues mit dem Titel-Präfix `[Plan]` — ein Plandokument aus `/plan` beschreibt einen Weg, es ist keine Aufgabe, und muss erst per `/issues #N` in Arbeitspakete zerlegt werden. Auch es wandert mit diesem Kommentar zurück nach Backlog, der Lauf geht mit dem nächsten Issue weiter:

```
Plan-Dokument — wird nicht implementiert, bitte per /issues #N in Arbeitspakete ueberfuehren.
```

**Gezeichnete Issues ueberspringen (Leitplanke):** Ein Issue mit dem Label
`kit:klaeren` traegt eine offene Entscheidung, auf die ein Mensch antworten muss.
Es wandert mit diesem Kommentar zurueck nach Backlog, der Lauf geht weiter:

```
Traegt kit:klaeren — eine offene Entscheidung wartet auf einen Menschen, wird nicht implementiert.
```

**Das Label wird dabei nie entfernt.** Die Maschine darf es setzen, abnehmen darf
es nur der Mensch (Plan #368, A4) — ein Lauf, der sein eigenes `kit:klaeren`
abraeumen duerfte, koennte sich selbst freigeben.

**Ungepruefte Issues: Hinweis, kein Stopp.** Ein Ready-Issue steht in einem von **drei Zustaenden** — und nur der dritte ist eine Luecke:

1. **Marker vorhanden.** Der Kontext-Abschnitt traegt die Zeile `Issue-Review:`, das Issue ist durch `/issue-review` gelaufen. **Kein Hinweis**, es geht wie bisher weiter.
2. **Bewusst ohne Pruefung freigegeben.** Der Kontext-Abschnitt traegt `Pruefung: Verzicht`, und diese Vorgabe ist gueltig, also nicht verfallen. Melde sie als "bewusst ohne Pruefung freigegeben (Pruefung: Verzicht)" und fahre fort — **keine Rueckfrage**. Das ist keine Luecke, sondern die Entscheidung des Menschen; sie zur Rueckfrage zu machen hiesse, ihr zu widersprechen.
3. **Weder Marker noch gueltiger Verzicht.** Das Issue ist nicht durch `/issue-review` gelaufen. Weise darauf hin und frage, ob trotzdem implementiert werden soll — **halte aber nicht von dir aus an**. Der Nacht-Runner stellt solche Issues bei gesetztem `issueReview.requiredBeforeReady` zurueck; interaktiv steht ein Mensch daneben, der entscheiden kann. Diese Asymmetrie ist Absicht: Nachts antwortet niemand, und eine Session, die auf eine Antwort wartet, ist vom Runner nicht von einem Fehlschlag zu unterscheiden (Issue #223).

**Eine verfallene Vorgabe ist nicht Fall 3.** Wurde das Issue nach der Entscheidung inhaltlich geaendert — Aufgabe, Akzeptanzkriterium oder Abhaengigkeiten —, ist die Vorgabe verfallen. Benenne dann genau das: "die Pruefvorgabe ist mit einer inhaltlichen Aenderung verfallen". Das sagt dem Menschen etwas anderes als "wurde nie geprueft"; nur er kann entscheiden, ob die alte Freigabe noch traegt. Fuer den Lauf gilt danach der Regelfall, also der Hinweis aus Fall 3. Ob eine Vorgabe gueltig, verfallen oder gar nicht vorhanden ist, sagt `node .claude/kit/board.mjs issue-review roles --stufe issue --author <Autor-Modell aus dem Kontext> --issue <id>` in den Feldern `verzicht` und `vorgabeQuelle` (`issue` | `verfallen` | `config`).

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
- Lang laufende Build-, Test- und Mutationstest-Kommandos (`mvn verify`, PIT, Testcontainers-ITs) mit explizit gesetztem, großzügigem Timeout aufrufen statt mit dem generischen Default — siehe die Timeout-Leitplanke im `local-check`-Skill.
- Einen im Hintergrund gestarteten Pflichtcheck vor Abschluss des Berichts immer aktiv abwarten und den geschriebenen Exit-Code einlesen — nie mit einer bloßen Ankündigung wie "ich melde mich, sobald der Lauf durch ist" enden, siehe die Leitplanke zum Hintergrund-Check im `local-check`-Skill.

Für eine granularere Variante mit explizitem Stopp zwischen rot und grün: `/implement-test` gefolgt von `/implement-done`.

### 4. Pruefungen vor dem Commit

```bash
node .claude/kit/checks.mjs run
```

Das Kommando waehlt die betroffenen `buildChecks` aus und fuehrt genau sie aus.
**Ohne `--since`** — den Anker bestimmt das Kommando (Default `HEAD`), der Skill
uebergibt nie selbst einen. Weil der Aufruf **vor** dem Commit steht, misst `HEAD`
genau dieses eine Arbeitspaket: Ein Fehlschlag gehoert dem Paket, das ihn ausgeloest
hat — in beiden Betriebsarten und auch dann, wenn eine Session mehrfach festschreibt.

Ein roter Lauf verhindert den Commit, wie bisher jeder rote Pflichtcheck.

Das Kommando nennt in seiner Ausgabe die **gelaufenen und die ausgelassenen**
Pruefungen, jeweils mit Grund. Beides gehoert in den Abschlussbericht (Schritt 6):
Nur die Laeufe zu nennen genuegt nicht — dann muesste man die Auslassungen indirekt
erschliessen, und ein verkuerzter Lauf saehe aus wie ein vollstaendiger. Meldet das
Kommando `leeresPaket`, steht das ausdruecklich als "keine Pruefung, weil nichts
veraendert wurde" im Bericht, nicht als leere Liste.

### 5. Lokal committen (nicht pushen)

```bash
git add <geänderte Dateien>
git commit -m "Kurztitel (Issue #N)

Beschreibung der Änderungen und Begründung.

Refs #N

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

Nur explizit veränderte Dateien stagen — kein `git add -A` oder `git add .`.

**Kein `Closes`/`Fixes`/`Resolves #N` im Commit.** Diese Keywords schließen das Issue automatisch, sobald der Commit auf den Default-Branch gelangt (`push`/Merge), und die Board-Automation zieht geschlossene Issues sofort nach *Done* — noch bevor der Mensch testen konnte. `Refs #N` verlinkt das Issue, ohne es zu schließen. Das Schließen (→ Done) macht ausschließlich der Mensch nach seinem Test.

**Manuelle Pruefpunkte blockieren den Abschluss nicht.** Traegt das Issue einen Abschnitt `### Manuelle Pruefung (Mensch, nicht Teil des Session-Abschlusses)` (Konvention aus dem `issues`-Skill), wird das Issue abgeschlossen, sobald alle maschinellen Kriterien erfuellt sind. Die manuellen Punkte werden **unveraendert in den Abschlussbericht und den Board-Kommentar uebernommen**, damit der Mensch vor dem Done-Zug weiss, was noch aussteht. Sie sind kein Grund anzuhalten — headless antwortet niemand, und eine Session, die daran haengenbleibt, ist vom Runner nicht von einem Fehlschlag zu unterscheiden (Issue #215).

### 6. Issue nach In review verschieben + Abschlussbericht

```bash
node .claude/kit/board.mjs issue move <id> in_review
```

Abschlussbericht als Issue-Kommentar:

```bash
node .claude/kit/board.mjs issue comment <id> --text - <<'BERICHT'
## Abschlussbericht Issue #N
...
BERICHT
```

Format des Abschlussberichts:

```
## Abschlussbericht Issue #N

### Änderungen
- `Datei.java` — kurze Beschreibung der Wirkung
- `DateiTest.java` — was getestet wird

### Tests und Checks
- gelaufen: <Kommando> → <Ergebnis>
- ausgelassen: <Kommando> → <Grund>
- bei `leeresPaket`: keine Pruefung, weil nichts veraendert wurde

### Hinweise
- <verbleibende Risiken, offene Punkte, manuelle Folgeschritte>
```

### 7. Nächstes Issue

Sobald das Issue in In review liegt: naechstes Issue aus dem zuvor geladenen Ready-Array abarbeiten (in Array-Reihenfolge). Wenn Ready leer ist: Vollzug melden.

## Verhalten bei leerem Ready

> "Ready ist leer. Alle Issues in In review. Ich warte auf dein GO für den nächsten Batch."

Kein eigenmächtiges Ziehen aus Backlog. Kein Raten, welches Issue sinnvoll wäre.

## Stop-Punkte

- Fachliche Issues (`[Fachlich]`-Titel), Ideen (`[Idee]`-Titel) und Plandokumente (`[Plan]`-Titel) implementieren: nie — kommentiert zurück nach Backlog
- Pushen: nie ohne explizite Trigger-Phrase `push main`
- Backlog nach Ready ziehen: nie — das ist Mannes GO
- Issues auf Done setzen: nie — das macht der Mensch nach seinem Test
- Issue-schließende Commit-Keywords (`Closes`/`Fixes`/`Resolves #N`): nie — sie schließen das Issue beim Push/Merge und die Board-Automation zieht es nach Done, bevor getestet wurde. Nur `Refs #N` verwenden.
