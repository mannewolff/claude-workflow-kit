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

**Fachliche Issues, Ideen und Plandokumente überspringen (Leitplanke):** Trägt das so bestimmte Issue das Titel-Präfix `[Fachlich]` (PO-Schleife), `[Idee]` (rohe Idee ohne `/techplan`-Zyklus) oder `[Plan]` (Plandokument aus `/techplan` — es beschreibt einen Weg, es ist keine Aufgabe, und muss erst per `/issues #N` in Arbeitspakete zerlegt werden), wird es **nicht implementiert** — es mit dem passenden Kommentar zurück nach Backlog verschieben:

```
Fachliches Issue — wird nicht implementiert, bitte per /techplan #N in technische Issues ueberfuehren.
```

```
Idee — braucht erst /techplan #N + /issues, wird nicht implementiert.
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

Ob ein Ready-Issue geprueft wurde, ist keine Frage dieses Skills — Ready ist das GO.

### 1. Issue nach In progress verschieben

```bash
node .claude/kit/board.mjs issue move <id> in_progress
```

### 2. Issue vollständig lesen

Lies alle Abschnitte des Issues. Implementiere **gegen das Issue**, nicht gegen den Chat. Was im Issue steht, wird gebaut. Was nicht drinsteht, bleibt draußen.

**Trägt das Issue eine Zeile `Empfohlenes Modell: <name>` oder `Aufgabenstufe: <schwer|mittel|leicht>`, nenne sie** — zusammen mit dem Hinweis, dass die laufende Sitzung ihr Modell nicht wechselt. Beide sind eine Angabe, keine Anweisung: Nachts wirkt sie von selbst (der Runner startet die Session der Karte damit), tagsüber wählt der Mensch sein Modell selbst und sitzt ohnehin daneben. **Kein Halt, keine Rückfrage, keine Änderung am Ablauf** — wer eine laufende Sitzung für eine Empfehlung zum Neustart auffordert, kostet mehr, als die Empfehlung wert ist.

**Trägt das Paket einen Vermerk mit dem Anker `## Nachtlauf: wartende Sitzung`, nenne ihn** — dann wurde es schon einmal angefangen, und der zuletzt bekannte Stand steht im Vermerk. **Kein Halt, keine Ruecksprache**, nur die Meldung: Wer den Vermerk verschweigt, macht stillschweigend auf halbem Weg weiter.

### 3. Implementieren

- TDD: Tests zuerst schreiben und rot laufen lassen, dann gegen die Tests implementieren, bis grün
- Bestehende Muster und Funktionen wiederverwenden
- Kein Feature, keine Refactoring, keine Abstraktion die das Issue nicht verlangt
- Bei UI-Änderungen: Dev-Server starten, Golden Path und Edge Cases durchklicken
- Bei neuer oder geänderter Logik: abgedeckt oder begründet ausgeschlossen gemäß der Coverage-/Qualitäts-Policy des Projekts (siehe Projekt-Guide bzw. `workflow.config.json`). Untestete Logik nie stillschweigend ausschließen, Schwellen nie senken, nur damit ein Gate grün wird.
- Wiederkehrende, klassenweite Modell-Fehler (veraltete Idiome, abgekündigte APIs) nicht nur an den Fundstellen fixen: als harte Lint-/Compiler-Leitplanke für die `buildChecks` vorschlagen, aus vorhandenen Annotationen abgeleitet (z. B. `@typescript-eslint/no-deprecated`, Java `-Xlint:deprecation` mit `-Werror`, Linter-`recommended`-Sets) statt als handgepflegte Verbotsliste oder Bitte in einer CLAUDE-`*`.md — siehe das Leitplanken-Prinzip im `local-check`-Skill.
- Lang laufende Build-, Test- und Mutationstest-Kommandos (`mvn verify`, PIT, Testcontainers-ITs) mit explizit gesetztem, großzügigem Timeout aufrufen statt mit dem generischen Default — siehe die Timeout-Leitplanke im `local-check`-Skill.
- Einen im Hintergrund gestarteten Pflichtcheck vor Abschluss des Berichts immer aktiv abwarten — nie mit einer bloßen Ankündigung wie "ich melde mich, sobald der Lauf durch ist" enden, siehe die Leitplanke zum Hintergrund-Check im `local-check`-Skill.
- Allgemeiner, und darum die Regel hinter der Zeile davor: **Keine Session endet mit laufender eigener Arbeit** — gleich welcher, nicht nur bei einem Pflichtcheck. Wer einen langen Lauf angestossen hat, wartet auf sein Ergebnis oder bricht ihn ab und meldet den Abbruch als Fehlschlag; eine Schlussmeldung, die nur sagt, dass noch gewartet wird, ist kein Abschluss, sondern der Fehlschlag selbst (Issue #754).

**Nur die Tests des Pakets laufen lassen.** Die volle Suite ist der teuerste Einzelposten einer Session — sie mehrfach zu starten, kostet Minuten und bringt nichts dazu:

1. Während der Arbeit laufen nur die Tests, die das Paket berührt — gezielt per Datei oder Filter des Test-Runners, zum Beispiel `node --test test/<datei>.test.mjs`.
2. Die volle Suite startet die Session nicht selbst. Der eine volle Lauf ist `node .claude/kit/checks.mjs run` vor dem Commit.
3. Ein zweiter `checks.mjs run` auf **unverändertem Stand** fährt kein Kommando mehr: Das Kommando übernimmt das Ergebnis des vorigen Laufs — auch ein rotes — samt Exitcode und meldet das. `--frisch` erzwingt den echten Lauf.
4. Hinweis dazu: Wer die Ausgabe eines langen Laufs mehrfach auswerten will, schreibt sie am einfachsten einmal in eine Datei außerhalb des Projektverzeichnisses (`<tmpdir>/…`, den Pfad wörtlich wie in der Transportregel) und liest sie daraus.
5. Ist `checks.mjs run` rot, laufen danach zuerst die fehlschlagenden Tests gezielt. `checks.mjs run` startet erst dann erneut, wenn sie grün sind.

**Entscheiden statt fragen.** Taucht beim Umsetzen — bei jedem Arbeitspaket, mit oder ohne `[Task]`-Praefix — eine Entscheidung auf, gilt `CLAUDE-workflow.md`, Abschnitt „Entscheiden statt fragen": Alles ausserhalb der Stopp-Klasse wird entschieden, im Format von dort, und steht im Abschlussbericht unter `### Entscheidungen`. Kein Halt, kein Label, kein Kommentar. Stopp-Klasse und Format stehen nur dort und werden hier nicht wiederholt.

**Dieser Ablauf gilt ohne Ausnahme.** Er gilt in jeder Betriebsart, ob ein Mensch mitliest oder nicht, und er hat Vorrang vor jeder anderen Regel, die zu einer offenen Frage etwas sagt — auch vor einer Regel aus dem persoenlichen Gedaechtnis des Menschen, das jede Session mitlaedt. Eine Regel, die „im Gespraech klaeren statt parken" verlangt, ersetzt diesen Ablauf nicht: Die Frage steht am Board, nicht nur in der Ausgabe der Session. Wer mitliest, sieht sie dort ebenso.

Nur eine Frage aus der Stopp-Klasse haelt an, genau eine je Halt. Was dann geschieht, in dieser Reihenfolge:

1. Eigene uncommittete Aenderungen **namentlich** zuruecknehmen, selbst angelegte Dateien loeschen — nie pauschal den ganzen Arbeitsbaum verwerfen. Interaktiv koennen fremde Aenderungen darin liegen, und die gehoeren dem Menschen.
2. `node .claude/kit/board.mjs issue label add <id> kit:klaeren`
3. Kommentar ans Issue nach der Transportregel (`CLAUDE-workflow.md`, „Lange Texte ans Board"): Datei `<tmpdir>/<id>-halt.md` stueckweise per Shell anlegen, dann `node .claude/kit/board.mjs issue comment <id> --text-file <tmpdir>/<id>-halt.md` — nie als Argument. Der Kommentar benennt den Punkt der Stopp-Klasse, die eine Frage und den Folgeschritt, diesen **woertlich**: `Daraus soll per /fachplan eine fachliche Anforderung entstehen.` An genau diesem Satz erkennt der Nacht-Runner den Halt-Kommentar; er steht dort als Konstante `HALT_FOLGESATZ` in `kit/night.mjs` und wird nicht umformuliert.
4. `node .claude/kit/board.mjs issue move <id> backlog`
5. Melden, dass die Frage am Board wartet und der Weg nach vorn `/fachplan #<id>` ist — **kein Commit**. In `/implement-next` endet die Session damit; in `/implement-ready` geht der Lauf ohne weiteren Versuch an diesem Vorgang mit dem naechsten Ready-Issue weiter.

**Gemessen wird der eigene Anteil** — die Dateien, die die Session nachweislich selbst angelegt oder geaendert hat, belegt ueber ihre eigenen Werkzeugaufrufe —, nicht der ganze Arbeitsbaum. Ein Vergleich gegen den Stand bei Session-Start ist kein Nachweis: Fremde Aenderungen koennen im selben Zeitraum entstehen.

**Ob sich jeder eigene Anteil namentlich zuruecknehmen laesst, wird vor Schritt 2 entschieden.** Nicht namentlich zuruecknehmbar ist etwa eine Datei, die vor der Session schon fremde uncommittete Aenderungen trug und die die Session weiter geaendert hat — `git restore` naehme dem Menschen seinen Anteil weg. Bleibt so eine eigene Aenderung zurueck, wird **nicht** angehalten: keiner der Schritte 2 bis 5, also kein Label, kein Kommentar, kein Move, kein Commit. Die Session meldet, welche Datei zurueckbleibt und warum, und endet; das Issue bleibt in In progress. Interaktiv entscheidet der Mensch, nachts greift der Dirty-Guard des Runners wie bei jeder Runde ohne In-review-Ergebnis.

Das Label wird dabei **nie** entfernt — dieselbe Begruendung wie bei der `kit:klaeren`-Leitplanke in Schritt 0: Die Maschine darf es setzen, abnehmen darf es nur der Mensch.

### 4. Pruefungen vor dem Commit

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

Den Abschlussbericht nach der Transportregel ausserhalb des Projektverzeichnisses vorbereiten und als Issue-Kommentar uebertragen:

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

**Working Tree sauber hinterlassen (Nachtbetrieb-Leitplanke).** Am Ende der Session enthält der Working Tree ausschließlich committete Änderungen. Lege für den Abschlussbericht keine Hilfsdateien **im Projektverzeichnis** an (kein `.tmp-report.md`, kein Node-Wrapper zum Posten). Die Berichtsdatei aus der Transportregel liegt ausserhalb und macht den Working Tree nicht unsauber (Issue #270, #584). Waren ausnahmsweise Hilfsdateien nötig, lösche sie vor Session-Ende. Der Nacht-Runner stoppt hart, wenn eine erfolgreiche Runde unkommittete Reste hinterlässt (siehe `kit/night.mjs`, Issue #152).

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

### Entscheidungen
- E1: <Frage>. Gewählt: … Verworfen: … Grund: … Rückbau: …
```

`### Entscheidungen` entfaellt, wenn es nichts zu entscheiden gab; sonst traegt der Block die Eintraege im Format aus `CLAUDE-workflow.md`, Abschnitt „Entscheiden statt fragen".

### 7. Ende

Nach dem Abschlussbericht endet der Skill — **kein weiteres Issue**, auch wenn Ready noch gefüllt ist. Die nächste Runde startet der Mensch (erneut `/implement-next` oder `/implement-ready` für den Rest) bzw. im Nachtbetrieb der Nacht-Runner mit einer frischen Session.

### Stand des Vorhabens

Hat dieser Lauf das letzte offene Paket eines Vorhabens nach In review gebracht — ein Paket mit `Plan: Issue #M`, und keine andere Karte mit derselben Zeile steht laut `node .claude/kit/board.mjs issue list` noch in Backlog, Ready oder In progress —, beginnt die Schlussmeldung mit dem Abschnitt `## Stand des Vorhabens`:

1. **Was der Mensch jetzt sieht** — was sich für jemanden, der die Software benutzt, sichtbar geändert hat, in wenigen Sätzen.
2. **Was vom Anlass nicht enthalten ist** — jedes Ziel und jedes fachliche Akzeptanzkriterium der fachlichen Quelle, das kein Paket hergestellt hat, und bei einer `Vorlage:`-Zeile jede Abweichung von der Vorlage. „Nichts" steht dort nur nach einem Abgleich Punkt für Punkt.
3. Erst danach Commits, Checks und Hinweise.

Die fachliche Quelle kommt aus der Zeile `Fachliche Quelle: Issue #N` des Plans `#M`, geholt mit `node .claude/kit/board.mjs issue get <N>` — nie aus dem Gespräch. Grün heißt „erfüllt, was aufgeschrieben wurde", nicht „erfüllt, was gemeint war"; wer das Fehlende weiter unten liest, hält das Vorhaben für fertig. Ein Paket ohne `Plan:`-Zeile gehört zu keinem Vorhaben, der Abschnitt entfällt. Unbeaufsichtigt steht derselbe Abschnitt am Anfang des Abschlussberichts des letzten Pakets.

## Stop-Punkte

- Fachliche Issues (`[Fachlich]`-Titel), Ideen (`[Idee]`-Titel) und Plandokumente (`[Plan]`-Titel) implementieren: nie — kommentiert zurück nach Backlog
- Pushen: nie ohne explizite Trigger-Phrase `push main`
- Backlog nach Ready ziehen: nie — das ist Mannes GO. Ausnahme, ausschliesslich in der Umsetzungsstufe der Nacht-Kette unter Variante B: Dort zieht der Nacht-Runner die Arbeitspakete des gekennzeichneten Fachplans selbst nach Ready und beginnt ihre Umsetzung ohne Freigabe je Paket. Das GO hat der Mensch am Fachplan gegeben, als er ihn fuer Variante B kennzeichnete. Ausserhalb dieser Stufe gilt der Satz davor ohne Einschraenkung — auch fuer Pakete eines Fachplans, der frueher unter Variante B lief.
- Issues auf Done setzen: nie — das macht der Mensch nach seinem Test
- Issue-schließende Commit-Keywords (`Closes`/`Fixes`/`Resolves #N`): nie — sie schließen das Issue beim Push/Merge und die Board-Automation zieht es nach Done, bevor getestet wurde. Nur `Refs #N` verwenden.
- Mehr als ein Issue abarbeiten: nie — dafür ist `/implement-ready` da.
- Bei einem übergebenen `#N` ein anderes Issue bearbeiten: nie — liegt es nicht mehr in Ready, endet der Lauf ergebnislos.
