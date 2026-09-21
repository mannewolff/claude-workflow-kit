---
name: task
description: Überführt eine Anforderung ohne Abwägungsbedarf in genau ein Arbeitspaket mit dem Titel-Präfix [Task] — ohne Fachkonzept, ohne Plan, ohne Zerlegung. Nutze diesen Skill wenn der Nutzer /task aufruft oder eine Anforderung oberhalb der Kleinigkeit umsetzen will, bei der es nichts abzuwägen gibt.
user-invocable: true
---

# Task

Bahn 3: oberhalb der Kleinigkeit, aber ohne Abwaegungsbedarf. Dieser Skill **ersetzt die Schritte 2 und 3** und traegt deshalb keine Prozessnummer: Ein `[Task]` ist genau ein Arbeitspaket ohne Fachkonzept, ohne Plan und ohne Zerlegung. Was danach kommt — GO, Implementierung, Review, Push — ist der normale Weg.

## Ablauf

### 0. Die Bahn benennen

**Unbeaufsichtigt** (gesetztes `KIT_AGENT_MODEL`): Der Skill endet mit der Meldung, dass der `[Task]`-Weg eine menschliche Bestaetigung braucht, und legt **nichts** an. Kein Rueckfall „unbeaufsichtigt gilt der Weg als bestaetigt": Nachts antwortet niemand.

**Interaktiv:** Ein Satz — „Das ist Bahn 3: <Grund in einem Halbsatz>" — dann wartet der Skill auf ein Wort der Bestaetigung. Erst danach entsteht etwas. Bleibt sie aus, endet der Skill, ohne etwas anzulegen.

### 1. Anforderung aufnehmen

Zwei Eingaenge, und nur zwei: der Chat (`/task <Anforderung>`) oder eine `[Idee]` (`/task #N`; Body **und** Kommentare lesen). Jede andere Nummer lehnt der Skill mit einer Meldung ab und legt nichts an; die Meldung nennt das Praefix. Traegt `#N` `[Fachlich]` oder `[Plan]`, ist dort der volle Weg bereits begonnen — der Weg nach vorn ist `/techplan #N` bzw. `/issues #N`.

### 2. Bestand lesen

Betroffene Dateien und vorhandene Muster lesen, wiederverwendbare Funktionen suchen.

### Entscheiden statt fragen

Jede Unklarheit, die beim Schreiben des Pakets auftaucht und nicht in der Stopp-Klasse aus `CLAUDE-workflow.md` (Abschnitt „Entscheiden statt fragen") steht, entscheidet der Skill selbst und haelt sie in `## Kontext` fest, je Eintrag eine Zeile:

```
Entscheidung: <Frage>. Gewählt: <Weg>. Verworfen: <Alternative>. Grund: <ein Satz>. Rückbau: <trivial | eine Datei | Migration>.
```

Eine Frage aus der Stopp-Klasse stellt er dem Menschen — genau eine je Halt —, bevor etwas entsteht. Stopp-Klasse und Format stehen nur dort; der Skill wiederholt sie nicht.

### 3. Den Body schreiben

Dieselben Abschnitte wie jedes Arbeitspaket aus `/issues`, in dieser Reihenfolge:

```markdown
## Kontext
Warum wird die Aufgabe gemacht? Vorgeschichte, getroffene Entscheidungen.

Autor-Modell: <wert>

## Aufgabe
Was konkret zu tun ist: Dateien, Tests, Aenderungen.

## Akzeptanzkriterium
Wie verifiziert wird: konkret, messbar oder ausfuehrbar.

## Abhängigkeiten
Keine. (oder: Issue #N muss vorher fertig sein)
```

`## Abhängigkeiten` als **letzter** Abschnitt — `parseDeps` in `kit/night.mjs` setzt das voraus. `Autor-Modell:` entsteht aus `KIT_AGENT_MODEL`, sonst aus der Selbstauskunft der Session, sonst woertlich `unbekannt`; die Zeile fehlt nie. Ist `night.stufen` aktiv, traegt der Kontext-Abschnitt zusaetzlich `Aufgabenstufe: <schwer|mittel|leicht>` und `Stufengrund: <ein Satz>` nach der Regel aus `/issues`, Abschnitt 4 — der Wortlaut steht dort, nicht hier noch einmal; ohne aktive Einstellung aendert sich am Skill nichts.

**Keine `Plan:`- und keine `Fachliche Quelle:`-Zeile.** Ein `[Task]` hat keinen Vorfahren; die Idee ist der Anlass, nicht der Vorfahr.

### 4. Anlegen

Nach der Transportregel aus `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board": Der Body entsteht stueckweise per Shell ausserhalb des Projektverzeichnisses, jedes Stueck hoechstens 6.000 Zeichen und ein **eigener** Werkzeugaufruf mit woertlichem Pfad, dann geht er in einem Aufruf ans Board:

```bash
printenv TMPDIR
```

```bash
cat  > <tmpdir>/neues-issue.md <<'TEIL1'
## Kontext
...
TEIL1
```

```bash
cat >> <tmpdir>/neues-issue.md <<'TEIL2'
... weitere Stuecke ...
TEIL2
```

```bash
node .claude/kit/board.mjs issue create --title "[Task] <Titel>" --author-model "<wert>" --body-file <tmpdir>/neues-issue.md
```

Scheitert ein Dateischritt, wird die unvollstaendige Datei nicht uebertragen; scheitert der Board-Aufruf, meldet der Skill den Fehler mit dem Pfad und endet ohne weitere Mutation. **Kein `--derived-from`** — ein `[Task]` hat keinen Vorfahren, ein Verweis zeigte ins Leere oder auf eine fremde Karte.

**Die Spur zur Quell-Idee.** Ist der `[Task]` `#T` ueber `/task #N` entstanden, haengt der Skill genau einen Kommentar an die Idee:

```bash
node .claude/kit/board.mjs issue comment <N> --text "Fortsetzung: Issue #T"
```

Liefert `issue create` statt einer Nummer `{ ideaId, pending: true }` (Ideen-Pool des Toolbox-Trackers), liegt der `[Task]` als board-lose Idee im Pool; der Skill meldet die `ideaId`, und der Mensch plant ihn erst ein. Der Kommentar lautet dann `Fortsetzung: Idee <ideaId> (noch nicht eingeplant)`. Ohne Argument `#N` entfaellt der Kommentar ersatzlos. **Fehlerfall:** Schlaegt das Anlegen fehl, meldet der Skill **weder eine Nummer noch einen erfolgreichen Abschluss**.

### 5. Abschluss

Nummer (bzw. `ideaId`) und Titel, dann woertlich:

> „Der Task liegt in **Backlog**. Zieh ihn nach Ready — das ist dein GO. Wer ihn vorher pruefen lassen will, ruft `/issue-review #N`."

## Ein `[Task]`, der einen Befund ablehnt

Ein Werkzeug meldet einen Befund, die Ablehnung ist vertretbar und soll halten. **Das Akzeptanzkriterium ist die versionierte Unterdrueckungsregel**, die das pruefende Werkzeug selbst auswertet, mit der Begruendung unmittelbar daneben: Das Werkzeug liest die Regel, die Begruendung richtet sich an Menschen. Das Beispiel steht im Bestand: `sonar-project.properties` fuehrt den Ausschluss von `javascript:S4036` als versionierte Zeile mit der Begruendung darueber.

Fehlt einem Werkzeug ein versionierbarer Weg, gehoert dessen Entwicklung in ein eigenes Vorhaben; ein werkzeugübergreifendes Register entsteht nicht — es waere eine Liste, die kein Werkzeug liest. **Verifiziert** wird durch einen erneuten Lauf desselben Werkzeugs: Der abgelehnte Befund bleibt aus, **und ein unabhaengiger Kontrollbefund wird weiterhin gemeldet** — sonst ist ein stummes Werkzeug von einem wirksamen Ausschluss nicht zu unterscheiden.

## Stop-Punkte

- **Kein Anlegen ohne Bestaetigung** — unbeaufsichtigt endet der Skill in Schritt 0 und legt nichts an.
- **Kein Code, kein Commit.** Dieser Skill schreibt ein Arbeitspaket, er setzt es nicht um.
- **Keine Ready-Bewegung.** Ready ist das GO des Menschen. Ausnahme, ausschliesslich in der Umsetzungsstufe der Nacht-Kette unter Variante B: Dort zieht der Nacht-Runner die entstandenen Arbeitspakete selbst nach Ready. Die Ausnahme gilt dem Runner, nicht diesem Skill — keine Ready-Bewegung durch diesen Skill.
- **Kein `[Fachlich]`- und kein `[Plan]`-Dokument als Quelle** — dort ist der volle Weg bereits begonnen.
