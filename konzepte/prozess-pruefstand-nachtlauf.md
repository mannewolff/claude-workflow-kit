# Der Nachtlauf auf dem Prüfstand

Stand: 13.09.2026. Grundlage: Whitepaper v1.2 (August 2026), docs.mwolff.org, die Repositories `claude-workflow-kit` (v1.52.2) und `kanban-kit` (v1.40.0), die Skills und Vorlagen des Kits, und vor allem die Nachtlauf-Protokolle beider Projekte vom 05.09. bis 12.09.2026 (Textprotokolle und Ergebnisstand-Dateien). Dazu die Arbeitsliste `prozess-pruefstand.md` vom 10.09., die einen Teil der Diagnose schon vorweggenommen hat.

Das Dokument beantwortet drei Fragen: Was war gedacht, was ist gebaut, warum läuft es nachts nicht durch. Danach folgen die Antworten auf deine beiden Fragen (Doppel-Review, Empfehlung folgen), ein Blick auf andere Ansätze und ein Neuentwurf für eine Nacht, die terminiert.

---

## 1. Befund in fünf Sätzen

Die Implementierung funktioniert nachts: 44 von 46 Sessions im Kit-Repo und 25 von 30 im kanban-kit endeten mit einem Commit und einer Karte in In review. Alles davor, also Plan erzeugen, Plan prüfen, Arbeitspakete erzeugen, Arbeitspakete prüfen, ist in der ganzen Woche kein einziges Mal ohne menschlichen Eingriff bis zum Ende gekommen. Der Grund ist nicht ein Fehler in einem Skill, sondern die Bauart des Prüfapparats: Er ist darauf optimiert, nie eine falsche Entscheidung zu treffen, und deshalb trifft er keine. Jeder Reviewer wird ausdrücklich gebeten, Alternativen und Regelverstöße zu finden, und jeder solche Fund ruft einen Menschen; ein Sprachmodell, das man nach Alternativen fragt, findet welche. Die Implementierung läuft dagegen durch, weil dort ein deterministisches Werkzeug entscheidet, ob etwas fertig ist, und genau das fehlt der Prüfkette.

---

## 2. Soll: was das Whitepaper v1.2 beschreibt

Das Whitepaper beschreibt neun Schritte mit drei Stop-Punkten (Ready, Push, Merge). Ein Modell-Review kommt genau einmal vor, in Schritt 7 für den Code („implementiert Modell A, reviewt Modell B"). Das fachliche Issue gibt es als optionalen Schritt 1.5. Für den Nachtlauf (Kapitel 8.3) gilt ein einziger Satz als Schnittkriterium: „Ein Issue, das unbeaufsichtigt laufen soll, muss ohne Rückfrage umsetzbar sein." Die Stop-Punkte Push und Merge bleiben am Morgen beim Menschen.

Zwei Anti-Patterns sind für die Analyse tragend. Anti-Pattern 9 lautet wörtlich: „Ein Modell, das beim zweiten Versuch durchwinkt, ist kein Gate. Es kann zuarbeiten, es kann Befunde liefern, es kann eine Vorprüfung machen. Die Entscheidung, ob etwas durchgeht, trifft ein deterministisches Werkzeug oder ein Mensch." Anti-Pattern 10 warnt vor Überautomatisierung ohne Stop-Punkte.

Was das Whitepaper nicht kennt: ein Review von Plänen oder Issues durch fremde Modelle, zwei Reviewer je Dokument, eine Synthese durch ein drittes Modell, Zustandslabels, Routing-Labels, drei Nachtmodi. Und was es offen lässt: ob die KI bei Unklarheit nachfragen oder eine Annahme treffen und dokumentieren soll. Diese Lücke hat die Implementierung gefüllt, und zwar in die Richtung „nachfragen".

---

## 3. Ist: was gebaut wurde

Die Kette vom Fachplan bis zum Code sieht heute so aus:

| Stufe | Wer schreibt | Wer prüft | Was zusätzlich läuft | Menschliche Geste danach |
|---|---|---|---|---|
| `[Fachlich]` | Mensch mit `/fachplan` | 2 Reviewer (Rollen form-beobachtbarkeit, abgrenzung) | Synthese, Beleg-Abgleich, Synthese-Prüfung durch ein viertes Modell | Label `kit:nightplan` |
| `[Plan]` | Nacht, `/techplan` | 2 Reviewer (architektur-bestand, schnitt-abhaengigkeiten) | dito, bis zu 3 Runden | Freigabe, Label `kit:nightissues` |
| Arbeitspakete | Nacht, `/issues` | 1 Reviewer (pruefbarkeit) je Paket | dito | Ready ziehen, Label `kit:nightrun` |
| Code | Nacht, `/implement-next` | Build-Gates, morgens `/review` | | `push main`, `merge production` |

Dazu kommen fünf Zustandslabels, vier Routing-Labels, die Register F1 bis F11, P1 bis P12 und W1 bis W4, die Zeilen `Pruefung:` und `Pruefung-Stand:` mit Verfall, die Rundengrenze 3, drei Ausgänge je Fund (übernommen, verworfen, zur Entscheidung) und drei Klassen je Fund (korrektur, gate, alternativen).

Ein paar Zahlen zur Größe des Apparats. Der Skill `issue-review` hat 1.032 Zeilen und 77 KB; er verweist auf 27 verschiedene Issues und fünf Vorfallsdaten als Begründung einzelner Regeln. `night.mjs` hat 3.900 Zeilen. Eine Prüf-Session lädt vor dem ersten Zeichen des zu prüfenden Dokuments rund 135 KB Regeln (CLAUDE.md, CLAUDE-workflow.md, die beiden Register, den Skill), im kanban-kit mit den Tech-Dateien rund 190 KB, also grob 35.000 bis 45.000 Token Protokoll. Der Plan-Review von #782 im kanban-kit hat 252 Züge, 14,7 Minuten und 22 USD gebraucht und endete ohne Marker.

---

## 4. Was die Protokolle zeigen

### Die Implementierung läuft

| Projekt | Sessions 05.09. bis 12.09. | Erfolg | Dauer je Paket | Kosten je Paket |
|---|---|---|---|---|
| claude-workflow-kit | 46 | 44 (2 harte Stopps: #517 war fertig und committet, der Runner hat die Runde wegen eines Rests im Arbeitsbaum als Stopp gewertet; #590 wegen liegengebliebener Dateien) | 3 bis 42 min, Median etwa 11 min | keine Kennzahlen (ohne `--verbose`) |
| kanban-kit | 30 | 25 (5 Fehlschläge) | 3 bis 16 min | 1 bis 12 USD |

Das ist der produktive Kern. Er funktioniert, weil am Ende ein Werkzeug entscheidet: Tests grün, Coverage 100, Mutation 100, Build grün, Karte in In review. Das Modell kann sich nicht herausreden.

### Die Vorstufen laufen nicht

| Lauf | Eingang | Ausgang |
|---|---|---|
| 09.09. Erzeugung Plan | #479, #533, #535 | #479 → Plan #562 erzeugt, die Prüf-Session lief ins 15-Minuten-Limit (ohne Ergebnis); #533 → Plan #564 mit `kit:klaeren`; #535 → #553 (war schon geprüft) |
| 09.09. Erzeugung Plan, 2. Versuch | #479, #549 | harter Stopp |
| 10.09. Erzeugung Plan | #567, #551, #559 | #567 → #575 und #551 → #577 erzeugt, beide Prüf-Sessions ins 15-Minuten-Limit (ohne Ergebnis); #559 → Plan #578, beide Prüf-Runden am Limit, Ende mit `kit:klaeren` |
| 10.09. Erzeugung Issues | Plan #562 | Pakete #572, #573, #574: alle drei `kit:klaeren`, 74 Minuten, rund 5 USD je Prüf-Session |
| 11.09. Review Plan (Kit) | #608 | `syntheseOhneBeleg` (ein als übernommen bezeichneter Fund stand nicht im Vorschlag) |
| 11.09. Review Issue (Kit) | #610 | ohne Befund, Marker gesetzt (der einzige saubere Durchlauf der Woche) |
| 11.09. Review Plan (kanban-kit) | #782 | 5 Funde „zur Entscheidung", kein Marker |
| 11.09. Review Issue (kanban-kit) | #816 | mit Befund, kein Marker |
| 12.09. Review Fachlich (kanban-kit) | #815 | 3 Funde „zur Entscheidung", kein Marker |

Von acht Plan-Erzeugungsversuchen kam keiner in derselben Nacht zu einem freigegebenen Plan; das Erzeugen selbst hat dabei meist funktioniert, gescheitert ist die Prüfung dahinter. Von fünf Prüf-Nächten endete eine mit Marker. Die eine war ein `[Task]`, also das Dokument mit dem kleinsten Prüfumfang.

### Drei Beispiele, die das Muster zeigen

**#815, „Vorhaben löschen, Karten bleiben ohne Vorhaben erhalten"** (dein erstes Beispiel). Zwei Reviewer, acht Funde, vier übernommen, einer verworfen, drei zur Entscheidung. Die beiden Reviewer fanden unabhängig denselben `alternativen`-Fund: Ob ein ausgeblendetes Vorhaben nach dem Wiederherstellen aus dem Papierkorb sichtbar ist oder ausgeblendet bleibt. Das ist ein Randfall aus dem Zusammentreffen zweier Nebenfunktionen, den ein Senior in drei Sekunden entscheidet („behält seinen Zustand"). Er hat die Nacht angehalten. Danach hat die Synthese-Prüfung (Sonnet) einen weiteren Befund geliefert: Die Synthese hatte einen HINWEIS als „zur Entscheidung" statt als „verworfen" verbucht, was in der Bilanzzeile unsauber sei. Das ist ein Buchhaltungsbefund über das Protokoll des Reviews, nicht über das Produkt. Auch er hält den Marker zurück.

**#782, Plan-Review im kanban-kit.** Fünf Funde „zur Entscheidung": eine veraltete Zeilenangabe in einer Begründung (nicht anwendbar, weil „menschlich gesetzter Inhalt"), der Satz „Tests sind grün" in der Verifizierung (Verstoß gegen P9, weil er das Ergebnis vorwegnimmt), ein Satz über Mocks, den der Bestand anders löst (P10), ein Bestandsbefund (die Typen passen bereits, drei Plan-Entscheidungen könnten entfallen) und drei Wege für einen Fehlerpfad. Von fünf Stopp-Gründen betreffen drei die Form des Dokuments, zwei sind echte, aber kleine technische Entscheidungen, die ein Senior beim Lesen trifft.

**#573 und #574, Arbeitspaket-Review im Kit.** #573: „Woher `/fachplan` die Nummer des angehaltenen `[Task]` nimmt: Argument, Nennung im Text oder eigene Suche am Board." #574: Runde 3, 14 Funde, 13 übernommen, ein `alternativen`-Fund über die Frage, welcher Test mit „der bestehende label-sync-Test" gemeint ist. Beides Fragen, die eine Implementierungs-Session nebenbei entscheidet. Die Runden 1 und 2 von #574 hatten übrigens Befunde geliefert, aber weder Body-Vorschlag noch Synthese geschrieben; die Transportmechanik (Dateistücke zu je 6.000 Zeichen, Schreibrechte, Zeitlimit) hatte sie aufgefressen.

---

## 5. Warum es scheitert: sieben Ursachen

**Erstens: Eskalation ist die Voreinstellung.** Jeder Reviewer muss jeden Fund klassifizieren; `gate` und `alternativen` rufen zwingend einen Menschen, ein Fund ohne Klasse „gilt wie `gate`", ein Fund auf eine PO-Antwort oder eine Plan-Begründung ebenfalls, ein roter Beleg-Abgleich ebenfalls, ein Befund der Synthese-Prüfung ebenfalls, ein ausgefallener Reviewer ebenfalls. Der Skill sagt es selbst: „Im Zweifel ruft der Fund einen Menschen." Die Register bitten außerdem darum, Alternativen zu benennen („mehr als ein gangbarer Weg, nenne welche"). In Software gibt es immer mehr als einen gangbaren Weg. Wer ein Sprachmodell danach fragt, bekommt sie geliefert, bei #815 sogar von beiden Reviewern übereinstimmend. Die Nacht hält an, nicht weil etwas unklar wäre, sondern weil das Protokoll Unklarheit belohnt.

**Zweitens: Geprüft wird die Form, nicht das Produkt.** Die Register F1 bis F11, P1 bis P12 und W1 bis W4 machen aus dem Review eine Konformitätsprüfung. Drei der fünf Stopp-Gründe bei #782 sind Formfragen (Zeilenangabe, das Wort „grün", ein Satz zu Mocks). Ein Fachplan-Reviewer prüft, ob vier Überschriften in der richtigen Reihenfolge stehen, ob `Autor-Modell:` im Abschnitt `## Ziel` steht und ob die Wurzel keine Herkunftszeile trägt. Das sind Dinge, die `board.mjs` in Millisekunden deterministisch prüfen kann. Ein Modell dafür einzusetzen kostet Minuten und Dollar und produziert Befunde, über die dann ein Mensch entscheiden soll.

**Drittens: Meta-Review ohne Boden.** Auf das Review (zwei Modelle) folgt die Synthese (das Session-Modell), darauf der Beleg-Abgleich (Kommando), darauf die Synthese-Prüfung (ein viertes Modell). Jede Schicht wurde nach einem konkreten Vorfall eingezogen (12.08.: neun Synthesen behaupteten Schärfungen, die nirgends standen; 31.08.: vier von vier Sessions ohne Body), und jede Schicht hat neue Fehlerarten mitgebracht (`syntheseOhneBeleg` bei #608, der Buchhaltungsbefund bei #815). Eine Schicht, die eine andere Schicht prüft, hat keinen Grund, jemals zu konvergieren, weil unten kein Boden ist: Es gibt keinen Test, der sagt, ob eine Synthese richtig ist. Das ist genau die Situation, vor der Anti-Pattern 9 warnt, nur mit umgekehrtem Vorzeichen: Nicht das Modell winkt durch, sondern das Modell lässt nie durch.

**Viertens: Nachts fehlt die Rolle, die entscheidet.** Das Whitepaper kennt drei menschliche Rollen. Nachts ist der PO nicht da, das ist klar. Aber der Senior Developer ist auch nicht da, und keinem Skill wurde seine Aufgabe übertragen. `/techplan` unbeaufsichtigt: „Es wird nicht nachgefragt. Jede offene Stelle wird stattdessen im Plan-Dokument festgehalten." Ein Plan mit einer offenen Frage „ist kein Eingang für `/issues`." Die Reviewer: „Unterstelle keine Entscheidungen, die nicht im Body stehen." Der Skill: „Geraten wird auch nachts nicht." Das Whitepaper sagt „ohne Rückfrage umsetzbar"; die Implementierung hat daraus „Rückfrage mit einer Nacht Verzögerung" gemacht. Dein eigener Befund ist der entscheidende Datenpunkt: In 99,9 Prozent der Fälle folgst du der Empfehlung des Modells. Dann ist der Erwartungswert einer nächtlichen Rückfrage null, ihr Preis ist eine Nacht.

**Fünftens: Regeln als Narbengewebe.** Der `issue-review`-Skill ist ein Vorfallsprotokoll in Regelform: 27 Issue-Verweise, fünf Datumsangaben, Formulierungen wie „Am 2026-08-08 in zwei Läufen protokolliert", „Am 2026-09-10 verloren zwei Prüf-Sitzungen ihr vollständiges Ergebnis". Jede Regel ist einzeln begründet, und keine wird je entfernt, weil der Vorfall ja war. Das Ergebnis ist ein Skill, den kein Mensch mehr in einem Stück liest und den ein Modell mit 45.000 Token Regeln im Kontext abarbeiten soll, bevor es das Dokument sieht. Dazu kommt die Transportmechanik (Dateistücke zu 6.000 Zeichen, wörtliche Pfade, Verbote für Pipes, Schreibrechte, 15-Minuten-Limit für Prüf-Sessions), die selbst ein guter Teil der Fehlschläge ist: Bei drei der Plan-Erzeugungen (#479, #567, #551) lief die Prüf-Session ins Zeitlimit, bei #559 beide Runden; keine davon ist an einem Inhalt gescheitert.

**Sechstens: Der Prozess baut den Prozess.** Das Backlog des Kits besteht fast vollständig aus Meta-Arbeit (Runner, Labels, Marker, Synthese, Register). Die letzten Commits im kanban-kit heißen „Nachtlauf-Auswertung", „Ergebnisstand-Parser", „Leitstand". Das ist an sich kein Fehler, das Kit ist ja das Produkt. Aber es ist ein Kostensignal: Seit August entstehen nachts vor allem Regeln über Nächte. Und es erklärt, warum der Apparat nur wächst: Jede Nacht, die scheitert, erzeugt ein `[Fachlich]` über den Fehler, das den Apparat um eine Regel erweitert.

**Siebtens: Der Takt.** Zwischen Fachplan und Code liegen drei menschliche Gesten (`kit:nightplan`, Freigabe plus `kit:nightissues`, Ready), dazu `kit:klaeren` an jeder Stelle. Selbst wenn nichts schiefgeht, braucht ein Fachplan drei Nächte und drei Morgen bis zum ersten Commit. Deine eigenen Zahlen (Fachplan liegt zehn Stunden, fünf Stunden bis Ready, acht Minuten Implementierung, zwei Tage in Review) sagen dasselbe wie These C7: Der Takt wird vom langsamsten menschlichen Schritt bestimmt, und die Nacht hat davon vier bekommen.

Das Gegenbild ist die Implementierung. Sie hat dieselben Modelle, dieselbe Transportmechanik, dieselben Zeitlimits, und sie läuft. Der Unterschied ist ausschließlich, dass am Ende ein Werkzeug „fertig" sagt und nicht ein Modell.

---

## 6. Antworten auf deine beiden Fragen

### Braucht es diesen Review-Prozess?

Nein, nicht in dieser Form. Was bleiben sollte: ein fremdes Modell liest den Fachplan und den Plan, bevor daraus etwas entsteht. Das ist billig (fünf Minuten, wenige Dollar), es findet echte Dinge (der Reviewer, der im Plan ein nicht existierendes Kommando fand; der BLOCKER bei #573, der eine bereits vergebene Spec-Nummer entdeckte), und es passt zu deiner Praxis, Spezifikationen durch mehrere Modellfamilien laufen zu lassen. Was gestrichen gehört: die Klassifikation der Funde, der Ausgang „zur Entscheidung", die Synthese als eigenes Dokument, der Beleg-Abgleich, die Synthese-Prüfung, der Marker als Gate für die nächste Stufe, die Rundengrenze, die Zustandslabels im Nachtbetrieb und der Review des einzelnen Arbeitspakets.

Zur Zahl der Reviewer: Zwei Reviewer am Fachplan sind vertretbar, weil dort der Hebel am größten ist und die beiden Rollen wirklich verschieden lesen. Am Plan reicht einer, der den Bestand kennt. Am Arbeitspaket keiner: Dein Befund vom 08.08. (drei von vier Scope-Funden Fehlalarme) und die Runde 3 von #574 (14 Funde, 13 übernommen, einer hält die Nacht an) zeigen, dass diese Stufe vor allem Rauschen produziert. Was ein Arbeitspaket falsch macht, fangen die Implementierung mit ihren Gates und der Code-Review in Schritt 7 ab.

Zur Synthese durch ein drittes Modell: Sie löst ein Problem, das erst durch die zwei Reviewer entsteht (Widerspruch zwischen Befundlisten). Bei #815 gab es keinen Dissens, die Synthese hatte nichts zu synthetisieren, und die Prüfung der Synthese fand einen Formfehler in der Bilanzzeile. Das Survey zur Multi-Agent-Debatte (Quellen unten) sagt dazu das Erwartbare: Debatten helfen bei Aufgaben mit prüfbarer Wahrheit (Mathematik, Code, Fakten) und sind bei offenen Bewertungsaufgaben auf schwache Stellvertreter wie LLM-as-a-judge angewiesen, mit dem bekannten Risiko gegenseitiger Bestätigung. Ein Review-Dokument ist eine offene Bewertungsaufgabe.

### Reicht es, der Empfehlung zu folgen?

Ja, unter drei Bedingungen, und damit wird aus „Empfehlung folgen" eine Regel, die nachts trägt.

Erstens wird die Empfehlung als Entscheidung protokolliert, nicht als Frage: gewählter Weg, verworfene Alternative, Grund, Rückbaukosten. Das ist dein eigenes Konzept des Entscheidungs-Backlogs, nur dass die Nacht es schreibt.

Zweitens ist die Entscheidung morgens umkehrbar. Nachts wird nichts gepusht; ein Plan, ein Paket, ein Commit lassen sich zurücknehmen. Der Stop-Punkt Push bleibt, wo er ist, und bekommt eine neue Aufgabe: Er ist der Moment, in dem du die Entscheidungen der Nacht bestätigst oder eine davon kippst.

Drittens gibt es eine kurze, geschlossene Liste von Fragen, die die Nacht nicht entscheiden darf (die Stopp-Klasse, siehe Abschnitt 8). Alles, was nicht auf dieser Liste steht, wird entschieden. Die Liste ist bewusst kurz: Wer sie lang macht, hat den heutigen Apparat wieder gebaut.

Was dabei mit deiner These A1 („Die KI entscheidet nicht") passiert, steht in Abschnitt 11. Kurz: Sie bleibt richtig, wenn man „entscheiden" als „verbindlich machen" liest. Verbindlich wird nachts nichts.

---

## 7. Wie andere es machen

GitHub Spec Kit hat die Regel, die dem Kit fehlt, wörtlich in seiner Vorlage: „Make informed guesses based on context and industry standards. Only mark with [NEEDS CLARIFICATION] if the choice significantly impacts feature scope or user experience. Maximum 3 [NEEDS CLARIFICATION] markers total." Alles andere wird als Annahme in einen Abschnitt „Assumptions" geschrieben. Der Klärungsschritt stellt höchstens fünf Fragen je Sitzung, sortiert nach Auswirkung mal Unsicherheit, und schließt „trivial stylistic preferences, or plan-level execution details" ausdrücklich aus. Der Unterschied zum Kit ist nicht die Idee, sondern die Obergrenze: drei Marker statt „jeder Fund ohne Klasse".

Amazon Kiro stellt Klärungsfragen einmal, am Anfang, und läuft dann durch: „No intermediate approvals, no step-by-step confirmation." Das Ergebnis ist ein Pull Request, der am Ende steht: „You review a merge-ready result, not a first draft." Das ist genau die Verschiebung des bewussten Akts von „vorher" nach „am Ende", die Abschnitt 6 vorschlägt.

Anthropics Harness für lang laufende Agenten trennt Planer, Generator und Evaluator in eigene Kontexte, hält den Zustand in einer Feature-Liste und Fortschrittsdateien, und lässt den Evaluator gegen feste Kriterien entscheiden, wann etwas fertig ist. Zwei Punkte sind übertragbar: Der Evaluator ist ein anderer Kontext als der Generator (das hast du mit dem fremden Modell schon), und er entscheidet nach Kriterien, nicht nach Geschmack, ohne einen Menschen zu rufen.

Der Ralph-Wiggum-Loop (inzwischen offizielles Claude-Code-Plugin) ist die radikalste Form: derselbe Prompt in einer Schleife, Abbruch durch ein Fertig-Signal oder eine maximale Iterationszahl, Wahrheit kommt aus Tests und Git-Historie. Er kennt keine Rückfrage, weil er keine Stelle hat, an der man sie stellen könnte. Sein Sicherheitsnetz ist die Obergrenze, nicht die Vorsicht.

Zur Frage, ob mehr Reviewer bessere Reviews ergeben, gibt das aktuelle Survey zu Multi-Agent-Debatten (Juli 2026) eine ernüchternde Antwort: Das Feld hat sich „by convention rather than systematic comparison" auf ein Muster festgelegt, Belege für eine optimale Zahl von Agenten oder Runden fehlen, und bei homogenen Rollen drohen vorzeitige Konvergenz und geteilte Fehler.

---

## 8. Neuentwurf: die Nacht-Kette

### Sechs Grundsätze

1. Eine Nacht, eine Kette. Ein Fachplan geht abends hinein, morgens liegen Plan, Pakete, Commits und ein Bericht vor. Kein Label je Stufe, keine Freigabe zwischen den Stufen.
2. Entscheiden statt fragen. Jede Unklarheit außerhalb der Stopp-Klasse wird entschieden und protokolliert.
3. Reviewer liefern Input, Werkzeuge entscheiden. Ein Modell-Befund ist ein Vorschlag an den Autor der Stufe; ob eine Stufe fertig ist, sagt ein Kommando (Formprüfung, Tests, Gates).
4. Deterministisches Ende. Jede Stufe endet mit „fertig" (Kommando grün), „angehalten" (genau eine Stopp-Frage) oder „abgebrochen" (Budget erschöpft). Der Zustand „wartet auf Mensch" gibt es mitten in der Kette nicht mehr.
5. Budget statt Runden. Zeit, Kosten und Korrekturrunden je Stufe sind Zahlen in der Config, keine Prosa im Skill.
6. Alles, was die Nacht entschieden hat, steht morgens an einer Stelle.

### Der Ablauf

**Abend, Mensch, zehn Minuten.** Der Fachplan ist gegroomt (interaktiv, wie heute; die PO-Schleife ist der Schritt, an dem dein Urteil den größten Hebel hat) und bekommt das Label `kit:night`. Das ist die einzige Geste der Nacht.

**Schritt 1, Plan erzeugen.** `/techplan` unbeaufsichtigt, mit einer neuen Regel für den Abschnitt `## Offene Fragen`: Er heißt nachts `## Entscheidungen der Nacht` und ist nie leer, wenn es etwas zu entscheiden gab. Format je Eintrag:

```
- E1: <Frage in einem Satz>
  Gewählt: <Weg>. Verworfen: <Alternative>. Grund: <ein Satz, Bezug auf Fachplan, Bestand oder Prioritätenordnung>. Rückbau: <trivial | eine Datei | Migration>.
```

Trifft die Frage die Stopp-Klasse, endet die Kette hier mit genau dieser einen Frage am Fachplan; der Plan bleibt als Entwurf stehen. Formprüfung durch `board.mjs plan-check` (die heutigen `[maschinell]`-Gates P1, P2, P3, P4, P6, P12 als Kommando). Ein Reviewer (Rolle „Senior, der den Bestand kennt": stimmen die Behauptungen über den Code, was bricht, was fehlt im Zuschnitt) liefert Befunde; die Autor-Session arbeitet sie ein oder lehnt sie mit einem Satz ab. Eine Runde, kein Marker, keine Klassen. Danach ist der Plan fertig.

**Schritt 2, Pakete erzeugen.** `/issues` unbeaufsichtigt, Kongruenzprüfung gegen den Fachplan wie heute, Formprüfung per Kommando (vier Abschnitte, Abhängigkeiten als `#N`). Kein Modell-Review je Paket. Unklarheiten werden in `## Kontext` als `Entscheidung: …` mit demselben Format festgehalten.

**Schritt 3, Implementierung.** Wie heute, das funktioniert. Frische Session je Paket, Build-Gates entscheiden. Neu: Eine Implementierungs-Session, die auf eine Entscheidung stößt, entscheidet nach demselben Format und schreibt sie in den Abschlussbericht; der heutige Halt mit `kit:klaeren` bleibt nur für die Stopp-Klasse.

**Schritt 4, Code-Review.** Schritt 7 des Whitepapers, nachts: fremdes Modell auf den Diff, die Session behebt, was sie behebt, höchstens zwei Runden. Was nach zwei Runden offen ist, steht im Bericht.

**Morgen, Mensch, dreißig Minuten.** Ein Kommentar am Fachplan (oder eine Seite im Leitstand des kanban-kit, den du gerade ohnehin baust) fasst zusammen: Stand der Kette, alle Entscheidungen der Nacht in einer Liste, abgelehnte Reviewer-Befunde mit Grund, Gates je Paket, Commits, offene Stopp-Frage falls vorhanden. Du liest die Entscheidungsliste, testest, und dann gilt wie heute: `push main` oder `git reset`. Das Kippen einer Entscheidung ist ein Satz am Fachplan und eine neue Nacht.

### Die Stopp-Klasse

Nur diese Fragen halten die Kette an, und jede mit genau einer Frage:

1. Datenverlust oder eine Migration ohne Rückweg.
2. Sicherheit: Rechte, Authentifizierung, Geheimnisse, Netzzugriff.
3. Verträge nach außen: eine Schnittstelle, die jemand anderes nutzt.
4. Ein Widerspruch im Fachplan selbst (zwei Akzeptanzkriterien schließen sich aus).
5. Eine Änderung an Gates, Stop-Punkten oder am Prozess (W1 bis W4).

Alles andere, ausdrücklich auch Randfälle, Namensfragen, Fehlerpfade, Reihenfolgen und die Frage, welcher Test gemeint ist, wird entschieden. Die Prioritätenordnung (Sicherheit, Korrektheit, Datenintegrität, …) ist dabei der Schiedsrichter, und der kleinste rückbaubare Eingriff gewinnt im Zweifel.

### Abbruchregeln, mechanisch

Zeitbudget je Stufe (Vorschlag: Plan 20 Minuten, Pakete 15, Implementierung 60 je Paket, Code-Review 15 je Paket), Kostenbudget je Kette, höchstens zwei Korrekturrunden je Dokument, eigener Worktree je Kette (deine Idee #571, sie beseitigt die harten Stopps durch liegengebliebene Dateien). Ein Abbruch ist ein Ausgang mit Grund, kein Fehler des Prozesses.

### Kennzahlen, damit die Diskussion nicht über Gefühle läuft

Je Nacht: Durchlaufquote (Ketten, die bis In review kamen), Stunden von `kit:night` bis zum letzten Commit, Zahl der Entscheidungen je Kette, Zahl der Stopp-Fragen, und die eine Zahl, die alles trägt: Wie viele Entscheidungen der Nacht hast du morgens gekippt. Wenn diese Quote nahe null bleibt, ist der Prozess bewiesen; steigt sie, weißt du, welche Entscheidungsklasse in die Stopp-Klasse gehört. Das ist die empirische Fassung deines „99,9 Prozent".

### Zwei Varianten für das GO

Variante A bleibt beim Whitepaper: Das GO gilt je Arbeitspaket. Die Nacht erzeugt Plan und Pakete, morgens ziehst du in zehn Minuten nach Ready, die zweite Nacht implementiert. Zwei Nächte statt vier, und W1 bleibt unverändert.

Variante B verschiebt das GO nachts eine Ebene nach oben: Ready gilt für den Fachplan. Eine Nacht, alles durch, morgens der Push-Stop-Punkt. Das ist eine bewusste Änderung der Körnung von W1, nicht seiner Existenz, und ich empfehle sie, weil du auf LinkedIn ohnehin schon so beschreibst, was dein Entscheidungspunkt ist („die Auswahl, welche Tickets im nächtlichen Lauf implementiert werden"), und weil das Ziehen von dreizehn Paketen nach Ready in der Praxis kein Urteil über die Pakete ist, sondern eine Wiederholung des Urteils über den Plan.

---

## 9. Konkrete Änderungen am Kit, in dieser Reihenfolge

1. **Stopp-Klasse und Entscheidungsformat** in `CLAUDE-workflow.md` (ein Abschnitt, zwanzig Zeilen), referenziert aus `/techplan`, `/issues`, `/implement-next`. Das ist die Regel, die alles andere trägt, und sie lässt sich morgen einführen, ohne den Runner anzufassen: `/techplan` unbeaufsichtigt schreibt Entscheidungen statt offener Fragen.
2. **`issue-review` auf den Kern kürzen**: eine Rolle je Stufe, Befunde als Kommentar, Einarbeiten durch die Autor-Session, keine Klassen, keine Synthese, kein Abgleich, keine Synthese-Prüfung, kein Marker als Gate. Zielgröße unter 150 Zeilen. Die Vorfallsgeschichten wandern in `docs/`, wenn sie jemand braucht.
3. **Formgates als Kommando**: alle `[maschinell]`-Gates aus `CLAUDE-Fachplan.md` und `CLAUDE-Plan.md` nach `board.mjs check-form <id>`. Die `[Urteil]`-Gates werden Hinweise im Reviewer-Prompt, nie Stopps.
4. **`night.mjs`: ein Modus `--kette`** statt drei Modi, mit Worktree, Budgets und Nachtbericht. Routing-Labels auf eines reduzieren, Rundengrenze und Marker-Gate entfernen. Der Implementierungsmodus bleibt, wie er ist.
5. **Arbeitspaket-Review streichen**, `requiredBeforeReady` und `Pruefung:`/`Pruefung-Stand:`/Verfall entfernen. Wer ein Paket geprüft haben will, ruft `/issue-review #N` tagsüber.
6. **`CLAUDE-workflow.md` halbieren**, wie in `prozess-pruefstand.md` (P2) schon vorgeschlagen; die Drift-Stellen dort gleich mit.
7. **Kennzahlen** in den Nachtbericht und in `/retro`.

Was unangetastet bleibt: die drei Stop-Punkte als Prinzip, das Commit-Gate, `/review` mit fremdem Kontext, die Build-Gates, das Vier-Abschnitt-Issue, die PO-Schleife am Fachplan.

---

## 10. Was am Whitepaper zu ändern wäre (v1.3)

Kapitel 8.3 braucht den Satz, der heute fehlt: Was unbeaufsichtigt läuft, trifft Annahmen und dokumentiert sie in einem festen Format; nur eine benannte Stopp-Klasse hält an. „Ohne Rückfrage umsetzbar" bleibt das Schnittkriterium und bekommt eine Definition.

Anti-Pattern 9 sollte ausdrücklich auf Dokument-Reviews ausgedehnt werden: Ein Modell-Review eines Plans oder Issues ist Zuarbeit, kein Gate; ein Marker, den ein Modell setzt, darf keine Stufe freigeben. Die Implementierung hat genau das gebaut, und das Whitepaper hat es nicht verboten, weil es diese Reviews nicht kannte.

Die Stop-Punkte bleiben drei. Für den Nachtbetrieb sollte das Papier sagen, auf welcher Ebene das GO liegt (Variante A oder B), und dass der Push-Stop-Punkt morgens die Entscheidungen der Nacht mit umfasst.

---

## 11. Konflikt mit deinen Thesen, benannt

A1 sagt „Die KI entscheidet nicht", A5 „Senior-Qualität im Artefakt, nicht im Urteil". Der Neuentwurf lässt die Nacht Dinge entscheiden. Der Widerspruch löst sich, wenn man deine eigene Abgrenzung zu A2 liest: „Kontrolle heißt, dass die Freigabe ein bewusster Akt bleibt. Gerade wenn der Output gut ist." Die Nacht macht nichts verbindlich; verbindlich wird es beim Push. Was sich verschiebt, ist der Zeitpunkt des bewussten Akts, nicht sein Vorhandensein. Kiro formuliert dieselbe Verschiebung mit „merge-ready result, not a first draft".

Der heutige Apparat verstößt dagegen gegen drei deiner Thesen: gegen B3 („Leitplanken müssen scheitern können, nicht argumentieren"), weil die Prüfkette ausschließlich argumentiert; gegen Anti-Pattern 9, weil Modell-Marker Stufen freigeben; und gegen die Abgrenzung zu C6 („Nicht mehr Dokument, sondern mehr Klärung"), weil jeder Review vier neue Dokumente erzeugt (Befunde, Vorschlag, Synthese, Abgleich) und die Klärung an einen Menschen zurückgibt.

Wenn du A1 wörtlich halten willst, bleibt Variante A mit einem zusätzlichen Satz: Die Nacht schlägt vor und implementiert gegen ihre eigenen Vorschläge; entschieden ist erst, was du morgens nach Ready oder nach main ziehst. Das ist inhaltlich dasselbe und rhetorisch näher an der These.

---

## 12. Die beiden Beispiele, durchgespielt

**Vorhaben löschen.** Fachplan wie #815. Die Nacht schreibt in den Plan: „E1: Sichtbarkeit eines ausgeblendeten Vorhabens nach Wiederherstellung. Gewählt: behält seinen Zustand. Verworfen: wird sichtbar. Grund: kleinster Eingriff, kein Kriterium im Fachplan verlangt anderes. Rückbau: trivial." Ein Reviewer prüft den Plan gegen den Bestand, findet zum Beispiel, dass die Rechte-Matrix zwei verschiedene Rechte kennt, die Session arbeitet es ein. Pakete, Implementierung, Gates, Code-Review. Morgens steht E1 im Bericht; du nickst oder schreibst „sichtbar" an den Fachplan. Die Frage, ob eine Karte zwei Vorhaben haben könnte, taucht nicht auf, weil die Formregel lautet: Behauptungen über den Bestand werden nachgeschlagen, nicht erfunden; wer sie erfindet, erfindet keine Alternative, sondern einen Fehler, und den fängt der Bestands-Reviewer.

**Leere Vorhaben automatisch löschen.** Das ist mit dem Neuentwurf ein Fachplan von fünf Zeilen mit einem Akzeptanzkriterium („Ein Vorhaben ohne zugeordnete Karten verschwindet von der Vorhaben-Seite"). Die Nacht entscheidet: „E1: endgültig löschen oder in den Papierkorb. Gewählt: Papierkorb. Grund: Datenintegrität vor Bequemlichkeit (W4), Rückweg bleibt. E2: Zeitpunkt. Gewählt: beim Archivieren der letzten Karte, nicht per Zeitplan. Grund: kein neuer Hintergrundjob, Verhalten ist am Auslöser prüfbar." Morgens liest du zwei Zeilen. Wenn du „nein, sofort löschen" willst, ist das ein Satz am Fachplan. Zwei Tage werden daraus nicht.

---

## Quellen

- Whitepaper v1.2: https://mwolff.org/whitepapers/whitepaper-ki-entwicklungsprozess-v1.2.pdf
- Dokumentation des Kits: https://docs.mwolff.org/dokumentation.html
- GitHub Spec Kit, Vorlage `specify`: https://github.com/github/spec-kit/blob/main/templates/commands/specify.md
- GitHub Spec Kit, Vorlage `clarify`: https://github.com/github/spec-kit/blob/main/templates/commands/clarify.md
- GitHub Spec Kit, Methodik: https://github.com/github/spec-kit/blob/main/spec-driven.md
- Kiro, autonomer Agent: https://kiro.dev/autonomous-agent
- Anthropic, Harness für lang laufende Agenten (InfoQ, April 2026): https://infoq.com/news/2026/04/anthropic-three-agent-harness-ai/
- Ralph-Wiggum-Plugin für Claude Code: https://github.com/anthropics/claude-code/blob/main/plugins/ralph-wiggum/README.md
- Multi-Agent Debate Strategies: Survey, Taxonomy, and Challenges (arXiv 2607.26212): https://arxiv.org/html/2607.26212
- Agentic Coding in the Wild: Characterizing GitHub Copilot at Production Scale (arXiv 2608.00101): https://arxiv.org/html/2608.00101v1
