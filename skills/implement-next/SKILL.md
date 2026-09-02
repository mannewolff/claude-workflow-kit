---
name: implement-next
description: Ersetzt Schritt 5 durch eine feinere Gangart — arbeitet genau ein Ready-Issue ab (das übergebene #N, sonst das oberste in Board-Reihenfolge), committet lokal, pusht nicht und endet danach. Nutze diesen Skill wenn der Nutzer /implement-next aufruft oder genau ein Ready-Issue umgesetzt werden soll (z. B. pro Session im Nachtbetrieb).
user-invocable: true
---

# Implement Next

Ersetzt Schritt 5 durch eine feinere Gangart: **Genau ein** Ready-Issue wird vollständig umgesetzt, lokal committet und nach In review verschoben — danach endet der Skill. Welches Issue, entscheidet das Argument: mit `#N` ist es verbindlich vorgegeben, ohne Argument ist es das oberste in Ready. Kernbaustein des Nachtbetriebs (der Nacht-Runner startet pro Issue eine frische Session mit `/implement-next #N`), interaktiv genauso nutzbar („mach genau eins").

## Vorbedingung

Die Konfiguration liegt in `.claude/workflow.config.json` (im Repository, gilt fuer alle) und wird optional durch `.claude/workflow.config.local.json` ergaenzt (nicht im Repository, nur persoenliche Felder: `reviewModel`, `reviewCommand`, `reviewScope`, `triggers`, Token-Pfade). Issue #207.

Relevantes Feld:
- `mainBranch`: Branch für lokale Commits (Default: `main`)

## Ablauf (genau ein Issue)

### 0. Issue dieses Laufs bestimmen

```bash
node .claude/kit/board.mjs issue list --status ready
```

Gibt die Issues in der Reihenfolge der Ready-Spalte des Boards (oben zuerst; nur der lokale Datei-Tracker liefert numerisch nach ID). Welches davon dran ist, hängt am Aufruf:

**Mit Argument (`/implement-next #N`, auch `/implement-next N`) — verbindlicher Auftrag.** Das Issue ist vorgegeben und wird **nicht** neu gewählt. Steht `#N` in der Ready-Liste, ist es das Issue dieses Laufs — unabhängig davon, an welcher Position es liegt. Steht es dort **nicht** (mehr), endet der Skill ergebnislos mit dieser Meldung, ohne ein Ersatz-Issue zu nehmen:

> "Issue #N liegt nicht (mehr) in Ready — kein Ersatz-Issue, Ende."

Nie auf das oberste Ready-Issue ausweichen. Der Auftraggeber (im Nachtbetrieb der Nacht-Runner) hat bereits gefiltert — nach Routing-Label, Abhängigkeiten und Board-Reihenfolge — und misst den Erfolg an genau diesem Issue. Eine eigene Auswahl erzeugt eine zweite Wahrheit darüber, was dran ist: Sie umgeht die Freigabe des Menschen (ungelabelte Issues) und lässt den beauftragten Vorgang fälschlich als Fehlschlag ins Backlog wandern.

**Ohne Argument (interaktiv).** Das **erste** Element der Liste ist das Issue dieses Laufs — nicht numerisch umsortieren, keine eigene Auswahl treffen.

**Fachliche Issues, Ideen und Plandokumente überspringen (Leitplanke):** Trägt das so bestimmte Issue das Titel-Präfix `[Fachlich]` (PO-Schleife), `[Idee]` (rohe Idee ohne `/plan`-Zyklus) oder `[Plan]` (Plandokument aus `/plan` — es beschreibt einen Weg, es ist keine Aufgabe, und muss erst per `/issues #N` in Arbeitspakete zerlegt werden), wird es **nicht implementiert** — es mit dem passenden Kommentar zurück nach Backlog verschieben:

```
Fachliches Issue — wird nicht implementiert, bitte per /plan #N in technische Issues ueberfuehren.
```

```
Idee — braucht erst /plan #N + /issues, wird nicht implementiert.
```

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

Ohne Argument danach mit dem nächsten Ready-Issue fortfahren (bzw. ohne Fehler enden, wenn keines bleibt). Mit Argument endet der Skill danach ergebnislos — der Auftrag lautete auf genau dieses Issue.

Wenn Ready leer ist:

> "Ready ist leer. Nichts zu tun."

Ohne Fehler enden.

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

Lies alle Abschnitte des Issues — bei gesetztem `spec`-Block auch `## Spec-Wirkung`; daraus stammen die IDs fuer die Testnamen. Implementiere **gegen das Issue**, nicht gegen den Chat. Was im Issue steht, wird gebaut. Was nicht drinsteht, bleibt draußen.

### 3. Implementieren

- TDD: Tests zuerst schreiben und rot laufen lassen, dann gegen die Tests implementieren, bis grün
- Bestehende Muster und Funktionen wiederverwenden
- Kein Feature, keine Refactoring, keine Abstraktion die das Issue nicht verlangt
- Bei UI-Änderungen: Dev-Server starten, Golden Path und Edge Cases durchklicken
- Bei neuer oder geänderter Logik: abgedeckt oder begründet ausgeschlossen gemäß der Coverage-/Qualitäts-Policy des Projekts (siehe Projekt-Guide bzw. `workflow.config.json`). Untestete Logik nie stillschweigend ausschließen, Schwellen nie senken, nur damit ein Gate grün wird.
- Wiederkehrende, klassenweite Modell-Fehler (veraltete Idiome, abgekündigte APIs) nicht nur an den Fundstellen fixen: als harte Lint-/Compiler-Leitplanke für die `buildChecks` vorschlagen, aus vorhandenen Annotationen abgeleitet (z. B. `@typescript-eslint/no-deprecated`, Java `-Xlint:deprecation` mit `-Werror`, Linter-`recommended`-Sets) statt als handgepflegte Verbotsliste oder Bitte in einer CLAUDE-`*`.md — siehe das Leitplanken-Prinzip im `local-check`-Skill.
- Lang laufende Build-, Test- und Mutationstest-Kommandos (`mvn verify`, PIT, Testcontainers-ITs) mit explizit gesetztem, großzügigem Timeout aufrufen statt mit dem generischen Default — siehe die Timeout-Leitplanke im `local-check`-Skill.
- Einen im Hintergrund gestarteten Pflichtcheck vor Abschluss des Berichts immer aktiv abwarten und den geschriebenen Exit-Code einlesen — nie mit einer bloßen Ankündigung wie "ich melde mich, sobald der Lauf durch ist" enden, siehe die Leitplanke zum Hintergrund-Check im `local-check`-Skill.

**Aussage-ID in den Testnamen (nur mit `spec`-Block).** Traegt `.claude/workflow.config.json` einen `spec`-Block, fuehrt jedes Arbeitspaket den Abschnitt `## Spec-Wirkung`. Fuer jede Aussage, die das Paket dort als `NEU` oder `GEAENDERT` fuehrt, traegt **mindestens ein Test** die Aussage-ID in der Form `[<ID>]`. Die ID-Form ist `<bereich>-<N>`; vergeben hat sie `/issues`, und sie steht in der Wirkungszeile. Beispiel: `test("[board-7] issue create lehnt ein Paket ohne Spec-Wirkung ab", …)`.

- **„Im Testnamen" heisst:** im Titel-String des Tests — `test("[<ID>] …")`, `it("[<ID>] …")`. Wo der Testname ein Bezeichner ist und keine eckigen Klammern erlaubt (JUnit, pytest), steht der Verweis in `@DisplayName` bzw. im Docstring. Massgeblich ist, dass `spec.testPattern` ihn im **Dateitext** findet.
- Belegt ein Test mehrere Aussagen, steht jede ID in einer eigenen Klammer: `[board-7] [board-8]`.
- Bei **`GEAENDERT`** wird der vorhandene Test mit `[<ID>]` an den neuen Aussage-Text angepasst; ein zweiter Verweis ist nicht noetig, aber ein **unveraenderter Test ist kein Beleg**. Der Verweis allein sagt bei `GEAENDERT` nichts — er stuende sonst ueber einem Test, der noch das alte Verhalten prueft, und das Gate saehe die Aussage als belegt.
- **`ENTFAELLT` braucht keinen** neuen Verweis.
- Gesucht wird mit `spec.testPattern` (regulaerer Ausdruck mit dem Platzhalter `<ID>`, Default `\[<ID>\]`) in den Dateien aus `spec.testGlobs` — beide Felder stehen im `spec`-Block der `.claude/workflow.config.json`.
- Bei einem Paket mit `KEINE` und in Projekten ohne `spec`-Block aendert sich nichts.

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

Abschlussbericht **direkt** als Issue-Kommentar posten — kein Zwischenschritt über eine Wrapper- oder Temp-Datei:

```bash
node .claude/kit/board.mjs issue comment <id> --text - <<'BERICHT'
## Abschlussbericht Issue #N
...
BERICHT
```

**Working Tree sauber hinterlassen (Nachtbetrieb-Leitplanke).** Am Ende der Session enthält der Working Tree ausschließlich committete Änderungen. Lege für den Abschlussbericht keine Hilfsdateien an (kein `.tmp-report.md`, kein Node-Wrapper zum Posten) — der `issue comment --text -`-Aufruf oben genügt, auch für lange Berichte (Issue #270). Waren ausnahmsweise Hilfsdateien nötig, lösche sie vor Session-Ende. Der Nacht-Runner stoppt hart, wenn eine erfolgreiche Runde unkommittete Reste hinterlässt (siehe `kit/night.mjs`, Issue #152).

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

### 7. Ende

Nach dem Abschlussbericht endet der Skill — **kein weiteres Issue**, auch wenn Ready noch gefüllt ist. Die nächste Runde startet der Mensch (erneut `/implement-next` oder `/implement-ready` für den Rest) bzw. im Nachtbetrieb der Nacht-Runner mit einer frischen Session.

## Stop-Punkte

- Fachliche Issues (`[Fachlich]`-Titel), Ideen (`[Idee]`-Titel) und Plandokumente (`[Plan]`-Titel) implementieren: nie — kommentiert zurück nach Backlog
- Pushen: nie ohne explizite Trigger-Phrase `push main`
- Backlog nach Ready ziehen: nie — das ist Mannes GO
- Issues auf Done setzen: nie — das macht der Mensch nach seinem Test
- Issue-schließende Commit-Keywords (`Closes`/`Fixes`/`Resolves #N`): nie — sie schließen das Issue beim Push/Merge und die Board-Automation zieht es nach Done, bevor getestet wurde. Nur `Refs #N` verwenden.
- Mehr als ein Issue abarbeiten: nie — dafür ist `/implement-ready` da.
- Bei einem übergebenen `#N` ein anderes Issue bearbeiten: nie — liegt es nicht mehr in Ready, endet der Lauf ergebnislos.
