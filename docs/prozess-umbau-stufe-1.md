# Prozess-Umbau, Stufe 1: handlungsfähig werden

Stand: 2026-09-13. Grundlage: `prozess-pruefstand-nachtlauf.md` (Abschnitte 8 und 9)
und die Arbeitsliste `prozess-pruefstand.md` vom 2026-09-10. Dieses Dokument ist der
Umsetzungsplan; die Diagnose steht dort und wird hier nicht wiederholt.

Der Umbau hat zwei Stufen. **Stufe 1** schreibt Regeln und Skills um, damit der
`[Task]`-Weg und die Kette Fachplan → Plan → Pakete ohne den Prüfapparat laufen.
`kit/night.mjs` und die Review-Kommandos in `kit/board.mjs` bleiben dabei unangetastet.
**Stufe 2** baut die Nacht-Kette (`night.mjs --kette`) und räumt den dann toten Code ab.
Sie bekommt einen eigenen Fachplan, wenn Stufe 1 durch ist.

## Prämisse

Die Regel, die alles trägt, ist die Stopp-Klasse mit dem Entscheidungsformat. Sie kommt
als erstes Paket in `CLAUDE-workflow.md`; jeder umgeschriebene Skill verweist nur noch
dorthin. Die Umsetzung der Pakete läuft über den Implementierungsmodus des Nacht-Runners
oder interaktiv über `/implement-next`. Das ist der Teil des Runners, der funktioniert.

**Bereits erledigt (Bahn 1, 2026-09-13):** drei Config-Zeilen in
`.claude/workflow.config.json`, ohne die der Runner jeden `[Task]` ohne
`Issue-Review:`-Marker zurückstellt.

| Feld | vorher | jetzt |
|---|---|---|
| `issueReview.requiredBeforeReady` | true | false |
| `issueReview.statusLabels` | true | false |
| `reviewStufen.plan.reviewer` | 2 | 1 |

## Der neue Skill `/task`

Was bleibt: genau ein Paket, Präfix `[Task]`, Vier-Abschnitt-Format plus Spec-Wirkung,
Eingang aus dem Chat oder einer `[Idee]`, keine `Plan:`- und keine
`Fachliche Quelle:`-Zeile, kein `--derived-from`, Ablage im Backlog, Ready bleibt das GO.
Der Abschnitt zum abgelehnten Werkzeug-Befund bleibt.

Was sich ändert:

- **Entscheiden statt fragen.** Jede Unklarheit außerhalb der Stopp-Klasse entscheidet
  der Skill selbst und schreibt sie als `Entscheidung:` in den Kontext, im festen Format
  aus `CLAUDE-workflow.md`. Nur eine Frage aus der Stopp-Klasse geht an den Menschen.
- **Die Bahnwahl wird ein Satz.** Der Skill nennt die Bahn in einer Zeile und wartet
  auf ein Wort. Die zwei Pflichtangaben und die lange Begründung entfallen.
- **Kein Review-Schritt.** Kein `label-sync`, kein Hinweis auf `/issue-review`, keine
  `Pruefung:`-Zeilen. Der Abschluss lautet: liegt in Backlog, Ready ist das GO. Wer
  prüfen lassen will, ruft `/issue-review #N` selbst.
- **Zielgröße unter 120 Zeilen** statt 247. Vorfallsverweise und Transportmechanik
  werden auf einen Verweis auf `CLAUDE-workflow.md` reduziert.

Unverändert und bewusst nicht in Stufe 1: `/task` läuft nur interaktiv. Nachts entsteht
kein `[Task]`, weil die Nacht-Kette Stufe 2 ist.

## Die Pakete in Reihenfolge

Alle Pakete sind `[Task]`. T1 und T2 werden noch mit dem alten `/task` angelegt, alle
weiteren mit dem neuen.

### Welle 1: Grundlage

Vier Pakete. T1 zuerst, die drei anderen unabhängig voneinander.

1. **T1 Regelwerk.** Neuer Abschnitt „Entscheiden statt fragen" in
   `templates/CLAUDE-workflow.md`: die Punkte der Stopp-Klasse (bei Stufe 1 fünf, seit Issue #685 sechs), das
   Entscheidungsformat, der Satz, dass ein Modell-Review Zuarbeit und kein Gate ist. Der
   Absatz „Vor dem GO gehört ein Dokument geprüft" wird auf Fachplan und Plan beschränkt.
2. **T2 Skill `/task` neu**, wie oben beschrieben. Tests `skills-task` anpassen.
3. **T3 Halt in `/implement-next` und `/implement-ready`.** Der wortgleiche Abschnitt
   „Ein [Task], bei dem Abwaegungsbedarf auftaucht" wird ersetzt: Die Session entscheidet
   nach dem Format und schreibt die Entscheidung in den Abschlussbericht unter eine neue
   Überschrift `### Entscheidungen`. `kit:klaeren` mit Halt bleibt nur für die
   Stopp-Klasse. Die Fallunterscheidung zu `Pruefung: Verzicht` entfällt. Test
   `skills-task-halt` folgt.
4. **T8 Formgates als Kommando.** `board.mjs check-form <id>` prüft die heutigen
   `[maschinell]`-Gates F1, F2, F6, F7, F9, F11 und P1, P2, P3, P6, P12 sowie am
   Arbeitspaket die Abschnitte und die `#N`-Abhängigkeiten. JSON auf stdout, Exitcode.
   Die Register-Dateien bleiben als Text; die `[Urteil]`-Gates werden Hinweise im
   Reviewer-Prompt, nie Stopps.

### Welle 2: die Skills

Vier Pakete. Jedes hängt an T1, T5 und T6 zusätzlich an T8.

5. **T4 `/issue-review` auf den Kern.** Eine Rolle je Stufe, Befunde als Kommentar, die
   aufrufende Session arbeitet ein oder lehnt mit einem Satz ab. Keine Klassen, keine
   Synthese, kein Abgleich, keine Synthese-Prüfung, keine Rundengrenze, kein
   Nachtabschnitt. Der Marker wird nur noch als Spur geschrieben; nichts liest ihn als
   Gate. Zielgröße unter 150 Zeilen. Die Text-Tests zu gestrichenen Regeln werden
   gelöscht, der Doku-Abschnitt „Issue-Review über mehrere Modelle" wird mitgezogen.
6. **T5 `/techplan`.** `## Offene Fragen` nimmt nur noch Stopp-Fragen auf; alles andere
   wird entschieden und steht als E-Eintrag unter `## Architektonische Entscheidungen`.
   Formprüfung über `check-form` statt Prosa. Bahn 0 nachts bleibt vorerst „immer Bahn 2".
7. **T6 `/issues`.** Eingang unbeaufsichtigt ist ein `[Plan]` ohne offene Stopp-Frage;
   der `Plan-Review:`-Marker ist keine Bedingung mehr. Unklarheiten stehen als
   `Entscheidung:` im Kontext. Kein `label-sync`, kein Review-Hinweis im Abschluss.
8. **T7 `/fachplan` auf den Kern.** Story-Format und PO-Schleife im Body bleiben.
   `label-sync` und der Marker-Bezug fallen weg; der Eingang `/fachplan #T` gegen einen
   angehaltenen `[Task]` wird an die Stopp-Klasse angepasst. Der Name bleibt `/fachplan`;
   eine systemweite Umstellung auf Englisch ist eine eigene, ferne Entscheidung.

### Welle 3: Aufräumen

Zwei Pakete nach Welle 2.

9. **T9 `CLAUDE-workflow.md` halbieren** nach der Tabelle aus `prozess-pruefstand.md`:
   Prüfstufen, Zustandslabels, `Pruefung:`-Absatz, Nachtbetrieb und Gates W1 bis W4
   wandern aus. Die vier Drift-Stellen werden dabei behoben; `docs/dokumentation.md` und
   die Doku-Tests folgen.
10. **T10 Kennzahlen in `/retro`.** Die Frage nach gekippten Nachtentscheidungen und die
    Zeiten von Anforderung bis GO und von GO bis Push.

### Stufe 2, später, eigener Fachplan

`night.mjs --kette` mit Worktree, Budgets, Nachtbericht und einem einzigen Label
`kit:night`. Dann entfallen die `board.mjs`-Kommandos `synthese-check`,
`roles --rolle synthese`, `label-sync` und `reviewZustand` samt ihrer Tests, dazu die
Routing-Labels und `kit:klaeren` außerhalb der Stopp-Klasse. Die Frage Variante A oder B
für das GO gehört in diesen Fachplan, nicht in Stufe 1.

Nicht angefasst in Stufe 1: die drei Stop-Punkte, das Commit-Gate, `/review`, das
Vier-Abschnitt-Issue, `kit/night.mjs`.

## Getroffene Entscheidungen

- **`/fachplan` bleibt der Name, `[Fachlich]` das Präfix.** Entschieden am 2026-09-13.
  Eine Umbenennung kommt, wenn überhaupt, mit einer systemweiten Umstellung auf Englisch.
- **Kein siebter Abschnitt `## Entscheidungen der Nacht`.** Das Prüfstand-Dokument
  schlägt vor, `## Offene Fragen` nachts umzubenennen. Das bräche P1, P2 und `/issues`.
  Die E-Einträge sind Entscheidungen mit Begründung und passen unter
  `## Architektonische Entscheidungen`; das Format bleibt stabil.
- **Die Vorfallsgeschichten aus `issue-review` wandern nicht nach `docs/`.** Git hat sie.
- **Reviewer-Zahl: Fachplan zwei, Plan einer, Arbeitspaket einer nur auf Aufruf.** Das
  steht in `reviewStufen` und ist mit der Config-Änderung oben erledigt.
- **Toter Code bleibt bis Stufe 2.** Die Review-Kommandos in `board.mjs` und ihre Tests
  werden in Stufe 1 nicht entfernt, nur nicht mehr aufgerufen. So bleibt jeder Skill-Task
  ein reiner Textumbau plus seine Tests.
- **Die Pakete dieser Umstellung gehen ohne Paket-Review nach Ready.** Das folgt dem
  Prüfstand-Dokument (Abschnitt 6: am Arbeitspaket kein Reviewer).

## Das Entscheidungsformat

Gilt ab T1 in Plänen, Paketen und Abschlussberichten. Je Eintrag:

```
- E1: <Frage in einem Satz>
  Gewählt: <Weg>. Verworfen: <Alternative>. Grund: <ein Satz, Bezug auf Fachplan, Bestand oder Prioritätenordnung>. Rückbau: <trivial | eine Datei | Migration>.
```

Die Stopp-Klasse, und nur sie, hält an, jede Frage einzeln:

1. Datenverlust oder eine Migration ohne Rückweg.
2. Sicherheit: Rechte, Authentifizierung, Geheimnisse, Netzzugriff.
3. Verträge nach außen: eine Schnittstelle, die jemand anderes nutzt.
4. Ein Widerspruch im Fachplan selbst.
5. Eine Änderung an Gates, Stop-Punkten oder am Prozess (W1 bis W4).

Alles andere wird entschieden. Die Prioritätenordnung ist der Schiedsrichter, und der
kleinste rückbaubare Eingriff gewinnt im Zweifel.
