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

**Übersprungen werden** nur Issues mit Titel-Präfix `[Idee]` — eine rohe Idee ohne `/plan`-Zyklus ist kein prüfbares Dokument. Nenne sie in der Zusammenfassung, damit niemand sie für geprüft hält.

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
  --author <modell>
```

`--author` ist Pflicht. Die Antwort liefert `rollen`, `reviewer` und `gewaehlt`; **`gewaehlt[i]` wird mit `rollen[i]` gepaart** — der erste gewählte Reviewer bekommt die erste Rolle. **Gestartet wird ausschließlich, was in `gewaehlt` steht.** Das stufenlose `reviewers`-Kommando wird für die Ausführung nicht mehr benutzt: Es liefert per Definition zwei Reviewer und würde die Besetzung der Stufe `issue` still verdoppeln.

Die Antwort trägt außerdem `stufenQuelle`. Steht dort `"stufen"`, gilt die konfigurierte Besetzung; steht dort `"default"`, fehlt der `reviewStufen`-Block und es gilt der Legacy-Fallback (siehe Schritt 3).

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
node .claude/kit/board.mjs issue-review roles --stufe issue --author <modell>
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
- Wo im Issue (Abschnitt, zitierter Satz)
- Ein konkreter Formulierungsvorschlag — keine allgemeine Kritik

Wenn du nichts findest: schreibe das ausdrücklich hin, nicht "alles gut".

--- ISSUE ---
{{ISSUE_BODY}}
```

**Fällt der Reviewer aus** — vor dem Start oder während der Ausführung, gleich aus welchem Grund —, läuft die Session nur noch **zur Protokollierung** weiter. Sie schreibt einen Board-Kommentar, dessen erste Zeile den Ausfall und den Grund nennt. Es entstehen **keine Befunde, keine Synthese, kein Body-Vorschlag** und **nie ein Marker**. Kein Ersatz-Reviewer.

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

Für jeden Fund: Schweregrad BLOCKER / WICHTIG / HINWEIS, die Fundstelle mit
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

Für jeden Fund: Schweregrad BLOCKER / WICHTIG / HINWEIS, die Fundstelle mit
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

Für jeden Fund: Schweregrad BLOCKER / WICHTIG / HINWEIS, die Fundstelle mit
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

Für jeden Fund: Schweregrad BLOCKER / WICHTIG / HINWEIS, die Fundstelle mit
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

`issueReview.rounds` aus der Config, **Default 1**. Bei mehr als einer Runde bekommt die zweite Runde den bereits geschärften Body, nicht den ursprünglichen. Jede Runde erzeugt einen eigenen Board-Kommentar, damit der Verlauf lesbar bleibt.

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

Lief der Review unterbesetzt oder ist ein Reviewer ausgefallen, steht das in der **ersten Zeile** des Kommentars.

### 5b. Synthese protokollieren — ein zweiter, getrennter Kommentar

Zwischen den Befunden und dem neuen Body liegt eine Arbeit, die sonst unsichtbar bleibt: Aus einer Befundliste wird ein Text. Dabei wird entschieden, welcher Fund einfließt und welcher verworfen wird — und wo eine Stufe mehrere Prüfer hat, bei Widerspruch auch, wer recht bekommt.

**Ohne Protokoll sieht ein bewusst verworfener Fund genauso aus wie ein übersehener.** Wer später Kommentar und Body nebeneinanderlegt, findet eine Differenz und kann die beiden Fälle nicht unterscheiden.

Der Kommentar ist **getrennt** vom Befunde-Kommentar aus Schritt 5. Der bleibt unverändert Verlauf (Issue #155); die Synthese ist bewertet und gehört nicht in denselben Block.

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

- Je Fund mit Schweregrad `BLOCKER` oder `WICHTIG` **eine Zeile**: Reviewer, Kurzbezeichnung, `übernommen` oder `verworfen` — und bei `verworfen` ein Satz Begründung.
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

**Nach der Zustimmung:** Body schreiben und die Marker-Zeile **der geprüften Stufe** in den Kontext-Abschnitt aufnehmen, wörtlich in einer dieser drei Formen:

```
Fachplan-Review: <reviewer[, reviewer…]> (JJJJ-MM-TT[, Nachtlauf])
Plan-Review:     <reviewer[, reviewer…]> (JJJJ-MM-TT[, Nachtlauf])
Issue-Review:    <reviewer[, reviewer…]> (JJJJ-MM-TT[, Nachtlauf])
```

Beispiel für ein Arbeitspaket, das mit seinem einen Reviewer gelaufen ist:

```
Issue-Review: codex (2026-08-06)
```

Die Namen stammen aus `gewaehlt` (Schritt 1b), in Auswahlreihenfolge, und nennen die **tatsächlich gelaufenen** Reviewer — nicht eine feste Liste aus der Config. Bei einem erneuten Review wird der Marker **derselben** Stufe ersetzt, nicht dupliziert.

**Der Anker `Issue-Review:` bleibt ausschliesslich dem Arbeitspaket vorbehalten.** An ihm hängt in `kit/night.mjs` das Gate `requiredBeforeReady`, also die Bedingung für die Freigabe zur Umsetzung. Trüge ein fachliches Dokument oder ein Plan denselben Marker, hielte der Nacht-Runner es für freigabereif und zöge es in die Implementierung. Ein Dokument einer anderen Stufe darf ihn deshalb nie tragen.

Geschrieben wird über den Adapter, nicht am Tracker vorbei:

```bash
node .claude/kit/board.mjs issue update <id> --body - <<'BODY'
...
BODY
```

Die Formulierung des Markers ist der Anker, an dem der Nacht-Runner erkennt, ob ein Issue geprüft ist. Nicht umformulieren.

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

**Schritt 6: Der Body wird nie geschrieben — auch nicht bei befundfreiem Review.** Stattdessen geht der fertig formulierte Body-Vorschlag als Board-Kommentar ans Issue, als übernehmbarer Text und nicht als Beschreibung dessen, was zu ändern wäre. Beim Groomen liest man ihn von dort (`issue get` liefert `comments`).

**Diese Marker-Regel gilt nur für die Stufe `issue`, nicht für `fachlich` und nicht für `plan`.** Der Grund ist der Ort: Der Marker wird *in den Body* geschrieben. In einer fachlichen Anforderung stehen die Antworten des Product Owners, in einem Plandokument die architektonischen Entscheidungen — beides hat ein Mensch getroffen. Für die Stufen `fachlich` und `plan` gilt deshalb in **jedem unbeaufsichtigten Lauf** — nicht nur nachts —: `issue update` wird nie ausgeführt, und auch bei befundfreiem Review wird kein Marker gesetzt. Befunde, Synthese und der vollständig formulierte Body-Vorschlag gehen ausschließlich als Kommentare ans Board.

**Der Marker wird gesetzt, wenn nichts zu ändern ist.** Genauer, beide Bedingungen zusammen:

1. Kein Fund trägt den Schweregrad `BLOCKER` oder `WICHTIG`. Ein einziger reicht, und der Marker bleibt aus.
2. Kein Reviewer ist ausgefallen, und der Lauf war nicht unterbesetzt.

Trifft eines davon nicht zu, bleibt der Marker aus und das Issue wartet auf den Menschen.

**Der Synthese-Kommentar aus Schritt 5b entsteht nachts genauso** — zusätzlich zum Body-Vorschlag. Dort ist er **wichtiger als interaktiv**, weil niemand zugesehen hat: Wer beim Groomen den Vorschlagstext übernimmt, übernimmt sonst eine fremde Abwägung, ohne sie zu sehen.

**Daraus folgt eine Schärfung der Marker-Regel:** Wird der Marker gesetzt, obwohl ein Fund verworfen wurde, **muss die Synthese das benennen**. Sonst behauptet der Marker eine Befundfreiheit, die es nicht gab — ein `HINWEIS`, den die Nacht verworfen hat, ist kein Grund, den Marker zurückzuhalten, aber er darf nicht unsichtbar bleiben.

Der Grund für diese Aufteilung: **Die Verantwortungsschwelle liegt beim Ändern der Anforderung, nicht beim Feststellen, dass nichts zu ändern ist.** Ein Issue, an dem zwei fremde Modelle nichts Gewichtiges finden, hat den Review bestanden; den Marker dafür zu setzen ist eine Protokollhandlung, keine Produktentscheidung. Das GO bleibt unangetastet — nach Ready zieht weiterhin nur der Mensch.

**Marker-Form nachts** — wörtlich so, damit ablesbar bleibt, dass niemand zugestimmt hat:

```
Issue-Review: codex (2026-08-06, Nachtlauf)
```

Der Zusatz steht innerhalb der Klammer; der Anker `Issue-Review:` bleibt unverändert.

Unverändert nachts: kein Ziehen nach Ready, kein Review von `[Idee]`-Issues, Befunde gehen unverändert als Kommentar ans Board. `[Fachlich]` und `[Plan]` schlägt der Runner bis Issue #283 ohnehin nicht vor.

## Abschluss

Zusammenfassung über alle bearbeiteten Issues:

```
### Issue-Review

- #205 → 3 Funde (1 BLOCKER), 2 übernommen / 1 verworfen, Body übernommen, Marker gesetzt
- #207 → keine Funde, Marker gesetzt
- #210 → 2 Funde, 0 übernommen / 2 verworfen, Vorschlag abgelehnt, kein Marker
- #212 → übersprungen ([Idee]-Präfix)
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
- **Nachts kein Schreiben in den Issue-Body** — nur Kommentar und, bei befundfreiem Review, der Marker
- Kein Marker ohne übernommenen Body (interaktiv) bzw. ohne befundfreien Review (nachts)
- **Kein Marker ohne Synthese-Kommentar, wenn Funde verworfen wurden** — sonst behauptet er eine Befundfreiheit, die es nicht gab
- **Kein Befund, keine Synthese, kein Body-Vorschlag und nie ein Marker, wenn auf der Stufe `issue` der eine Reviewer ausfällt** — dort ist ein Ausfall kein unterbesetzter Lauf, sondern gar keine Prüfung. Die Session protokolliert und endet
- **Kein Schreiben in ein Plandokument in einem unbeaufsichtigten Lauf** — bei Stufe `plan` weder `issue update` noch ein Marker. Auch der Plan trägt architektonische Entscheidungen, die ein Mensch getroffen hat
- **Kein Schreiben in eine fachliche Anforderung in einem unbeaufsichtigten Lauf** — bei Stufe `fachlich` weder `issue update` noch ein Marker, auch nicht bei befundfreiem Review. Dort stehen die Antworten des Product Owners
- Kein Ziehen nach Ready — das ist das menschliche GO
- Kein Review von `[Idee]`-Issues — `[Fachlich]` und `[Plan]` bestimmen dagegen die Stufe (Schritt 1b)
- Kein Start, wenn Reviewer fehlen und der Mensch nicht gefragt wurde
