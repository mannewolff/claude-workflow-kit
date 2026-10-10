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
- Genau ein Issue dort: das ist das aktuelle Issue. Ob es fortgesetzt werden darf, sagt der Auftrag in Schritt 1.

## Ablauf

### 1. Auftrag holen und lesen

```bash
node .claude/kit/board.mjs issue auftrag <id> --spalte in_progress
```

Ein Aufruf liefert das **Urteil** (`darf beginnen` oder `darf nicht beginnen` samt Grund) mit seiner **Folge**, dazu die Aufgabe mit Kommentaren, die Plan-Entscheidungen im Wortlaut, den fachlichen Anlass, die Geschwister mit Spalte, die Voraussetzungen und die Lücken. `--spalte in_progress`, weil `/implement-test` die Karte schon gezogen hat. Gehandelt wird allein nach der Folge; die Prüfungen dahinter und die Wortlaute der Backlog-Kommentare stehen in `kit/board.mjs`, nicht in diesem Skill:

- **`beginnen`** — weiter mit Schritt 2.
- **`bleibt`** — stoppen, den Grund aus dem Urteil melden, die Karte nicht bewegen und nicht kommentieren.
- **`backlog`** — der Kommentar, den der Auftrag unter „Kommentar fuer die Karte (woertlich)" liefert, geht unverändert ans Issue, danach zieht die Karte nach Backlog, und der Skill endet:

  ```bash
  node .claude/kit/board.mjs issue comment <id> --text '<Kommentar aus dem Auftrag, woertlich>'
  ```

  ```bash
  node .claude/kit/board.mjs issue move <id> backlog
  ```

- **`geschuetzt`** — das Paket nennt eine geschützte Datei, die nur ein Mensch schreiben darf, und ist nicht freigegeben. Es wird nicht begonnen, keine Datei wird angefasst. Die Schritte nennt auch der Grund im Urteil, in dieser Reihenfolge — zuerst nach Backlog:

  ```bash
  node .claude/kit/board.mjs issue move <id> backlog
  ```

  Dann das Label:

  ```bash
  node .claude/kit/board.mjs issue label add <id> kit:geschuetzt
  ```

  Ein Fehlschlag dieses Aufrufs wird gemeldet und hält nicht auf. Danach geht der Kommentar ans Issue, den der Auftrag unter „Kommentar fuer die Karte (woertlich)" liefert, als letzte Zeile ergänzt um die Label-Zeile, die den Ausgang vermerkt: `Label kit:geschuetzt gesetzt`, oder `Label kit:geschuetzt nicht gesetzt`, wenn der Aufruf davor scheiterte. Nur die erste gibt das Paket später frei. Der Kommentar geht nach der Transportregel (`CLAUDE-workflow.md`, „Lange Texte ans Board"): Datei `<tmpdir>/<id>-geschuetzt.md` stückweise per Shell anlegen, dann

  ```bash
  node .claude/kit/board.mjs issue comment <id> --text-file <tmpdir>/<id>-geschuetzt.md
  ```

  Danach endet der Skill.

**Auch `kit:geschuetzt` wird nie entfernt.** Die Maschine setzt es, abnehmen darf es allein der Mensch, nachdem er die geschützte Änderung selbst vorgenommen hat — erst damit gilt das Paket beim nächsten Anlauf als freigegeben.

Lies alle Abschnitte der Aufgabe im Auftrag erneut; ein weiteres `issue get` braucht es nicht, und die Ausgabe wird nicht per `node -e` oder `jq` zerlegt. Das Akzeptanzkriterium ist der Maßstab für die Implementierung, nicht die bereits vorhandenen Tests allein.

### 2. Gegen die Tests implementieren

- Implementieren, bis die von `/implement-test` geschriebenen Tests grün sind.
- Testcode nicht anfassen — außer er ist nachweislich falsch formuliert (widerspricht dem Akzeptanzkriterium, testet das Falsche). Dann Rücksprache mit dem Menschen statt stillschweigender Änderung.
- Bestehende Muster und Funktionen wiederverwenden. Kein Feature, keine Refactoring, keine Abstraktion, die das Issue nicht verlangt.
- Ohne Aufsicht (gesetztes `KIT_AGENT_MODEL`) gibt es keine Hintergrundarbeit: Der Hook `bash-pruefen` weist einen Bash-Aufruf mit `run_in_background` ab (Issue #1081) — den Befehl im Vordergrund aufrufen und auf ihn warten. Interaktiv bleibt Hintergrundarbeit erlaubt.

**Nur die Tests des Pakets laufen lassen.** Die volle Suite ist der teuerste Einzelposten einer Session — sie mehrfach zu starten, kostet Minuten und bringt nichts dazu:

1. Während der Arbeit laufen nur die Tests, die das Paket berührt — gezielt per Datei oder Filter des Test-Runners, zum Beispiel `node --test test/<datei>.test.mjs`. Dazu gehören auch die Tests dessen, was von der geänderten Datei abhängt — nicht nur die der Datei selbst. Gibt es die dafür nur als vollständige Gruppe, fährt die Session sie über `node .claude/kit/checks.mjs run --bereich <name>`; das ist dann kein Verstoß gegen die Zehn-Minuten-Marke, sondern der vorgesehene Weg.
2. Die volle Suite startet die Session nicht selbst. Der eine volle Lauf ist `node .claude/kit/checks.mjs run --abschluss <kartennummer>` vor dem Commit. Sein Block `Fuer den Abschlussbericht:` beginnt mit der Zeile `Wartezeit:`, die wie der Rest wortgetreu in den Bericht geht. Die Abschlussprüfung wiederholt eine rote Prüfung selbst einmal auf demselben Stand — die Session wiederholt sie nicht zusätzlich; eine `Gewackelt:`-Zeile geht wortgetreu in den Bericht, und das Paket geht wie gewohnt nach In review.
3. Ein zweiter `checks.mjs run` auf **unverändertem Stand** fährt kein Kommando mehr: Das Kommando übernimmt das Ergebnis des vorigen Laufs — auch ein rotes — samt Exitcode und meldet das. `--frisch` erzwingt den echten Lauf.
4. Hinweis dazu: Wer die Ausgabe eines langen Laufs mehrfach auswerten will, schreibt sie am einfachsten einmal in eine Datei außerhalb des Projektverzeichnisses (`<tmpdir>/…`, den Pfad wörtlich wie in der Transportregel) und liest sie daraus.
5. Ist `checks.mjs run` rot, genügt nach der Korrektur derselbe Aufruf `checks.mjs run --abschluss <kartennummer>`: Er fährt selbst zuerst die zuletzt roten Prüfungen und erst, wenn sie grün sind, im selben Aufruf einmal den vollen Lauf. Gezielte Einzeltests während der Korrektur bleiben erlaubt.

**Rueckfall: Schreibzugriff auf eine geschuetzte Datei abgewiesen.** Weist Claude Code einen Schreibzugriff ab, weil die Datei geschützt ist, obwohl die Aufgabe sie nicht beim Namen nennt, hält die Session an — ohne weiteren Versuch. Der Schutz wird nie umgangen, auch nicht über die Shell. Das ist nicht der Halt einer Stopp-Frage: anderes Label, anderer Anker, eine andere Reihenfolge, und der Weg nach vorn ist die Handlung des Menschen an der Datei, kein Fachkonzept. In dieser Reihenfolge:

1. Eigene uncommittete Aenderungen **namentlich** zuruecknehmen, selbst angelegte Dateien loeschen — nie pauschal den ganzen Arbeitsbaum verwerfen. Gemessen wird der eigene Anteil, belegt ueber die eigenen Werkzeugaufrufe.
2. `node .claude/kit/board.mjs issue move <id> backlog`
3. `node .claude/kit/board.mjs issue label add <id> kit:geschuetzt` — ein Fehlschlag wird gemeldet und beendet den Halt nicht.
4. Den Kommentar holen: `node .claude/kit/board.mjs issue check-geschuetzt <id> --pfad <abgewiesener Pfad>`, je abgewiesenem Pfad ein `--pfad`. Das Kommando endet mit Exit 1, das ist der Befund. Das Feld `kommentar` seiner Ausgabe beginnt mit dem Anker `## Geschuetzte Datei` und ist der Text — die Session baut ihn nicht selbst. Er geht als letzte Zeile ergänzt um die Label-Zeile aus Schritt 3 (`Label kit:geschuetzt gesetzt` oder `Label kit:geschuetzt nicht gesetzt`) nach der Transportregel (`CLAUDE-workflow.md`, „Lange Texte ans Board") ans Issue: Datei `<tmpdir>/<id>-geschuetzt.md` stückweise per Shell anlegen, dann `node .claude/kit/board.mjs issue comment <id> --text-file <tmpdir>/<id>-geschuetzt.md` — nie als Argument.
5. Melden, welche Datei ein Mensch ändern muss — **kein Commit**. In `/implement-ready` geht der Lauf danach mit dem naechsten Ready-Issue weiter, die anderen Skills enden damit.

Bleibt ein eigener Anteil zurueck, der sich nicht namentlich zuruecknehmen laesst — etwa eine Datei, die vor der Session schon fremde uncommittete Aenderungen trug —, wird **nicht** angehalten: kein Move, kein Label, kein Kommentar, kein Commit. Die Session meldet die Datei und endet; das Paket bleibt in In progress. Auch hier gilt: `kit:geschuetzt` wird nie entfernt.

### 3. Pruefungen vor dem Commit

```bash
node .claude/kit/checks.mjs run --abschluss <kartennummer>
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

**`--abschluss <kartennummer>` — dies ist der Abschluss genau einer Karte.** Nur ein
solcher Lauf darf die Pruefungen auslassen, die mit `nichtBeimAbschluss` als
Zusammenspiel-Pruefung gekennzeichnet sind: Sie messen, was mehrere Pakete gemeinsam
ergeben, und laufen vollstaendig vor dem Veroeffentlichen in `/push-main`. Die
**Kartennummer** ist die des Issues, das dieser Lauf abschliesst — ohne sie koennte die
Wirksamkeit ihre Kennzahl je Karte nicht rechnen (Issue #951).

Ein roter Lauf verhindert den Commit, wie bisher jeder rote Pflichtcheck.

Eine Hinweis-Pruefung haelt dagegen nie an: Sie endet gruen und schreibt ihre Funde als
`hinweis: <Datei und Grund>` in den Block `Fuer den Abschlussbericht:`. Die
`hinweis:`-Zeilen gehen wortgetreu in den Berichtsteil Tests und Checks mit und halten die Fertigmeldung nicht an —
kein Fix im selben Paket, keine Rueckfrage, kein Halt (Issue #1156).

Das Kommando nennt in seiner Ausgabe die **gelaufenen und die ausgelassenen**
Pruefungen, jeweils mit Grund. Beides gehoert in den Abschlussbericht (Schritt 5):
Nur die Laeufe zu nennen genuegt nicht — dann muesste man die Auslassungen indirekt
erschliessen, und ein verkuerzter Lauf saehe aus wie ein vollstaendiger. Die
Auslassungen werden **mit ihrem Grund** aus der Ausgabe uebernommen, wortgetreu und nicht
zu "ausgelassen" verkuerzt — erst der Grund sagt, ob eine Pruefung an ihrem Zeitpunkt
wartet oder ausfiel. Meldet das
Kommando `leeresPaket`, steht das ausdruecklich als "keine Pruefung, weil nichts
veraendert wurde" im Bericht, nicht als leere Liste.

**Wer eine Datei anlegt, ordnet sie zu.** Nennt der Block `Fuer den Abschlussbericht:`
`voller Umfang` wegen einer Datei, die dieses Paket angelegt hat, ergaenzt das Paket
`checkAreas` um ein passendes Muster (oder begruendet einen Eintrag in `ohnePruefung`)
und faehrt den Lauf erneut. Weist Claude Code den Schreibzugriff auf die Config ab
(Nachtlauf, geschuetzte Datei), steht die Datei unter `### Hinweise` im Bericht — kein
Anhalten, kein Umweg ueber die Shell.

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

### 5. Melden: Abschlussbericht und In review

Gleiches Format wie `implement-ready` Schritt 6, der Bericht steht unten.

Bericht ablegen und Karte nach In review ziehen ist **ein** Aufruf. Der Bericht steht als Argument in einfachen Anführungszeichen, ohne Zwischendatei, ohne Heredoc, ohne Pipe:

```bash
node .claude/kit/board.mjs issue melden <id> --text '## Abschlussbericht Issue #N
…'
```

**Maskierung:** Ein `'` im Bericht wird als `'\''` geschrieben — das ist die einzige Regel, alles andere steht im Bericht, wie es ist.

**Über 6.000 Zeichen** geht der Bericht in nummerierten Stücken, jedes ein **eigener** Werkzeugaufruf, weil die Grenze je Aufruf gilt. Ein Stück berührt das Board nicht, und eine Wiederholung überschreibt es:

```bash
node .claude/kit/board.mjs issue melden <id> --teil <n> --text '<Stück n>'
```

Danach der abschließende Aufruf ohne `--text` — er setzt die Stücke in Nummernfolge zusammen, legt ab, zieht nach In review und räumt die Stücke erst danach:

```bash
node .claude/kit/board.mjs issue melden <id>
```

Die letzte Zeile `Bericht-Lauf: <stempel>` setzt das Kit; die Session schreibt sie nicht. An ihr erkennt `issue melden` den Bericht dieses Laufs: Eine Wiederholung legt keinen zweiten an, sondern lässt ihn bei gleichem Inhalt stehen und ersetzt ihn bei geändertem. **Scheitert die Meldung**, ist die Karte nicht bewegt, und die Ausgabe nennt den Grund. Die Wiederholung ist der Abschlussaufruf allein — bei der Stückform `issue melden <id>` ohne `--text`, die Stücke liegen noch; bei der Einzelform derselbe Aufruf mit `--text`. Warum `issue melden` von der Transportregel ausgenommen ist, steht in `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board".

Die Ursprungsdokumente zieht `issue melden` selbst nach: Die Abschlussmeldung nennt die Zeilen aus dem Feld `ursprung` seiner Ausgabe (gewandert, lag bereits, nicht nachgezogen samt Kommando), und die Session bewegt Plan und fachliche Anforderung nie selbst.

Format des Abschlussberichts:

```
## Abschlussbericht Issue #N

### Änderungen
- `Datei.java` — kurze Beschreibung der Wirkung
- `DateiTest.java` — was getestet wird (von /implement-test vorbereitet)

### Tests und Checks
<die Zeilen aus dem Block `Fuer den Abschlussbericht:` der Ausgabe von `checks.mjs run`, wortgetreu, nicht umformuliert oder gekuerzt:>
- Wartezeit: <s> s, zusammen <s> s in <n> Laeufen fuer Karte #<n>   (ohne Kartennummer: Wartezeit: <s> s)
- Teillauf: nur die zuletzt roten Pruefungen   (nur nach einem roten Teillauf)
- gelaufen: <Kommando> → <Ergebnis>, <Dauer> — <Grund>
- hinweis: <Datei und Grund>   (je Fund einer Hinweis-Pruefung, direkt unter ihrer Zeile)
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
- Backlog nach Ready ziehen: nie — das ist Mannes GO. Ausnahme, ausschliesslich in der Umsetzungsstufe der Nacht-Kette unter Variante B: Dort zieht der Nacht-Runner die Arbeitspakete der gekennzeichneten Karte selbst nach Ready und beginnt ihre Umsetzung ohne Freigabe je Paket. Das GO hat der Mensch an der gekennzeichneten Karte gegeben — an der fachlichen Anforderung oder am Plandokument —, als er sie fuer Variante B kennzeichnete. Ausserhalb dieser Stufe gilt der Satz davor ohne Einschraenkung — auch fuer Pakete einer Karte, die frueher unter Variante B lief.
- Issues auf Done setzen: nie — das macht der Mensch nach seinem Test
- Issue-schließende Commit-Keywords (`Closes`/`Fixes`/`Resolves #N`): nie — nur `Refs #N`
- Testcode stillschweigend ändern: nie — bei Zweifel Rücksprache statt eigenmächtiger Korrektur
