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

Die Prüferzahl der Stufe `plan` kann ein Lauf über `KIT_PLAN_REVIEWER` setzen; die Session übernimmt die Ausgabe des Kommandos und zählt nicht selbst. `gewaehlt[i]` wird mit `rollen[i]` gepaart; gestartet wird ausschließlich, was in `gewaehlt` steht. `unterbesetzt: true` läuft trotzdem und steht in Zeile 2 des Kommentars; `quelle` (`pairs` | `regel`) und ein `autorAufgeloest: false` gehören ebenfalls dorthin.

### 4. Reviewer starten
Unmittelbar vor dem Start nimmt die Session ein vorhandenes Label ab: `node .claude/kit/board.mjs issue label remove <id> review:fertig`. Hängt es nicht an der Karte, ist das kein Fehler. Endet der Lauf danach vorzeitig, bleibt das Label ab — der Marker im Body sagt weiter, was geprüft wurde; die Zusammenfassung nennt das Label als abgenommen und nicht wieder gesetzt.

Jeder Reviewer `<n>` aus `gewaehlt` bekommt seinen Prüfauftrag als Datei. Das Kit montiert ihn aus der Rolle unter `kit/rollen/<rolle>.md`, der Artenliste und dem unveränderten Body, beim Plan samt `Fachliche Quelle:` und `Vorlage:`; die Session schreibt keinen Rollentext ab und füllt nichts selbst ein:
```bash
node .claude/kit/board.mjs issue-review pruefauftrag --rolle <rolle> --id <id> --datei <tmpdir>/<id>-auftrag-<n>.md
```

Bei `kind: claude` startet die Session das Agent-Tool mit `subagent_type: kit-pruefer` und dem Modell aus `reviewers[].model`; der Auftrag lautet nur `Lies <tmpdir>/<id>-auftrag-<n>.md`, mit wörtlichem Pfad. Der Agent darf nur lesen, seine Abschlussnachricht ist der Befund. Bei `kind: command` startet das Kit das fremde Werkzeug an seiner Lesegrenze, die Antwort steht danach in der Ausgabedatei:
```bash
node .claude/kit/board.mjs issue-review start --reviewer <name> --auftrag <tmpdir>/<id>-auftrag-<n>.md --ausgabe <tmpdir>/<id>-antwort-<n>.md
```

Scheitert `pruefauftrag` oder `start` (Exit 1, etwa `rolle-fehlt` oder `keine-lesegrenze`), ist das ein Ausfall dieses Reviewers in Zeile 2 des Befunde-Kommentars, mit dem Fehler aus der Ausgabe; die Prüfung läuft ohne ihn weiter. Einen Ersatzweg gibt es nicht — keinen selbst geschriebenen Prompt, keinen Start am Kit vorbei.

### 5. Befunde ans Board
Ein Kommentar je Lauf. Erste Zeile wörtlich `## <Stufe>-Review, Runde 1` mit `Issue`, `Fachplan` oder `Plan`; Zeile 2 nennt Ausfall, Unterbesetzung oder den Regelvorschlag beim Autor-Modell, sonst bleibt sie leer; darunter je Reviewer der Kopf wörtlich `### Reviewer <n>: <rolle>, <modell>`, etwa `### Reviewer 1: form-beobachtbarkeit, fable`, und darunter seine Funde. Aus diesem Kopf bucht `buchen` die Rolle; in anderer Form fällt sie auf „unbekannt“. Datei `<tmpdir>/<id>-befunde.md`, dann die Form der Funde prüfen:
```bash
node .claude/kit/befunde.mjs pruefen --datei <tmpdir>/<id>-befunde.md
```

Meldet das Kommando fehlende Angaben, fordert die Session sie beim liefernden Reviewer genau **einmal** nach und schreibt die Datei neu. Den fehlenden `reviewer-kopf` setzt die Session selbst, ohne Nachforderung — der Kopf stammt von ihr, nicht vom Reviewer; einen Kopf ohne gelaufenen Reviewer schreibt sie nie. Bleibt eine Angabe danach aus, trägt der betroffene Fundblock die Zeile `Angaben: unvollstaendig`. **Kein Gate:** Weder eine fehlende Angabe noch eine ausgebliebene Nachlieferung hält den Lauf auf; scheitert das Kommando selbst, steht das als eine Zeile in Zeile 2 des Kommentars. Der Kommentar geht in jedem dieser Fälle ans Board:
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

Dann die Buchung: Je Fundblock ergänzt die Session im Befunde-Text die Zeile `Uebernahme: uebernommen` beziehungsweise `Uebernahme: abgelehnt` — dieselbe Entscheidung, die der Kommentar in Prosa trägt —, schreibt den Text nach der Transportregel als `<tmpdir>/<id>-buchung.md` und bucht ihn mit der Stufe des Laufs aus Schritt 1b; für **jede** Art, die `buchen` unter `arten` als `erreicht` und mit `vorschlag: true` meldet, folgt ein Vorschlag — eine Urteils-Art (`vorschlag: false`) erzeugt keinen. **Kein Gate:** Ein Fehlschlag von `buchen` oder `vorschlag` steht in **einer Zeile** und hält weder Lauf noch Label auf — das Protokoll ist Buchhaltung, keine Bedingung. Wird der Lauf mit `kit:klaeren` geparkt, **wird nicht gebucht**: Dort hat niemand über die Funde entschieden, und ein Fund ohne Übernahmevermerk gehört nicht ins Protokoll. Im Worktree eines Runners legt `vorschlag` nichts an und meldet das mit Grund: Das ist kein Fehlschlag, die Zusammenfassung nennt es als „Vorschlag folgt beim Abbau“.
```bash
node .claude/kit/befunde.mjs buchen --datei <tmpdir>/<id>-buchung.md --stufe <fachlich|plan|issue> --karte <id>
node .claude/kit/befunde.mjs vorschlag --art <a>
```

Danach das Label als sichtbare Spur am Board: `node .claude/kit/board.mjs issue label add <id> review:fertig`. Es ist eine Spur, keine Freigabe, und meint den Stand des Marker-Datums. Trifft ein Fund die Stopp-Klasse und wird `kit:klaeren` gesetzt, entfaellt `review:fertig`. Meldet `befunde.mjs pruefen` den Eintrag `keine-pruefer`, wird `review:fertig` nicht gesetzt: Ohne einen einzigen gelaufenen Reviewer ist die Stufe nicht geprüft, und die Zusammenfassung nennt das. Ist das Label am Board nicht definiert, meldet der Skill die Fehlermeldung des Adapters und läuft weiter; Body, Marker und Kommentare stehen dann trotzdem, und die Zusammenfassung nennt das fehlende Label. Die Nacht-Kette verlangt dieses Label als Voraussetzung, bevor sie eine fachliche Anforderung oder ein Plandokument aufnimmt; die Spur bleibt trotzdem nur Spur, keine Freigabe. Das Label bezeugt allein die Pruefung durch die Modelle — **nicht**, dass der PO die Fragen unter `## Offene Fragen an den PO` beantwortet hat; die Reviewer duerfen sie ausdruecklich nicht beantworten. Die Kette verlangt beides: Eine Anforderung mit `review:fertig` und offenen Fragen wird mit Grund uebersprungen, bis in der **ersten** Zeile des Abschnitts ein Vermerk steht, der mit `Keine` beginnt — beantwortete Fragen allein genuegen nicht, die Kette liest nur diese eine Zeile. Wird eine Anforderung nach der Pruefung wesentlich geaendert, das Label abnehmen oder neu pruefen lassen — der naechtliche Lauf erkennt eine nachtraegliche Aenderung nicht.

### 7. Abschluss
Zusammenfassung je Dokument: Stufe, Zahl der Funde, übernommen / abgelehnt, Zahl der **gebuchten** Funde und die dabei entstandenen oder ergänzten **Vorschläge** (bei einem Fehlschlag der Buchung dessen eine Zeile), Marker und `review:fertig` gesetzt, Label abgenommen und nicht wieder gesetzt, oder `kit:klaeren`, übersprungene Dokumente mit Grund. Dann: Ready ist das GO des Menschen — der Marker gibt nichts frei.

## Lange Texte ans Board
Befunde, Body und Einarbeitung entstehen nach der Transportregel aus `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board": nie als Kommandozeilen-Argument, sondern stückweise in eine Datei außerhalb des Projektverzeichnisses (`printenv TMPDIR`, bleibt die Ausgabe leer (Linux und WSL2 ohne Sandbox), gilt `/tmp`; dann `cat >` und `cat >>` mit je höchstens 6.000 Zeichen), jedes Stück ein **eigener** Werkzeugaufruf mit wörtlichem Pfad, dann ein Aufruf mit `--text-file` bzw. `--body-file`. Scheitert ein Dateischritt, wird die unvollständige Datei nicht übertragen; scheitert ein Board-Aufruf, meldet der Skill den Fehler mit dem Pfad und endet ohne weitere Mutation.

## Stop-Punkte
- Kein Ziehen nach Ready — das ist das GO des Menschen. Ausnahme, ausschliesslich in der Umsetzungsstufe der Nacht-Kette unter Variante B: Dort zieht der Nacht-Runner die entstandenen Arbeitspakete selbst nach Ready. Die Ausnahme gilt dem Runner, nicht diesem Skill — keine Ready-Bewegung durch diesen Skill.
- Interaktiv kein Schreiben in den Body ohne ein Wort der Zustimmung.
- Kein Marker gibt einen Schritt frei; er ist eine Spur. Auch `review:fertig` ist Spur, keine Freigabe.
- Kein Ersatz-Reviewer aus eigenem Antrieb — die Besetzung kommt aus `roles`.
- Kein Review von `[Idee]`.
