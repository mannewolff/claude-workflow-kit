---
name: issue-review
description: Lässt ein Dokument von fremden Modellen prüfen, die es nicht geschrieben haben, bevor es nach Ready wandert. Nutze diesen Skill wenn der Nutzer /issue-review aufruft oder Issues vor dem GO schärfen will.
user-invocable: true
---

# Issue Review

Werkzeug neben dem Prozess, zwischen `/issues` (Schritt 3) und dem GO (Schritt 4). Ein Dokument wird von Modellen gelesen, die es nicht geschrieben haben — und geschärft, bevor jemand danach implementiert.

**Wie viele prüfen, entscheidet die Stufe** (Schritt 1b): Die fachliche Anforderung und das Plandokument bekommen je zwei Prüfer, das einzelne Arbeitspaket nur noch einen. Der Grund steht bei der Stufe `issue`.

**Warum das trägt:** Der Autor eines Issues hat den Kontext im Kopf, aus dem es entstanden ist. Was er nicht hingeschrieben hat, fällt ihm beim Lesen nicht auf — er ergänzt es unbewusst. Ein fremdes Modell war bei dieser Entstehung nicht dabei — es liest, was dasteht, und stolpert dort, wo später die Implementierung stolpert. (Den Bestand darf es dabei lesen; kontextlos heißt ohne Entstehungsgeschichte, nicht ohne Code — siehe Schritt 3.) Das ist derselbe Grund, aus dem der Code-Review in Schritt 7 funktioniert, nur eine Stufe früher und mit höherem Einsatz: Ein Fehler im Issue pflanzt sich in die ganze Umsetzung fort.

## Vorbedingung

Die Konfiguration liegt in `.claude/workflow.config.json` (im Repository, gilt fuer alle) und wird optional durch `.claude/workflow.config.local.json` ergaenzt (nicht im Repository, nur persoenliche Felder: `reviewModel`, `reviewScope`, `triggers`, Token-Pfade). Issue #207.

Relevant ist der Block `issueReview`:

```json
"issueReview": {
  "rounds": 1,
  "reviewers": [
    { "name": "opus",   "kind": "claude",  "model": "claude-opus-5" },
    { "name": "sonnet", "kind": "claude",  "model": "claude-sonnet-5" },
    { "name": "fable",  "kind": "claude",  "model": "claude-fable-5" },
    { "name": "codex",  "kind": "command", "command": "codex exec --model gpt-5" }
  ]
}
```

Fehlt der Block, sag das und beende — ohne Reviewer gibt es nichts zu tun.

`rounds` ist der **Regelfall**, nicht die Rundenzahl dieses Laufs: Ein Ticket kann sie mit einer `Pruefung:`-Zeile überschreiben. Gelesen wird sie deshalb nie hier, sondern über `issue-review roles --issue <N>` (Schritt 2 und 4).

## Aufruf

```
/issue-review                    # alle Issues im Backlog ohne Review-Marker
/issue-review #205 #207          # genau diese
/issue-review --dry-run          # nur Vorflug, nichts starten
```

## Ablauf

### 0. Vorflug — immer, nicht nur bei --dry-run

```bash
node .claude/kit/board.mjs issue-review check
```

Meldet je Reviewer, ob er laufen kann. **Ist nicht alles verfügbar, frage den Menschen, bevor irgendetwas startet** — mit der Liste, was fehlt und warum:

> `codex` ist nicht im PATH. Ich kann mit dem verbleibenden Reviewer weitermachen oder abbrechen. Wie möchtest du?

Der Grund für die Rückfrage: Ein unterbesetzter Lauf sieht am Board aus wie ein vollständiger. Wer das nicht merkt, hält ein halb geprüftes Dokument für geprüft. Maßstab ist die Sollbesetzung der Stufe aus `issue-review roles` (Feld `reviewer`), nicht eine feste Zahl — auf der Stufe `issue` ist ein Reviewer die volle Besetzung, auf den Stufen `fachlich` und `plan` sind es zwei.

**Im Nachtbetrieb wird hier nicht gefragt** (siehe unten): Der Runner hat den Vorflug vor dem Lauf gefahren und bei fehlendem Reviewer gar nicht erst gestartet.

Bei `--dry-run` endet der Skill hier. Er listet zusätzlich, welche Issues er bearbeiten würde und welche Reviewer je Issue drankämen. **Nichts wird gestartet, nichts geschrieben.**

### 1. Issues bestimmen

**Ohne Argumente:** alle Dokumente in Backlog, die noch keinen Marker **ihrer Stufe** tragen. Welcher Marker das ist, entscheidet Schritt 1b — für ein Arbeitspaket `Issue-Review:`, für eine fachliche Anforderung `Fachplan-Review:`, für ein Plandokument `Plan-Review:`.

```bash
node .claude/kit/board.mjs issue list --status backlog
```

**Mit Argumenten:** genau die übergebenen Nummern, unabhängig von Spalte und Marker. Ein erneuter Review ist ausdrücklich erlaubt — etwa nachdem sich die Anforderung geändert hat.

**Übersprungen werden** Dokumente aus zwei Gründen. Beide gehören in die Zusammenfassung, damit niemand ein übersprungenes Dokument für geprüft hält:

1. **Titel-Präfix `[Idee]`** — eine rohe Idee ohne `/plan`-Zyklus ist kein prüfbares Dokument.
2. **Ein gültiger, nicht verfallener Verzicht** (`Pruefung: Verzicht` im Kontext-Abschnitt). Der Mensch hat entschieden, dass dieses Dokument ohne Prüfung freigegeben wird — ein Review, der trotzdem liefe, würde diese Entscheidung überschreiben. Ob der Verzicht noch gilt, sagt nicht die Zeile allein: Maßgeblich ist das Feld `verzicht` der `roles`-Antwort (Schritt 2), denn nur sie kennt den Bezugsstand und damit den Verfall. Ist der Verzicht **verfallen**, ist er kein Ausschlussgrund — dann läuft der Review normal (Schritt 4).

**Auch mit expliziter Nummer schließt ein gültiger Verzicht den Review aus.** Ein erneuter Review ist unabhängig vom Marker erlaubt, ein Verzicht ist aber keine Marker-Frage, sondern eine Entscheidung des Menschen. Sie wird **einmal sichtbar gemeldet**, danach endet der Lauf für dieses Dokument **ohne Reviewer-Start**:

> #205 trägt `Pruefung: Verzicht` — bewusst ohne Prüfung freigegeben. Kein Reviewer gestartet.

`[Fachlich]` und `[Plan]` werden **nicht mehr übersprungen**: Sie bestimmen die Prüfstufe (Schritt 1b).

### 1b. Stufe bestimmen

Die Stufe folgt dem Titel-Präfix:

| Präfix | Stufe | Dokument |
|---|---|---|
| `[Fachlich]` | `fachlich` | fachliche Anforderung aus `/fachplan` |
| `[Plan]` | `plan` | Plandokument aus `/plan` |
| kein Präfix | `issue` | Arbeitspaket aus `/issues` |
| `[Idee]` | — | ausgeschlossen, siehe oben |

Die Präfix-Erkennung ist **rückwärtskompatibel** zum bisherigen Verhalten: unabhängig von Groß- und Kleinschreibung, nach optional führendem Leerraum, auch ohne Leerzeichen nach `]`. Ein Präfix mitten im Titel zählt nicht — `Text über [Plan]` ist ein Arbeitspaket.

Rollen, Reviewer-Zahl und die einzusetzenden Reviewer kommen aus:

```bash
node .claude/kit/board.mjs issue-review roles \
  --stufe <fachlich|plan|issue> \
  --author <modell> \
  --issue <N>
```

`--author` ist Pflicht. Die Antwort liefert `rollen`, `reviewer` und `gewaehlt`; **`gewaehlt[i]` wird mit `rollen[i]` gepaart** — der erste gewählte Reviewer bekommt die erste Rolle. **Gestartet wird ausschließlich, was in `gewaehlt` steht.** Das stufenlose `reviewers`-Kommando wird für die Ausführung nicht mehr benutzt: Es liefert per Definition zwei Reviewer und würde die Besetzung der Stufe `issue` still verdoppeln.

Die Antwort trägt außerdem `stufenQuelle`. Steht dort `"stufen"`, gilt die konfigurierte Besetzung; steht dort `"default"`, fehlt der `reviewStufen`-Block und es gilt der Legacy-Fallback (siehe Schritt 3).

**`--issue <N>` ist in diesem Skill nicht optional.** Nur mit der Nummer liest das Kommando die Prüfvorgabe am Ticket und liefert die drei Felder `runden`, `verzicht` und `vorgabeQuelle` (Issue #302) — sie tragen die Auswahl (Schritt 1) und die Rundenzahl (Schritt 4). Ohne die Nummer antwortet es mit dem Regelfall und meldet `vorgabeQuelle: "config"`; die Entscheidung des Menschen am Ticket bliebe dann unsichtbar.

**Auswahl ohne Argumente:** Erst alle Backlog-Dokumente laden, dann je Dokument die Stufe aus dem Titel bestimmen und **nur den Marker dieser Stufe** prüfen. Ein Marker einer anderen Stufe zählt nicht als Nachweis. Ohne diese Reihenfolge würde ein bereits geprüftes fachliches Dokument erneut ausgewählt, weil sonst auf `Issue-Review:` gefiltert wird. Mit expliziten Nummern bleibt ein erneuter Review unabhängig vom vorhandenen Marker erlaubt.

**Abgrenzung:** Die stufenabhängige Kandidatenauswahl und der stufenabhängige Marker-Vergleich im Nacht-Runner sind Gegenstand von Issue #283. Die ausformulierten Rollen-Prompts stehen in Schritt 3: fachlich aus Issue #280, Plan aus Issue #281, Arbeitspaket aus Issue #282.

### 2. Autor-Modell lesen und Reviewer wählen

Das Autor-Modell steht als Zeile im Kontext-Abschnitt (`Autor-Modell: …`, angelegt von `/issues`).

**Fehlt sie oder lautet sie `unbekannt`, frage einmal nach** — mit dem vorgeschlagenen Reviewer:

> #205 nennt kein Autor-Modell. Vorschlag: `codex`. Wer hat es geschrieben? (Modellname / weiter mit Vorschlag)

Das ist der einzige neue Stopp-Punkt und er kostet ein Wort. Ohne ihn prüft bei jedem Issue, das vor der Konvention entstanden ist, womöglich der Autor sein eigenes Dokument — und der Marker suggeriert am Ende trotzdem, es sei geprüft worden. Auf der Stufe `issue`, wo genau ein Reviewer läuft, ist der Review dann vollständig wertlos.

**Ausnahme im Nachtbetrieb:** Läuft der Skill ohne Menschen (erkennbar an gesetztem `KIT_AGENT_MODEL`), wird **nicht** gefragt. Dann gilt der Regel-Vorschlag, und der Board-Kommentar vermerkt das ausdrücklich. Dieselbe Asymmetrie wie beim Gate aus Issue #223, aus demselben Grund: Eine Session, die auf eine Antwort wartet, ist vom Runner nicht von einem Fehlschlag zu unterscheiden.

Steht das Autor-Modell fest, wird die Besetzung stufenbezogen abgefragt — für ein Arbeitspaket also:

```bash
node .claude/kit/board.mjs issue-review roles --stufe issue --author <modell> --issue <N>
```

Meldet die Antwort `unterbesetzt: true`, läuft der Review trotzdem — aber die **erste Zeile** des Board-Kommentars sagt, mit wie vielen Reviewern gefahren wurde. Auf der Stufe `issue` heißt `unterbesetzt` allerdings: gar kein Reviewer. Dann gilt die Ausfall-Regel im Unterabschnitt zur Stufe `issue`.

Die Antwort trägt außerdem `quelle: "pairs" | "regel"` (Issue #225). Nenne den Wert im Board-Kommentar: Wer eine `pairs`-Zeile für seinen Autor erwartet hat und `regel` liest, sieht sofort, dass der Name dort fehlt oder anders geschrieben ist.

**`quelle: "regel"` bei gesetztem Autor-Modell hat noch eine zweite Ursache:** Die Auflösung des Autors auf einen Reviewer-Kurznamen ist fehlgeschlagen. `/issues` schreibt die volle Modell-ID (`claude-opus-5`), `pairs` ist mit Kurznamen geschlüsselt (`opus`); die Übersetzung läuft über `reviewers[].model`. Steht das Modell dort nicht, greift `pairs` nicht — und der Autor kann unter den Reviewern landen, also sein eigenes Issue prüfen. Das Feld **`autorAufgeloest: false`** in derselben Antwort zeigt genau diesen Fall an. Es ist erlaubt (älteres Issue ohne Autor-Zeile, ein Mensch als Autor), gehört bei gesetztem Autor-Modell aber in den Board-Kommentar — dann fehlt in der Config ein `model`-Eintrag.

Wer wissen will, wer wen prüft, muss dafür nicht die Config lesen:

```bash
node .claude/kit/board.mjs issue-review matrix
```

### 3. Reviewer starten — jede Rolle ein anderer Blickwinkel

Jeder Reviewer bekommt denselben unveränderten Body, aber **seine eigene Rolle** aus `rollen`. Wo eine Stufe mehrere Prüfer vorsieht, ist der Gewinn der Blickwinkel und nicht die Anzahl: Derselbe Prompt an mehrere Modelle findet großenteils dasselbe.

Welcher Unterabschnitt gilt, entscheidet die Stufe aus Schritt 1b.

**Die Streich-Frage ist Pflicht in jeder Rolle.** Reviewer schlagen von sich aus Ergänzungen vor, weil Ergänzen leichter ist als Streichen. Ein Dokument, das nach dem Review doppelt so lang ist, ist nicht automatisch besser implementierbar — ohne diese Frage kippt der Roundtrip in Aufblähung.

#### Darf ein Reviewer den Bestand lesen? Ja.

**Kontextlosigkeit meint die Entstehungsgeschichte, nicht den Code.** Der Wert des fremden Modells liegt darin, dass es das Gespräch nicht kennt, aus dem das Issue entstand — die Absicht, die Datei, die dabei offen war, die Entscheidung von vorgestern. Davon hat es auch dann nichts, wenn es das Repository liest.

Der Reviewer darf und soll deshalb den Bestand lesen: Dateien öffnen, suchen, nachschlagen. Die Rolle `architektur-bestand` fragt ausdrücklich, ob jede Behauptung über den Bestand stimmt — diese Frage ist ohne Blick in den Code nicht zu beantworten, und ein Prompt, der sie stellt und den Blick zugleich verbietet, verlangt Unmögliches.

**Woher die Klarstellung kommt:** Bis Issue #268 stand in den Rollen-Prompts der Satz „du hast nur den Text". Subagents mit Werkzeugen haben ihn folgerichtig ignoriert — am 2026-08-08 in zwei Läufen protokolliert, jeweils mit deutlich konkreteren Funden (der Reviewer wies nach, dass ein referenziertes Kommando im Adapter gar nicht existiert). Ein Satz, den das Werkzeug ohnehin nicht einhält, ist keine Regel, sondern eine Fehlerquelle: Er macht Befunde unvergleichbar, weil am Board nicht steht, welcher Reviewer nachgesehen hat.

**Deshalb wird der Zugriff ausgewiesen, nicht verboten.** Der Board-Kommentar nennt je Reviewer eine Zeile der Form:

```
codex (pruefbarkeit) — Bestand: gelesen
```

Wer nicht nachgesehen hat, steht mit `Bestand: nein` da. Bei mehreren Prüfern eine Zeile je Reviewer.

**Bei `kind: "command"`-Reviewern ist das nicht durchsetzbar.** Ein fremdes Werkzeug bringt seine eigenen Rechte mit; ob es ins Repository sieht, entscheidet es selbst. Genau deshalb gehört es in den Kommentar — was man nicht erzwingen kann, muss man wenigstens ablesen können.

#### Stufe `issue`: die eine Rolle des Arbeitspakets

Diese Stufe läuft mit **einem** Reviewer. Nicht aus Sparsamkeit: Zuschnitt, Abhängigkeiten und Kollateralschäden entscheiden sich im Plan und werden dort geprüft — ein Prüfer, der nur ein einzelnes Paket sieht, kann sie ohnehin nicht beurteilen. Belegt am 2026-08-08: Drei der vier Scope-Befunde jenes Laufs waren Fehlalarme an Abhängigkeitsgrenzen, weil der Prüfer das Nachbar-Issue nicht sah.

**Rolle B ist nicht gestrichen, sie ist gewandert** — als `schnitt-abhaengigkeiten` in die Stufe `plan`, wo der Prüfer den ganzen Zuschnitt vor sich hat. Was hier bleibt, ist die maschinelle Prüfbarkeit der Akzeptanzkriterien; sie hat auf den oberen Stufen kein Gegenstück, weil Akzeptanzkriterien erst beim Schreiben der Arbeitspakete entstehen.

**Rolle `pruefbarkeit`:**

```
Du prüfst ein Issue, das gleich implementiert werden soll. Du kennst die
Entstehungsgeschichte nicht — nicht das Gespräch, nicht die Absicht dahinter. Das
ist gewollt: Genau diese Lücke sollst du finden. Den Bestand darfst du lesen;
schlag im Repository nach, wo es deinen Befund schärft.

Prüfe auf Vollständigkeit und Prüfbarkeit:
1. Ist jedes Akzeptanzkriterium maschinell prüfbar (Kommando, Dateizustand,
   Testergebnis)? Was ein menschliches Urteil oder eine menschliche Handlung
   braucht, gehört in den Block "### Manuelle Prüfung (Mensch, nicht Teil des
   Session-Abschlusses)". Steht so etwas fälschlich oben, ist das ein Fund.
2. Ist "fertig" eindeutig, oder bleibt Interpretationsspielraum?
3. Fehlen Randfälle, Fehlerpfade, Rückwärtskompatibilität?
4. Was kann RAUS? Welcher Satz, welches Kriterium trägt nichts?

Für jeden Fund:
- Schweregrad: BLOCKER / WICHTIG / HINWEIS
- **Klasse:** `gate` (Verstoß gegen eine Regel aus einem Register — nenne welche),
  `alternativen` (mehr als ein gangbarer Weg — nenne welche) oder `korrektur`
  (plausibel, wichtig, ein Weg). Die Register: `CLAUDE-workflow.md` (prozessweit,
  gilt immer) und das Stufen-Register der geprüften Stufe — `CLAUDE-Fachplan.md`
  bzw. `CLAUDE-Plan.md`. Für die Stufe `issue` gibt es **kein eigenes
  Format-Register**; dort zählt allein das prozessweite. Die Angabe ist **Pflicht**: Lässt du sie aus, gilt der Fund wie `gate` und ruft einen Menschen.
- Wo im Issue (Abschnitt, zitierter Satz)
- Ein konkreter Formulierungsvorschlag — keine allgemeine Kritik

Wenn du nichts findest: schreibe das ausdrücklich hin, nicht "alles gut".

--- ISSUE ---
{{ISSUE_BODY}}
```

**Fällt der Reviewer aus** — vor dem Start oder während der Ausführung, gleich aus welchem Grund —, läuft die Session nur noch **zur Protokollierung** weiter. Sie schreibt einen Board-Kommentar mit dem üblichen Anker `## <Stufe>-Review, Runde n` in Zeile 1 und dem Ausfall samt Grund in **Zeile 2**. Beides zugleich in der ersten Zeile ginge nicht — und ohne den Anker erkennt `reviewZustand` (Issue #381) den Kommentar nicht als Review-Kommentar der Stufe. Es entstehen **keine Befunde, keine Synthese, kein Body-Vorschlag** und **nie ein Marker**. Kein Ersatz-Reviewer.

Der Grund ist der Rechenweg: Bei einem einzigen Prüfer gibt es nichts zu synthetisieren, und ein Vorschlag ohne Befund wäre die Meinung der Session über ein Issue, das sie nicht prüfen sollte. „Unterbesetzt" und „gar nicht geprüft" fallen auf dieser Stufe zusammen. Die Nachtregel aus Issue #267 gilt unverändert daneben.

#### Stufe `fachlich`: die beiden Rollen der fachlichen Anforderung

Diese Stufe hat den größten Hebel: Ein Fehler dort pflanzt sich in den Plan, in jedes Arbeitspaket und in allen Code fort. Sie ist zugleich die einzige, für die es vorher keinerlei Prüfung gab.

**Der Maßstab ist die Form.** Beim Arbeitspaket sind es die vier Abschnitte und die maschinelle Prüfbarkeit; bei der fachlichen Anforderung ist es das Story-Format aus `/fachplan`. Ein Prüfer ohne festgelegte Form kann nur Geschmack äußern — mit ihr kann er prüfen.

**Rolle `form-beobachtbarkeit`** (erster Reviewer der Stufe):

```
Du prüfst eine fachliche Anforderung, aus der gleich ein technischer Plan
entstehen soll. Du kennst die Entstehungsgeschichte nicht — nicht das Gespräch mit
dem Product Owner, nicht die Absicht dahinter. Das ist gewollt: Genau diese Lücke
sollst du finden.

Maßstab ist das Story-Format: Ziel, Fachliche Akzeptanzkriterien, Nicht-Ziele,
Offene Fragen an den PO.

1. Sind alle vier Überschriften vorhanden? Ziel, Fachliche Akzeptanzkriterien und
   Nicht-Ziele brauchen mindestens einen inhaltlichen Eintrag. Unter "Offene
   Fragen an den PO" stehen entweder konkrete Fragen, dokumentierte Antworten des
   PO oder ausdrücklich "Keine offenen Fragen". Ein leerer Abschnitt oder ein
   bloßer Platzhalter ist ein Fund — eine fertig gegroomte Anforderung ohne offene
   Fragen ist dagegen in Ordnung.
2. Ist jedes fachliche Akzeptanzkriterium AUS NUTZERSICHT BEOBACHTBAR? Nicht
   technisch prüfbar — das ist eine spätere Stufe. Woran würde ein Mensch, der die
   Software benutzt, merken, dass es erfüllt ist?
3. Steht Technik drin, wo keine hingehört? Dateien, Architektur,
   Implementierungsdetails gehören nicht in eine fachliche Anforderung.
4. Ist das Ziel als Nutzerwirkung formuliert, oder beschreibt es eine Lösung?
5. Was kann RAUS? Welcher Satz, welches Kriterium trägt nichts?

Für jeden Fund: Schweregrad BLOCKER / WICHTIG / HINWEIS, die **Klasse** — `gate` (Verstoß gegen eine Regel aus einem Register — nenne welche),
`alternativen` (mehr als ein gangbarer Weg — nenne welche) oder `korrektur`
(plausibel, wichtig, ein Weg). Die Register: `CLAUDE-workflow.md` (prozessweit,
gilt immer) und das Stufen-Register der geprüften Stufe — `CLAUDE-Fachplan.md`
bzw. `CLAUDE-Plan.md`. Für die Stufe `issue` gibt es **kein eigenes
Format-Register**; dort zählt allein das prozessweite. Die Angabe ist **Pflicht**: Lässt du sie aus, gilt der Fund wie `gate` und ruft einen Menschen.
Dazu die Fundstelle mit
Zitat, ein konkreter Formulierungsvorschlag.

Wenn du nichts findest: schreibe das ausdrücklich hin, nicht "alles gut".

--- ANFORDERUNG ---
{{ISSUE_BODY}}
```

**Rolle `abgrenzung`** (zweiter Reviewer der Stufe):

```
Du prüfst eine fachliche Anforderung, aus der gleich ein technischer Plan
entstehen soll. Du kennst die Entstehungsgeschichte nicht — das ist gewollt.

Prüfe auf Abgrenzung und Widerspruch:

1. Widersprechen sich Ziele und Nicht-Ziele? Verlangt ein Kriterium etwas, das
   ein Nicht-Ziel ausschließt?
2. Fehlt eine Scope-Grenze? Was könnte jemand hineinlesen, das nicht gemeint ist?
3. Ist eine offene Frage durch das Ziel, ein Akzeptanzkriterium, ein Nicht-Ziel
   oder eine im Body dokumentierte PO-Antwort bereits entschieden? Dann schlage
   vor, sie zu entfernen oder als Entscheidung festzuhalten. Unterstelle keine
   Entscheidungen, die nicht im Body stehen — du kennst die Vorgeschichte nicht.
4. Fehlt eine Frage, die vor dem Plan beantwortet sein muss? Wo würde ein Planer
   raten müssen?
5. Was kann RAUS? Welcher Teil gehört nicht in diese Anforderung?

Für jeden Fund: Schweregrad BLOCKER / WICHTIG / HINWEIS, die **Klasse** — `gate` (Verstoß gegen eine Regel aus einem Register — nenne welche),
`alternativen` (mehr als ein gangbarer Weg — nenne welche) oder `korrektur`
(plausibel, wichtig, ein Weg). Die Register: `CLAUDE-workflow.md` (prozessweit,
gilt immer) und das Stufen-Register der geprüften Stufe — `CLAUDE-Fachplan.md`
bzw. `CLAUDE-Plan.md`. Für die Stufe `issue` gibt es **kein eigenes
Format-Register**; dort zählt allein das prozessweite. Die Angabe ist **Pflicht**: Lässt du sie aus, gilt der Fund wie `gate` und ruft einen Menschen.
Dazu die Fundstelle mit
Zitat, ein konkreter Formulierungsvorschlag.

Wenn du nichts findest: schreibe das ausdrücklich hin, nicht "alles gut".

--- ANFORDERUNG ---
{{ISSUE_BODY}}
```

#### Stufe `plan`: die beiden Rollen des Plandokuments

Hier zahlt sich der Bestandszugriff aus Issue #268 am meisten aus: Ein Plan behauptet, **wie** etwas gebaut wird — ob das mit dem vorhandenen Code zusammengeht, sieht nur ein Prüfer, der hineinschaut. Am 2026-08-08 wies ein Reviewer nach, dass ein im Plan referenziertes Kommando im Adapter gar nicht existiert und eine genannte Funktion anders heißt. Beides wäre sonst in dreizehn Arbeitspakete gewandert.

Maßstab ist das verbindliche Plan-Format aus Issue #274, insbesondere die Begründungspflicht bei den Entscheidungen.

**Rolle `architektur-bestand`** (erster Reviewer der Stufe):

```
Du prüfst einen technischen Plan, aus dem gleich Arbeitspakete entstehen. Du
kennst die Entstehungsgeschichte nicht — nicht das Gespräch, aus dem er stammt.
Den Bestand darfst und sollst du lesen: Schlag im Repository nach.

0. Entspricht der Plan dem verbindlichen Plan-Format? Enthält er genau einmal und
   in dieser Reihenfolge `## Ziel`, `## Betroffene Bereiche`, `## Architektonische
   Entscheidungen`, `## Geplante Änderungen`, `## Offene Fragen` und
   `## Verifizierung`? Sind leere Pflichtabschnitte ausdrücklich mit `- Keine.`
   ausgewiesen?
1. Stimmt jede Behauptung über den Bestand? Existieren die genannten Dateien,
   Funktionen, Kommandos und Konfigurationsfelder wirklich, und heißen sie so?
2. Trägt jede Entscheidung unter "Architektonische Entscheidungen" eine
   Begründung? Eine Entscheidung ohne Begründung ist nicht überprüfbar — das ist
   ein Fund.
3. Widerspricht eine Entscheidung einer erkennbaren Konvention des Projekts?
4. Was bricht, das der Plan nicht nennt? Welches bestehende Verhalten, welcher
   Test, welche Kopie ist betroffen?
5. Was kann RAUS? Welche Entscheidung, welcher Abschnitt trägt nichts?

Für jeden Fund: Schweregrad BLOCKER / WICHTIG / HINWEIS, die **Klasse** — `gate` (Verstoß gegen eine Regel aus einem Register — nenne welche),
`alternativen` (mehr als ein gangbarer Weg — nenne welche) oder `korrektur`
(plausibel, wichtig, ein Weg). Die Register: `CLAUDE-workflow.md` (prozessweit,
gilt immer) und das Stufen-Register der geprüften Stufe — `CLAUDE-Fachplan.md`
bzw. `CLAUDE-Plan.md`. Für die Stufe `issue` gibt es **kein eigenes
Format-Register**; dort zählt allein das prozessweite. Die Angabe ist **Pflicht**: Lässt du sie aus, gilt der Fund wie `gate` und ruft einen Menschen.
Dazu die Fundstelle mit
Zitat, ein konkreter Formulierungsvorschlag. Bei Behauptungen über den Bestand:
nenne die Datei und die Stelle, an der du nachgesehen hast.

Wenn du nichts findest: schreibe das ausdrücklich hin, nicht "alles gut".

--- PLAN ---
{{ISSUE_BODY}}
```

**Rolle `schnitt-abhaengigkeiten`** (zweiter Reviewer der Stufe):

```
Du prüfst einen technischen Plan, aus dem gleich Arbeitspakete entstehen. Du
kennst die Entstehungsgeschichte nicht. Den Bestand darfst du lesen.

Prüfe den Schnitt:

1. Lässt sich der Plan überhaupt in einzeln abschließbare Arbeitspakete zerlegen?
   Wo hängt alles an allem?
2. Welche Reihenfolge erzwingt er, und ist sie im Plan erkennbar? Ein Paket, das
   ein anderes voraussetzt, ohne dass der Plan es sagt, wird später zur
   unsichtbaren Abhängigkeit.
3. Ist ein Teil zu groß — brauchte er einen eigenen Plan?
4. Sagt "Verifizierung", WIE geprüft wird, oder behauptet sie nur, dass geprüft
   wird?
5. Sind die offenen Fragen wirklich Stopp-Fragen — solche, deren Antwort den
   Zuschnitt ändert? Nachträglich entscheidbare Fragen blähen den Plan.
6. Was kann RAUS?

Für jeden Fund: Schweregrad BLOCKER / WICHTIG / HINWEIS, die **Klasse** — `gate` (Verstoß gegen eine Regel aus einem Register — nenne welche),
`alternativen` (mehr als ein gangbarer Weg — nenne welche) oder `korrektur`
(plausibel, wichtig, ein Weg). Die Register: `CLAUDE-workflow.md` (prozessweit,
gilt immer) und das Stufen-Register der geprüften Stufe — `CLAUDE-Fachplan.md`
bzw. `CLAUDE-Plan.md`. Für die Stufe `issue` gibt es **kein eigenes
Format-Register**; dort zählt allein das prozessweite. Die Angabe ist **Pflicht**: Lässt du sie aus, gilt der Fund wie `gate` und ruft einen Menschen.
Dazu die Fundstelle mit
Zitat, ein konkreter Formulierungsvorschlag.

Wenn du nichts findest: schreibe das ausdrücklich hin, nicht "alles gut".

--- PLAN ---
{{ISSUE_BODY}}
```

#### Legacy-Fallback ohne `reviewStufen`

Meldet `issue-review roles` die `stufenQuelle: "default"`, fehlt der `reviewStufen`-Block in der Config — der Normalfall in jedem Bestandsprojekt. Dann gilt für alle drei Stufen die alte Besetzung: **zwei Reviewer mit den Rollen `vollstaendigkeit-pruefbarkeit` und `scope-risiko-bestand`.** Ohne diese Regel wäre für Bestandsprojekte undefiniert, was mit der zweiten gelieferten Rolle geschieht.

**Rolle `vollstaendigkeit-pruefbarkeit`** verwendet wörtlich den Prompt der Rolle `pruefbarkeit` oben.

**Rolle `scope-risiko-bestand`:**

```
Du prüfst ein Issue, das gleich implementiert werden soll. Du kennst die
Entstehungsgeschichte nicht — nicht das Gespräch, nicht die Absicht dahinter. Das
ist gewollt: Genau diese Lücke sollst du finden. Den Bestand darfst du lesen;
schlag im Repository nach, wo es deinen Befund schärft.

Prüfe auf Scope und Risiko:
1. Ist der Schnitt zu groß für eine Arbeitseinheit? Wäre ein Teil ein eigenes Issue?
2. Fehlen Abhängigkeiten? Sie müssen als "Issue #N" im Abhängigkeiten-Abschnitt
   stehen, sonst sind sie für den Nacht-Runner unsichtbar.
3. Was bricht, das im Issue nicht steht? Welche bestehende Datei, welches Verhalten
   ist betroffen, ohne erwähnt zu sein?
4. Widerspricht die Aufgabe einer erkennbaren Entscheidung im Projekt?
5. Was kann RAUS? Welcher Teil gehört nicht in dieses Issue?

Für jeden Fund:
- Schweregrad: BLOCKER / WICHTIG / HINWEIS
- **Klasse:** `gate` (Verstoß gegen eine Regel aus einem Register — nenne welche),
  `alternativen` (mehr als ein gangbarer Weg — nenne welche) oder `korrektur`
  (plausibel, wichtig, ein Weg). Die Register: `CLAUDE-workflow.md` (prozessweit,
  gilt immer) und das Stufen-Register der geprüften Stufe — `CLAUDE-Fachplan.md`
  bzw. `CLAUDE-Plan.md`. Für die Stufe `issue` gibt es **kein eigenes
  Format-Register**; dort zählt allein das prozessweite. Die Angabe ist **Pflicht**: Lässt du sie aus, gilt der Fund wie `gate` und ruft einen Menschen.
- Wo im Issue (Abschnitt, zitierter Satz)
- Ein konkreter Formulierungsvorschlag — keine allgemeine Kritik

Wenn du nichts findest: schreibe das ausdrücklich hin, nicht "alles gut".

--- ISSUE ---
{{ISSUE_BODY}}
```

**Zuordnung und Fehlerpfad:** Die Rollennamen aus `issue-review roles` sind eindeutig einem Promptblock zugeordnet — `pruefbarkeit` für das Arbeitspaket, `form-beobachtbarkeit` und `abgrenzung` für die fachliche Stufe, `architektur-bestand` und `schnitt-abhaengigkeiten` für den Plan, `vollstaendigkeit-pruefbarkeit` und `scope-risiko-bestand` im Legacy-Fallback. Jeder Prompt erhält den unveränderten Issue-Body über `{{ISSUE_BODY}}`. **Liefert die Config einen Rollennamen, zu dem es keinen Prompt gibt, bricht der Review vor dem Reviewer-Start mit sichtbarer Fehlermeldung ab.** Ohne diesen Pfad wäre ein Vertipper in der Config ein stiller Ausfall: Die Session liefe an, verbrauchte ihre Zeit und lieferte einen Befund, der auf keiner Rolle beruht.

**Ausführung je nach `kind`:**

- **`kind: "claude"`** — Subagent über das Agent-Tool, mit dem konfigurierten `model`. Frische Session ohne Kontext dieser Sitzung, wie in `/review`.
- **`kind: "command"`** — das konfigurierte Kommando starten und den Prompt **über stdin** übergeben, die Antwort von stdout lesen:

  ```bash
  <command> < prompt.txt
  ```

  Nicht als Argument. Ein Issue-Body mit Backticks, Anführungszeichen und Zeilenumbrüchen durch eine Kommandozeile zu quoten ist genau der Fehler, den Issue #196 aus `board.mjs` entfernt hat. Die Kommandozeile ist frei konfiguriert und läuft deshalb über die Plattform-Shell — dieselbe Abgrenzung wie bei `buildChecks` in `night.mjs` (Issue #199).

  Schlägt das Kommando fehl (Exit ungleich 0), gilt der Reviewer als ausgefallen. Das ist ein Fund für den Bericht, kein Abbruch: Auf den Stufen `fachlich` und `plan` bleiben die Befunde des verbliebenen Prüfers wertvoll. Auf der Stufe `issue` gibt es keinen zweiten — dort greift die Ausfall-Regel ihres Unterabschnitts, und die Session protokolliert nur noch.

### 4. Runden

**Die Rundenzahl kommt aus dem Feld `runden` der `roles`-Antwort (Schritt 2), nicht aus der Config.** Das Kommando hat die Vorgabe am Ticket bereits mit dem Regelfall verrechnet und liefert den fertigen Wert. Wer daneben noch einmal selbst in `issueReview.rounds` sieht, baut eine zweite Wahrheit darüber, wie oft geprüft wird — und übergeht dabei genau die Entscheidung, die der Mensch am Ticket getroffen hat.

Drei Lagen, ablesbar an `verzicht` und `vorgabeQuelle`:

| Antwort | Was läuft | Was der Board-Kommentar sagt |
|---|---|---|
| `verzicht: true` | **kein Reviewer** | den Verzicht |
| `vorgabeQuelle: "verfallen"` | Review normal mit `runden` (Regel-Rundenzahl) | dass eine Vorgabe verfallen ist |
| `vorgabeQuelle: "issue"` oder `"config"` | Review mit `runden` | die Quelle der Rundenzahl |

**Bei `verzicht: true` startet kein Reviewer** — auch nicht einer, auch nicht bei explizit übergebener Nummer (Schritt 1). Es entstehen keine Befunde, keine Synthese, kein Body-Vorschlag und **nie ein Marker**: Ein Verzicht ist keine Prüfung, und ein Marker behauptete das Gegenteil. Was bleibt, ist der Board-Kommentar — er ist die einzige Spur, dass hier bewusst nicht geprüft wurde:

```
Kein Review: `Pruefung: Verzicht` am Ticket — bewusst ohne Pruefung freigegeben.
Kein Reviewer gestartet, kein Marker gesetzt.
```

**Auch hier `label-sync`:** Ein gültiger Verzicht ergibt `fertig` — der Mensch hat entschieden, dass nicht geprüft wird, und das ist ein Ergebnis, kein Loch. Ohne den Aufruf bliebe das Ticket auf `review:offen` stehen und sähe aus wie eines, das noch wartet.

```bash
node .claude/kit/board.mjs issue-review label-sync <id>
```

**Bei `vorgabeQuelle: "verfallen"`** läuft der Review ganz normal mit der Regel-Rundenzahl, die `runden` liefert. Der Kommentar nennt den Verfall trotzdem — für den, der ihn morgens liest, ist „nie entschieden" etwas anderes als „entschieden, aber durch eine inhaltliche Änderung überholt". Wer nur das eine sieht, weiß nicht, dass er noch einmal entscheiden sollte.

Bei mehr als einer Runde bekommt die zweite Runde den bereits geschärften Body, nicht den ursprünglichen. Jede Runde erzeugt einen eigenen Board-Kommentar, damit der Verlauf lesbar bleibt.

Mehr als eine Runde findet erfahrungsgemäß vor allem Geschmacksfragen. Wenn die zweite Runde nichts mit Schweregrad BLOCKER oder WICHTIG mehr liefert, sag das — es ist die Information, ob sich weitere Runden lohnen.

### 5. Befunde dokumentieren

Die Reviewer-Ausgaben gehen **unverändert** als Board-Kommentar ans Issue. Sie sind Verlauf, nicht verhandelter Stand (Regel aus Issue #155):

```bash
node .claude/kit/board.mjs issue comment <id> --text - <<'BEFUNDE'
## Issue-Review, Runde 1

Reviewer: codex (pruefbarkeit)
codex — Bestand: nein

### codex — Vollständigkeit und Prüfbarkeit
<Befunde>
BEFUNDE
```

Je gelaufener Reviewer eine Überschrift, in der Reihenfolge aus `gewaehlt`. Auf den Stufen `fachlich` und `plan` sind es zwei Blöcke, auf der Stufe `issue` einer.

**Der Text geht über stdin, nicht als Argument** (Issue #270). Reviewer-Befunde
liegen regelmäßig bei über zehntausend Zeichen; als Kommandozeilen-Argument
scheitert daran das Quoting, und eine Session, die sich daraufhin ein Hilfsskript
baut, wird headless abgelehnt — sie endet ohne Board-Spur, und der Runner bucht sie
als Fehlschlag. Der Heredoc mit **quotiertem** Marker (`<<'BEFUNDE'`) verhindert
zusätzlich, dass die Shell Backticks und `$` im Befundtext auswertet.

Braucht ein Werkzeug doch eine Datei, gehört sie **außerhalb des Projektverzeichnisses**
— eine Datei im Repo macht den Working Tree unsauber, und darauf stoppt der
Nacht-Runner hart (Issue #152).

Lief der Review unterbesetzt oder ist ein Reviewer ausgefallen, steht das in der **zweiten Zeile** des Kommentars — die erste trägt den Anker.

**Danach `label-sync`** — der erste von drei Aufrufen in diesem Skill: **nach dem Befunde-Kommentar** (hier), **nach dem Schreiben von Body und Marker** (Schritt 6) und **nach der Verzicht-Meldung** (Schritt 4):

```bash
node .claude/kit/board.mjs issue-review label-sync <id>
```

Der Zustand hat sich gerade geändert (von `offen` auf `befunde`, oder auf `ausgefallen`), und das Label soll ihn zeigen. Das Kommando leitet selbst ab — es bekommt keinen Zustand übergeben, und es gibt hier nichts zu entscheiden.

### 5b. Synthese protokollieren — ein zweiter, getrennter Kommentar

Zwischen den Befunden und dem neuen Body liegt eine Arbeit, die sonst unsichtbar bleibt: Aus einer Befundliste wird ein Text. Dabei wird entschieden, welcher Fund einfließt und welcher verworfen wird — und wo eine Stufe mehrere Prüfer hat, bei Widerspruch auch, wer recht bekommt.

**Ohne Protokoll sieht ein bewusst verworfener Fund genauso aus wie ein übersehener.** Wer später Kommentar und Body nebeneinanderlegt, findet eine Differenz und kann die beiden Fälle nicht unterscheiden.

Der Kommentar ist **getrennt** vom Befunde-Kommentar aus Schritt 5. Der bleibt unverändert Verlauf (Issue #155); die Synthese ist bewertet und gehört nicht in denselben Block.

**Die Synthese beschreibt Entscheidungen über den Vorschlag, nicht über einen bereits geänderten Body.** „Übernommen" heißt: Der Fund ist in den vorgeschlagenen Text eingearbeitet — im Nachtbetrieb in den Body-Vorschlag aus Schritt 6, interaktiv in den Vorschlag, den der Mensch noch freigeben muss. Geschrieben ist damit nichts. Die Perfekt-Formulierung („nennt jetzt beide") ist genau der Ort, an dem die Verwechslung entsteht: Am 2026-08-12 behaupteten neun Synthesen Schärfungen, die in keinem Text standen.

Beispiel einer Stufe mit zwei Prüfern (`fachlich` oder `plan`) — auf der Stufe `issue` entfällt der Abschnitt „Dissens", weil es nur eine Befundliste gibt:

```bash
node .claude/kit/board.mjs issue comment <id> --text - <<'SYNTHESE'
## Synthese, Runde 1

### Entscheidungen
- opus, "Akzeptanzkriterium nicht maschinell prüfbar" (BLOCKER) — übernommen
- codex, "Abhängigkeit fehlt" (WICHTIG) — verworfen: Issue #7 steht bereits im
  Abhängigkeiten-Abschnitt, der Reviewer sah ihn nicht (Kontextlosigkeit).
- codex, "Cookie-Schreiben ist Kandidat für RAUS" (WICHTIG) — verworfen:
  Issue #10 spezifiziert es vollständig und ist als Abhängigkeit genannt.

### Dissens
- opus wollte die Codeprüfung durch einen Test ersetzen, codex umgekehrt den
  Test-Zweig streichen (das Projekt hat keine Testbasis). Entschieden für opus.
  Folgeänderung: Issue #7 als Abhängigkeit ergänzt.

Übernommen: 1 · Verworfen: 2
SYNTHESE
```

**Was hineingehört:**

- Je Fund mit Schweregrad `BLOCKER` oder `WICHTIG` **eine Zeile**: Reviewer, Kurzbezeichnung, `übernommen`, `verworfen` oder **`zur Entscheidung`** — und bei `verworfen` ein Satz Begründung.
- **`zur Entscheidung`** ist der dritte Ausgang (Issue #386): Ein Fund der Klasse
  `gate` oder `alternativen` ruft einen Menschen. Die Zeile nennt den offenen
  Punkt im Klartext und den Auslöser dazu — welche Regel berührt ist, oder welche
  Wege zur Wahl stehen.
- **Eine fehlende Klasse ist ein eigener Auslöser** und wird als solcher benannt,
  nicht als erfundene Regelverletzung. Ein klassenloser Fund und ein echter
  `gate`-Fund führen zum selben Verhalten, bedeuten aber Verschiedenes: „der
  Reviewer sah eine Regel berührt" gegen „der Reviewer sagte nichts". Wer die
  Synthese liest, muss das unterscheiden können — sonst sucht er nach einer Regel,
  die niemand genannt hat. Diese beiden Klassen kann die Synthese **nicht verwerfen**;
  verworfen wird nur, was nicht plausibel oder nicht wichtig ist.
- **Die Abbildung auf das Verhalten:** `korrektur` wird angewendet; `gate` und
  `alternativen` werden nicht angewendet und zeichnen das Ticket mit
  `kit:klaeren` (siehe Issue #387).
- `HINWEIS`-Funde nur, wenn sie **verworfen** wurden. Sonst wird die Liste länger als ihr Nutzen.
- **Ein verworfener `BLOCKER` braucht immer eine Begründung.** Das ist die Kategorie, bei der stilles Verwerfen am teuersten ist.
- Auf den Stufen `fachlich` und `plan`: Widersprechen sich die Prüfer, steht das als eigener Punkt — welche Vorschläge kollidierten, welcher gewonnen hat, warum, und welche Folgeänderungen daraus entstanden sind. Auf der Stufe `issue` gibt es diesen Fall nicht.

**Ein Muster, das man kennen sollte:** Die Kontextlosigkeit, die den Review überhaupt trägt, produziert an Abhängigkeitsgrenzen zuverlässig Fehlalarme — ein Reviewer sieht das Nachbar-Issue nicht und meldet als fehlend, was dort steht. Solche Funde zu verwerfen ist richtig. Es bleibt eine Entscheidung und gehört protokolliert.

### 6. Body schärfen — nur mit Freigabe

**Der Body wird nie automatisch geschrieben.** Zeige einen Vorschlag mit den eingearbeiteten Funden und frage einmal:

> Stufe `issue`, Reviewer `codex` (pruefbarkeit), 3 Funde (1 BLOCKER, 2 HINWEIS). Vorschlag für den neuen Body:
> …
> Übernehmen? (ja / nein / einzelne Funde nennen)

Kein Konsens-Automatismus: Modelle können sich einig und trotzdem falsch sein. Übereinstimmung ist kein Wahrheitskriterium, und wer über die Anforderung entscheidet, entscheidet über das Produkt — das ist keine Modellfrage.

**Nach der Zustimmung:** Body schreiben und die Marker-Zeile **der geprüften Stufe** aufnehmen, wörtlich in einer dieser drei Formen:

```
Fachplan-Review: <reviewer[, reviewer…]> (JJJJ-MM-TT[, Nachtlauf])
Plan-Review:     <reviewer[, reviewer…]> (JJJJ-MM-TT[, Nachtlauf])
Issue-Review:    <reviewer[, reviewer…]> (JJJJ-MM-TT[, Nachtlauf])
```

Beispiel für ein Arbeitspaket, das mit seinem einen Reviewer gelaufen ist:

```
Issue-Review: codex (2026-08-06)
```

**Wohin die Zeile gehört**, entscheidet das Format des Dokuments — nur das Arbeitspaket hat einen `## Kontext`:

| Dokument | Ort des Markers |
|---|---|
| Arbeitspaket | im Abschnitt `## Kontext` |
| fachliche Anforderung | im Abschnitt `## Ziel`, unmittelbar bei `Autor-Modell:` |
| Plandokument | vor `## Ziel`, unmittelbar bei `Plan-Modell:` und gegebenenfalls `Fachliche Quelle:` |

Die Reihenfolge der vorhandenen Kennzeichnungszeilen bleibt unverändert — der Marker stellt sich dazu, er verdrängt nichts.

Die Namen stammen aus `gewaehlt` (Schritt 1b), in Auswahlreihenfolge, und nennen die **tatsächlich gelaufenen** Reviewer — nicht eine feste Liste aus der Config. Bei einem erneuten Review wird der Marker **derselben** Stufe ersetzt, nicht dupliziert.

**Der Anker `Issue-Review:` bleibt ausschliesslich dem Arbeitspaket vorbehalten.** An ihm hängt in `kit/night.mjs` das Gate `requiredBeforeReady`, also die Bedingung für die Freigabe zur Umsetzung. Trüge ein fachliches Dokument oder ein Plan denselben Marker, hielte der Nacht-Runner es für freigabereif und zöge es in die Implementierung. Ein Dokument einer anderen Stufe darf ihn deshalb nie tragen.

**Die vorhandenen Zeilen `Pruefung:` und `Pruefung-Stand:` müssen dabei erhalten bleiben.** `issue update` prüft sie nicht: Der Body wird durchgeschrieben, wie er kommt. Eine Session, die den Body neu formuliert und die beiden Zeilen dabei vergisst, verliert sie stillschweigend — ohne Fehler, ohne Warnung. Wer den Body ersetzt, übernimmt **beide** Zeilen unverändert aus dem alten Stand. Es ist dieselbe Fehlerklasse wie bei `Autor-Modell:` in `/fachplan`, mit zwei zusätzlichen Folgen:

- `Pruefung:` trägt die Vorgabe des Menschen. Fällt sie weg, gilt wieder der Regelfall — bei `Pruefung: 3` still weniger Prüfung als entschieden, bei `Pruefung: Verzicht` das Gegenteil des Entschiedenen.
- Wo der Wegfall eine **Verringerung** wäre, weist `issue update` bei gesetztem `KIT_AGENT_MODEL` den Schreibzugriff ab (Issue #303). Dann bleibt nachts der Body ungeschrieben und der Marker ungesetzt: Der ganze Review ist gelaufen und verfällt an einer vergessenen Zeile.

`Pruefung-Stand:` pflegt der Adapter selbst — er berechnet sie beim Schreiben neu, sofern der Body eine Vorgabe trägt. Sie mitzunehmen ist trotzdem richtig und sie von Hand zu ändern immer falsch: Ohne Vorgabezeile bekommt der neue Body auch keinen Stand.

Geschrieben wird über den Adapter, nicht am Tracker vorbei:

```bash
node .claude/kit/board.mjs issue update <id> --body - <<'BODY'
...
BODY
```

Die Formulierung des Markers ist der Anker, an dem der Nacht-Runner erkennt, ob ein Issue geprüft ist. Nicht umformulieren.

**Danach `label-sync`** — der Marker macht aus `befunde` ein `fertig`:

```bash
node .claude/kit/board.mjs issue-review label-sync <id>
```

**Bei Ablehnung:** Body bleibt unverändert und **kein Marker** wird gesetzt. Ein Review, dessen Ergebnis verworfen wurde, hat das Issue nicht geschärft.

## Im Nachtbetrieb

Erkennungsmerkmal ist **gesetztes `KIT_AGENT_MODEL`** — dieselbe Bedingung wie bei der Autor-Modell-Ausnahme oben, und ausdrücklich kein zweites Signal. Der Nacht-Runner startet diesen Skill über `night.mjs --review` mit `/issue-review #N`.

Drei Abweichungen, sonst gilt alles unverändert:

**Nachts wird nicht gefragt — in keiner Lage.** Das gilt für den Vorflug (Schritt 0), für das fehlende Autor-Modell (Schritt 2) und ausdrücklich auch dann, wenn ein Reviewer **beim Start ausfällt**, obwohl der Vorflug ihn als verfügbar gemeldet hat. Eine Session, die auf eine Antwort wartet, ist vom Runner nicht von einem Fehlschlag zu unterscheiden.

Konkret bei einem ausgefallenen Reviewer, gleich zu welchem Zeitpunkt und aus welchem Grund:

1. Der Review **läuft mit den verbleibenden Reviewern zu Ende**. Ihre Befunde sind wertvoll und dürfen nicht verfallen. Bleibt keiner übrig — auf der Stufe `issue` ist das nach einem Ausfall immer der Fall —, greift deren Ausfall-Regel: Die Session protokolliert nur noch, ohne Befunde, Synthese und Body-Vorschlag.
2. Die **erste Zeile** des Board-Kommentars nennt den Ausfall mit Grund.
3. Der **Marker bleibt aus** — ein unterbesetzter Lauf ist nie befundfrei im Sinne der Marker-Regel unten.
4. **Kein Ersatz-Reviewer aus eigenem Antrieb.** Wer die Besetzung ändert, ändert das Verfahren; dafür gibt es `pairs`. Nachts wird die Lücke protokolliert, nicht gefüllt.

Diese Regel gilt für **jeden unbeaufsichtigten Lauf**, nicht nur für `night.mjs --review` — auch dann, wenn ein anderer Runner den Skill startet.

Der Grund steht im Protokoll vom 2026-08-08 (Issue #267): Vier Sessions hatten ihre Reviewer-Arbeit fertig — bei einer davon drei BLOCKER — und haben sie verworfen, weil sie auf eine Antwort warteten, die nachts niemand geben kann. Fünf bis sechs Minuten Arbeit je Issue, viermal, für nichts. Der bisherige Text deckte nur zwei Lagen ab: Reviewer fehlt beim Vorflug (dann startet der Runner nicht) und Reviewer fällt mitten im Lauf aus (dann ist es ein Fund für den Bericht). Die dritte — Vorflug meldet ihn, Start scheitert — kannte er nicht, und für eine Lage ohne Regel improvisiert jede Session neu.

**Schritt 6 nachts: Der Body wird geschrieben, wenn alle Funde `korrektur` sind.**

Die Verantwortungsschwelle liegt nicht mehr am Text, sondern an der **Entscheidung**: Automatisiert wird, was automatisierbar ist; wo eine Entscheidung fehlt, zeichnet ein Label sie sichtbar.

- **Alle Funde `korrektur`:** Der Body wird geschrieben, der Marker gesetzt.
- **Mindestens ein `gate`- oder `alternativen`-Fund** — diese beiden Klassen kann die Synthese **nicht verwerfen**, sie rufen nach A9 immer den Menschen: Die übernommenen `korrektur`-Funde werden trotzdem angewendet, `kit:klaeren` wird gesetzt, der Marker bleibt aus, und die Synthese benennt jeden offenen Punkt einzeln.

Für `korrektur`-Funde bleibt die Abwägung übernommen/verworfen mit Begründung bestehen; **angewendet wird, was übernommen ist** — nicht ausnahmslos jeder.

**Ein Fund ohne Klassenangabe gilt wie `gate`.** Er wird **nicht angewendet**, er
zeichnet das Ticket mit `kit:klaeren`, und der **Marker bleibt aus** — genau wie ein
echter `gate`-Fund.

Die Richtung ist Absicht: Im Zweifel ruft der Fund einen Menschen. Die Gegenrichtung —
fehlende Angabe gilt als `korrektur` — wäre bequemer und genau falsch, weil sie das
Auslassen zur billigsten Variante machte. Ein Prompt wird nicht immer befolgt; die Regel
darf nicht daran hängen, dass er es wird.

Das Label wird so gesetzt:

```bash
node .claude/kit/board.mjs issue label add <id> kit:klaeren
```

Ein bereits vorhandenes Label ist kein Fehler.

**Angewendet wird nur wörtlich Vorgeschlagenes** (A10): Was der Reviewer nicht wörtlich geliefert hat, verändert den Body nicht — keine Umformulierung, keine sinngemäße Übertragung, keine eigene Ergänzung an der Stelle. Der `## Body-Vorschlag`-Kommentar bleibt in beiden Fällen daneben bestehen; er ist die Spur, was die Maschine getan hat.

**Reihenfolge der Schreibbefehle und Fehlerpfad:**

1. `## Body-Vorschlag`-Kommentar
2. `issue update` — der geschärfte Body OHNE Marker (ein vorhandener Marker derselben Stufe wird dabei entfernt; endet der Lauf mit `kit:klaeren`, bleibt er entfernt)
3. gegebenenfalls `issue label add kit:klaeren`
4. Synthese-Kommentar
5. gegebenenfalls ein ZWEITES `issue update` — derselbe Body, ergänzt um die Marker-Zeile; `Pruefung:` und `Pruefung-Stand:` werden wie bei jeder Body-Schreibung aus dem aktuellen Stand übernommen
6. `issue-review label-sync <id>` — wie in Schritt 6 beschrieben, nachts identisch

Der Marker ist keine eigene Operation, sondern eine **Zeile im Body**. Er kann deshalb nur mit einer Body-Schreibung entstehen — und weil er nie ohne Synthese dastehen darf, wird der Body zweimal geschrieben: erst geschärft ohne Marker, nach erfolgreicher Synthese ein zweites Mal mit.

Bei befundfreiem Lauf entfallen die Schritte 1 bis 3; das `issue update` mit der Marker-Zeile ist dann die einzige Body-Schreibung und schreibt den unveränderten Body plus Marker.

**Schlägt einer der Befehle fehl, endet der Skill mit Fehler und führt keine weitere Mutation am Issue aus.** Scheitert die **zweite** Body-Schreibung, bleibt der Body geschärft und ohne Marker zurück — das Ticket sieht dann aus wie eines mit Befunden, was es zu diesem Zeitpunkt auch ist. Ein Marker ohne Synthese kann nicht mehr entstehen. Zwei Fehlerpfade sind im Bestand angelegt und ausdrücklich gemeint: `issue update` weist bei gesetztem `KIT_AGENT_MODEL` einen Body ab, der die `Pruefung:`-Zeile verringert (Issue #303), und `issue label add` scheitert, solange die Label-Definition am Board fehlt.

**Für die Stufen `fachlich` und `plan` gilt das alles nicht — dort wird der Body unbeaufsichtigt nie geschrieben:** Stattdessen geht der fertig formulierte Body-Vorschlag als Board-Kommentar ans Issue, als übernehmbarer Text und nicht als Beschreibung dessen, was zu ändern wäre. Beim Groomen liest man ihn von dort (`issue get` liefert `comments`).

Die **erste Zeile** dieses Kommentars lautet wörtlich `## Body-Vorschlag, Runde <n>`, mit der Nummer der Runde:

```bash
node .claude/kit/board.mjs issue comment <id> --text - <<'VORSCHLAG'
## Body-Vorschlag, Runde 1

## Kontext
… der vollständige neue Body, Abschnitt für Abschnitt …
VORSCHLAG
```

Darunter steht der **vollständige Ersatz** für den Issue-Body, nicht eine Liste der vorzunehmenden Änderungen. Wer ihn übernimmt, kopiert ihn unverändert in `issue update`.

**Die Reihenfolge ist verbindlich: erst der Body-Vorschlag, dann die Synthese.** Wer die Synthese zuerst schreibt, hat die Abwägung protokolliert und den Text noch nicht — und genau dann fällt das Aufschreiben aus. Am 2026-08-12 ist das neunmal in einem Lauf passiert: Befunde und Synthese lagen vor, der übernehmbare Text fehlte in allen neun Fällen, und die Synthesen behaupteten im Perfekt Schärfungen, die in keinem Body standen.

**`night.mjs --review` prüft das.** Fehlt der neue Vorschlag und wurde kein Marker der aktiven Stufe gesetzt, meldet der Lauf „Schärfung fehlt" statt eines Erfolgs. Gewertet wird nur, was **in dieser Session** hinzugekommen ist — ein Vorschlag aus einem früheren Lauf zählt nicht. Bei mehreren Runden zählt die höchste geschriebene Runde.

**Diese Marker-Regel gilt nur für die Stufe `issue`, nicht für `fachlich` und nicht für `plan`.** Der Grund ist der Ort: Der Marker wird *in den Body* geschrieben. In einer fachlichen Anforderung stehen die Antworten des Product Owners, in einem Plandokument die architektonischen Entscheidungen — beides hat ein Mensch getroffen. Für die Stufen `fachlich` und `plan` gilt deshalb in **jedem unbeaufsichtigten Lauf** — nicht nur nachts —: `issue update` wird nie ausgeführt, und auch bei befundfreiem Review wird kein Marker gesetzt. Befunde, Synthese und der vollständig formulierte Body-Vorschlag gehen ausschließlich als Kommentare ans Board.

**Der Marker wird gesetzt, wenn nichts zu ändern ist.** Genauer, beide Bedingungen zusammen:

1. **Alle Funde tragen die Klasse `korrektur`**, und die übernommenen wurden angewendet. Ein einziger `gate`- oder `alternativen`-Fund reicht, und der Marker bleibt aus — stattdessen wird `kit:klaeren` gesetzt. **Ein Fund ohne Klassenangabe trägt `korrektur` nicht** und hält den Marker damit ebenso zurück.
2. Kein Reviewer ist ausgefallen, und der Lauf war nicht unterbesetzt.

Bis Issue #387 stand an Stelle 1 der Schweregrad: kein Fund mit `BLOCKER` oder `WICHTIG`. Das kollidierte mit der Klassifikation, sobald es sie gab — ein `korrektur`-Fund kann `WICHTIG` sein, und ein solches Ticket bliebe nach dem Anwenden weder markiert noch gezeichnet liegen.

Trifft eines davon nicht zu, bleibt der Marker aus und das Issue wartet auf den Menschen.

**Der Synthese-Kommentar aus Schritt 5b entsteht nachts genauso** — zusätzlich zum Body-Vorschlag. Dort ist er **wichtiger als interaktiv**, weil niemand zugesehen hat: Wer beim Groomen den Vorschlagstext übernimmt, übernimmt sonst eine fremde Abwägung, ohne sie zu sehen.

**Daraus folgt eine Schärfung der Marker-Regel:** Wird der Marker gesetzt, obwohl ein Fund verworfen wurde, **muss die Synthese das benennen**. Sonst behauptet der Marker eine Befundfreiheit, die es nicht gab — ein `HINWEIS`, den die Nacht verworfen hat, ist kein Grund, den Marker zurückzuhalten, aber er darf nicht unsichtbar bleiben.

Der Grund für diese Aufteilung: **Die Verantwortungsschwelle liegt auf der Entscheidung, nicht am Text.** Was ein Reviewer wörtlich vorschlägt und was nur einen Weg kennt, kann die Maschine anwenden — daran ist nichts zu entscheiden. Wo dagegen eine Regel berührt ist oder mehrere Wege offenstehen, macht `kit:klaeren` genau das sichtbar, statt es in einem Kommentar zu vergraben. Das GO bleibt unangetastet — nach Ready zieht weiterhin nur der Mensch.

**Marker-Form nachts** — wörtlich so, damit ablesbar bleibt, dass niemand zugestimmt hat:

```
Issue-Review: codex (2026-08-06, Nachtlauf)
```

Der Zusatz steht innerhalb der Klammer; der Anker `Issue-Review:` bleibt unverändert.

**`label-sync` läuft nachts identisch**, ohne Ausnahme: Ein Label ist weder Body noch Marker, es fällt also nicht unter das nächtliche Schreibverbot für die Stufen `fachlich` und `plan`. Der Zustand ist abgeleitet und jederzeit neu berechenbar — ihn zu zeigen ist keine Produktentscheidung.

Unverändert nachts: kein Ziehen nach Ready, kein Review von `[Idee]`-Issues, kein Reviewer bei gültigem Verzicht (Schritt 1 und 4), Befunde gehen unverändert als Kommentar ans Board. `[Fachlich]` und `[Plan]` schlägt der Runner bis Issue #283 ohnehin nicht vor.

## Abschluss

Zusammenfassung über alle bearbeiteten Issues:

```
### Issue-Review

- #205 → 3 Funde (1 BLOCKER), 2 übernommen / 1 verworfen, Body übernommen, Marker gesetzt
- #207 → keine Funde, Marker gesetzt
- #210 → 2 Funde, 0 übernommen / 2 verworfen, Vorschlag abgelehnt, kein Marker
- #212 → übersprungen ([Idee]-Präfix)
- #213 → übersprungen (`Pruefung: Verzicht`, gültig) — bewusst ohne Prüfung freigegeben
- #214 → Reviewer `codex` ausgefallen (nicht startbar), nur protokolliert, kein Marker
- #272 → fachliche Stufe, 2 Funde, 2 übernommen / 0 verworfen, Body übernommen, Marker `Fachplan-Review:` gesetzt
```

**Die Zählung übernommen/verworfen gehört dazu.** „3 Funde, Body übernommen" liest sich gleich, egal ob alle drei eingeflossen sind oder keiner — und genau dieser Unterschied entscheidet, wie viel der Review wert war.

Dann der Hinweis auf den nächsten Schritt:

> „Geprüfte Issues können nach Ready — das ist dein GO (Schritt 4)."

## Stop-Punkte

- Kein Schreiben in den Issue-Body ohne ausdrückliche Zustimmung
- **Nachts wird nie gefragt, in keiner Lage** — auch nicht, wenn ein Reviewer beim Start ausfällt oder das Autor-Modell fehlt. Es wird mit dem verfahren, was da ist, und der Rest protokolliert
- **Nachts kein Ersatz-Reviewer** — die Besetzung folgt `pairs`, eine Lücke wird vermerkt, nicht gefüllt
- **Nachts kein Schreiben in den Issue-Body bei den Stufen `fachlich` und `plan`** — dort nur Kommentare und nie ein Marker. Auf der Stufe `issue` wird der Body geschrieben, wenn alle Funde `korrektur` sind (Issue #387)
- **Nie ein Marker ohne erfolgreich geschriebenen Body und Synthese-Kommentar** — schlägt ein Schreibbefehl fehl, endet der Skill und führt keine weitere Mutation aus
- Kein Marker ohne übernommenen Body (interaktiv) bzw. ohne befundfreien Review (nachts)
- **Kein Marker ohne Synthese-Kommentar, wenn Funde verworfen wurden** — sonst behauptet er eine Befundfreiheit, die es nicht gab
- **Kein Befund, keine Synthese, kein Body-Vorschlag und nie ein Marker, wenn auf der Stufe `issue` der eine Reviewer ausfällt** — dort ist ein Ausfall kein unterbesetzter Lauf, sondern gar keine Prüfung. Die Session protokolliert und endet
- **Kein Schreiben in ein Plandokument in einem unbeaufsichtigten Lauf** — bei Stufe `plan` weder `issue update` noch ein Marker. Auch der Plan trägt architektonische Entscheidungen, die ein Mensch getroffen hat
- **Kein Schreiben in eine fachliche Anforderung in einem unbeaufsichtigten Lauf** — bei Stufe `fachlich` weder `issue update` noch ein Marker, auch nicht bei befundfreiem Review. Dort stehen die Antworten des Product Owners
- Kein Ziehen nach Ready — das ist das menschliche GO
- Kein Review von `[Idee]`-Issues — `[Fachlich]` und `[Plan]` bestimmen dagegen die Stufe (Schritt 1b)
- **Kein Reviewer bei gültigem, nicht verfallenem Verzicht** — auch nicht bei explizit übergebener Nummer. Der Verzicht wird gemeldet und protokolliert, nicht übergangen
- **Kein Body-Rewrite ohne die Zeilen `Pruefung:` und `Pruefung-Stand:`** — sie werden aus dem alten Stand übernommen, sonst verfällt die Entscheidung des Menschen still (Schritt 6)
- Kein Start, wenn Reviewer fehlen und der Mensch nicht gefragt wurde
