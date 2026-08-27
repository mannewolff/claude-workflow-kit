# Anforderung: Spec-Speicher für das claude-workflow-kit

Diese Datei ist die Anforderung für Schritt 1. Sie ist als Eingabe für `/plan` gedacht.
Sie beschreibt, was gebaut werden soll, und sie legt fest, was ausdrücklich nicht dazugehört.

Stand: August 2026. Zielrepo: claude-workflow-kit.

---

## 1. Das Problem

Ein Sprachmodell, das ein bestehendes Feature ändern soll, muss wissen, wie sich das
System heute verhält. Diese Information steht heute nur im Code und in den Tests.
Also liest das Modell Code, und zwar bei jedem Plan neu.

Das hat drei Kosten. Es füllt das Kontextfenster mit Material, das schon einmal
verstanden wurde. Es rekonstruiert Verhalten aus Implementierung, was systematisch
schiefgeht, wo die Implementierung mehr kann als beabsichtigt. Und es liefert keine
Antwort auf die Frage, warum etwas so ist, weil der Code die Begründung nicht enthält.

Das Issue beschreibt eine Änderung. Die Konventionsdatei beschreibt Regeln. Der Vault
beschreibt Entscheidungen. Keines dieser Artefakte beschreibt den Zustand.

## 2. Ziel

Ein durchsuchbarer Speicher im Repo, der das aktuelle fachliche Verhalten des Systems
beschreibt, beim Merge fortgeschrieben wird und im Build scheitern kann.

Messbares Ziel: `/plan` liest für Bestandsverhalten keinen Produktionscode mehr. Wo es
das doch tut, weist es die Stelle als Spec-Lücke aus.

## 3. Nicht-Ziele

Diese Punkte gehören nicht in diese Umsetzung. Wer sie mitbaut, hat die Anforderung
verfehlt.

- Kein Code aus der Spec generieren. Die Spec beschreibt, sie erzeugt nichts.
- Keine Spec pro Codedatei und keine Eins-zu-eins-Abbildung auf Klassen.
- Kein vierter Stop-Punkt. Der Spec-Merge hängt am bestehenden dritten.
- Keine neue Plattform, kein drittes Kit, kein Dienst. Dateien im Repo und ein Node-Skript.
- Keine Spec-Bearbeitung im Board. Das Board zeigt, es hält nicht. Siehe Abschnitt 12.
- Kein Rückkanal vom Board ins Repo. Die Veröffentlichung läuft in eine Richtung.
- Keine Embeddings, keine Vektordatenbank in dieser Ausbaustufe.
- Keine Migration der 500 Bestands-Issues in Specs. Warum nicht, steht in Abschnitt 11.
- Der Name `spec-kit` ist von GitHub belegt. Er wird hier nicht verwendet.

## 4. Begriffe

**Spec.** Eine Markdown-Datei unter `specs/`, die einen fachlichen Fähigkeitsbereich
beschreibt. Maximal eine Bildschirmseite.

**Spec-Aussage.** Ein einzelner, prüfbarer Satz über das Verhalten, mit einer stabilen
ID der Form `BEREICH-N`.

**Spec-Wirkung.** Ein Abschnitt im Issue, der sagt, welche Spec-Aussagen dieses Issue
hinzufügt, ändert oder streicht.

**Spec-Merge.** Der Vorgang, bei dem die Spec-Wirkung der gemergten Issues in die
Spec-Dateien eingearbeitet wird.

**Reifegrad.** Eine Spec ist `entwurf` oder `gueltig`. Das Gate greift nur bei `gueltig`.

## 5. Die drei Speicher

Nach der Umsetzung gibt es drei Speicher mit drei getrennten Fragen. Diese Trennung ist
die tragende Entscheidung der ganzen Anforderung.

| Speicher | Beantwortet | Wird geschrieben | Wächst |
|---|---|---|---|
| `specs/` | Was gilt heute? | Beim Merge, konsolidiert | Nein, wird umgeschrieben |
| `issues/archive/` | Warum ist es so geworden? | Beim Merge, unverändert | Ja, wird nie gepflegt |
| Vault | Was wurde wann entschieden? | Beim Session-Ende | Ja |

`specs/` ist klein und gepflegt. Das Archiv ist groß und wird nur durchsucht.

Das kanban-kit ist kein vierter Speicher. Es ist eine Projektion von `specs/` und dem
Archiv, damit Menschen ohne Klon lesen können, was gilt. Abschnitt 12 beschreibt sie.

## 6. Dateiformat einer Spec

Pfad: `specs/<bereich>/<name>.md`

```markdown
---
id: AUTH
titel: Anmeldung und Sitzung
bereich: auth
reifegrad: gueltig        # entwurf | gueltig
stand: 2026-08-13
grundstock: 12             # AUTH-1 bis AUTH-12 stammen aus dem bootstrap
                           # und werden vom Replay in Abschnitt 12 nicht geprüft
code:                      # Glob-Muster, gegen die der Drift-Bericht prüft
  - src/main/java/**/auth/**
  - frontend/src/features/auth/**
aliase: [login, anmelden, token, sitzung]
issues: [312, 340, 401]
---

## Zweck
Wofür es diesen Bereich gibt, in zwei bis drei Sätzen, in PO-Sprache.

## Verhalten
AUTH-1  Eine Anmeldung mit gültigen Daten liefert ein Token mit der Rolle USER.
AUTH-2  Nach fünf Fehlversuchen ist das Konto zehn Minuten gesperrt.
AUTH-3  Ein abgelaufenes Token führt zu Statuscode 401 mit dem Fehlercode TOKEN_EXPIRED.

## Grenzen
Was dieser Bereich ausdrücklich nicht tut, und was woanders geregelt ist.

## Abhängigkeiten
Andere Spec-IDs, auf deren Verhalten dieser Bereich aufbaut, oder "Keine".
```

Regeln für Aussagen:

1. Eine Aussage ist ein Satz und beschreibt beobachtbares Verhalten. Keine Implementierung.
2. IDs werden nie wiederverwendet. Eine gestrichene Aussage bleibt gestrichen, ihre Nummer
   auch. Streichungen stehen am Ende der Datei unter `## Entfallen` mit Datum und Issue.
3. Eine Aussage, die kein Test referenziert, ist keine Aussage. Sie fliegt raus oder
   bekommt einen Test.
4. Wenn eine Spec länger wird als eine Bildschirmseite, ist der Bereich zu groß geschnitten.
5. `grundstock` hält die höchste Nummer, die aus dem bootstrap stammt. Alles darüber muss
   sich aus einem Issue herleiten lassen. Der Wert wird einmal gesetzt und danach nie erhöht.

## 7. Erweiterung des Issue-Formats

Das Issue bekommt einen fünften Abschnitt. Er steht hinter den Akzeptanzkriterien.

```markdown
## Spec-Wirkung
NEU       AUTH-7  Nach fünf Fehlversuchen ist das Konto zehn Minuten gesperrt.
GEAENDERT AUTH-2  Das Token trägt zusätzlich die Rolle PENDING.
ENTFAELLT AUTH-5
```

Zulässig ist außerdem genau eine Zeile:

```markdown
## Spec-Wirkung
KEINE     Ändert kein beobachtbares Verhalten.
```

Diese Zeile ist der Normalfall für Refactorings, Build-Änderungen und die meisten
SonarQube-Befunde. Sie ist keine Ausrede, sie ist eine Aussage, die im Review geprüft wird.

Die IDs vergibt `/issues` beim Anlegen des Issues, indem es die höchste vergebene Nummer
des Bereichs aus `specs/` liest. Zwei parallel angelegte Issues dürfen dieselbe Nummer
nicht bekommen; `spec.mjs check` erkennt Kollisionen.

## 8. Das Werkzeug: `.claude/kit/spec.mjs`

Ein Node-Skript ohne Abhängigkeiten außerhalb der Standardbibliothek, aufgerufen aus dem
Wurzelverzeichnis des Projekts. Es benutzt kein Sprachmodell. Alle Befehle sind
deterministisch und wiederholbar.

| Befehl | Wirkung | Ausgabe |
|---|---|---|
| `index` | Erzeugt `specs/INDEX.md` aus allen Frontmattern | Datei, eine Zeile je Spec |
| `search <begriff>` | Volltextsuche über `specs/` und `issues/archive/` | Treffer mit Datei, Aussage-ID, Zeile |
| `show <id>` | Gibt eine Spec oder eine einzelne Aussage aus | Markdown |
| `check` | Das Gate, siehe Abschnitt 9 | Exitcode 0 oder 1, Befundliste |
| `drift` | Bereiche, in denen Code sich bewegt hat und die Spec nicht | Liste, immer Exitcode 0 |
| `affected <datei>...` | Welche Specs betreffen diese Dateien? | Spec-IDs |
| `apply <issue-nr>...` | Wendet die Spec-Wirkung auf die Spec-Dateien an | Diff-Vorschlag, schreibt erst nach Bestätigung |
| `archive import` | Holt abgeschlossene Issues über den Adapter nach `issues/archive/` | Anzahl importierter Dateien |
| `publish` | Veröffentlicht die Specs im Board, siehe Abschnitt 12 | Anzahl übertragener Aussagen |
| `bootstrap --area <glob>` | Erzeugt einen Spec-Entwurf aus vorhandenen Tests | Datei mit `reifegrad: entwurf` |

Zu `index`: `specs/INDEX.md` ist maschinell erzeugt und wird nie von Hand editiert. Eine
Zeile je Spec mit ID, Titel, Zweck in einem Satz und den Aliasen. Ziel ist eine Datei, die
klein genug bleibt, um sie bei jedem Session-Start vollständig zu laden. Bei mehr als
hundert Specs wird der Index nach Bereichen gruppiert ausgegeben.

Zu `search`: Textsuche reicht in der ersten Ausbaustufe. Sie sucht in Aussagen, Zweck,
Titel und Aliasen, gewichtet Treffer in `specs/` höher als im Archiv und gibt maximal
zwanzig Treffer zurück. Wenn diese Suche das erste Mal erkennbar danebenliegt, ist der
lokale Embedding-Index der nächste Schritt und bis dahin YAGNI.

Zu `archive import`: Der Import läuft über `board.mjs`, nicht über eine eigene
Plattformanbindung. Er schreibt je Issue eine Datei `issues/archive/<nr>-<slug>.md` mit dem
vollständigen Body und dem Abschlussdatum im Frontmatter. Der Import ist idempotent.
Vorhandene Dateien werden nicht überschrieben.

Zu `bootstrap`: Der einzige Befehl, der Verhalten aus dem Bestand ableitet. Er liest die
Testnamen und Testfälle des angegebenen Bereichs und schlägt daraus Aussagen vor. Das
Ergebnis ist immer `reifegrad: entwurf` und trägt keinen Test-Verweis. Ein Mensch macht
daraus `gueltig`, oder es bleibt Entwurf.

## 9. Das Gate

`spec.mjs check` wird als Kommando in `buildChecks` aufgenommen und prüft fünf Dinge:

1. Jede Aussage einer Spec mit `reifegrad: gueltig` wird von mindestens einem Test
   referenziert.
2. Jeder Test-Verweis zeigt auf eine existierende Aussage. Verwaiste Verweise sind Fehler.
3. Keine doppelt vergebene Aussage-ID.
4. Keine Spec-Wirkung in einem gemergten Issue ohne entsprechende Änderung in `specs/`.
5. `specs/INDEX.md` ist aktuell.
6. Mit `--replay`: Jede Aussage oberhalb von `grundstock` lässt sich aus der Spec-Wirkung
   eines archivierten Issues herleiten. Abschnitt 12.3 beschreibt das Verfahren.

Punkt 1 ist der Kern. Er ist der Grund, warum diese Spec nicht driftet, und er ist der
Unterschied zu jedem Dokument, das nur behauptet.

Wie ein Test auf eine Aussage verweist, hängt vom Stack ab und steht in der Config:

```json
"spec": {
  "testPattern": "\\[([A-Z]+-[0-9]+)\\]",
  "testGlobs": ["src/test/**/*.java", "frontend/src/**/*.test.tsx"]
}
```

Für Java also `@DisplayName("[AUTH-2] sperrt nach fünf Fehlversuchen")`, für JavaScript
`it("[AUTH-2] sperrt nach fünf Fehlversuchen", ...)`. Eine Annotation ist die sauberere
Lösung und die aufwendigere. Der Testname reicht.

`drift` ist kein Gate. Er vergleicht die geänderten Dateien der letzten N Tage gegen die
`code`-Globs der Specs und meldet Bereiche, in denen sich Code bewegt hat, ohne dass sich
die Spec bewegt hat. Die Liste ist ein Tagesordnungspunkt der KI-Retrospektive.

## 10. Änderungen an den Skills

| Skill | Änderung |
|---|---|
| `/kontext` | Lädt zusätzlich `specs/INDEX.md`. Meldet, wenn der Index älter ist als die jüngste Spec. |
| `/plan` | Liest den Index, lädt über `spec.mjs affected` und `search` nur die betroffenen Specs. Liest Produktionscode für Bestandsverhalten erst, wenn die Spec die Frage nicht beantwortet, und weist jede solche Stelle im Plan unter "Spec-Lücken" aus. |
| `/issues` | Erzeugt den Abschnitt Spec-Wirkung, vergibt die Aussage-IDs, verweigert ein Issue ohne diesen Abschnitt. |
| `/issue-review` | Der Prüfer mit dem Auftrag "Scope und Bestand" bekommt die betroffenen Specs dazu und beantwortet zusätzlich: Welche bestehende Aussage bricht dieses Issue, ohne dass es dasteht? |
| `/implement-*` | Lädt Issue plus die in der Spec-Wirkung genannten Specs. Schreibt den Test-Verweis auf die Aussage-ID in den Testnamen. |
| `/merge-production` | Ruft nach dem erstellten Pull Request `spec.mjs apply` für die betroffenen Issues auf und legt den Diff zur Bestätigung vor. Danach `spec.mjs index`, `spec.mjs archive import` und `spec.mjs publish`. |
| `/retro` | Legt die Drift-Liste vor. |

Neuer Skill `/spec` für die Handarbeit: eine Spec anlegen, eine Aussage schärfen, einen
Bereich neu schneiden. Grenze: Er ändert nie eine Spec mit `reifegrad: gueltig`, ohne den
Diff vorzulegen, und er setzt nie selbst einen Reifegrad auf `gueltig`.

Der Nacht-Runner bekommt eine zusätzliche Leitplanke, analog zum Präfix `[Fachlich]`: Ein
Issue ohne Abschnitt Spec-Wirkung wird kommentiert ins Backlog zurückgestellt. Nachts ist
niemand da, der die Wirkung nachtragen könnte.

## 11. Migration: 500 Issues und ein Bestandssystem

Das sind zwei Migrationen mit sehr unterschiedlichen Kosten. Sie gehören getrennt.

### 11.1 Das Archiv: mechanisch, ein Lauf

`spec.mjs archive import` holt die 500 abgeschlossenen Issues über den Adapter und legt sie
als Dateien ab. Kein Modell, keine Prüfung, kein Urteil. Das läuft einmal, dauert Minuten
und ist danach durchsuchbar.

Damit ist die Frage "Warum ist das so geworden?" ab dem ersten Tag beantwortet, ohne dass
jemand einen Text angefasst hat. Das ist der billigste Teil des ganzen Vorhabens und der
mit der schnellsten Wirkung.

### 11.2 Die Specs: nicht aus den 500 Issues

Der naheliegende Weg wäre, die 500 Issues durchzugehen und daraus Specs zu bauen. Er ist
falsch, und zwar aus einem Grund, der sich nicht wegarbeiten lässt: Issue 12 ist von Issue
340 überschrieben worden. Die Summe aller Issues ergibt nicht den Ist-Zustand, sie ergibt
die Historie. Wer 500 Issues zusammenfasst, bekommt ein Dokument, das an vielen Stellen
beschreibt, was einmal galt, und das ist schlimmer als gar keine Spec.

Die Quelle für den Ist-Zustand sind die grünen Tests. Sie beschreiben das aktuelle
Verhalten, und sie sind wahr, solange der Build grün ist. Bei einem Projekt mit hoher
Testabdeckung und hohem Mutation Score ist das eine gute Quelle. Ergänzend der Code, wo die
Tests schweigen, und die fachlichen Issues, wo es um Absicht geht.

### 11.3 Die Reihenfolge: nach Änderungshäufigkeit, nicht nach Vollständigkeit

Eine Spec zahlt sich in dem Moment aus, in dem der nächste Plan den Bereich anfasst. Ein
Bereich, den seit einem Jahr niemand angefasst hat, braucht heute keine Spec.

Also: `git log` auswerten, die Bereiche nach Änderungshäufigkeit der letzten sechs Monate
sortieren und von oben abarbeiten. Zwanzig Prozent der Bereiche decken erfahrungsgemäß den
größten Teil der Änderungen ab.

Der Rest wächst faul nach, über eine Regel im Skill: Berührt `/plan` einen Bereich ohne
Spec, entsteht zuerst ein Issue "Spec für Bereich X erstellen", und erst danach der Plan.
Das kostet einmal Zeit und nie wieder.

### 11.4 Die Umsetzung läuft durch den eigenen Prozess

Jede Spec ist ein Issue. Vier Abschnitte, Akzeptanzkriterium maschinell prüfbar:

```
Kontext:        Bereich auth wird häufig geändert, es gibt keine Spec.
Aufgabe:        spec.mjs bootstrap --area src/**/auth/** ausführen, den Entwurf
                gegen die vorhandenen Tests durchgehen, Aussagen formulieren.
Akzeptanz:      specs/auth/anmeldung.md existiert, spec.mjs check --area auth
                meldet keine Befunde, reifegrad ist entwurf.
Out of Scope:   Keine Änderung an Produktionscode. Keine Tests ergänzen.
                Reifegrad bleibt entwurf.
Abhängigkeiten: Keine
```

Diese Issues sind gute Nacht-Issues, weil sie eindeutig sind und keinen Produktionscode
anfassen. Fünf pro Nacht, morgens durchgehen. Bei zwanzig Bereichen sind das vier Nächte
Maschinenarbeit und vier Vormittage Lesearbeit.

Die Lesearbeit ist der eigentliche Aufwand, und sie lässt sich nicht delegieren. Ein
Entwurf, den niemand gelesen hat, ist eine Behauptung des Modells über den Code. Genau
deshalb steht `reifegrad: entwurf` in der Vorlage, und deshalb setzt kein Skill ihn hoch.

### 11.5 Warum der Reifegrad die Migration überhaupt möglich macht

Ohne die Unterscheidung `entwurf` und `gueltig` müsste am Tag der Einführung jede Aussage
einen Test-Verweis haben, sonst bricht der Build. Bei einem Bestandssystem heißt das
entweder wochenlanger Stillstand oder ein abgeschaltetes Gate, und ein abgeschaltetes Gate
kommt nie wieder an.

Mit dem Reifegrad greift das Gate am ersten Tag, und zwar auf einer leeren Menge. Es wächst
mit jedem Bereich, den ein Mensch auf `gueltig` setzt. Ein Bereich wird gültig, wenn seine
Aussagen gelesen sind und die Test-Verweise stehen. Das Hochstufen ist der Moment, in dem
die Spec verbindlich wird, und es ist eine menschliche Handlung.

### 11.6 Stichtag statt Nacharbeit

Für Bestands-Issues wird keine Spec-Wirkung nachgetragen. Die Regel gilt ab dem Tag der
Einführung für neu angelegte Issues. Alte Issues bleiben, wie sie sind, und sind über das
Archiv durchsuchbar.

### 11.7 Abbruchkriterium

Wenn nach zehn migrierten Bereichen `/plan` immer noch regelmäßig Produktionscode für
Bestandsverhalten liest, stimmt der Schnitt der Specs nicht, und es hilft nicht, mehr davon
zu schreiben. Dann wird der Schnitt überarbeitet, bevor der elfte Bereich entsteht. Die
Zahl der Spec-Lücken aus den Plänen ist die Messgröße dafür.

## 12. Das Board als Spec-Viewer

Eine PO-Rolle liest kein Repo, und ein Stakeholder erst recht nicht. Das kanban-kit ist der
Ort, an dem diese Menschen ohnehin hinsehen. Es bekommt deshalb eine Spec-Ansicht.

Die Richtung ist einseitig. Das Repo schreibt, das Board zeigt.

### 12.1 Warum das Board die Spec nicht hält

Drei Gründe, und jeder für sich reicht.

Der Prozess läuft gegen GitHub Projects, GitLab und den lokalen Modus. Läge die Spec im
Board, wäre das Board keine Option mehr, sondern eine Voraussetzung.

Eine Spec im Board ist nicht im Diff. Sie läuft nicht durch das Review, das der Code
durchläuft, und beim Pull Request sieht niemand, dass sich eine Verhaltensaussage geändert
hat.

Das Gate braucht die Datei. `spec.mjs check` prüft Aussage gegen Test im Arbeitsverzeichnis.
Ein Build, der dafür eine API befragen muss, hat eine Netzabhängigkeit bekommen.

### 12.2 Was veröffentlicht wird

`spec.mjs publish` läuft im Schritt 9 nach `apply` und `index`. Es überträgt über `tbx.mjs`
die vollständige Menge der Specs des Projekts: Bereich, Aussage-ID, Text, Reifegrad,
`grundstock`, die Issue-Nummern je Aussage und den Stand.

Der Aufruf ist idempotent und überträgt immer alles. Auf Board-Seite wird nicht gemergt,
sondern ersetzt. Damit gibt es keinen Zustand, der nur im Board existiert.

Zeigt `issueTracker` nicht auf das kanban-kit, tut `publish` nichts und meldet das einmal.
Das ist derselbe Degraded Mode wie beim fehlenden Vault.

### 12.3 Der Replay

Sobald die Spec-Wirkung im Issue steht, sind die Tickets ein Journal. Das Board liest alle
Issues eines Bereichs in Merge-Reihenfolge, wendet NEU, GEAENDERT und ENTFAELLT nacheinander
an und vergleicht das Ergebnis mit der veröffentlichten Spec.

Weichen beide ab, hat jemand eine Spec-Datei von Hand geändert, ohne dass ein Issue
dahinterstand. Der Replay ist deterministisch und braucht kein Modell.

Zwei Grenzen gehören dazu. Er rechnet nur über Aussagen oberhalb von `grundstock`, weil
Bootstrap-Aussagen keine Buchung haben. Und er rechnet nur über Issues ab dem Stichtag aus
Abschnitt 11.6, weil ältere Issues keine Spec-Wirkung tragen.

Dieselbe Rechnung läuft lokal über `spec.mjs check --replay`. Ob sie ein Gate wird oder ein
Bericht bleibt, steht in Abschnitt 15.

### 12.4 Die vier Ansichten

**Spec-Tab je Projekt.** Bereiche links, Aussagen rechts, Volltextsuche darüber.

**Aussage mit Herkunft.** Klick auf eine Aussage zeigt die Issues, die sie erzeugt und
geändert haben, mit Datum, einschließlich der archivierten Karten.

**Änderungsrate je Aussage.** Dieselbe Mechanik, mit der das Board Verweildauern misst,
angewendet auf Aussagen. Eine Aussage, die viermal umformuliert wurde, zeigt einen fachlich
unklaren Bereich an.

**Reifegrad je Bereich.** Wie viele Aussagen beschrieben, wie viele davon gültig und
testgedeckt. Das ist der Fortschrittsbalken der Migration aus Abschnitt 11.

### 12.5 Die Nicht-Funktion

Im Board lässt sich keine Spec bearbeiten. Kein Stift, kein Feld, keine Ausnahme für
Administratoren. Wem eine Aussage nicht passt, der legt ein Issue an.

Das ist dieselbe Regel wie "Die Verhandlung läuft im Body", und sie hält die Spec bei genau
einem Schreiber.

### 12.6 Was dafür im kanban-kit entsteht

Eine Tabelle für Spec-Aussagen mit Projekt, Bereich, ID, Text, Reifegrad, Quell-Issues und
Stand. Ein Endpunkt, der die vollständige Menge je Projekt setzt, gebunden an dasselbe
projektgebundene Token wie die übrigen Kit-Operationen. Ein Tab in der Oberfläche, der
ausschließlich liest.

Das ist ein eigenes Vorhaben im kanban-kit und nicht Teil des Kits. Es hängt hinten, weil
alles davor auch ohne Board funktioniert.

## 13. Akzeptanzkriterien der Gesamtumsetzung

1. `spec.mjs index`, `search`, `show`, `check`, `drift`, `affected`, `apply`,
   `archive import` und `bootstrap` laufen ohne externe Abhängigkeiten und ohne Modell.
2. `spec.mjs check` steht in `buildChecks` und bricht bei Verstößen mit Exitcode 1 ab.
3. Ein Issue ohne Abschnitt Spec-Wirkung wird von `/issues` nicht erzeugt und vom
   Nacht-Runner nicht bearbeitet.
4. Ein Merge über `/merge-production` führt zu einem vorgelegten Spec-Diff, einem
   aktualisierten Index und archivierten Issues.
5. `/plan` gibt bei jedem Lauf eine Liste der Spec-Lücken aus, auch wenn sie leer ist.
6. Der Prozess läuft weiter, wenn es kein `specs/`-Verzeichnis gibt. Alle Skills melden das
   einmal und arbeiten wie bisher. Das ist derselbe Degraded Mode wie beim fehlenden Vault.
7. Die Spec-Dateien eines mittelgroßen Bereichs plus Index passen zusammen in ein
   Kontextfenster, ohne dass Code geladen werden muss.
8. `spec.mjs publish` ist idempotent, überträgt immer die vollständige Menge und tut nichts,
   wenn kein kanban-kit konfiguriert ist.
9. Die Spec-Ansicht im Board bietet keinen Weg, eine Aussage zu ändern. Ein Schreibversuch
   über die API auf einem anderen Weg als `publish` wird abgelehnt.
10. `spec.mjs check --replay` meldet eine von Hand geänderte Spec-Datei und meldet nichts
    für Aussagen unterhalb von `grundstock`.

## 14. Vorgeschlagene Umsetzungsreihenfolge

Sieben Schritte, jeder einzeln nutzbar. Nach Schritt 3 hat der Prozess schon einen Nutzen,
auch wenn nichts davon verdrahtet ist.

1. Dateiformat und Beispiel-Spec festlegen, `spec.mjs index` und `search` bauen.
2. `spec.mjs archive import` bauen, die 500 Issues importieren.
3. `/kontext` und `/plan` auf Index und Suche umstellen, Spec-Lücken ausgeben.
4. Issue-Format um die Spec-Wirkung erweitern, `/issues` und `/issue-review` anpassen.
5. `spec.mjs apply` bauen, `/merge-production` erweitern.
6. `spec.mjs check` bauen, in `buildChecks` aufnehmen, Test-Verweise im Pilotbereich setzen.
7. `bootstrap` und `drift` bauen, die Migration nach Abschnitt 11 fahren.
8. `check --replay` bauen, sobald genug Issues mit Spec-Wirkung gemergt sind.
9. `publish` bauen und die Spec-Ansicht im kanban-kit, als eigenes Vorhaben dort.

## 15. Offene Entscheidungen

Diese Punkte entscheidet ein Mensch, bevor der Plan geschrieben wird. Sie sind nicht
technisch.

1. Test-Verweis über den Testnamen oder über eine Annotation? Der Testname ist billiger,
   die Annotation ist stabiler gegen Umformulierungen.
2. Liegen die Specs bei `issueTracker: local` im selben Verzeichnisbaum wie die Issues oder
   getrennt? Getrennt ist klarer, weil die eine Sorte Dateien wächst und die andere nicht.
3. Wird `spec.mjs check` sofort ein Pflicht-Check oder erst nach dem ersten gültigen
   Bereich? Ein Gate, das drei Wochen lang nichts prüft, gewöhnt niemanden an etwas.
4. Werden gestrichene Aussagen in der Datei behalten oder nur im git-Verlauf? Behalten
   kostet Kontextfenster, streichen kostet die Antwort auf die Frage, warum etwas
   verschwunden ist.
5. Wird `check --replay` ein Pflicht-Check oder bleibt es ein Bericht für die
   KI-Retrospektive? Als Gate erzwingt es, dass jede Verhaltensänderung durch ein Issue
   gegangen ist. Das ist genau der Zweck, und es macht die schnelle Korrektur an einer
   Formulierung unmöglich, ohne ein Issue anzulegen.
