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

### 1. Ready-Issues laden und Auftrag holen

```bash
node .claude/kit/board.mjs issue list --status ready
```

Issue mit der niedrigsten ID nehmen. Diese Auswahl ist verbindlich, kein Raten, welches Issue sinnvoller wäre.

Dann den Auftrag holen — ein Aufruf, **vor** dem Zug nach In progress, denn er erwartet die Karte in Ready:

```bash
node .claude/kit/board.mjs issue auftrag <id>
```

Er liefert das **Urteil** (`darf beginnen` oder `darf nicht beginnen` samt Grund) mit seiner **Folge**, dazu die Aufgabe mit Kommentaren, die Plan-Entscheidungen im Wortlaut, den fachlichen Anlass, die Geschwister mit Spalte, die Voraussetzungen und die Lücken. Gehandelt wird allein nach der Folge; die Prüfungen dahinter und die Wortlaute der Backlog-Kommentare stehen in `kit/board.mjs`, nicht in diesem Skill:

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

### 2. Issue nach In progress verschieben

```bash
node .claude/kit/board.mjs issue move <id> in_progress
```

### 3. Issue vollständig lesen

Gelesen wird der Auftrag aus Schritt 1; ein weiteres `issue get` braucht es nicht, und seine Ausgabe wird nicht per `node -e` oder `jq` zerlegt. Lies alle Abschnitte der Aufgabe. Die Tests entstehen gegen das Issue, nicht gegen den Chat.

### 4. Nur die Tests schreiben

- Testdatei(en) gegen das Akzeptanzkriterium schreiben — so, dass sie beim jetzigen Stand des Codes fehlschlagen (rot).
- Keine Produktionslogik. Kein Stub, keine Mock-Implementierung, die den Test schon grün macht.
- Bestehende Test-Muster und -Helfer des Projekts wiederverwenden.
- Ohne Aufsicht (gesetztes `KIT_AGENT_MODEL`) gibt es keine Hintergrundarbeit: Der Hook `bash-pruefen` weist einen Bash-Aufruf mit `run_in_background` ab (Issue #1081) — den Befehl im Vordergrund aufrufen und auf ihn warten. Interaktiv bleibt Hintergrundarbeit erlaubt.

**Nur die Tests des Pakets laufen lassen.** Die volle Suite ist der teuerste Einzelposten einer Session — sie mehrfach zu starten, kostet Minuten und bringt nichts dazu:

1. Während der Arbeit laufen nur die Tests, die das Paket berührt — gezielt per Datei oder Filter des Test-Runners, zum Beispiel `node --test test/<datei>.test.mjs`. Dazu gehören auch die Tests dessen, was von der geänderten Datei abhängt — nicht nur die der Datei selbst. Gibt es die dafür nur als vollständige Gruppe, fährt die Session sie über `node .claude/kit/checks.mjs run --bereich <name>`; das ist dann kein Verstoß gegen die Zehn-Minuten-Marke, sondern der vorgesehene Weg.
2. Die volle Suite startet die Session nicht selbst. Der eine volle Lauf ist `node .claude/kit/checks.mjs run --abschluss <kartennummer>` vor dem Commit. Sein Block `Fuer den Abschlussbericht:` beginnt mit der Zeile `Wartezeit:`, die wie der Rest wortgetreu in den Bericht geht. Die Abschlussprüfung wiederholt eine rote Prüfung selbst einmal auf demselben Stand — die Session wiederholt sie nicht zusätzlich; eine `Gewackelt:`-Zeile geht wortgetreu in den Bericht, und das Paket geht wie gewohnt nach In review.
3. Ein zweiter `checks.mjs run` auf **unverändertem Stand** fährt kein Kommando mehr: Das Kommando übernimmt das Ergebnis des vorigen Laufs — auch ein rotes — samt Exitcode und meldet das. `--frisch` erzwingt den echten Lauf.
4. Hinweis dazu: Wer die Ausgabe eines langen Laufs mehrfach auswerten will, schreibt sie am einfachsten einmal in eine Datei außerhalb des Projektverzeichnisses (`<tmpdir>/…`, den Pfad wörtlich wie in der Transportregel) und liest sie daraus.
5. Ist `checks.mjs run` rot, genügt nach der Korrektur derselbe Aufruf `checks.mjs run --abschluss <kartennummer>`: Er fährt selbst zuerst die zuletzt roten Prüfungen und erst, wenn sie grün sind, im selben Aufruf einmal den vollen Lauf. Gezielte Einzeltests während der Korrektur bleiben erlaubt.

Das rote Laufenlassen der neuen Tests aus Schritt 4 ist genau so ein gezielter Lauf: nur die geschriebene Testdatei, nicht die Suite. Den vollen Lauf holt `/implement-done` vor dem Commit nach. Er traegt dort `--abschluss <kartennummer>`, weil er der
Abschluss genau einer Karte ist; dieser Skill schliesst nichts ab und faehrt ihn nicht.

**Rueckfall: Schreibzugriff auf eine geschuetzte Datei abgewiesen.** Weist Claude Code einen Schreibzugriff ab, weil die Datei geschützt ist, obwohl die Aufgabe sie nicht beim Namen nennt, hält die Session an — ohne weiteren Versuch. Der Schutz wird nie umgangen, auch nicht über die Shell. Das ist nicht der Halt einer Stopp-Frage: anderes Label, anderer Anker, eine andere Reihenfolge, und der Weg nach vorn ist die Handlung des Menschen an der Datei, kein Fachkonzept. In dieser Reihenfolge:

1. Eigene uncommittete Aenderungen **namentlich** zuruecknehmen, selbst angelegte Dateien loeschen — nie pauschal den ganzen Arbeitsbaum verwerfen. Gemessen wird der eigene Anteil, belegt ueber die eigenen Werkzeugaufrufe.
2. `node .claude/kit/board.mjs issue move <id> backlog`
3. `node .claude/kit/board.mjs issue label add <id> kit:geschuetzt` — ein Fehlschlag wird gemeldet und beendet den Halt nicht.
4. Den Kommentar holen: `node .claude/kit/board.mjs issue check-geschuetzt <id> --pfad <abgewiesener Pfad>`, je abgewiesenem Pfad ein `--pfad`. Das Kommando endet mit Exit 1, das ist der Befund. Das Feld `kommentar` seiner Ausgabe beginnt mit dem Anker `## Geschuetzte Datei` und ist der Text — die Session baut ihn nicht selbst. Er geht als letzte Zeile ergänzt um die Label-Zeile aus Schritt 3 (`Label kit:geschuetzt gesetzt` oder `Label kit:geschuetzt nicht gesetzt`) nach der Transportregel (`CLAUDE-workflow.md`, „Lange Texte ans Board") ans Issue: Datei `<tmpdir>/<id>-geschuetzt.md` stückweise per Shell anlegen, dann `node .claude/kit/board.mjs issue comment <id> --text-file <tmpdir>/<id>-geschuetzt.md` — nie als Argument.
5. Melden, welche Datei ein Mensch ändern muss — **kein Commit**. In `/implement-ready` geht der Lauf danach mit dem naechsten Ready-Issue weiter, die anderen Skills enden damit.

Bleibt ein eigener Anteil zurueck, der sich nicht namentlich zuruecknehmen laesst — etwa eine Datei, die vor der Session schon fremde uncommittete Aenderungen trug —, wird **nicht** angehalten: kein Move, kein Label, kein Kommentar, kein Commit. Die Session meldet die Datei und endet; das Paket bleibt in In progress. Auch hier gilt: `kit:geschuetzt` wird nie entfernt.

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
