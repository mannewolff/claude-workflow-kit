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

Die Konfiguration liegt in `.claude/workflow.config.json` (im Repository, gilt fuer alle) und wird optional durch `.claude/workflow.config.local.json` ergaenzt (nicht im Repository, nur persoenliche Felder: `reviewModel`, `reviewCommand`, `reviewScope`, `triggers`, Token-Pfade). Issue #207.

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

1. **Titel-Präfix `[Idee]`** — eine rohe Idee ohne `/techplan`-Zyklus ist kein prüfbares Dokument.
2. **Ein gültiger, nicht verfallener Verzicht** (`Pruefung: Verzicht` im Kontext-Abschnitt). Der Mensch hat entschieden, dass dieses Dokument ohne Prüfung freigegeben wird — ein Review, der trotzdem liefe, würde diese Entscheidung überschreiben. Ob der Verzicht noch gilt, sagt nicht die Zeile allein: Maßgeblich ist das Feld `verzicht` der `roles`-Antwort (Schritt 2), denn nur sie kennt den Bezugsstand und damit den Verfall. Ist der Verzicht **verfallen**, ist er kein Ausschlussgrund — dann läuft der Review normal (Schritt 4).

**Auch mit expliziter Nummer schließt ein gültiger Verzicht den Review aus.** Ein erneuter Review ist unabhängig vom Marker erlaubt, ein Verzicht ist aber keine Marker-Frage, sondern eine Entscheidung des Menschen. Sie wird **einmal sichtbar gemeldet**, danach endet der Lauf für dieses Dokument **ohne Reviewer-Start**:

> #205 trägt `Pruefung: Verzicht` — bewusst ohne Prüfung freigegeben. Kein Reviewer gestartet.

`[Fachlich]` und `[Plan]` werden **nicht mehr übersprungen**: Sie bestimmen die Prüfstufe (Schritt 1b).

### 1b. Stufe bestimmen

Die Stufe folgt dem Titel-Präfix:

| Präfix | Stufe | Dokument |
|---|---|---|
| `[Fachlich]` | `fachlich` | fachliche Anforderung aus `/fachplan` |
| `[Plan]` | `plan` | Plandokument aus `/techplan` |
| kein Präfix | `issue` | Arbeitspaket aus `/issues` |
| `[Task]` | `issue` | Arbeitspaket aus `/task` (Bahn 3) |
| `[Idee]` | — | ausgeschlossen, siehe oben |

Die `[Task]`-Zeile ist eine reine Klarstellung: `stufeAusTitel` fällt für jedes unbekannte
Präfix ohnehin auf `issue` zurück. Sie steht trotzdem da, weil die Tabelle sich sonst als
abschließend liest — und die nächste Sitzung für `[Task]` eine vierte Stufe erfände.

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

**Die Streich-Frage ist Pflicht in jeder Rolle, die ein Dokument prüft** — also in allen Rollen dieses Abschnitts außer `synthese`. Reviewer schlagen von sich aus Ergänzungen vor, weil Ergänzen leichter ist als Streichen. Ein Dokument, das nach dem Review doppelt so lang ist, ist nicht automatisch besser implementierbar — ohne diese Frage kippt der Roundtrip in Aufblähung. Die Rolle `synthese` liest kein Dokument, sondern eine Abwägung; die Frage würde sie zur Dokumentkritik einladen, und genau die ist dort ausgeschlossen.

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

#### Rolle `synthese`: das fremde Auge auf die Synthese

Diese Rolle gehört zu keiner Stufe. Sie läuft in Schritt 6, nachdem die Synthese geschrieben ist, und prüft **die Abwägung, nicht das Dokument** — wer besetzt wird und wann sie überhaupt läuft, steht dort.

Sie ist der einzige Blick von außen auf einen Schritt, den sonst dieselbe Session tut, die auch die Befunde verwaltet: Aus einer Befundliste wird ein Text, und dabei fällt jede Entscheidung über Übernahme und Verwerfung. Der Beleg-Abgleich aus Issue #593 prüft davon nur die mechanische Hälfte — ob ein als übernommen bezeichneter Fund im Vorschlag auch steht. Ob die Begründung eines **verworfenen** Funds trägt, kann kein Kommando sehen.

**Rolle `synthese`:**

```
Du liest die Synthese eines Reviews, nicht das geprüfte Dokument. Ein anderes
Modell hat aus den Befundlisten der Reviewer einen Textvorschlag gemacht und
dabei entschieden, welcher Fund einfließt und welcher verworfen wird. Du prüfst
diese Entscheidungen.

1. Bleibt ein Widerspruch zwischen den Befundlisten unbenannt, obwohl die
   Synthese ihn hätte benennen müssen?
2. Trägt die Begründung, mit der ein Fund verworfen wurde — adressiert sie den
   Fund, argumentiert sie nachvollziehbar, widerspricht sie den vorliegenden
   Unterlagen nicht? Du prüfst NICHT, ob sie sachlich zutrifft; dafür brauchst du
   den Bestand, und darum geht es hier nicht.

Du prüfst das Dokument NICHT erneut. Ein Fund, den keine Befundliste nennt,
gehört nicht in deine Antwort — auch dann nicht, wenn er dir richtig erscheint.

Je Befund:
- die Synthese-Zeile, auf die er sich bezieht (Zitat)
- Reviewer und Fund, um den es geht
- der Grund: was an der Begründung nicht trägt, oder welcher Widerspruch fehlt

Wenn du nichts findest: schreibe das ausdrücklich hin, nicht "alles gut".

--- BEFUNDLISTEN ---
{{BEFUNDE}}

--- SYNTHESE ---
{{SYNTHESE}}

--- BODY-VORSCHLAG ---
{{VORSCHLAG}}
```

Auf der Stufe `issue` entfällt Frage 1 — dort gibt es nur eine Befundliste und damit keinen Widerspruch, den die Synthese benennen könnte. Der Prompt geht dann ohne diesen Punkt hinaus; Frage 2 bleibt unverändert.

**Die Platzhalter kommen aus Dateien, die schon da sind.** `{{BEFUNDE}}` ist der Inhalt von `<tmpdir>/<id>-befunde.md` (Schritt 5), `{{SYNTHESE}}` und `{{VORSCHLAG}}` sind die beiden Dateien des Beleg-Abgleichs (Schritt 6). **Kein `{{ISSUE_BODY}}`:** Mit dem Dokument im Prompt fällt der Prüfer zuverlässig in die Dokumentkritik zurück, und genau die ist hier ausgeschlossen — geprüft wurde das Dokument schon.

Wie jede Rolle weist der Prüfer den Bestandszugriff aus, mit derselben Zeile im Board-Kommentar: `Bestand: gelesen`, sonst `Bestand: nein`. Er braucht den Bestand für seine beiden Fragen nicht; ablesbar bleiben soll es trotzdem.

**Zuordnung und Fehlerpfad:** Die Rollennamen aus `issue-review roles` sind eindeutig einem Promptblock zugeordnet — `pruefbarkeit` für das Arbeitspaket, `form-beobachtbarkeit` und `abgrenzung` für die fachliche Stufe, `architektur-bestand` und `schnitt-abhaengigkeiten` für den Plan, `vollstaendigkeit-pruefbarkeit` und `scope-risiko-bestand` im Legacy-Fallback, `synthese` für die Synthese-Prüfung aus Schritt 6. Jeder Prompt erhält den unveränderten Issue-Body über `{{ISSUE_BODY}}` — **ausgenommen `synthese`**, die kein Dokument prüft und ihn deshalb nicht bekommt. **Liefert die Config einen Rollennamen, zu dem es keinen Prompt gibt, bricht der Review vor dem Reviewer-Start mit sichtbarer Fehlermeldung ab.** Ohne diesen Pfad wäre ein Vertipper in der Config ein stiller Ausfall: Die Session liefe an, verbrauchte ihre Zeit und lieferte einen Befund, der auf keiner Rolle beruht.

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
printenv TMPDIR
```

```bash
cat  > <tmpdir>/<id>-befunde.md <<'TEIL1'
## Issue-Review, Runde 1

Reviewer: codex (pruefbarkeit)
codex — Bestand: nein

### codex — Vollständigkeit und Prüfbarkeit
<Befunde>
TEIL1
```

```bash
cat >> <tmpdir>/<id>-befunde.md <<'TEIL2'
… weitere Stuecke, je hoechstens 6.000 Zeichen …
TEIL2
```

```bash
node .claude/kit/board.mjs issue comment <id> --text-file <tmpdir>/<id>-befunde.md
```

Jeder Block ist ein **eigener** Werkzeugaufruf, und der Pfad steht woertlich — die Grenze von 6.000 Zeichen gilt je Aufruf, und eine Variable im Redirect-Ziel wird unbeaufsichtigt abgewiesen. Warum, steht in `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board".

Je gelaufener Reviewer eine Überschrift, in der Reihenfolge aus `gewaehlt`. Auf den Stufen `fachlich` und `plan` sind es zwei Blöcke, auf der Stufe `issue` einer.

**Der Text geht nie als Kommandozeilen-Argument** (Issue #270). Reviewer-Befunde
liegen regelmäßig bei über zehntausend Zeichen; als Argument scheitert daran das
Quoting, und eine Session, die sich daraufhin ein Hilfsskript baut, wird headless
abgelehnt — sie endet ohne Board-Spur, und der Runner bucht sie als Fehlschlag.

**Die Schlussfolgerung war bis zum 2026-09-10 „also Heredoc"; sie lautet jetzt „also
stueckweise in eine Datei".** Der Heredoc löste das Quoting-Problem, lief aber in eine
andere Wand: Der Befehls-Parser weist einen Aufruf ab, der den ganzen Text trägt. An
diesem Tag verloren zwei Prüf-Sitzungen ihr vollständiges Ergebnis daran. Das Quoting-
Argument bleibt gültig — es spricht nur nicht mehr für den Heredoc am Board-Aufruf,
sondern für den Dateiweg aus `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board".
Die `cat`-Blöcke tragen den quotierten Marker weiterhin, damit die Shell Backticks und
`$` im Befundtext nicht auswertet.

**Eine Ausnahme:** Die Ausfall-Form weiter unten ist zwei Zeilen lang und geht als
`--text "…"`-Argument. Sie soll gerade dann noch gelingen, wenn der Dateiweg gescheitert
ist — und bei zwei Zeilen trägt das Quoting.

Die Datei gehört **außerhalb des Projektverzeichnisses** — eine Datei im Repo macht den
Working Tree unsauber, und darauf stoppt der Nacht-Runner hart (Issue #152).

Lief der Review unterbesetzt oder ist ein Reviewer ausgefallen, steht das in der **zweiten Zeile** des Kommentars — die erste trägt den Anker.

**Danach `label-sync`** — der erste von drei Aufrufen in diesem Skill: **nach dem Befunde-Kommentar** (hier), **nach dem Schreiben von Body und Marker** (Schritt 6) und **nach der Verzicht-Meldung** (Schritt 4):

```bash
node .claude/kit/board.mjs issue-review label-sync <id>
```

Der Zustand hat sich gerade geändert (von `offen` auf `befunde`, oder auf `ausgefallen`), und das Label soll ihn zeigen. Das Kommando leitet selbst ab — es bekommt keinen Zustand übergeben, und es gibt hier nichts zu entscheiden.

**Wenn der Transport scheitert.** Der Text geht über eine Datei (Schritt 5). Zwei Stellen können dabei scheitern, und sie
werden verschieden behandelt.

**Scheitert ein Dateischritt**, wird die unvollständige Datei **nicht übertragen**. Ein
halber Befundtext am Board ist schlechter als keiner: Er sieht aus wie ein vollständiger.

**Scheitert der Board-Aufruf, hängt alles daran, ob schon ein Kommentar mit dem
Runden-Anker steht.**

- **Noch keiner** — es ist der Befunde-Kommentar selbst, der nicht ankommt. Dann folgt
  genau **ein** Versuch mit der Ausfall-Form: Anker in Zeile 1, in Zeile 2
  `Ausfall: Ergebnis nicht ans Board gebracht (<erste Zeile der Fehlermeldung>), von Hand nachsehen`.
  Sie geht als `--text "…"`-Argument — zwei Zeilen tragen das Quoting, und sie soll
  gerade dann gelingen, wenn der Dateiweg gescheitert ist. Danach endet der Skill mit
  Fehler, ohne Marker. **Das ist die einzige Ausnahme vom Mutationsstopp oben.**
- **Schon einer** — der Befunde-Kommentar steht bereits am Board, und es scheitert die
  Synthese, der Body-Vorschlag oder die Body-Schreibung. Dann bleibt es beim
  Mutationsstopp: kein weiterer Schreibversuch. Die Befunde sind die Board-Spur, und
  `night.mjs --review` meldet für diese Lage „Schärfung fehlt". **Eine Ausfall-Form
  dahinter wäre schädlich:** `reviewZustand` liest den jüngsten Kommentar mit Anker und
  setzte das Dokument auf `ausgefallen` zurück — die vorhandenen Befunde wären damit
  entwertet, und die nächste Nacht prüfte von vorn.

**Nach der Ausfall-Form folgt kein `label-sync`.** Zu diesem Zeitpunkt trägt die Karte
ohnehin `review:offen`, und der Zustand `ausgefallen` bildet genau darauf ab
(`kit/board.mjs`, `ZUSTAND_ZU_LABEL`) — **ein Label `review:ausgefallen` existiert
nicht.** Was die Ausfall-Form trotzdem leistet: Ein Kommentar mit Anker **und**
Ausfallvermerk zählt nach Regel 4 nicht für `GRENZE_RUNDEN`. Drei gescheiterte
Übertragungen machen ein Dokument also nicht zu „auserzählt", während drei ankerlose
Notizen für die Maschine gar nicht existieren.

**Der Grund für die Fehlermeldung gehört in die Klammer, nicht eine Vermutung.** Mit
`--text-file` scheitert der Aufruf nicht mehr an der Größe, sondern an Netz, Auth oder
Drosselung. „(Größe)" wäre dann eine falsche Diagnose für den, der morgens nachsieht.

### 5b. Synthese protokollieren — ein zweiter, getrennter Kommentar

Zwischen den Befunden und dem neuen Body liegt eine Arbeit, die sonst unsichtbar bleibt: Aus einer Befundliste wird ein Text. Dabei wird entschieden, welcher Fund einfließt und welcher verworfen wird — und wo eine Stufe mehrere Prüfer hat, bei Widerspruch auch, wer recht bekommt.

**Ohne Protokoll sieht ein bewusst verworfener Fund genauso aus wie ein übersehener.** Wer später Kommentar und Body nebeneinanderlegt, findet eine Differenz und kann die beiden Fälle nicht unterscheiden.

Der Kommentar ist **getrennt** vom Befunde-Kommentar aus Schritt 5. Der bleibt unverändert Verlauf (Issue #155); die Synthese ist bewertet und gehört nicht in denselben Block.

**Die Synthese beschreibt Entscheidungen über den Vorschlag, nicht über einen bereits geänderten Body.** „Übernommen" heißt: Der Fund ist in den vorgeschlagenen Text eingearbeitet — im Nachtbetrieb in den Body-Vorschlag aus Schritt 6, interaktiv in den Vorschlag, den der Mensch noch freigeben muss. Geschrieben ist damit nichts. Die Perfekt-Formulierung („nennt jetzt beide") ist genau der Ort, an dem die Verwechslung entsteht: Am 2026-08-12 behaupteten neun Synthesen Schärfungen, die in keinem Text standen.

Beispiel einer Stufe mit zwei Prüfern (`fachlich` oder `plan`) — auf der Stufe `issue` entfällt der Abschnitt „Dissens", weil es nur eine Befundliste gibt:

```bash
printenv TMPDIR
```

```bash
cat  > <tmpdir>/<id>-synthese.md <<'TEIL1'
## Synthese, Runde 1

### Entscheidungen
- opus, "Akzeptanzkriterium nicht maschinell prüfbar" (BLOCKER) — übernommen →
  Akzeptanzkriterium: "der Aufruf endet mit Exitcode 0"
- opus, "Der Absatz zur Migration ist Kandidat für RAUS" (WICHTIG) — übernommen →
  Kontext: gestrichen "Die Migration der Altdaten läuft nebenher."
- codex, "Abhängigkeit fehlt" (WICHTIG) — verworfen: Issue #7 steht bereits im
  Abhängigkeiten-Abschnitt, der Reviewer sah ihn nicht (Kontextlosigkeit).
- codex, "Cookie-Schreiben ist Kandidat für RAUS" (WICHTIG) — verworfen:
  Issue #10 spezifiziert es vollständig und ist als Abhängigkeit genannt.

### Dissens
- opus wollte die Codeprüfung durch einen Test ersetzen, codex umgekehrt den
  Test-Zweig streichen (das Projekt hat keine Testbasis). Entschieden für opus.
  Folgeänderung: Issue #7 als Abhängigkeit ergänzt.

Übernommen: 2 · Verworfen: 2
TEIL1
```

```bash
cat >> <tmpdir>/<id>-synthese.md <<'TEIL2'
… weitere Stuecke, je hoechstens 6.000 Zeichen …
TEIL2
```

```bash
node .claude/kit/board.mjs issue comment <id> --text-file <tmpdir>/<id>-synthese.md
```

Jeder Block ist ein **eigener** Werkzeugaufruf, und der Pfad steht woertlich — die Grenze von 6.000 Zeichen gilt je Aufruf, und eine Variable im Redirect-Ziel wird unbeaufsichtigt abgewiesen. Warum, steht in `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board".

**Jeder `übernommen`-Punkt trägt einen Beleg**, unmittelbar nach dem Ausgangswort; Prosa steht danach. Zwei Formen, je nachdem ob der Fund Text hinzufügt oder Text entfernt:

```
- <reviewer>, "<Fund>" (<Grad>, `<Klasse>`) — übernommen → <Abschnitt>: "<Zitat>"
- <reviewer>, "<Fund>" (<Grad>, `<Klasse>`) — übernommen → <Abschnitt>: gestrichen "<Zitat aus dem alten Body>"
```

Das Zitat wird **wörtlich aus dem Body-Vorschlag kopiert**, bei `gestrichen` wörtlich aus dem alten Body. Ohne Beleg nennt die Zeile den Fund und nicht die Textänderung — der Abgleich aus Schritt 6 hätte keinen Suchbegriff und meldete sie zwangsläufig als unbelegt.

**Die zweite Form ist keine Verzierung.** Jede Reviewer-Rolle stellt die Frage „Was kann RAUS?". Wird eine Streichung übernommen, steht im neuen Text nichts, was zu zitieren wäre; mit der einfachen Form riefe genau der Fund einen Menschen, der das Dokument kürzt. Belegt wird sie umgekehrt: Das Zitat aus dem alten Body darf im Vorschlag **nicht mehr** vorkommen.

`verworfen` und `zur Entscheidung` behaupten keine Textänderung und tragen deshalb keinen Beleg.

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

### 6. Body schärfen

Was hier geschieht, hängt an der Betriebsart — **und an nichts sonst**. Für alle drei Stufen gilt dieselbe Regel. **Die unbeaufsichtigte steht zuerst**, weil eine Session von oben liest und nach dem ersten Fall handelt, den sie findet:

**Unbeaufsichtigt** (`KIT_AGENT_MODEL` gesetzt): Sind alle Funde `korrektur`, wird der Body geschrieben und der Marker gesetzt. Ist mindestens ein Fund `gate`, `alternativen` oder klassenlos, werden die übernommenen `korrektur`-Funde trotzdem angewendet, `kit:klaeren` wird gesetzt und der Marker bleibt aus.

**Interaktiv:** Vorschlag zeigen, einmal fragen.

Erkennungsmerkmal ist **gesetztes `KIT_AGENT_MODEL`** und ausdrücklich kein zweites Signal — dieselbe Bedingung wie im Abschnitt „Im Nachtbetrieb". Der Nacht-Runner stellt dem Auftrag zwar einen Satz voran, der die Betriebsart benennt. **Maßgeblich bleibt allein `KIT_AGENT_MODEL`; der Hinweis im Prompt wiederholt es nur** — sein Fehlen ist keine Entwarnung.

**Der Abgleich vor der ersten Schreibung.** Bevor irgendetwas geschrieben wird, werden die als `übernommen` bezeichneten Funde der Synthese gegen den Body-Vorschlag gehalten — die Belegform dazu steht in Schritt 5b:

```bash
node .claude/kit/board.mjs issue-review synthese-check --synthese-file <tmpdir>/<id>-synthese.md --vorschlag-file <tmpdir>/<id>-vorschlag.md
```

**Unbeaufsichtigt** läuft der Abgleich vor Schreibbefehl 1; beide Entwürfe liegen dann bereits als Dateien vor, aus denen die Kommentare gleich entstehen. **Interaktiv** läuft er **vor der Zustimmungsfrage**: Synthese und Body-Vorschlag werden dafür vorher als `<tmpdir>/<id>-synthese.md` und `<tmpdir>/<id>-vorschlag.md` abgelegt — dieselben Dateien, die anschließend als Kommentare ans Board gehen; der Vorschlag im Chat ist ihre Wiedergabe, nicht ihr Ersatz. Die Regeln aus „Lange Texte ans Board" gelten dabei unverändert.

Der Datei-Weg ist keine Bequemlichkeit: Nach der Zustimmung ist der Body geschrieben, und eine Prüfung hinter der Schreibung kommt zu spät. Zu diesem Zeitpunkt steht am Board noch nichts, was `synthese-check <id>` lesen könnte — die Variante mit der Kartennummer ist hier nicht gemeint.

**`ok: false` wirkt wie ein `gate`-Fund:** Die Schreibbefehle 1 bis 5 laufen (Body-Vorschlag, Body ohne Marker, `kit:klaeren`, Synthese, Abgleich-Kommentar), die zweite Body-Schreibung entfällt, `label-sync` läuft. Der **Marker bleibt aus** — was eine Synthese als übernommen ausweist, ohne dass es im Text steht, ist keine geprüfte Schärfung.

**Scheitert der Aufruf selbst** — Exit ungleich 0, keine gültige JSON-Ausgabe, eine der Dateien nicht lesbar —, gilt dasselbe: kein Marker, `kit:klaeren`, und der Abgleich-Kommentar trägt in Zeile 2 `Abgleich ausgefallen: <erste Zeile der Fehlermeldung>`. **Kein zweiter Versuch.** Ein ausgefallener Abgleich ist nie befundfrei.

**Der Abgleich-Kommentar** entsteht bei jedem Lauf mit Befunden — er trägt neben den Beleg-Befunden auch das Ergebnis der Synthese-Prüfung weiter unten, und die läuft gerade dann, wenn der Beleg-Abgleich grün war. Seine erste Zeile lautet wörtlich `## Synthese-Abgleich, Runde <n>`, mit der Runde des geprüften Synthese-Kommentars — nie einer eigenen Zählung. **Nur bei `ok: false`** steht darunter je Zeile ein Eintrag aus `ohneBeleg` mit Reviewer, Fund und Grund, in dieser Form:

```
- opus, "Akzeptanzkriterium nicht maschinell prüfbar" — beleg-fehlt
- codex, "Der Absatz zur Migration ist Kandidat für RAUS" — zitat-nicht-gefunden
```

Geschrieben wird er über `issue comment --text-file` nach der Transportregel, wie der Synthese-Kommentar aus Schritt 5b.

Interaktiv entsteht er unmittelbar nach dem Abgleich, **vor der Zustimmungsfrage und unabhängig von der Antwort** — auch bei Ablehnung. Der Grund gehört ans Dokument, nicht in den Verlauf, und gerade dann, wenn der Mensch nicht übernimmt.

**Interaktiv** wird `kit:klaeren` dabei **ohne Rückfrage** gesetzt — ein Label ist weder Body noch Marker. Antwortet der Mensch trotz Befund mit „ja", wird der Body geschrieben und der Marker bleibt trotzdem aus; ein Neu-Abgleich wird nicht angeboten.

**Die Synthese-Pruefung — unmittelbar hinter dem Beleg-Abgleich.** Ist der Abgleich grün (`ok: true`), liest ein Modell die Synthese, das sie nicht geschrieben und auch keine Befundliste beigesteuert hat. Der Prompt dazu ist die Rolle `synthese` aus Schritt 3. **Unbeaufsichtigt** läuft sie vor Schreibbefehl 1, **interaktiv** vor der Zustimmungsfrage — dieselbe Stelle wie der Abgleich, aus demselben Grund: Danach ist der Body geschrieben.

**Wann sie läuft.** Nach einem grünen Abgleich, und nur wenn es etwas zu prüfen gibt: mindestens ein verworfener Fund **oder** zwei Befundlisten, die beide mindestens einen Fund tragen. Ein befundfreier Lauf ist ein Entfall — dort überspringt Schritt 6 die Schreibbefehle 1 bis 3, es gibt also weder Synthese noch Vorschlag.

**Ist der Beleg-Abgleich rot**, läuft der Prüfer nicht, und es entsteht **keine zusätzliche Zeile**: Der Kommentar trägt ohnehin die Beleg-Befunde, und der Marker bleibt aus. Eine zweite Begründung für dieselbe Folge sagt niemandem etwas.

**Die Besetzung** kommt aus demselben Kommando wie die Reviewer, mit der festen Rolle:

```bash
node .claude/kit/board.mjs issue-review roles \
  --stufe <fachlich|plan|issue> \
  --rolle synthese \
  --author <modell> \
  --ausschluss <name,...> \
  --issue <N>
```

`--author` trägt das `Autor-Modell:` des Dokuments. Die Ausschlussliste trägt die Namen aus `gewaehlt` (Schritt 1b) **und das Modell dieser Session** — nachts `KIT_AGENT_MODEL`, interaktiv die Selbstauskunft der Session, wie bei `Autor-Modell:` in `/issues`. `KIT_AGENT_MODEL` setzt nur der Nacht-Runner; ohne die interaktive Ergänzung dürfte die Session ihre eigene Synthese prüfen, sobald ihr Modell vom `Autor-Modell:` abweicht — und damit fiele der ganze Sinn dieses Schritts weg.

**Drei Ausgänge.** Befund und Ausfall wirken in **beiden** Betriebsarten wie `ok: false` aus dem Beleg-Abgleich: Unbeaufsichtigt laufen die Schreibbefehle 1 bis 5 und `label-sync`, die zweite Body-Schreibung entfällt. Interaktiv wird `kit:klaeren` **ohne Rückfrage** gesetzt, der Befund steht vor der Zustimmungsfrage, und ein „ja" schreibt den Body ohne Marker.

- **Befund** — die Befunde stehen im Kommentar `## Synthese-Abgleich, Runde <n>`, unter den Beleg-Einträgen bzw. an deren Stelle.
- **Entfall** — es gibt kein unbeteiligtes Modell (`entfall: true` in der `roles`-Antwort) oder nichts zu prüfen (kein verworfener Fund, keine zwei gefüllten Befundlisten). Im selben Kommentar steht die Zeile `Synthese-Pruefung entfallen: <Grund>`. Der Marker **wird** gesetzt, sofern die Marker-Regel im Übrigen erfüllt ist, und trägt den Zusatz in der Klammer: `(JJJJ-MM-TT[, Nachtlauf][, ohne Synthese-Pruefung])`.
- **Ausfall** — Exit ungleich 0, keine Antwort, oder eine Antwort, die weder einen Befund noch den ausdrücklichen Satz enthält, dass nichts gefunden wurde: kein Marker, `kit:klaeren`, die Zeile `Synthese-Pruefung ausgefallen: <Grund>`, **kein zweiter Versuch, kein Ersatz-Pruefer**. Dieselbe Regel wie beim ausgefallenen Abgleich — eine ausgefallene Prüfung ist nie befundfrei.

Der Unterschied zwischen Entfall und Ausfall ist die ganze Sache: Beim Entfall gab es nichts zu prüfen oder niemanden, der prüfen durfte, und beides ist eine Eigenschaft der Lage, nicht ein Loch im Lauf. Beim Ausfall sollte geprüft werden und wurde nicht.

**Unbeaufsichtigt gilt im Einzelnen:**

Die Verantwortungsschwelle liegt nicht am Text, sondern an der **Entscheidung**: Automatisiert wird, was automatisierbar ist; wo eine Entscheidung fehlt, zeichnet ein Label sie sichtbar.

Für `korrektur`-Funde bleibt die Abwägung übernommen/verworfen mit Begründung bestehen; **angewendet wird, was übernommen ist** — nicht ausnahmslos jeder. Die Klassen `gate` und `alternativen` kann die Synthese **nicht verwerfen**, sie rufen nach A9 immer den Menschen; sie benennt dann jeden offenen Punkt einzeln.

**Ein Fund ohne Klassenangabe gilt wie `gate`.** Er wird **nicht angewendet**, er
zeichnet das Ticket mit `kit:klaeren`, und der **Marker bleibt aus** — genau wie ein
echter `gate`-Fund.

Die Richtung ist Absicht: Im Zweifel ruft der Fund einen Menschen. Die Gegenrichtung —
fehlende Angabe gilt als `korrektur` — wäre bequemer und genau falsch, weil sie das
Auslassen zur billigsten Variante machte. Ein Prompt wird nicht immer befolgt; die Regel
darf nicht daran hängen, dass er es wird.

**Ein `korrektur`-Fund auf einen menschlich gesetzten Inhalt ist kein `korrektur`-Fund.**
Berührt er eine dokumentierte PO-Antwort unter `## Offene Fragen an den PO` oder eine
Begründung unter `## Architektonische Entscheidungen`, wird er **nicht angewendet**; er
zeichnet das Ticket mit `kit:klaeren` und hält damit über die Klassenlos-Regel auch den
**Marker** zurück. Geschützt sind nicht die Stufen, sondern die Inhalte, die ein Mensch
gesetzt hat — dieselbe Aufgabe erfüllt weiter unten die Liste der Kennzeichnungszeilen,
die aus dem alten Stand übernommen werden. Deshalb steht die Regel hier oben, bei der
Klassifikation der Funde: Wer erst unten davon liest, hat sie schon angewendet.

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
5. der `## Synthese-Abgleich`-Kommentar — bei jedem Lauf mit Befunden; er trägt die Beleg-Einträge, den Ausfall des Abgleichs oder das Ergebnis der Synthese-Pruefung
6. gegebenenfalls ein ZWEITES `issue update` — derselbe Body, ergänzt um die Marker-Zeile; `Pruefung:` und `Pruefung-Stand:` werden wie bei jeder Body-Schreibung aus dem aktuellen Stand übernommen
7. `issue-review label-sync <id>` — wie weiter unten beschrieben, unbeaufsichtigt identisch

Der Marker ist keine eigene Operation, sondern eine **Zeile im Body**. Er kann deshalb nur mit einer Body-Schreibung entstehen — und weil er nie ohne Synthese dastehen darf, wird der Body zweimal geschrieben: erst geschärft ohne Marker, nach erfolgreicher Synthese ein zweites Mal mit.

Bei befundfreiem Lauf entfallen die Schritte 1 bis 3 **und 5**; das `issue update` mit der Marker-Zeile ist dann die einzige Body-Schreibung und schreibt den unveränderten Body plus Marker. Ohne Synthese gibt es weder etwas abzugleichen noch etwas zu prüfen — und damit auch nichts zu kommentieren.

**Schlägt einer der Befehle fehl, endet der Skill mit Fehler und führt keine weitere Mutation am Issue aus.** Scheitert die **zweite** Body-Schreibung, bleibt der Body geschärft und ohne Marker zurück — das Ticket sieht dann aus wie eines mit Befunden, was es zu diesem Zeitpunkt auch ist. Ein Marker ohne Synthese kann nicht mehr entstehen. Zwei Fehlerpfade sind im Bestand angelegt und ausdrücklich gemeint: `issue update` weist bei gesetztem `KIT_AGENT_MODEL` einen Body ab, der die `Pruefung:`-Zeile verringert (Issue #303), und `issue label add` scheitert, solange die Label-Definition am Board fehlt.


Wie der `## Body-Vorschlag`-Kommentar (Schreibbefehl 1) aufgebaut ist und welche Kopfzeile er wörtlich trägt, steht im Abschnitt „Im Nachtbetrieb".

**Interaktiv wird nichts ohne Zustimmung geschrieben.** Zeige einen Vorschlag mit den eingearbeiteten Funden und frage einmal:

> Stufe `issue`, Reviewer `codex` (pruefbarkeit), 3 Funde (1 BLOCKER, 2 HINWEIS). Vorschlag für den neuen Body:
> …
> Übernehmen? (ja / nein / einzelne Funde nennen)

Kein Konsens-Automatismus: Modelle können sich einig und trotzdem falsch sein. Übereinstimmung ist kein Wahrheitskriterium, und wer über die Anforderung entscheidet, entscheidet über das Produkt — das ist keine Modellfrage.

**Bei Ablehnung:** Body bleibt unverändert und **kein Marker** wird gesetzt. Ein Review, dessen Ergebnis verworfen wurde, hat das Issue nicht geschärft.

**In beiden Betriebsarten gilt:**

**Wird der Body geschrieben** — interaktiv nach der Zustimmung, unbeaufsichtigt nach der Fallunterscheidung oben —, wird die Marker-Zeile **der geprüften Stufe** aufgenommen, wörtlich in einer dieser drei Formen:

```
Fachplan-Review: <reviewer[, reviewer…]> (JJJJ-MM-TT[, Nachtlauf][, ohne Synthese-Pruefung])
Plan-Review:     <reviewer[, reviewer…]> (JJJJ-MM-TT[, Nachtlauf][, ohne Synthese-Pruefung])
Issue-Review:    <reviewer[, reviewer…]> (JJJJ-MM-TT[, Nachtlauf][, ohne Synthese-Pruefung])
```

Der Zusatz `, ohne Synthese-Pruefung` steht nur bei einem Entfall der Synthese-Pruefung (Schritt 6) und immer als letztes Glied in der Klammer. Ein Arbeitspaket, dessen Synthese-Pruefung mangels unbeteiligtem Modell entfallen ist, trägt danach:

```
Issue-Review: codex (2026-08-06, ohne Synthese-Pruefung)
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
printenv TMPDIR
```

```bash
cat  > <tmpdir>/<id>-body.md <<'TEIL1'
...
TEIL1
```

```bash
cat >> <tmpdir>/<id>-body.md <<'TEIL2'
… weitere Stuecke, je hoechstens 6.000 Zeichen …
TEIL2
```

```bash
node .claude/kit/board.mjs issue update <id> --body-file <tmpdir>/<id>-body.md
```

Jeder Block ist ein **eigener** Werkzeugaufruf, und der Pfad steht woertlich — die Grenze von 6.000 Zeichen gilt je Aufruf, und eine Variable im Redirect-Ziel wird unbeaufsichtigt abgewiesen. Warum, steht in `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board".

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
2. Die **zweite Zeile** des Board-Kommentars nennt den Ausfall mit Grund — die erste trägt den Anker, und `reviewZustand` liest den Vermerk in Zeile 2.
3. Der **Marker bleibt aus** — ein unterbesetzter Lauf ist nie befundfrei im Sinne der Marker-Regel unten.
4. **Kein Ersatz-Reviewer aus eigenem Antrieb.** Wer die Besetzung ändert, ändert das Verfahren; dafür gibt es `pairs`. Nachts wird die Lücke protokolliert, nicht gefüllt.

Diese Regel gilt für **jeden unbeaufsichtigten Lauf**, nicht nur für `night.mjs --review` — auch dann, wenn ein anderer Runner den Skill startet.

Der Grund steht im Protokoll vom 2026-08-08 (Issue #267): Vier Sessions hatten ihre Reviewer-Arbeit fertig — bei einer davon drei BLOCKER — und haben sie verworfen, weil sie auf eine Antwort warteten, die nachts niemand geben kann. Fünf bis sechs Minuten Arbeit je Issue, viermal, für nichts. Der bisherige Text deckte nur zwei Lagen ab: Reviewer fehlt beim Vorflug (dann startet der Runner nicht) und Reviewer fällt mitten im Lauf aus (dann ist es ein Fund für den Bericht). Die dritte — Vorflug meldet ihn, Start scheitert — kannte er nicht, und für eine Lage ohne Regel improvisiert jede Session neu.

**Schritt 6 steht in Schritt 6.** Was unbeaufsichtigt mit dem Body geschieht — die Fallunterscheidung, die Regel für den Fund ohne Klassenangabe, das `kit:klaeren`-Kommando, in welcher Folge geschrieben wird und was ein fehlgeschlagener Befehl hinterlässt — ist dort geregelt, wo die Session es liest, bevor sie handelt. Hier steht nur, was allein nachts gilt.

Der Grund ist derselbe wie beim Reviewer-Ausfall oben: Stand die Ausnahme achtzig Zeilen unter der Regel, handelte die Session, bevor sie sie las. Am 2026-08-31 endeten so vier von vier Nacht-Sessions mit „Schärfung fehlt" — Befunde vollständig, Body ungeschrieben. Zweimal war zuvor die Formulierung geschärft worden, beide Male ohne Wirkung (Issue #417).

**Der `## Body-Vorschlag`-Kommentar (Schreibbefehl 1 aus Schritt 6) trägt den fertig formulierten Text ans Board** — als übernehmbaren Text und nicht als Beschreibung dessen, was zu ändern wäre. Er entsteht auf jeder Stufe und auch dann, wenn der Body anschließend geschrieben wird: Er ist die Spur, was die Maschine getan hat, und beim Groomen liest man ihn von dort (`issue get` liefert `comments`).

Die **erste Zeile** dieses Kommentars lautet wörtlich `## Body-Vorschlag, Runde <n>`, mit der Nummer der Runde:

```bash
printenv TMPDIR
```

```bash
cat  > <tmpdir>/<id>-vorschlag.md <<'TEIL1'
## Body-Vorschlag, Runde 1

## Kontext
… der vollständige neue Body, Abschnitt für Abschnitt …
TEIL1
```

```bash
cat >> <tmpdir>/<id>-vorschlag.md <<'TEIL2'
… weitere Stuecke, je hoechstens 6.000 Zeichen …
TEIL2
```

```bash
node .claude/kit/board.mjs issue comment <id> --text-file <tmpdir>/<id>-vorschlag.md
```

Jeder Block ist ein **eigener** Werkzeugaufruf, und der Pfad steht woertlich — die Grenze von 6.000 Zeichen gilt je Aufruf, und eine Variable im Redirect-Ziel wird unbeaufsichtigt abgewiesen. Warum, steht in `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board".

Darunter steht der **vollständige Ersatz** für den Issue-Body, nicht eine Liste der vorzunehmenden Änderungen. Wer ihn übernimmt, kopiert ihn unverändert in `issue update`.

**Die Reihenfolge ist verbindlich: erst der Body-Vorschlag, dann die Synthese.** Wer die Synthese zuerst schreibt, hat die Abwägung protokolliert und den Text noch nicht — und genau dann fällt das Aufschreiben aus. Am 2026-08-12 ist das neunmal in einem Lauf passiert: Befunde und Synthese lagen vor, der übernehmbare Text fehlte in allen neun Fällen, und die Synthesen behaupteten im Perfekt Schärfungen, die in keinem Body standen.

**`night.mjs --review` prüft das.** Fehlt der neue Vorschlag und wurde kein Marker der aktiven Stufe gesetzt, meldet der Lauf „Schärfung fehlt" statt eines Erfolgs. Gewertet wird nur, was **in dieser Session** hinzugekommen ist — ein Vorschlag aus einem früheren Lauf zählt nicht. Bei mehreren Runden zählt die höchste geschriebene Runde.

**Die Marker-Regel unten gilt für alle drei Stufen.** Wird der Body geschrieben, muss das Dokument als geprüft erkennbar sein — sonst bleibt es auf `review:offen` stehen und sieht ungeprüft aus, obwohl sein Body den Review bereits trägt. Gefahrlos ist das, weil an `Fachplan-Review:` und `Plan-Review:` kein Gate hängt: `requiredBeforeReady` prüft allein `Issue-Review:` (`kit/night.mjs`), und die oberen Stufen gehen ohnehin nie nach Ready. Nicht die Stufe schützt, was ein Mensch entschieden hat, sondern die Schutzregel aus Schritt 6.

**Der Marker wird gesetzt, wenn nichts zu ändern ist.** Genauer, beide Bedingungen zusammen:

1. **Alle Funde tragen die Klasse `korrektur`**, und die übernommenen wurden angewendet. Ein einziger `gate`- oder `alternativen`-Fund reicht, und der Marker bleibt aus — stattdessen wird `kit:klaeren` gesetzt. **Ein Fund ohne Klassenangabe trägt `korrektur` nicht** und hält den Marker damit ebenso zurück.
2. Kein Reviewer ist ausgefallen, und der Lauf war nicht unterbesetzt.
3. Die Synthese-Pruefung (Schritt 6) hat weder einen Befund geliefert noch ist sie ausgefallen.

**Ein Entfall der Synthese-Pruefung ist weder ein Ausfall noch ein unterbesetzter Lauf** und hält den Marker deshalb nicht zurück — er steht als Zusatz `, ohne Synthese-Pruefung` in der Klammer. Ohne diesen Satz zöge Bedingung 2 den Entfall zu sich, und jedes Projekt mit zu wenigen Reviewern verlöre den Marker dauerhaft: Wo die Prüfung mangels unbeteiligtem Modell nie stattfinden kann, wäre ihr Ausbleiben ein Dauerfehler statt einer Lage.

Bis Issue #387 stand an Stelle 1 der Schweregrad: kein Fund mit `BLOCKER` oder `WICHTIG`. Das kollidierte mit der Klassifikation, sobald es sie gab — ein `korrektur`-Fund kann `WICHTIG` sein, und ein solches Ticket bliebe nach dem Anwenden weder markiert noch gezeichnet liegen.

Trifft eines davon nicht zu, bleibt der Marker aus und das Issue wartet auf den Menschen.

**Der Synthese-Kommentar aus Schritt 5b entsteht nachts genauso** — zusätzlich zum Body-Vorschlag. Dort ist er **wichtiger als interaktiv**, weil niemand zugesehen hat: Wer beim Groomen den Vorschlagstext übernimmt, übernimmt sonst eine fremde Abwägung, ohne sie zu sehen.

**Daraus folgt eine Schärfung der Marker-Regel:** Wird der Marker gesetzt, obwohl ein Fund verworfen wurde, **muss die Synthese das benennen**. Sonst behauptet der Marker eine Befundfreiheit, die es nicht gab — ein `HINWEIS`, den die Nacht verworfen hat, ist kein Grund, den Marker zurückzuhalten, aber er darf nicht unsichtbar bleiben.

Der Grund für diese Aufteilung: **Die Verantwortungsschwelle liegt auf der Entscheidung, nicht am Text.** Was ein Reviewer wörtlich vorschlägt und was nur einen Weg kennt, kann die Maschine anwenden — daran ist nichts zu entscheiden. Wo dagegen eine Regel berührt ist oder mehrere Wege offenstehen, macht `kit:klaeren` genau das sichtbar, statt es in einem Kommentar zu vergraben. Das GO bleibt unangetastet — nach Ready zieht weiterhin nur der Mensch.

**Marker-Form nachts** — wörtlich so, damit ablesbar bleibt, dass niemand zugestimmt hat. Hier der Marker eines Arbeitspakets, Stufe `issue`:

```
Issue-Review: codex (2026-08-06, Nachtlauf)
```

Der Zusatz steht innerhalb der Klammer; der Anker bleibt unverändert. Für `Fachplan-Review:` und `Plan-Review:` gilt dieselbe Form mit demselben Zusatz.

**`label-sync` läuft nachts identisch**, ohne Ausnahme: Ein Label ist weder Body noch Marker; ihn zu zeigen ist keine Produktentscheidung. Der Zustand ist abgeleitet und jederzeit neu berechenbar.

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

- Interaktiv kein Schreiben in den Issue-Body ohne ausdrückliche Zustimmung; unbeaufsichtigt nur nach der Fallunterscheidung in Schritt 6
- **Nachts wird nie gefragt, in keiner Lage** — auch nicht, wenn ein Reviewer beim Start ausfällt oder das Autor-Modell fehlt. Es wird mit dem verfahren, was da ist, und der Rest protokolliert
- **Nachts kein Ersatz-Reviewer** — die Besetzung folgt `pairs`, eine Lücke wird vermerkt, nicht gefüllt
- **Kein Anwenden eines Funds auf einen menschlich gesetzten Inhalt** — berührt er eine dokumentierte PO-Antwort unter `## Offene Fragen an den PO` oder eine architektonische Begründung unter `## Architektonische Entscheidungen`, ist er kein `korrektur`-Fund: Er wird nicht angewendet, zeichnet das Ticket mit `kit:klaeren` und hält den Marker zurück (Schritt 6, Issue #418)
- **Nie ein Marker ohne erfolgreich geschriebenen Body und Synthese-Kommentar** — schlägt ein Schreibbefehl fehl, endet der Skill und führt keine weitere Mutation aus
- **Kein Marker, wenn der Abgleich nicht gelaufen ist oder `ok: false` gemeldet hat** — ein ausgefallener Abgleich ist nie befundfrei (Schritt 6, Issue #593)
- **Kein Marker nach einem Befund oder einem Ausfall der Synthese-Pruefung** — ein Entfall hält ihn dagegen nicht zurück und steht als Zusatz `, ohne Synthese-Pruefung` im Marker (Schritt 6, Issue #598)
- Kein Marker ohne übernommenen Body (interaktiv) bzw. ohne dass alle Funde `korrektur` tragen und die übernommenen angewendet sind (nachts)
- **Kein Marker ohne Synthese-Kommentar, wenn Funde verworfen wurden** — sonst behauptet er eine Befundfreiheit, die es nicht gab
- **Kein Befund, keine Synthese, kein Body-Vorschlag und nie ein Marker, wenn auf der Stufe `issue` der eine Reviewer ausfällt** — dort ist ein Ausfall kein unterbesetzter Lauf, sondern gar keine Prüfung. Die Session protokolliert und endet
- Kein Ziehen nach Ready — das ist das menschliche GO
- Kein Review von `[Idee]`-Issues — `[Fachlich]` und `[Plan]` bestimmen dagegen die Stufe (Schritt 1b)
- **Kein Reviewer bei gültigem, nicht verfallenem Verzicht** — auch nicht bei explizit übergebener Nummer. Der Verzicht wird gemeldet und protokolliert, nicht übergangen
- **Kein Body-Rewrite ohne die Zeilen `Pruefung:` und `Pruefung-Stand:`** — sie werden aus dem alten Stand übernommen, sonst verfällt die Entscheidung des Menschen still (Schritt 6)
- Kein Start, wenn Reviewer fehlen und der Mensch nicht gefragt wurde
