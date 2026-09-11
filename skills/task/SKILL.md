---
name: task
description: Überführt eine Anforderung ohne Abwägungsbedarf in genau ein Arbeitspaket mit dem Titel-Präfix [Task] — ohne Fachkonzept, ohne Plan, ohne Zerlegung. Nutze diesen Skill wenn der Nutzer /task aufruft oder eine Anforderung oberhalb der Kleinigkeit umsetzen will, bei der es nichts abzuwägen gibt.
user-invocable: true
---

# Task

Zwischen Kleinigkeit und vollem Vorhaben fehlte ein Weg: Bahn 1 verlangt genau eine Datei,
Bahn 2 verlangt Fachkonzept, Plan und Zerlegung. Eine Umbenennung über zwölf Dateien ist
für die eine zu groß und für die andere zu eindeutig — der Mensch hatte nur die Wahl
zwischen zu viel und zu wenig.

Dieser Skill macht die dritte Bahn verfügbar. Er **ersetzt die Schritte 2 und 3** und
trägt deshalb keine Prozessnummer: Der `[Task]`-Weg ist kein zusätzlicher Schritt neben
dem vollen, er tritt an dessen Stelle. Was danach kommt — Prüfung, GO, Implementierung,
Review, Push — ist unverändert der normale Weg.

**`/task` ist ein eigener Skill**, kein Zweig in `/techplan` und kein Modus in `/issues`.
`/techplan` erzeugt Pläne, `/issues` zerlegt einen Plan in mehrere Pakete. Ein `[Task]` ist
genau ein Paket und hat keinen Plan.

## Ablauf

### 0. Den Weg benennen und bestätigen lassen

**Unbeaufsichtigt** (gesetztes `KIT_AGENT_MODEL`): Der Skill endet hier mit der Meldung,
dass der `[Task]`-Weg eine menschliche Bestätigung braucht, und legt **nichts** an.
**Kein Rückfall** „unbeaufsichtigt gilt der Weg als bestätigt": Nachts antwortet niemand,
und eine Bahnwahl, die sich selbst bestätigt, ist keine Wahl mehr. Wer den Vorgang nachts
festhalten will, nimmt `/techplan` — der hält ein Bahn-3-Urteil als Plan fest und legt die
Entscheidung dem Menschen vor.

**Interaktiv:** Der Skill sagt in zwei Sätzen, warum der Vorgang ein `[Task]` ist, und
wartet auf die Bestätigung. Erst danach entsteht etwas. Zwei Angaben gehören hinein:

- **welche Bahn-1-Regel der Vorgang verfehlt** — mehr als eine Datei, mehr als ein Modul,
  ein berührtes Datenmodell, mehr Aufwand als ein Commit;
- **was es nicht abzuwägen gibt** — abzuwägen gibt es etwas, wenn mehrere vertretbare Wege
  offenstehen. Eine Feststellung mit genau einem richtigen Ausgang ist keine Abwägung.

Bleibt die Bestätigung aus, endet der Skill, ohne etwas anzulegen. Das ist der Stop-Punkt
dieses Wegs: Er spart Fachkonzept und Plan ein, und was dabei eingespart wird, ist genau
die Gelegenheit, an der ein Mensch sonst widerspräche.

### 1. Anforderung aufnehmen

Zwei Eingänge sind zulässig, und nur zwei.

**Aus dem Chat.** `/task <Anforderung>` — die Anforderung steht im Gespräch.

**Aus einer `[Idee]`.** `/task #N` gegen eine Karte mit dem Titel-Präfix `[Idee]`: Sie ist
eine rohe Anforderung, kein begonnener Weg, und damit ein zulässiger Eingang. Die Idee
wird vollständig gelesen, Body **und** Kommentare.

**Jede andere Nummer lehnt der Skill mit einer Meldung ab und legt nichts an.** Trägt `#N`
das Präfix `[Fachlich]` oder `[Plan]`, ist dort der volle Weg bereits begonnen — ein
`[Task]` daneben wäre eine zweite Wahrheit darüber, was gebaut wird. Auch ein Arbeitspaket
und ein vorhandener `[Task]` sind keine Quelle. Die Meldung nennt das Präfix:

> „#N trägt `[Fachlich]` — dort ist der volle Weg bereits begonnen. `/task` nimmt nur den
> Chat oder eine `[Idee]` als Quelle. Es wurde nichts angelegt."

Für ein `[Fachlich]`-Issue ist `/techplan #N` der Weg nach vorn, für ein `[Plan]`-Dokument
`/issues #N`.

### 2. Bestand lesen

Lies die betroffenen Dateien und vorhandene Muster. Suche aktiv nach wiederverwendbaren
Funktionen — neuer Code, für den es schon eine passende Stelle gibt, ist der häufigste
vermeidbare Befund.

**Trägt `.claude/workflow.config.json` einen Top-Level-Block `spec`, gilt dieselbe
Rangfolge wie in `/techplan` Schritt 2:** Die Beschreibung unter `specs/` ist die **erste**
Quelle — zuerst `specs/INDEX.md`, dann die Specs der betroffenen Bereiche. Produktionscode
kommt als Quelle für Bestandsverhalten **erst, wenn** die geladenen Specs die Frage nicht
beantworten. Wer eine Datei ändern will, sieht sie sich weiterhin an; die Rangfolge
betrifft die Frage, *wie sich der Bestand heute verhält*.

**Keine Vorhaben-Notiz auf diesem Weg.** Die Notiz aus `spec.mjs vorhaben` hängt am Planen
und am Plandokument — genau das spart der `[Task]`-Weg ein. Es entsteht hier also weder
eine wartende Notiz noch ein Eintrag unter `specs/vorhaben/`.

### 3. Den Body im Vier-Abschnitt-Format schreiben

Dieselben Abschnitte wie jedes Arbeitspaket aus `/issues`, in dieser Reihenfolge:

```markdown
## Kontext
Warum wird diese Aufgabe gemacht? Was fehlt vorher, welche Vorgeschichte gehört dazu?

Autor-Modell: <wert>

## Aufgabe
Was konkret ist zu tun? Betroffene Dateien, zu schreibende Tests, konkrete Änderungen.

## Akzeptanzkriterium
Wie wird verifiziert, dass die Aufgabe erledigt ist? Konkret, messbar oder ausführbar.

## Spec-Wirkung
Was ändert das Paket an der Beschreibung unter specs/? Nur bei gesetztem spec-Block.

## Abhängigkeiten
Keine. (oder: Issue #N muss vorher fertig sein)
```

Dabei bleibt `## Abhängigkeiten` als **letzter** Abschnitt stehen — `parseDeps` in
`kit/night.mjs` setzt das voraus. `## Spec-Wirkung` entsteht nur bei gesetztem `spec`-Block; ohne ihn gilt
das Vier-Abschnitt-Format unverändert.

**Der Wert von `Autor-Modell:`** entsteht in drei Stufen: `KIT_AGENT_MODEL`, sofern nicht
leer — sonst die Selbstauskunft der Session — und nur, wenn beides nicht zu ermitteln ist,
wörtlich `unbekannt`. Die Zeile wird nie weggelassen; `board.mjs issue create` legt seit
Issue #266 kein Issue ohne sie an.

**Keine `Plan:`- und keine `Fachliche Quelle:`-Zeile.** Ein `[Task]` hat keinen Vorfahren:
Es gibt kein Plandokument, aus dem er geschnitten wurde, und keine fachliche Anforderung,
aus der er stammt. Die Zeilen zu erfinden behauptete eine Kette, die es nicht gibt — und
eine spätere Sitzung suchte vergeblich nach dem Dokument, auf das sie zeigen. Auch der
Eingang aus einer `[Idee]` ändert daran nichts: Die Idee ist der Anlass, nicht der Vorfahr,
und die Spur zu ihr läuft in die andere Richtung (siehe Schritt 4).

**Die ID-Vergabe im Abschnitt `## Spec-Wirkung`** folgt der Konvention aus `/issues`
(Abschnitt „Spec-Wirkung: der fuenfte Abschnitt"): Grammatik, ID-Form und die Regel, aus
welchen Quellen die nächste Nummer entsteht, stehen dort und werden hier nicht wiederholt.
Zwei Fassungen derselben Regel wären zwei Wahrheiten über die Nummernvergabe, und die
falsche fiele erst am Gate auf.

### 4. Anlegen

Der Body entsteht stückweise per Shell **außerhalb des Projektverzeichnisses**, dann geht
er in **einem** Aufruf ans Board:

```bash
printenv TMPDIR
```

```bash
cat  > <tmpdir>/neues-issue.md <<'TEIL1'
## Kontext
...

Autor-Modell: <wert>

## Aufgabe
...
TEIL1
```

```bash
cat >> <tmpdir>/neues-issue.md <<'TEIL2'
… weitere Stuecke, je hoechstens 6.000 Zeichen …
TEIL2
```

```bash
node .claude/kit/board.mjs issue create --title "[Task] <Titel>" --author-model "<wert>" --body-file <tmpdir>/neues-issue.md
```

Jeder Block ist ein **eigener** Werkzeugaufruf, und der Pfad steht woertlich — die Grenze
von 6.000 Zeichen gilt je Aufruf, und eine Variable im Redirect-Ziel wird unbeaufsichtigt
abgewiesen. Warum, steht in `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board".
**Scheitert ein Dateischritt**, wird die unvollstaendige Datei nicht uebertragen; scheitert
der Board-Aufruf, meldet der Skill den Fehler mit dem Pfad der Datei und endet ohne weitere
Mutation.

**Das Anlegen geht ohne `--derived-from` — immer.** Die Option trägt die Kartennummer des
nächsten Vorfahren als Feld ans Board (Issue #356). Ein `[Task]` hat keinen Vorfahren, und
ein Verweis von hier aus zeigte entweder ins Leere oder auf eine fremde Karte. `/techplan`
setzt die Option auf das fachliche Issue, `/issues` auf das Plandokument, `/fachplan` und
`/task` setzen sie nie — aus verschiedenen Gründen: Die fachliche Anforderung ist die
Wurzel einer Kette, ein `[Task]` steht in gar keiner.

**Nach dem Anlegen `label-sync`:**

```bash
node .claude/kit/board.mjs issue-review label-sync <id>
```

Ein frisches Dokument ist ungeprüft; das Kommando setzt `review:offen`. Ohne den Aufruf
trägt es gar kein Zustandslabel und fällt in der Board-Ansicht aus der Reihe.

**Die Spur zurück zur Quell-Idee.** Ist der `[Task]` `#T` über den Eingang `/task #N`
gegen eine `[Idee]` entstanden, hängt der Skill genau einen Kommentar an die Idee `#N`:

```bash
node .claude/kit/board.mjs issue comment <N> --text "Fortsetzung: Issue #T"
```

Dasselbe Muster, das `/fachplan` für einen angehaltenen `[Task]` führt. Lieferte
`issue create` statt einer Nummer eine `ideaId`, gibt es kein `#T`, auf das der Kommentar
zeigen könnte; er lautet dann `Fortsetzung: Idee <ideaId> (noch nicht eingeplant)`. Ohne
Argument `#N` entfällt der Aufruf **ersatzlos**.

**Sonderfall Toolbox-/kanban-kit-Tracker (Ideen-Pool):** Liefert `issue create` statt einer
Nummer `{ ideaId, pending: true }`, liegt der `[Task]` als board-lose Idee im
Projekt-Ideen-Pool. Der Skill meldet dann die `ideaId` und weist darauf hin, dass der
Mensch ihn erst einplanen muss — vorher existiert keine Nummer, unter der er adressierbar
wäre. `label-sync` entfällt in diesem Fall ersatzlos.

**Fehlerfall:** Schlägt das Anlegen fehl, meldet der Skill **weder eine Nummer noch einen
erfolgreichen Abschluss**. Ein Paket, das nirgends steht, ist kein angelegtes Paket.

### 5. Abschluss

Melde Nummer (bzw. `ideaId`) und Titel und den weiteren Weg:

> „Der Task ist angelegt und liegt in **Backlog**. Lass ihn mit `/issue-review #N` prüfen;
> danach ziehst du ihn nach Ready — das ist dein GO."

Der Status bleibt **Backlog**. Die Bewegung nach Ready ist das menschliche GO.

## Ein `[Task]`, der einen Befund ablehnt

Ein häufiger Fall für diesen Weg: Ein Werkzeug meldet einen Befund, der Befund ist
vertretbar abgelehnt, und die Ablehnung soll halten. Dafür gilt eine feste Form.

**Das Akzeptanzkriterium ist die versionierte Unterdrueckungsregel**, die das prüfende
Werkzeug selbst auswertet, mit der Begründung unmittelbar daneben. Beides gehört zusammen
und hat verschiedene Leser: Das Werkzeug liest die Regel, die Begründung richtet sich an
Menschen und spätere Sitzungen. Eine Ablehnung, die nur im Web-UI des Werkzeugs als
„accepted" markiert ist, hält nicht — der nächste gleichartige Fund entsteht außerhalb
und muss von Hand nachgezogen werden.

Das Beispiel steht im Bestand: `sonar-project.properties` führt den Ausschluss der Regel
`javascript:S4036` als versionierte Zeile, und darüber steht ausgeschrieben, warum er
vertretbar ist.

**Dieser Weg deckt nur vorhandene Mechanismen ab.** Fehlt einem Werkzeug ein
versionierbarer Weg, gehört dessen Entwicklung in ein eigenes Vorhaben — sie ist keine
Ablehnung mehr, sondern ein Bau. Ein werkzeugübergreifendes Register entsteht nicht: Es
wäre eine zweite Liste neben den Regeldateien der Werkzeuge, die keines von ihnen liest.

**Verifiziert** wird ein solcher `[Task]` durch einen erneuten Lauf desselben Werkzeugs.
Zwei Beobachtungen gehören dazu, und die zweite ist die wichtigere: Der abgelehnte Befund
bleibt aus, **und ein unabhängiger Kontrollbefund wird weiterhin gemeldet**. Ohne den
Kontrollbefund ist ein stummes Werkzeug von einem wirksamen Ausschluss nicht zu
unterscheiden.

## Stop-Punkte

- **Kein Anlegen ohne Bestätigung** — weder interaktiv noch unbeaufsichtigt. Unbeaufsichtigt
  endet der Skill in Schritt 0 und legt nichts an.
- **Kein Code, kein Commit.** Dieser Skill schreibt ein Arbeitspaket, er setzt es nicht um.
- **Keine Ready-Bewegung.** Ready heißt freigegeben; das ist das GO des Menschen.
- **Kein `[Fachlich]`- und kein `[Plan]`-Dokument als Quelle** — dort ist der volle Weg
  bereits begonnen.
