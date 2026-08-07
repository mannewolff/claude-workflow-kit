---
name: issue-review
description: Lässt ein Issue von zwei Modellen prüfen, die es nicht geschrieben haben, bevor es nach Ready wandert. Nutze diesen Skill wenn der Nutzer /issue-review aufruft oder Issues vor dem GO schärfen will.
user-invocable: true
---

# Issue Review

Werkzeug neben dem Prozess, zwischen `/issues` (Schritt 3) und dem GO (Schritt 4). Zwei Modelle, die das Issue nicht geschrieben haben, prüfen es — und schärfen es, bevor jemand es implementiert.

**Warum das trägt:** Der Autor eines Issues hat den Kontext im Kopf, aus dem es entstanden ist. Was er nicht hingeschrieben hat, fällt ihm beim Lesen nicht auf — er ergänzt es unbewusst. Ein fremdes Modell hat nur den Text. Das ist derselbe Grund, aus dem der Code-Review in Schritt 7 funktioniert, nur eine Stufe früher und mit höherem Einsatz: Ein Fehler im Issue pflanzt sich in die ganze Umsetzung fort.

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

> `codex` ist nicht im PATH. Ich kann mit einem Reviewer weitermachen oder abbrechen. Wie möchtest du?

Der Grund für die Rückfrage: Ein Ein-Reviewer-Lauf sieht am Board aus wie ein vollständiger. Wer das nicht merkt, hält ein halb geprüftes Issue für geprüft.

**Im Nachtbetrieb wird hier nicht gefragt** (siehe unten): Der Runner hat den Vorflug vor dem Lauf gefahren und bei fehlendem Reviewer gar nicht erst gestartet.

Bei `--dry-run` endet der Skill hier. Er listet zusätzlich, welche Issues er bearbeiten würde und welche Reviewer je Issue drankämen. **Nichts wird gestartet, nichts geschrieben.**

### 1. Issues bestimmen

**Ohne Argumente:** alle Issues in Backlog, die noch keine Marker-Zeile `Issue-Review:` im Body tragen.

```bash
node .claude/kit/board.mjs issue list --status backlog
```

**Mit Argumenten:** genau die übergebenen Nummern, unabhängig von Spalte und Marker. Ein erneuter Review ist ausdrücklich erlaubt — etwa nachdem sich die Anforderung geändert hat.

**Übersprungen werden** Issues mit Titel-Präfix `[Fachlich]` oder `[Idee]`. Sie sind keine technischen Issues, und ihr Zuschnitt folgt anderen Regeln (siehe `/fachplan`). Nenne sie in der Zusammenfassung, damit niemand sie für geprüft hält.

### 2. Autor-Modell lesen und Reviewer wählen

Das Autor-Modell steht als Zeile im Kontext-Abschnitt (`Autor-Modell: …`, angelegt von `/issues`).

**Fehlt sie oder lautet sie `unbekannt`, frage einmal nach** — mit den vorgeschlagenen Reviewern:

> #205 nennt kein Autor-Modell. Vorschlag: `opus`, `sonnet`. Wer hat es geschrieben? (Modellname / weiter mit Vorschlag)

Das ist der einzige neue Stopp-Punkt und er kostet ein Wort. Ohne ihn ist bei jedem Issue, das vor der Konvention entstanden ist, die Hälfte des Reviews Selbstprüfung — und der Marker suggeriert am Ende trotzdem, es sei geprüft worden.

**Ausnahme im Nachtbetrieb:** Läuft der Skill ohne Menschen (erkennbar an gesetztem `KIT_AGENT_MODEL`), wird **nicht** gefragt. Dann gilt der Regel-Vorschlag, und der Board-Kommentar vermerkt das ausdrücklich. Dieselbe Asymmetrie wie beim Gate aus Issue #223, aus demselben Grund: Eine Session, die auf eine Antwort wartet, ist vom Runner nicht von einem Fehlschlag zu unterscheiden.

```bash
node .claude/kit/board.mjs issue-review reviewers --author <modell>
```

Meldet die Antwort `unterbesetzt: true`, läuft der Review trotzdem — aber die **erste Zeile** des Board-Kommentars sagt, mit wie vielen Reviewern gefahren wurde.

Die Antwort trägt außerdem `quelle: "pairs" | "regel"` (Issue #225). Nenne den Wert im Board-Kommentar: Wer eine `pairs`-Zeile für seinen Autor erwartet hat und `regel` liest, sieht sofort, dass der Name dort fehlt oder anders geschrieben ist.

**`quelle: "regel"` bei gesetztem Autor-Modell hat noch eine zweite Ursache:** Die Auflösung des Autors auf einen Reviewer-Kurznamen ist fehlgeschlagen. `/issues` schreibt die volle Modell-ID (`claude-opus-5`), `pairs` ist mit Kurznamen geschlüsselt (`opus`); die Übersetzung läuft über `reviewers[].model`. Steht das Modell dort nicht, greift `pairs` nicht — und der Autor kann unter den Reviewern landen, also sein eigenes Issue prüfen. Das Feld **`autorAufgeloest: false`** in derselben Antwort zeigt genau diesen Fall an. Es ist erlaubt (älteres Issue ohne Autor-Zeile, ein Mensch als Autor), gehört bei gesetztem Autor-Modell aber in den Board-Kommentar — dann fehlt in der Config ein `model`-Eintrag.

Wer wissen will, wer wen prüft, muss dafür nicht die Config lesen:

```bash
node .claude/kit/board.mjs issue-review matrix
```

### 3. Reviewer starten — zwei Rollen, nicht zweimal dasselbe

Beide Reviewer bekommen denselben Issue-Body, aber **verschiedene Rollen**. Zwei Modelle mit identischem Prompt finden großenteils dasselbe; der Gewinn liegt im Blickwinkel, nicht in der Anzahl.

**Rolle A — Vollständigkeit und Prüfbarkeit** (erster Reviewer):

```
Du prüfst ein Issue, das gleich implementiert werden soll. Du hast keinen Kontext
über seine Entstehung — das ist gewollt, du hast nur den Text.

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

**Rolle B — Scope, Risiko und Bestand** (zweiter Reviewer):

```
Du prüfst ein Issue, das gleich implementiert werden soll. Du hast keinen Kontext
über seine Entstehung — das ist gewollt, du hast nur den Text.

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

**Die Streich-Frage ist Pflicht in beiden Rollen.** Reviewer schlagen von sich aus Ergänzungen vor, weil Ergänzen leichter ist als Streichen. Ein Issue, das nach drei Modellen doppelt so lang ist, ist nicht automatisch besser implementierbar — ohne diese Frage kippt der Roundtrip in Aufblähung.

**Ausführung je nach `kind`:**

- **`kind: "claude"`** — Subagent über das Agent-Tool, mit dem konfigurierten `model`. Frische Session ohne Kontext dieser Sitzung, wie in `/review`.
- **`kind: "command"`** — das konfigurierte Kommando starten und den Prompt **über stdin** übergeben, die Antwort von stdout lesen:

  ```bash
  <command> < prompt.txt
  ```

  Nicht als Argument. Ein Issue-Body mit Backticks, Anführungszeichen und Zeilenumbrüchen durch eine Kommandozeile zu quoten ist genau der Fehler, den Issue #196 aus `board.mjs` entfernt hat. Die Kommandozeile ist frei konfiguriert und läuft deshalb über die Plattform-Shell — dieselbe Abgrenzung wie bei `buildChecks` in `night.mjs` (Issue #199).

  Schlägt das Kommando fehl (Exit ungleich 0), gilt der Reviewer als ausgefallen. Das ist ein Fund für den Bericht, kein Abbruch: Die Befunde des anderen Reviewers bleiben wertvoll.

### 4. Runden

`issueReview.rounds` aus der Config, **Default 1**. Bei mehr als einer Runde bekommt die zweite Runde den bereits geschärften Body, nicht den ursprünglichen. Jede Runde erzeugt einen eigenen Board-Kommentar, damit der Verlauf lesbar bleibt.

Mehr als eine Runde findet erfahrungsgemäß vor allem Geschmacksfragen. Wenn die zweite Runde nichts mit Schweregrad BLOCKER oder WICHTIG mehr liefert, sag das — es ist die Information, ob sich weitere Runden lohnen.

### 5. Befunde dokumentieren

Die Reviewer-Ausgaben gehen **unverändert** als Board-Kommentar ans Issue. Sie sind Verlauf, nicht verhandelter Stand (Regel aus Issue #155):

```bash
node .claude/kit/board.mjs issue comment <id> --text "## Issue-Review, Runde 1

Reviewer: opus (Vollständigkeit), codex (Scope)

### opus — Vollständigkeit und Prüfbarkeit
<Befunde>

### codex — Scope, Risiko und Bestand
<Befunde>"
```

Lief der Review unterbesetzt oder ist ein Reviewer ausgefallen, steht das in der **ersten Zeile** des Kommentars.

### 5b. Synthese protokollieren — ein zweiter, getrennter Kommentar

Zwischen den Befunden und dem neuen Body liegt eine Arbeit, die sonst unsichtbar bleibt: Aus zwei Listen wird ein Text. Dabei wird entschieden, welcher Fund einfließt, welcher verworfen wird, und bei Widerspruch, wer recht bekommt.

**Ohne Protokoll sieht ein bewusst verworfener Fund genauso aus wie ein übersehener.** Wer später Kommentar und Body nebeneinanderlegt, findet eine Differenz und kann die beiden Fälle nicht unterscheiden.

Der Kommentar ist **getrennt** vom Befunde-Kommentar aus Schritt 5. Der bleibt unverändert Verlauf (Issue #155); die Synthese ist bewertet und gehört nicht in denselben Block.

```bash
node .claude/kit/board.mjs issue comment <id> --text "## Synthese, Runde 1

### Entscheidungen
- opus, \"Akzeptanzkriterium nicht maschinell prüfbar\" (BLOCKER) — übernommen
- codex, \"Abhängigkeit fehlt\" (WICHTIG) — verworfen: Issue #7 steht bereits im
  Abhängigkeiten-Abschnitt, der Reviewer sah ihn nicht (Kontextlosigkeit).
- codex, \"Cookie-Schreiben ist Kandidat für RAUS\" (WICHTIG) — verworfen:
  Issue #10 spezifiziert es vollständig und ist als Abhängigkeit genannt.

### Dissens
- opus wollte die Codeprüfung durch einen Test ersetzen, codex umgekehrt den
  Test-Zweig streichen (das Projekt hat keine Testbasis). Entschieden für opus.
  Folgeänderung: Issue #7 als Abhängigkeit ergänzt.

Übernommen: 1 · Verworfen: 2"
```

**Was hineingehört:**

- Je Fund mit Schweregrad `BLOCKER` oder `WICHTIG` **eine Zeile**: Reviewer, Kurzbezeichnung, `übernommen` oder `verworfen` — und bei `verworfen` ein Satz Begründung.
- `HINWEIS`-Funde nur, wenn sie **verworfen** wurden. Sonst wird die Liste länger als ihr Nutzen.
- **Ein verworfener `BLOCKER` braucht immer eine Begründung.** Das ist die Kategorie, bei der stilles Verwerfen am teuersten ist.
- Widersprechen sich die Reviewer, steht das als eigener Punkt: welche beiden Vorschläge kollidierten, welcher gewonnen hat, warum, und welche Folgeänderungen daraus entstanden sind.

**Ein Muster, das man kennen sollte:** Die Kontextlosigkeit, die den Review überhaupt trägt, produziert an Abhängigkeitsgrenzen zuverlässig Fehlalarme — ein Reviewer sieht das Nachbar-Issue nicht und meldet als fehlend, was dort steht. Solche Funde zu verwerfen ist richtig. Es bleibt eine Entscheidung und gehört protokolliert.

### 6. Body schärfen — nur mit Freigabe

**Der Body wird nie automatisch geschrieben.** Zeige einen Vorschlag mit den eingearbeiteten Funden und frage einmal:

> Zwei Reviewer, 3 Funde (1 BLOCKER, 2 HINWEIS). Vorschlag für den neuen Body:
> …
> Übernehmen? (ja / nein / einzelne Funde nennen)

Kein Konsens-Automatismus: Zwei Modelle können sich einig und trotzdem falsch sein. Übereinstimmung ist kein Wahrheitskriterium, und wer über die Anforderung entscheidet, entscheidet über das Produkt — das ist keine Modellfrage.

**Nach der Zustimmung:** Body schreiben und eine Marker-Zeile in den Kontext-Abschnitt aufnehmen, wörtlich in dieser Form:

```
Issue-Review: opus, codex (2026-08-06)
```

Geschrieben wird über den Adapter, nicht am Tracker vorbei:

```bash
node .claude/kit/board.mjs issue update <id> --body "..."
```

Die Formulierung des Markers ist der Anker, an dem der Nacht-Runner erkennt, ob ein Issue geprüft ist. Nicht umformulieren.

**Bei Ablehnung:** Body bleibt unverändert und **kein Marker** wird gesetzt. Ein Review, dessen Ergebnis verworfen wurde, hat das Issue nicht geschärft.

## Im Nachtbetrieb

Erkennungsmerkmal ist **gesetztes `KIT_AGENT_MODEL`** — dieselbe Bedingung wie bei der Autor-Modell-Ausnahme oben, und ausdrücklich kein zweites Signal. Der Nacht-Runner startet diesen Skill über `night.mjs --review` mit `/issue-review #N`.

Drei Abweichungen, sonst gilt alles unverändert:

**Vorflug (Schritt 0): nicht fragen.** Der Runner hat vor dem Lauf geprüft und bei fehlendem Reviewer gar nicht gestartet. Eine Session, die auf eine Antwort wartet, ist vom Runner nicht von einem Fehlschlag zu unterscheiden.

**Schritt 6: Der Body wird nie geschrieben — auch nicht bei befundfreiem Review.** Stattdessen geht der fertig formulierte Body-Vorschlag als Board-Kommentar ans Issue, als übernehmbarer Text und nicht als Beschreibung dessen, was zu ändern wäre. Beim Groomen liest man ihn von dort (`issue get` liefert `comments`).

**Der Marker wird gesetzt, wenn nichts zu ändern ist.** Genauer, beide Bedingungen zusammen:

1. Kein Fund trägt den Schweregrad `BLOCKER` oder `WICHTIG`. Ein einziger reicht, und der Marker bleibt aus.
2. Kein Reviewer ist ausgefallen, und der Lauf war nicht unterbesetzt.

Trifft eines davon nicht zu, bleibt der Marker aus und das Issue wartet auf den Menschen.

**Der Synthese-Kommentar aus Schritt 5b entsteht nachts genauso** — zusätzlich zum Body-Vorschlag. Dort ist er **wichtiger als interaktiv**, weil niemand zugesehen hat: Wer beim Groomen den Vorschlagstext übernimmt, übernimmt sonst eine fremde Abwägung, ohne sie zu sehen.

**Daraus folgt eine Schärfung der Marker-Regel:** Wird der Marker gesetzt, obwohl ein Fund verworfen wurde, **muss die Synthese das benennen**. Sonst behauptet der Marker eine Befundfreiheit, die es nicht gab — ein `HINWEIS`, den die Nacht verworfen hat, ist kein Grund, den Marker zurückzuhalten, aber er darf nicht unsichtbar bleiben.

Der Grund für diese Aufteilung: **Die Verantwortungsschwelle liegt beim Ändern der Anforderung, nicht beim Feststellen, dass nichts zu ändern ist.** Ein Issue, an dem zwei fremde Modelle nichts Gewichtiges finden, hat den Review bestanden; den Marker dafür zu setzen ist eine Protokollhandlung, keine Produktentscheidung. Das GO bleibt unangetastet — nach Ready zieht weiterhin nur der Mensch.

**Marker-Form nachts** — wörtlich so, damit ablesbar bleibt, dass niemand zugestimmt hat:

```
Issue-Review: opus, codex (2026-08-06, Nachtlauf)
```

Der Zusatz steht innerhalb der Klammer; der Anker `Issue-Review:` bleibt unverändert.

Unverändert nachts: kein Ziehen nach Ready, kein Review von `[Fachlich]`- und `[Idee]`-Issues, Befunde gehen unverändert als Kommentar ans Board.

## Abschluss

Zusammenfassung über alle bearbeiteten Issues:

```
### Issue-Review

- #205 → 3 Funde (1 BLOCKER), 2 übernommen / 1 verworfen, Body übernommen, Marker gesetzt
- #207 → keine Funde, Marker gesetzt
- #210 → 2 Funde, 0 übernommen / 2 verworfen, Vorschlag abgelehnt, kein Marker
- #212 → übersprungen ([Idee]-Präfix)
```

**Die Zählung übernommen/verworfen gehört dazu.** „3 Funde, Body übernommen" liest sich gleich, egal ob alle drei eingeflossen sind oder keiner — und genau dieser Unterschied entscheidet, wie viel der Review wert war.

Dann der Hinweis auf den nächsten Schritt:

> „Geprüfte Issues können nach Ready — das ist dein GO (Schritt 4)."

## Stop-Punkte

- Kein Schreiben in den Issue-Body ohne ausdrückliche Zustimmung
- **Nachts kein Schreiben in den Issue-Body** — nur Kommentar und, bei befundfreiem Review, der Marker
- Kein Marker ohne übernommenen Body (interaktiv) bzw. ohne befundfreien Review (nachts)
- **Kein Marker ohne Synthese-Kommentar, wenn Funde verworfen wurden** — sonst behauptet er eine Befundfreiheit, die es nicht gab
- Kein Ziehen nach Ready — das ist das menschliche GO
- Kein Review von `[Fachlich]`- und `[Idee]`-Issues
- Kein Start, wenn Reviewer fehlen und der Mensch nicht gefragt wurde
