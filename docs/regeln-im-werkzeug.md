# Regeln im Werkzeug

Aufstellung vom 12.10.2026, Stand vor Kit 5.1.2. Sie wird nicht mehr gepflegt; was heute gilt, steht in der Dokumentation.

Der Skill `/local-check` ist mit Issue #1609 entfallen; die letzte Spalte nennt deshalb je Regel den heutigen Ort oder vermerkt, dass sie nicht mehr gilt. Die Spalte „Fundstelle“ zeigt weiter den alten Ort im Skill.

Diese Seite ist die Aufstellung zur Umstellung von `/local-check`: Sie führt **jede** Regel der Anweisung `skills/local-check/SKILL.md` und sagt je Regel, welcher Art sie ist, wie weit sie ins Werkzeug überführt wurde und wo sie heute steht.

Der Maßstab dahinter heißt „Regel im Text oder Regel im Werkzeug" und steht in `CLAUDE-workflow.md`, also in der Prozessvorlage, die jedes Projekt mitbekommt. Kurz gefasst:

- **Bedienvorgabe** — sagt, wie ein Werkzeug zu bedienen ist. Ihre Befolgung ist an Ausgabe oder Ergebnis ablesbar, und ein Werkzeug könnte sie an der Stelle des Lesers ausführen. Sie gehört ins Werkzeug.
- **Urteilsregel** — verlangt eine Entscheidung oder Haltung im Einzelfall. Sie bleibt im Text, weil ein Werkzeug sie nur erraten könnte.
- **gemischt** — trägt beides. Der überführbare Teil wandert, der Rest bleibt benannt im Text.

Der **Überführungsgrad** sagt, was davon tatsächlich geschehen ist: `vollständig` (die Regel steht nur noch im Werkzeug), `teilweise` (ein Teil wandert, der Rest bleibt benannt) oder `nicht` (sie bleibt, wo sie war — mit Grund).

Eine Zeile mit der Art *Bedienvorgabe* und dem Grad *nicht* ist kein Widerspruch: Die Art sagt nichts über die Überführbarkeit. Sie sagt nur, dass hier noch etwas zu holen wäre, wenn sich jemand die Stelle vornimmt.

## Die Regeln von `/local-check`

| Regel | Fundstelle | Art | Grad | Neuer Ort oder Grund fürs Bleiben |
| --- | --- | --- | --- | --- |
| Echter Rückgabewert des Prüfkommandos | Abschnitt 1, Build-Checks | Bedienvorgabe | vollständig | `kit/checks.mjs` (unverändert): `kommandoAusfuehren` ruft jedes Kommando selbst auf und liest seinen eigenen Rückgabewert. Die Anleitung, ihn erst in eine Datei zu schreiben, ist aus dem Text verschwunden. |
| Allgemeine Fehlermerkmale in der Ausgabe | Abschnitt 1, Build-Checks | Bedienvorgabe | vollständig | `kit/checks.mjs` (unverändert): `fehlermerkmal` prüft die Ausgabe jedes Kommandos; ein Treffer färbt die Prüfung rot, auch bei Rückgabewert 0. Nachbau der Merkmalprüfung in `kit/night.mjs` für die Salvage-Vorprüfung. |
| Zeitrahmen für lang laufende Checks | `Leitplanke: Lang laufende Checks brauchen einen großzügigen Zeitrahmen.` | gemischt | teilweise | `CLAUDE-workflow.md`, „Leitplanken der Pruefungen“. Der Abbruch an der Uhr ist sichtbar geworden: `kit/checks.mjs` schreibt die Zusammenfassung begleitend, ein Lauf, der stirbt, hinterlässt sie unabgeschlossen und ungrün. Die Bitte um einen großzügigen Zeitrahmen bleibt im Text — ein Werkzeug kann sich nicht mehr Zeit geben, als sein Aufrufer ihm einräumt. |
| Hintergrundlauf abholen | `Leitplanke: Keine Session endet mit laufender eigener Arbeit.` | gemischt | teilweise | `CLAUDE-workflow.md`, „Leitplanken der Pruefungen“, Verweis auf den Absatz im Abschnitt „Nachtbetrieb (optional)“. Die unabgeschlossene Zusammenfassung übernimmt `kit/checks.mjs`: Ein weggelaufener Lauf ist von außen als solcher erkennbar. Die Haltung — warten oder abbrechen und den Abbruch als Fehlschlag melden — bleibt im Text, weil nur die Session weiß, ob sie noch einen Zug hat. Ebenso im Text bleibt der zweite Teil (Issue #983): dass eine Warteschleife auch prüft, ob der Lauf noch existiert, und einen toten Lauf als Fehlschlag meldet statt als Zeitablauf. Ohne Aufsicht weist der Hook `bash-check` Hintergrundarbeit ab (Issue #1081). |
| Timeout erreicht: nicht mit demselben Wert neu starten | dieselbe Leitplanke, letzter Satzteil | Urteilsregel | nicht | `CLAUDE-workflow.md`, „Leitplanken der Pruefungen“, Leitplanke zum Zeitrahmen. Bleibt im Text: Ob der Wert erhöht und das benannt wird oder der Check als Fehlschlag zurückgeht, ist eine Abwägung im Einzelfall. |
| Coverage-Gate als Floor ausweisen | `Leitplanke: Ein Coverage-/Qualitäts-Gate ist ein Floor, kein Beweis voller Abdeckung.` | Urteilsregel | nicht | `CLAUDE-workflow.md`, „Leitplanken der Pruefungen“. Bleibt im Text: Ob eine Lücke echt ungetestete Logik ist oder Rauschen, entscheidet der Blick in den Report. Ein Werkzeug könnte nur die Zahl gegen die Schwelle halten — das tut die Gütemessung mit ihrer Marke schon. |
| Klassenweite Modell-Fehler ins Gate | `Leitplanke: Wiederkehrende, klassenweite Modell-Fehler gehören ins Gate, nicht in Prompts.` | Urteilsregel | nicht | `CLAUDE-workflow.md`, „Leitplanken der Pruefungen“. Bleibt im Text: Welche Lint- oder Compiler-Regel eine Fehlerklasse abdeckt, hängt am Projekt und an seinem Ökosystem. Das Kit verankert das Prinzip, den Katalog führt das Projekt in seinen `buildChecks`. |
| Fehleranalyse bei rotem Check | Abschnitt 1, „Bei Fehler" | Urteilsregel | nicht | `implement-*` und `/push-main` Schritt 5, W3. Bleibt im Text: Ausgabe zeigen, Ursache analysieren, Fix vorschlagen — das ist die Arbeit selbst, kein Handgriff am Werkzeug. |
| Manuelle UI-Verifikation | Abschnitt 3 | Urteilsregel | nicht | `/push-main` Schritt 2: Vor dem Veröffentlichen fragt es nach den Oberflächenänderungen des Stands. Golden Path und Grenzfälle klickt ein Mensch; ein Werkzeug kann hier nur daran erinnern. |
| Prüf-Anker aus `git merge-base` | Abschnitt 1, „Warum dieser Anker" | Bedienvorgabe | nicht | `/push-main` Schritt 5 und `docs/prozess.md`, „Prüflauf von Hand“. Der richtige Anker hängt am Zeitpunkt des Aufrufers; die `implement-*`-Skills prüfen vor dem Commit gegen den Default `HEAD`. Das Werkzeug kennt seinen Aufrufer nicht. |
| Paketstufe fahren, kein `--stage` übergeben | Abschnitt 1, „Gefahren wird die Paketstufe" | Bedienvorgabe | nicht | gilt nicht mehr (#1609): der Schritt ist entfallen. Die Paketstufe als Vorgabe ohne `--stage` trägt `kit/checks.mjs`. |
| Format-Fix genau einmal nachfahren | Abschnitt 1b | Bedienvorgabe | vollständig | `kit/checks.mjs`: `run` fährt an der Paketstufe bei einer roten Prüfung `formatFixCommand` genau einmal und die Prüfung einmal erneut, ohne eigenen Fix im Nacht-Runner (Issue #1672). |
| Berichtspflicht nach dem Fix | Abschnitt 1b, „Berichtspflicht" | Urteilsregel | vollständig | `kit/checks.mjs`: Der Bericht von `run` sagt, dass das Nachformatieren lief und ob es gereicht hat (Issue #1672). |
| Berichtsformat der Checklist | Abschnitt „Ergebnis" | Bedienvorgabe | nicht | gilt nicht mehr (#1609): der Schritt ist entfallen. Gelaufene und ausgelassene Prüfungen samt Grund liefert `checks.mjs run` im Block für den Abschlussbericht. |
| Roter Check stoppt den Prozess | Abschnitt „Ergebnis" | Bedienvorgabe | nicht | `implement-*` und `/push-main` Schritt 5, W3. `checks.mjs run` endet ungrün und sagt, woran; ohne grünen Nachweis entsteht kein Commit und kein Push. |
| Stop-Punkt vor `/kit-review` und vor dem Push | Abschnitt „Stop-Punkt" | Urteilsregel | nicht | gilt nicht mehr (#1609): der Schritt ist entfallen. Der Push wartet weiter auf die Trigger-Phrase `push main`. |
| Mutations-Test läuft ungefiltert | Abschnitt 2 | Bedienvorgabe | vollständig | `kit/checks.mjs`, Stufe `push`: `run --stage push` fährt `mutationCommand` einmal nachgelagert über den Stand, der veröffentlicht wird; ein rotes Ergebnis hält nichts an und steht im Bericht (Issue #1673). |
| Prüfkommando im Vordergrund ausführen | Abschnitt 1, letzter Absatz | Urteilsregel | nicht | `CLAUDE-workflow.md`, „Leitplanken der Pruefungen“, Leitplanke zum Zeitrahmen, und der Absatz im Abschnitt „Nachtbetrieb (optional)“: Ohne Aufsicht weist der Hook `bash-check` Hintergrundarbeit ab. Interaktiv bestimmt ein Werkzeug nicht, wie sein Aufrufer es startet. |
| Fehlende oder leere `buildChecks` melden | Vorbedingung und Abschnitt „Ergebnis" | Bedienvorgabe | nicht | `/push-main` Schritt 5. Der Hinweis richtet sich an den Menschen, der die Config ins Repository legt. Der harte Teil sitzt woanders — der Nacht-Runner startet gar nicht, wenn auf der Paketstufe keine Prüfung liegt. |

## Was die Aufstellung nicht ist

Sie ist keine Änderungsliste. Was an welchem Tag wanderte, steht in `CHANGELOG.md` und in den Commits. Diese Seite beschreibt den **Stand**: wo eine Regel heute wirkt und warum dort.

Sie ist auch keine Liste aller Regeln des Kits. Sie nimmt sich die eine Anweisung vor, an der der Maßstab zuerst angewendet wurde. Für jede weitere gilt derselbe Maßstab — die Aufstellung dazu entsteht, wenn sie umgestellt wird.
