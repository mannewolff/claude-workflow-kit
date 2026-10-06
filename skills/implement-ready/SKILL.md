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

### 0. Ready-Issues laden und Auftrag holen

```bash
node .claude/kit/board.mjs issue list --status ready
```

Gibt die Issues als JSON-Array in der Reihenfolge der Ready-Spalte des Boards (oben zuerst; nur der lokale Datei-Tracker liefert numerisch nach ID). Diese Reihenfolge ist verbindlich — der Mensch legt sie vor dem GO per Drag&Drop in der Ready-Spalte fest. Nicht numerisch umsortieren.

**Für jedes Issue zuerst den Auftrag holen — ein Aufruf, vor jedem Zug:**

```bash
node .claude/kit/board.mjs issue auftrag <id>
```

Der Auftrag liefert in einem Zug das **Urteil** (`darf beginnen` oder `darf nicht beginnen` samt Grund) mit seiner **Folge**, dazu die Aufgabe mit Kommentaren, die Plan-Entscheidungen im Wortlaut, den fachlichen Anlass, die Geschwister mit Spalte, die Voraussetzungen und die Lücken. Er läuft **vor** Schritt 1: Er erwartet die Karte in Ready, nach dem Zug nach In progress lautete seine Folge `bleibt`. Gehandelt wird allein nach der Folge. Die Prüfungen dahinter — die Titel-Präfixe `[Fachlich]`, `[Idee]`, `[Plan]` und `[Mensch]`, das Label `kit:klaeren`, das Label `kit:geschuetzt` und die geschützten Dateien, die das Paket nennt, die Spalte, die Voraussetzungen — und die Wortlaute der Backlog-Kommentare stehen in `kit/board.mjs`, nicht in diesem Skill:

- **`beginnen`** — weiter mit Schritt 1.
- **`bleibt`** — die Karte wird nicht bewegt und nicht kommentiert. Der Skill meldet den Grund aus dem Urteil, und der Lauf geht mit dem nächsten Issue weiter.
- **`backlog`** — die Karte ist keine Umsetzungsaufgabe oder trägt eine offene Frage an einen Menschen. Der Kommentar, den der Auftrag unter „Kommentar fuer die Karte (woertlich)" liefert, geht unverändert ans Issue, danach zieht die Karte nach Backlog, und der Lauf geht mit dem nächsten Issue weiter:

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

  Danach geht der Lauf mit dem nächsten Issue weiter.

**Das Label `kit:klaeren` wird dabei nie entfernt.** Die Maschine darf es setzen, abnehmen darf es nur der Mensch (Plan #368, A4) — ein Lauf, der sein eigenes `kit:klaeren` abraeumen duerfte, koennte sich selbst freigeben.

**Auch `kit:geschuetzt` wird nie entfernt.** Die Maschine setzt es, abnehmen darf es allein der Mensch, nachdem er die geschützte Änderung selbst vorgenommen hat — erst damit gilt das Paket beim nächsten Anlauf als freigegeben.

Ob ein Ready-Issue geprueft wurde, ist keine Frage dieses Skills — Ready ist das GO.

### 1. Issue nach In progress verschieben

```bash
node .claude/kit/board.mjs issue move <id> in_progress
```

### 2. Issue vollständig lesen

Gelesen wird der Auftrag aus Schritt 0. Er trägt Aufgabe, Kommentare und Zusammenhang schon: Ein weiteres `issue get` für die Karte, den Plan oder die fachliche Quelle braucht es nicht, und seine Ausgabe wird nicht per `node -e` oder `jq` zerlegt. Was er unter „Lücken" nennt, fehlt wirklich und wird nicht still ergänzt. Lies alle Abschnitte der Aufgabe. Implementiere **gegen das Issue**, nicht gegen den Chat. Was im Issue steht, wird gebaut. Was nicht drinsteht, bleibt draußen.

**Trägt das Issue eine Zeile `Empfohlenes Modell: <name>` oder `Aufgabenstufe: <schwer|mittel|leicht>`, nenne sie** — zusammen mit dem Hinweis, dass die laufende Sitzung ihr Modell nicht wechselt. Beide sind eine Angabe, keine Anweisung: Nachts wirkt sie von selbst (der Runner startet die Session der Karte damit), tagsüber wählt der Mensch sein Modell selbst und sitzt ohnehin daneben. **Kein Halt, keine Rückfrage, keine Änderung am Ablauf** — wer eine laufende Sitzung für eine Empfehlung zum Neustart auffordert, kostet mehr, als die Empfehlung wert ist.

**Trägt das Paket einen Vermerk mit dem Anker `## Nachtlauf: wartende Sitzung` oder `## Nachtlauf: Zeitgrenze erreicht`, nenne ihn** — dann wurde es schon einmal angefangen, und der zuletzt bekannte Stand steht im Vermerk. Der zweite Anker sagt zusaetzlich, dass der vorige Lauf an der Sitzungszeitgrenze endete. **Kein Halt, keine Ruecksprache**, nur die Meldung: Wer den Vermerk verschweigt, macht stillschweigend auf halbem Weg weiter.

### 3. Implementieren

- TDD: Tests zuerst schreiben und rot laufen lassen, dann gegen die Tests implementieren, bis grün
- Bestehende Muster und Funktionen wiederverwenden
- Kein Feature, keine Refactoring, keine Abstraktion die das Issue nicht verlangt
- Bei UI-Änderungen: Dev-Server starten, Golden Path und Edge Cases durchklicken
- Bei neuer oder geänderter Logik: abgedeckt oder begründet ausgeschlossen gemäß der Coverage-/Qualitäts-Policy des Projekts (siehe Projekt-Guide bzw. `workflow.config.json`). Untestete Logik nie stillschweigend ausschließen, Schwellen nie senken, nur damit ein Gate grün wird.
- Wiederkehrende, klassenweite Modell-Fehler (veraltete Idiome, abgekündigte APIs) nicht nur an den Fundstellen fixen: als harte Lint-/Compiler-Leitplanke für die `buildChecks` vorschlagen, aus vorhandenen Annotationen abgeleitet (z. B. `@typescript-eslint/no-deprecated`, Java `-Xlint:deprecation` mit `-Werror`) statt als handgepflegte Verbotsliste oder Bitte in einer CLAUDE-`*`.md — siehe das Leitplanken-Prinzip im `local-check`-Skill.
- Lang laufende Build-, Test- und Mutationstest-Kommandos (`mvn verify`, PIT, Testcontainers-ITs) mit explizit gesetztem, großzügigem Timeout aufrufen statt mit dem generischen Default — siehe die Timeout-Leitplanke im `local-check`-Skill.
- Einen im Hintergrund gestarteten Pflichtcheck vor Abschluss des Berichts immer aktiv abwarten — nie mit einer bloßen Ankündigung wie "ich melde mich, sobald der Lauf durch ist" enden, siehe die Leitplanke zum Hintergrund-Check im `local-check`-Skill.
- Allgemeiner, und darum die Regel hinter der Zeile davor: **Keine Session endet mit laufender eigener Arbeit** — gleich welcher, nicht nur bei einem Pflichtcheck. Wer einen langen Lauf angestossen hat, wartet auf sein Ergebnis oder bricht ihn ab und meldet den Abbruch als Fehlschlag; eine Schlussmeldung, die nur sagt, dass noch gewartet wird, ist kein Abschluss, sondern der Fehlschlag selbst (Issue #754). Wer wartet, prueft dabei zweierlei: ob das Ergebnis da ist und ob der Lauf **noch existiert** — eine Warteschleife ohne die zweite Pruefung wartet im Fehlerfall ihre volle Laenge ab, und ein Lauf, den es nicht mehr gibt, ist ein Fehlschlag und wird als solcher gemeldet, nicht als Zeitablauf (Issue #983).
- Ohne Aufsicht (gesetztes `KIT_AGENT_MODEL`) gibt es keine Hintergrundarbeit: Der Hook `bash-pruefen` weist einen Bash-Aufruf mit `run_in_background` ab (Issue #1081) — den Befehl im Vordergrund aufrufen und auf ihn warten. Interaktiv bleibt Hintergrundarbeit erlaubt.

**Nur die Tests des Pakets laufen lassen.** Die volle Suite ist der teuerste Einzelposten einer Session — sie mehrfach zu starten, kostet Minuten und bringt nichts dazu:

1. Während der Arbeit laufen nur die Tests, die das Paket berührt — gezielt per Datei oder Filter des Test-Runners, zum Beispiel `node --test test/<datei>.test.mjs`. Dazu gehören auch die Tests dessen, was von der geänderten Datei abhängt — nicht nur die der Datei selbst. Gibt es die dafür nur als vollständige Gruppe, fährt die Session sie über `node .claude/kit/checks.mjs run --bereich <name>`; das ist dann kein Verstoß gegen die Zehn-Minuten-Marke, sondern der vorgesehene Weg.
2. Die volle Suite startet die Session nicht selbst. Der eine volle Lauf ist `node .claude/kit/checks.mjs run --abschluss <kartennummer>` vor dem Commit. Sein Block `Fuer den Abschlussbericht:` beginnt mit der Zeile `Wartezeit:`, die wie der Rest wortgetreu in den Bericht geht.
3. Ein zweiter `checks.mjs run` auf **unverändertem Stand** fährt kein Kommando mehr: Das Kommando übernimmt das Ergebnis des vorigen Laufs — auch ein rotes — samt Exitcode und meldet das. `--frisch` erzwingt den echten Lauf.
4. Hinweis dazu: Wer die Ausgabe eines langen Laufs mehrfach auswerten will, schreibt sie am einfachsten einmal in eine Datei außerhalb des Projektverzeichnisses (`<tmpdir>/…`, den Pfad wörtlich wie in der Transportregel) und liest sie daraus.
5. Ist `checks.mjs run` rot, genügt nach der Korrektur derselbe Aufruf `checks.mjs run --abschluss <kartennummer>`: Er fährt selbst zuerst die zuletzt roten Prüfungen und erst, wenn sie grün sind, im selben Aufruf einmal den vollen Lauf. Gezielte Einzeltests während der Korrektur bleiben erlaubt.

Für eine granularere Variante mit explizitem Stopp zwischen rot und grün: `/implement-test` gefolgt von `/implement-done`.

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

**Rueckfall: Schreibzugriff auf eine geschuetzte Datei abgewiesen.** Weist Claude Code einen Schreibzugriff ab, weil die Datei geschützt ist, obwohl die Aufgabe sie nicht beim Namen nennt, hält die Session an — ohne weiteren Versuch. Der Schutz wird nie umgangen, auch nicht über die Shell. Das ist nicht der Halt einer Stopp-Frage: anderes Label, anderer Anker, eine andere Reihenfolge, und der Weg nach vorn ist die Handlung des Menschen an der Datei, kein Fachkonzept. In dieser Reihenfolge:

1. Eigene uncommittete Aenderungen **namentlich** zuruecknehmen, selbst angelegte Dateien loeschen — nie pauschal den ganzen Arbeitsbaum verwerfen. Gemessen wird der eigene Anteil, belegt ueber die eigenen Werkzeugaufrufe.
2. `node .claude/kit/board.mjs issue move <id> backlog`
3. `node .claude/kit/board.mjs issue label add <id> kit:geschuetzt` — ein Fehlschlag wird gemeldet und beendet den Halt nicht.
4. Den Kommentar holen: `node .claude/kit/board.mjs issue check-geschuetzt <id> --pfad <abgewiesener Pfad>`, je abgewiesenem Pfad ein `--pfad`. Das Kommando endet mit Exit 1, das ist der Befund. Das Feld `kommentar` seiner Ausgabe beginnt mit dem Anker `## Geschuetzte Datei` und ist der Text — die Session baut ihn nicht selbst. Er geht als letzte Zeile ergänzt um die Label-Zeile aus Schritt 3 (`Label kit:geschuetzt gesetzt` oder `Label kit:geschuetzt nicht gesetzt`) nach der Transportregel (`CLAUDE-workflow.md`, „Lange Texte ans Board") ans Issue: Datei `<tmpdir>/<id>-geschuetzt.md` stückweise per Shell anlegen, dann `node .claude/kit/board.mjs issue comment <id> --text-file <tmpdir>/<id>-geschuetzt.md` — nie als Argument.
5. Melden, welche Datei ein Mensch ändern muss — **kein Commit**. In `/implement-ready` geht der Lauf danach mit dem naechsten Ready-Issue weiter, die anderen Skills enden damit.

Bleibt ein eigener Anteil zurueck, der sich nicht namentlich zuruecknehmen laesst — etwa eine Datei, die vor der Session schon fremde uncommittete Aenderungen trug —, wird **nicht** angehalten: kein Move, kein Label, kein Kommentar, kein Commit. Die Session meldet die Datei und endet; das Paket bleibt in In progress. Auch hier gilt: `kit:geschuetzt` wird nie entfernt.

### 4. Pruefungen vor dem Commit

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
Pruefungen, jeweils mit Grund. Beides gehoert in den Abschlussbericht (Schritt 6):
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

### 6. Melden: Abschlussbericht und In review

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

Format des Abschlussberichts:

```
## Abschlussbericht Issue #N

### Änderungen
- `Datei.java` — kurze Beschreibung der Wirkung
- `DateiTest.java` — was getestet wird

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

### 7. Nächstes Issue

Sobald das Issue in In review liegt: naechstes Issue aus dem zuvor geladenen Ready-Array abarbeiten (in Array-Reihenfolge). Wenn Ready leer ist: Vollzug melden.

### Stand des Vorhabens

Hat dieser Lauf das letzte offene Paket eines Vorhabens nach In review gebracht — ein Paket mit `Plan: Issue #M`, und keine andere Karte mit derselben Zeile steht laut `node .claude/kit/board.mjs issue list` noch in Backlog, Ready oder In progress —, beginnt die Schlussmeldung mit dem Abschnitt `## Stand des Vorhabens`:

1. **Was der Mensch jetzt sieht** — was sich für jemanden, der die Software benutzt, sichtbar geändert hat, in wenigen Sätzen.
2. **Was vom Anlass nicht enthalten ist** — jedes Ziel und jedes fachliche Akzeptanzkriterium der fachlichen Quelle, das kein Paket hergestellt hat, und bei einer `Vorlage:`-Zeile jede Abweichung von der Vorlage. „Nichts" steht dort nur nach einem Abgleich Punkt für Punkt.
3. Erst danach Commits, Checks und Hinweise.

Die fachliche Quelle kommt aus der Zeile `Fachliche Quelle: Issue #N` des Plans `#M`, geholt mit `node .claude/kit/board.mjs issue get <N>` — nie aus dem Gespräch. Grün heißt „erfüllt, was aufgeschrieben wurde", nicht „erfüllt, was gemeint war"; wer das Fehlende weiter unten liest, hält das Vorhaben für fertig. Ein Paket ohne `Plan:`-Zeile gehört zu keinem Vorhaben, der Abschnitt entfällt. Unbeaufsichtigt steht derselbe Abschnitt am Anfang des Abschlussberichts des letzten Pakets.

## Verhalten bei leerem Ready

> "Ready ist leer. Alle Issues in In review. Ich warte auf dein GO für den nächsten Batch."

Kein eigenmächtiges Ziehen aus Backlog. Kein Raten, welches Issue sinnvoll wäre.

## Stop-Punkte

- Fachliche Issues (`[Fachlich]`-Titel), Ideen (`[Idee]`-Titel), Plandokumente (`[Plan]`-Titel) und Menschenschritte (`[Mensch]`-Titel) implementieren: nie — kommentiert zurück nach Backlog
- Pushen: nie ohne explizite Trigger-Phrase `push main`
- Backlog nach Ready ziehen: nie — das ist Mannes GO. Ausnahme, ausschliesslich in der Umsetzungsstufe der Nacht-Kette unter Variante B: Dort zieht der Nacht-Runner die Arbeitspakete der gekennzeichneten Karte selbst nach Ready und beginnt ihre Umsetzung ohne Freigabe je Paket. Das GO hat der Mensch an der gekennzeichneten Karte gegeben — an der fachlichen Anforderung oder am Plandokument —, als er sie fuer Variante B kennzeichnete. Ausserhalb dieser Stufe gilt der Satz davor ohne Einschraenkung — auch fuer Pakete einer Karte, die frueher unter Variante B lief.
- Issues auf Done setzen: nie — das macht der Mensch nach seinem Test
- Issue-schließende Commit-Keywords (`Closes`/`Fixes`/`Resolves #N`): nie — sie schließen das Issue beim Push/Merge und die Board-Automation zieht es nach Done, bevor getestet wurde. Nur `Refs #N` verwenden.
