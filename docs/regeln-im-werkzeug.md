# Regeln im Werkzeug

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
| Echter Rückgabewert des Prüfkommandos | Abschnitt 1, Build-Checks | Bedienvorgabe | vollständig | `kit/checks.mjs` (`kommandoAusfuehren`) ruft jedes Kommando selbst auf und liest seinen eigenen Rückgabewert. Die Anleitung, ihn erst in eine Datei zu schreiben, ist aus dem Text verschwunden. |
| Allgemeine Fehlermerkmale in der Ausgabe | Abschnitt 1, Build-Checks | Bedienvorgabe | vollständig | `kit/checks.mjs` (`fehlermerkmal`) prüft die Ausgabe jedes Kommandos; ein Treffer färbt die Prüfung rot, auch bei Rückgabewert 0. Nachbau der Merkmalprüfung in `kit/night.mjs` für die Salvage-Vorprüfung. |
| Zeitrahmen für lang laufende Checks | `Leitplanke: Lang laufende Checks brauchen einen großzügigen Zeitrahmen.` | gemischt | teilweise | Der Abbruch an der Uhr ist sichtbar geworden: `kit/checks.mjs` schreibt die Zusammenfassung begleitend, ein Lauf, der stirbt, hinterlässt sie unabgeschlossen und ungrün. Die Bitte um einen großzügigen Zeitrahmen bleibt im Text — ein Werkzeug kann sich nicht mehr Zeit geben, als sein Aufrufer ihm einräumt. |
| Hintergrundlauf abholen | `Leitplanke: Keine Session endet mit laufender eigener Arbeit.` | gemischt | teilweise | Die unabgeschlossene Zusammenfassung übernimmt `kit/checks.mjs`: Ein weggelaufener Lauf ist von außen als solcher erkennbar. Die Haltung — warten oder abbrechen und den Abbruch als Fehlschlag melden — bleibt im Text, weil nur die Session weiß, ob sie noch einen Zug hat. |
| Timeout erreicht: nicht mit demselben Wert neu starten | dieselbe Leitplanke, letzter Satzteil | Urteilsregel | nicht | Bleibt im Text: Ob der Wert erhöht und das benannt wird oder der Check als Fehlschlag zurückgeht, ist eine Abwägung im Einzelfall. |
| Coverage-Gate als Floor ausweisen | `Leitplanke: Ein Coverage-/Qualitäts-Gate ist ein Floor, kein Beweis voller Abdeckung.` | Urteilsregel | nicht | Bleibt im Text: Ob eine Lücke echt ungetestete Logik ist oder Rauschen, entscheidet der Blick in den Report. Ein Werkzeug könnte nur die Zahl gegen die Schwelle halten — das tut die Gütemessung mit ihrer Marke schon. |
| Klassenweite Modell-Fehler ins Gate | `Leitplanke: Wiederkehrende, klassenweite Modell-Fehler gehören ins Gate, nicht in Prompts.` | Urteilsregel | nicht | Bleibt im Text: Welche Lint- oder Compiler-Regel eine Fehlerklasse abdeckt, hängt am Projekt und an seinem Ökosystem. Das Kit verankert das Prinzip, den Katalog führt das Projekt in seinen `buildChecks`. |
| Fehleranalyse bei rotem Check | Abschnitt 1, „Bei Fehler" | Urteilsregel | nicht | Bleibt im Text: Ausgabe zeigen, Ursache analysieren, Fix vorschlagen — das ist die Arbeit selbst, kein Handgriff am Werkzeug. |
| Manuelle UI-Verifikation | Abschnitt 3 | Urteilsregel | nicht | Bleibt im Text: Golden Path und Grenzfälle klickt ein Mensch. Ein Werkzeug kann hier nichts übernehmen, es kann nur daran erinnern. |
| Prüf-Anker aus `git merge-base` | Abschnitt 1, „Warum dieser Anker" | Bedienvorgabe | nicht | Bleibt im Text: Der richtige Anker hängt am Zeitpunkt des Aufrufers — `/local-check` prüft nach dem Commit gegen den letzten Push, die `implement-*`-Skills davor gegen den Default `HEAD`. Das Werkzeug kennt seinen Aufrufer nicht. |
| Paketstufe fahren, kein `--stufe` übergeben | Abschnitt 1, „Gefahren wird die Paketstufe" | Bedienvorgabe | nicht | Bleibt als Begründung im Text: Die Vorgabe trägt `kit/checks.mjs` bereits (ohne `--stufe` läuft die Paketstufe), der Text sagt nur noch, warum der Skill nichts übergibt. |
| Format-Fix genau einmal nachfahren | Abschnitt 1b | Bedienvorgabe | nicht | Bleibt im Text: `formatFixCommand` ruft heute der Nacht-Runner und der Leser dieser Anweisung, nicht `checks.mjs run`. Die Grenze „kein Loop, keine zweite Runde" hängt damit an beiden Aufrufern. |
| Berichtspflicht nach dem Fix | Abschnitt 1b, „Berichtspflicht" | Urteilsregel | nicht | Bleibt im Text: Dass der Arbeitsbaum nach dem Fix verändert ist, gehört in die Meldung an den Menschen. Was er daraus macht — committen oder ansehen —, entscheidet er. |
| Berichtsformat der Checklist | Abschnitt „Ergebnis" | Bedienvorgabe | nicht | Bleibt im Text: `checks.mjs run` liefert gelaufene und ausgelassene Prüfungen samt Grund, die Form der Meldung an den Menschen (die Checklist mit ihren Zeichen) bleibt Sache der Anweisung. |
| Roter Check stoppt den Prozess | Abschnitt „Ergebnis" | Bedienvorgabe | nicht | Bleibt im Text: `checks.mjs run` endet ungrün und sagt, woran. Ob der Prozess dann anhält, entscheidet der Ablauf drumherum — im Nachtbetrieb der Runner, interaktiv der Mensch. |
| Stop-Punkt vor `/review` und vor dem Push | Abschnitt „Stop-Punkt" | Urteilsregel | nicht | Bleibt im Text: Der Push wartet auf die Trigger-Phrase `push main`. Das ist eine Prozessregel über Zuständigkeiten, kein Handgriff, den ein Prüfwerkzeug ausführen könnte. |
| Mutations-Test läuft ungefiltert | Abschnitt 2 | Bedienvorgabe | nicht | Bleibt im Text: `mutationCommand` steht nicht in `buildChecks` und ist damit nicht Teil der bereichsbezogenen Auswahl. Wer Verbindlichkeit will, trägt sein Kommando als `buildChecks`-Eintrag mit `guete`-Block ein — dann prüft das Werkzeug. |
| Prüfkommando im Vordergrund ausführen | Abschnitt 1, letzter Absatz | Urteilsregel | nicht | Bleibt im Text: Ein Werkzeug bestimmt nicht, wie sein Aufrufer es startet. Die Leitplanke zum Hintergrundlauf deckt den Rest ab. |
| Fehlende oder leere `buildChecks` melden | Vorbedingung und Abschnitt „Ergebnis" | Bedienvorgabe | nicht | Bleibt im Text: Der Hinweis richtet sich an den Menschen, der die Config ins Repository legt. Der harte Teil sitzt woanders — der Nacht-Runner startet gar nicht, wenn auf der Paketstufe keine Prüfung liegt. |

## Was die Aufstellung nicht ist

Sie ist keine Änderungsliste. Was an welchem Tag wanderte, steht in `CHANGELOG.md` und in den Commits. Diese Seite beschreibt den **Stand**: wo eine Regel heute wirkt und warum dort. Wer eine Regel von `/local-check` umstellt, ändert hier die Zeile mit.

Sie ist auch keine Liste aller Regeln des Kits. Sie nimmt sich die eine Anweisung vor, an der der Maßstab zuerst angewendet wurde. Für jede weitere gilt derselbe Maßstab — die Aufstellung dazu entsteht, wenn sie umgestellt wird.
