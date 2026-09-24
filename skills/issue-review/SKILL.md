---
name: issue-review
description: Lässt Fachplan und Plan von fremden Modellen lesen, bevor daraus etwas entsteht; Arbeitspakete auf Aufruf. Nutze diesen Skill wenn der Nutzer /issue-review aufruft oder ein Dokument vor dem nächsten Schritt schärfen will.
user-invocable: true
---

# Issue Review
Werkzeug neben dem Prozess. Ein Dokument wird von Modellen gelesen, die es nicht geschrieben haben und seine Entstehungsgeschichte nicht kennen: Sie lesen, was dasteht, und stolpern dort, wo später der Plan oder die Implementierung stolpert. Den Bestand dürfen sie dabei lesen. Befunde sind Zuarbeit an den Autor der Stufe, kein Gate: Die Session, die den Skill aufgerufen hat, arbeitet sie ein oder lehnt sie mit einem Satz ab. Ob eine Stufe fertig ist, sagt ein Kommando oder ein Mensch, nie ein Modell-Marker.

Vorbedingung: `.claude/workflow.config.json` trägt den Block `issueReview` mit `reviewers` (optional `pairs`) und den Block `reviewStufen` mit Rollen und Reviewer-Zahl je Stufe. Fehlt einer, sag das und beende — ohne Reviewer gibt es nichts zu tun.

## Aufruf
```
/issue-review #N [#M …]     # genau diese Dokumente, unabhängig von Spalte und Marker
/issue-review                # alle [Fachlich]- und [Plan]-Dokumente in Backlog ohne Marker ihrer Stufe
/issue-review --dry-run      # nur Vorflug, nichts starten
```

Arbeitspakete — mit und ohne `[Task]` — werden nur mit expliziter Nummer geprüft; der Regelfall ist Ready ohne Paket-Review. `[Idee]` wird immer übersprungen und in der Zusammenfassung genannt.

## Ablauf
### 0. Vorflug
`node .claude/kit/board.mjs issue-review check` meldet je Reviewer, ob er laufen kann. Fehlt einer, frage den Menschen, bevor etwas startet. **Unbeaufsichtigt** (gesetztes `KIT_AGENT_MODEL`) wird nicht gefragt: Der Lauf fährt mit den verfügbaren Reviewern, und Zeile 2 des Befunde-Kommentars nennt den Ausfall. Bei `--dry-run` endet der Skill hier und listet Dokumente und Reviewer je Dokument.

### 1b. Stufe bestimmen
| Präfix | Stufe | Dokument |
|---|---|---|
| `[Fachlich]` | `fachlich` | fachliche Anforderung aus `/fachplan` |
| `[Plan]` | `plan` | Plandokument aus `/techplan` |
| kein Präfix | `issue` | Arbeitspaket aus `/issues` |
| `[Task]` | `issue` | Arbeitspaket aus `/task` (Bahn 3) |
| `[Idee]` | — | ausgeschlossen |

Die Erkennung ist die von `stufeAusTitel` in `kit/board.mjs`: Groß- und Kleinschreibung egal, führender Leerraum erlaubt, ein Präfix mitten im Titel zählt nicht.

### 2. Form vor Inhalt
```bash
node .claude/kit/board.mjs issue check-form <id>
```

Verstöße — Reihenfolge der Abschnitte, fehlende Kennzeichnungszeile, Herkunftszeile am falschen Ort — behebt die aufrufende Session selbst im Body, bevor ein Reviewer startet, mit `issue update` nach der Transportregel unten. Ein Reviewer prüft keine Form.

### 3. Reviewer wählen
Lies `Autor-Modell:` (Arbeitspaket: `## Kontext`; fachliche Anforderung: `## Ziel`) bzw. `Plan-Modell:` im Kopf des Plandokuments. Fehlt der Wert oder lautet er `unbekannt`, frage einmal nach und schlage einen Reviewer vor; unbeaufsichtigt gilt der Regelvorschlag, und der Befunde-Kommentar vermerkt das.
```bash
node .claude/kit/board.mjs issue-review roles --stufe <fachlich|plan|issue> --author <modell>
```

`gewaehlt[i]` wird mit `rollen[i]` gepaart; gestartet wird ausschließlich, was in `gewaehlt` steht. `unterbesetzt: true` läuft trotzdem und steht in Zeile 2 des Kommentars; `quelle` (`pairs` | `regel`) und ein `autorAufgeloest: false` gehören ebenfalls dorthin.

### 4. Reviewer starten
Jeder Reviewer bekommt denselben unveränderten Body und seine Rolle: `kind: claude` als Subagent mit dem konfigurierten Modell, `kind: command` als CLI mit dem Prompt über stdin. Jede Rolle trägt die Streich-Frage — Ergänzen ist leichter als Streichen, und ein Dokument, das nach dem Review doppelt so lang ist, ist nicht besser.

**Die Artenliste wird nicht abgeschrieben.** Vor dem Start füllt die Session `{{ARTEN}}` in jedem Prompt aus der Ausgabe von `node .claude/kit/befunde.mjs arten` — je Art eine Zeile aus Name und erklärendem Satz —, genau wie `{{ISSUE_BODY}}` und `{{QUELLE_BODY}}`. Zwei Orte für denselben Wortlaut driften auseinander, sobald eine Art hinzukommt oder ihren Namen wechselt.

**Die Form des Stands wird mitgegeben.** Wie die Artenliste gehört auch diese Regel in jeden Prompt, den die Session füllt: Die Gegenprobe-Zeile schließt am Zeilenende wörtlich mit `— geprueft, bestaetigt` oder `— nicht geprueft` (Umlaute erlaubt). Varianten wie „— geprueft, es gibt keine" oder „— geprueft, nicht haltbar" werden von der Formprüfung abgewiesen; die Begründung gehört als eigener Satz davor, nicht hinter den Strich.

Beispiel: `Gegenprobe: Ein Satz X im Body hätte den Fund widerlegt; es gibt keinen. — geprueft, bestaetigt`

Unmittelbar vor dem Start nimmt die Session ein vorhandenes Label ab: `node .claude/kit/board.mjs issue label remove <id> review:fertig`. Hängt es nicht an der Karte, ist das kein Fehler. Endet der Lauf danach vorzeitig, bleibt das Label ab — der Marker im Body sagt weiter, was geprüft wurde; die Zusammenfassung nennt das Label als abgenommen und nicht wieder gesetzt.

**Rolle `pruefbarkeit`** (Stufe `issue`):
```
Du prüfst ein Arbeitspaket, das gleich implementiert werden soll. Du kennst die Entstehungsgeschichte nicht — das ist gewollt: Genau diese Lücke sollst du finden. Den Bestand darfst du lesen.
1. Ist jedes Akzeptanzkriterium maschinell prüfbar (Kommando, Dateizustand, Testergebnis)? Was ein menschliches Urteil braucht, gehört in den Block "### Manuelle Pruefung (Mensch, nicht Teil des Session-Abschlusses)".
2. Ist "fertig" eindeutig, oder bleibt Interpretationsspielraum?
3. Fehlen Randfälle, Fehlerpfade, Rückwärtskompatibilität?
4. Was kann RAUS? Welcher Satz, welches Kriterium trägt nichts?
Für jeden Fund ein Block mit diesen Angaben:
- Schweregrad BLOCKER / WICHTIG / HINWEIS als fette Kopfzeile
- Ort (Abschnitt, zitierter Satz) und ein konkreter Formulierungsvorschlag
- Gegenprobe: <Beobachtung, die den Fund widerlegen würde> — geprüft, bestätigt (hast du sie nicht angestellt: — nicht geprüft)
- Art: <name> aus dieser Liste, nur der Name:
{{ARTEN}}
Einen Fund, den deine eigene Gegenprobe widerlegt hat, meldest du nicht.
Wenn du nichts findest, schreibe das ausdrücklich hin.
--- ISSUE ---
{{ISSUE_BODY}}
```

**Rolle `form-beobachtbarkeit`** (Stufe `fachlich`, erster Reviewer):
```
Du prüfst eine fachliche Anforderung, aus der gleich ein technischer Plan entstehen soll. Du kennst das Gespräch mit dem Product Owner nicht — das ist gewollt. Maßstab ist das Story-Format: Ziel, Fachliche Akzeptanzkriterien, Nicht-Ziele, Offene Fragen an den PO.
1. Trägt jeder Abschnitt Inhalt statt Platzhalter? Eine fertig gegroomte Anforderung ohne offene Fragen ist in Ordnung.
2. Ist jedes Akzeptanzkriterium AUS NUTZERSICHT BEOBACHTBAR? Woran merkt ein Mensch, der die Software benutzt, dass es erfüllt ist?
3. Steht Technik drin, wo keine hingehört — Dateien, Architektur, Implementierungsdetails?
4. Ist das Ziel als Nutzerwirkung formuliert, oder beschreibt es eine Lösung?
5. Was kann RAUS? Welcher Satz, welches Kriterium trägt nichts?
Für jeden Fund ein Block mit diesen Angaben:
- Schweregrad BLOCKER / WICHTIG / HINWEIS als fette Kopfzeile
- Fundstelle mit Zitat und ein konkreter Formulierungsvorschlag
- Gegenprobe: <Beobachtung, die den Fund widerlegen würde> — geprüft, bestätigt (hast du sie nicht angestellt: — nicht geprüft)
- Art: <name> aus dieser Liste, nur der Name:
{{ARTEN}}
Einen Fund, den deine eigene Gegenprobe widerlegt hat, meldest du nicht.
Wenn du nichts findest, schreibe das ausdrücklich hin.
--- ANFORDERUNG ---
{{ISSUE_BODY}}
```

**Rolle `abgrenzung`** (Stufe `fachlich`, zweiter Reviewer):
```
Du prüfst eine fachliche Anforderung, aus der gleich ein technischer Plan entstehen soll. Du kennst die Entstehungsgeschichte nicht — das ist gewollt.
1. Widersprechen sich Ziele und Nicht-Ziele? Verlangt ein Kriterium etwas, das ein Nicht-Ziel ausschließt?
2. Fehlt eine Scope-Grenze? Was könnte jemand hineinlesen, das nicht gemeint ist?
3. Ist eine offene Frage durch Ziel, Kriterium, Nicht-Ziel oder eine im Body dokumentierte PO-Antwort bereits entschieden? Unterstelle keine Entscheidungen, die nicht im Body stehen.
4. Fehlt eine Frage, die vor dem Plan beantwortet sein muss? Wo müsste ein Planer raten?
5. Was kann RAUS? Welcher Teil gehört nicht in diese Anforderung?
Für jeden Fund ein Block mit diesen Angaben:
- Schweregrad BLOCKER / WICHTIG / HINWEIS als fette Kopfzeile
- Fundstelle mit Zitat und ein konkreter Formulierungsvorschlag
- Gegenprobe: <Beobachtung, die den Fund widerlegen würde> — geprüft, bestätigt (hast du sie nicht angestellt: — nicht geprüft)
- Art: <name> aus dieser Liste, nur der Name:
{{ARTEN}}
Einen Fund, den deine eigene Gegenprobe widerlegt hat, meldest du nicht.
Wenn du nichts findest, schreibe das ausdrücklich hin.
--- ANFORDERUNG ---
{{ISSUE_BODY}}
```

**Rolle `architektur-bestand`** (Stufe `plan`, erster Reviewer — der Senior, der den Bestand kennt):
```
Du prüfst einen technischen Plan, aus dem gleich Arbeitspakete entstehen. Du kennst das Gespräch nicht, aus dem er stammt. Den Bestand darfst und sollst du lesen: Schlag im Repository nach.
1. Stimmt jede Behauptung über den Bestand? Existieren die genannten Dateien, Funktionen, Kommandos und Konfigurationsfelder, und heißen sie so?
2. Trägt jede Entscheidung unter "Architektonische Entscheidungen" eine Begründung, die man angreifen kann?
3. Widerspricht eine Entscheidung einer erkennbaren Konvention des Projekts?
4. Was bricht, das der Plan nicht nennt — welches Verhalten, welcher Test, welche Kopie?
5. Was fehlt im Zuschnitt, und was kann RAUS?
6. Stellt der Plan her, was die fachliche Quelle verlangt — jedes Ziel, jedes Akzeptanzkriterium, jede beantwortete Frage, und bei verbindlicher Vorlage deren Aussehen? Die Vorlage liegt unter {{VORLAGE_PFAD}}; lies sie.
Für jeden Fund ein Block mit diesen Angaben:
- Schweregrad BLOCKER / WICHTIG / HINWEIS als fette Kopfzeile
- Fundstelle mit Zitat und ein konkreter Formulierungsvorschlag; bei Behauptungen über den Bestand die Datei und Stelle, an der du nachgesehen hast
- Gegenprobe: <Beobachtung, die den Fund widerlegen würde> — geprüft, bestätigt (hast du sie nicht angestellt: — nicht geprüft)
- Art: <name> aus dieser Liste, nur der Name:
{{ARTEN}}
Einen Fund, den deine eigene Gegenprobe widerlegt hat, meldest du nicht.
Wenn du nichts findest, schreibe das ausdrücklich hin.
--- PLAN ---
{{ISSUE_BODY}}
--- FACHLICHE QUELLE ---
{{QUELLE_BODY}}
```

**Die fachliche Quelle im Plan-Review.** Trägt der Plan `Fachliche Quelle: Issue #N`, holt die Session den Body dieser Karte mit `node .claude/kit/board.mjs issue get <N>` — wie den Plan selbst, nie aus dem Gesprächsverlauf — und setzt ihn für `{{QUELLE_BODY}}` ein; `{{VORLAGE_PFAD}}` ist der Pfad aus einer `Vorlage:`-Zeile im Plan oder in der Quelle. Fehlt die Quelle, entfallen der Abschnitt `--- FACHLICHE QUELLE ---` und Frage 6 ohne Vermerk; fehlt eine Vorlage, entfällt nur der Satz zur Vorlage. Ohne diesen Eingang prüft der Reviewer, ob der Plan zum Code passt, aber nicht, ob er das Ziel herstellt, für das er entstand.

**Rolle `schnitt-abhaengigkeiten`** (Stufe `plan`, zweiter Reviewer — nur, wenn `reviewStufen.plan.reviewer` zwei vorsieht): derselbe Prompt wie `architektur-bestand`, aber mit den Fragen: Lässt sich der Plan in einzeln abschließbare Pakete zerlegen? Welche Reihenfolge erzwingt er, und steht sie im Plan? Ist ein Teil zu groß für einen Plan? Sagt „Verifizierung", WIE geprüft wird?

### 5. Befunde ans Board
Ein Kommentar je Lauf. Erste Zeile wörtlich `## <Stufe>-Review, Runde 1` mit `Issue`, `Fachplan` oder `Plan`; Zeile 2 nennt Ausfall, Unterbesetzung oder den Regelvorschlag beim Autor-Modell, sonst bleibt sie leer; darunter je Reviewer Rolle, Modell und seine Funde. Datei `<tmpdir>/<id>-befunde.md`, dann die Form der Funde prüfen:
```bash
node .claude/kit/befunde.mjs pruefen --datei <tmpdir>/<id>-befunde.md
```

Meldet das Kommando fehlende Angaben, fordert die Session sie beim liefernden Reviewer genau **einmal** nach und schreibt die Datei neu. Bleibt eine Angabe danach aus, trägt der betroffene Fundblock die Zeile `Angaben: unvollstaendig`. **Kein Gate:** Weder eine fehlende Angabe noch eine ausgebliebene Nachlieferung hält den Lauf auf; scheitert das Kommando selbst, steht das als eine Zeile in Zeile 2 des Kommentars. Der Kommentar geht in jedem dieser Fälle ans Board:
```bash
node .claude/kit/board.mjs issue comment <id> --text-file <tmpdir>/<id>-befunde.md
```

Kommt dieser Kommentar nicht an, endet der Skill ohne weitere Mutation.

### 6. Einarbeiten
Die aufrufende Session geht jeden Fund durch und entscheidet nach `CLAUDE-workflow.md`, Abschnitt „Entscheiden statt fragen": übernehmen oder mit einem Satz ablehnen. Trifft ein Fund die Stopp-Klasse, wird interaktiv gefragt; unbeaufsichtigt zeichnet die Session das Dokument, schreibt keinen Body und endet nach dem Einarbeitungs-Kommentar:
```bash
node .claude/kit/board.mjs issue label add <id> kit:klaeren
```

Interaktiv zeigt sie die Liste (übernommen / abgelehnt mit Grund) und wartet auf ein Wort, bevor sie schreibt; unbeaufsichtigt schreibt sie direkt. Geschrieben wird der vollständige neue Body — vorhandene Kennzeichnungszeilen (`Autor-Modell:`, `Plan-Modell:`, `Fachliche Quelle:`, `Plan:`) bleiben erhalten — über `<tmpdir>/<id>-body.md`:
```bash
node .claude/kit/board.mjs issue update <id> --body-file <tmpdir>/<id>-body.md
```

Dazu die Marker-Zeile als Spur am Ort der Stufe: beim Arbeitspaket in `## Kontext`, bei der fachlichen Anforderung in `## Ziel` neben `Autor-Modell:`, beim Plandokument im Kopf neben `Plan-Modell:`. Unbeaufsichtigt steht `, Nachtlauf` in der Klammer:
```
Issue-Review: codex (2026-09-13)
Plan-Review: fable (2026-09-13, Nachtlauf)
```

Kein Fund ist auch ein Ergebnis: Marker schreiben, Kommentar mit „keine Funde". Danach der zweite Kommentar mit der ersten Zeile `## Einarbeitung, Runde 1` und der Liste übernommen / abgelehnt mit Grund je Fund, über `<tmpdir>/<id>-einarbeitung.md`:
```bash
node .claude/kit/board.mjs issue comment <id> --text-file <tmpdir>/<id>-einarbeitung.md
```

Dann die Buchung: Je Fundblock ergänzt die Session im Befunde-Text die Zeile `Uebernahme: uebernommen` beziehungsweise `Uebernahme: abgelehnt` — dieselbe Entscheidung, die der Kommentar in Prosa trägt —, schreibt den Text nach der Transportregel als `<tmpdir>/<id>-buchung.md` und bucht ihn mit der Stufe des Laufs aus Schritt 1b; für **jede** Art, die `buchen` unter `arten` als `erreicht` meldet, folgt ein Vorschlag. **Kein Gate:** Ein Fehlschlag von `buchen` oder `vorschlag` steht in **einer Zeile** und hält weder Lauf noch Label auf — das Protokoll ist Buchhaltung, keine Bedingung. Wird der Lauf mit `kit:klaeren` geparkt, **wird nicht gebucht**: Dort hat niemand über die Funde entschieden, und ein Fund ohne Übernahmevermerk gehört nicht ins Protokoll.
```bash
node .claude/kit/befunde.mjs buchen --datei <tmpdir>/<id>-buchung.md --stufe <fachlich|plan|issue> --karte <id>
node .claude/kit/befunde.mjs vorschlag --art <a>
```

Danach das Label als sichtbare Spur am Board: `node .claude/kit/board.mjs issue label add <id> review:fertig`. Es ist eine Spur, keine Freigabe, und meint den Stand des Marker-Datums. Trifft ein Fund die Stopp-Klasse und wird `kit:klaeren` gesetzt, entfaellt `review:fertig`. Ist das Label am Board nicht definiert, meldet der Skill die Fehlermeldung des Adapters und läuft weiter; Body, Marker und Kommentare stehen dann trotzdem, und die Zusammenfassung nennt das fehlende Label. Die Nacht-Kette verlangt dieses Label als Voraussetzung, bevor sie eine fachliche Anforderung oder ein Plandokument aufnimmt; die Spur bleibt trotzdem nur Spur, keine Freigabe. Wird eine Anforderung nach der Pruefung wesentlich geaendert, das Label abnehmen oder neu pruefen lassen — der naechtliche Lauf erkennt eine nachtraegliche Aenderung nicht.

### 7. Abschluss
Zusammenfassung je Dokument: Stufe, Zahl der Funde, übernommen / abgelehnt, Zahl der **gebuchten** Funde und die dabei entstandenen oder ergänzten **Vorschläge** (bei einem Fehlschlag der Buchung dessen eine Zeile), Marker und `review:fertig` gesetzt, Label abgenommen und nicht wieder gesetzt, oder `kit:klaeren`, übersprungene Dokumente mit Grund. Dann: Ready ist das GO des Menschen — der Marker gibt nichts frei.

## Lange Texte ans Board
Befunde, Body und Einarbeitung entstehen nach der Transportregel aus `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board": nie als Kommandozeilen-Argument, sondern stückweise in eine Datei außerhalb des Projektverzeichnisses (`printenv TMPDIR`, dann `cat >` und `cat >>` mit je höchstens 6.000 Zeichen), jedes Stück ein **eigener** Werkzeugaufruf mit wörtlichem Pfad, dann ein Aufruf mit `--text-file` bzw. `--body-file`. Scheitert ein Dateischritt, wird die unvollständige Datei nicht übertragen; scheitert ein Board-Aufruf, meldet der Skill den Fehler mit dem Pfad und endet ohne weitere Mutation.

## Stop-Punkte
- Kein Ziehen nach Ready — das ist das GO des Menschen. Ausnahme, ausschliesslich in der Umsetzungsstufe der Nacht-Kette unter Variante B: Dort zieht der Nacht-Runner die entstandenen Arbeitspakete selbst nach Ready. Die Ausnahme gilt dem Runner, nicht diesem Skill — keine Ready-Bewegung durch diesen Skill.
- Interaktiv kein Schreiben in den Body ohne ein Wort der Zustimmung.
- Kein Marker gibt einen Schritt frei; er ist eine Spur. Auch `review:fertig` ist Spur, keine Freigabe.
- Kein Ersatz-Reviewer aus eigenem Antrieb — die Besetzung kommt aus `roles`.
- Kein Review von `[Idee]`.
