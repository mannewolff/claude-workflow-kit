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

Zwei Eingaenge, und nur zwei: der Chat (`/task <Anforderung>`) oder eine `[Idee]` (`/task #N`; Body **und** Kommentare lesen). `/task` ist die Bahn ohne Abwaegungsbedarf, und die Idee hat zwei Wege: Verlangt sie eine Abwaegung, ist `/fachplan #N` der Weg; ist nichts abzuwaegen oder hat der Mensch bereits entschieden, `/task #N`. Welcher Fall vorliegt, entscheidet der Mensch mit dem Aufruf — der Skill weist eine Idee mit Abwaegung **nicht** ab, weil er das nicht entscheiden kann; die Abgrenzung steht hier, damit sie beim Aufruf bekannt ist.
Jede andere Nummer lehnt der Skill mit einer Meldung ab und legt nichts an; die Meldung nennt das Praefix. Traegt `#N` `[Fachlich]` oder `[Plan]`, ist dort der volle Weg bereits begonnen — der Weg nach vorn ist `/techplan #N` bzw. `/issues #N`.

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

`## Abhängigkeiten` als **letzter** Abschnitt — `parseDeps` in `kit/night.mjs` setzt das voraus. `Autor-Modell:` entsteht aus `KIT_AGENT_MODEL`, sonst aus der Selbstauskunft der Session, sonst woertlich `unbekannt`; die Zeile fehlt nie. Ist `night.stufen` aktiv, traegt der Kontext-Abschnitt zusaetzlich `Aufgabenstufe: <schwer|mittel|leicht>` und `Stufengrund: <ein Satz>` nach der Regel aus `/issues`, Abschnitt 4 — der Wortlaut steht dort, nicht hier noch einmal; ohne aktive Einstellung aendert sich am Skill nichts. Und wie jedes Arbeitspaket traegt der Kontext-Abschnitt die Zeile `Sitzungsumfang: passt | reisst — <ein Satz>` nach derselben Regel aus `/issues`, Abschnitt 2: zwei Werte und ein Satz, keine geschaetzte Minutenzahl und keine dritte Zwischenstufe, Massstab die Zeitgrenze einer Sitzung aus `--timeout-min` und ausdruecklich nicht gemeint `night.kette.umsetzungMin`, das Budget der ganzen Stufe — vor demselben GO steht derselbe Leser.

**Keine `Plan:`- und keine `Fachliche Quelle:`-Zeile.** Ein `[Task]` hat keinen Vorfahren; die Idee ist der Anlass, nicht der Vorfahr.

**Liegt die Aufgabe ausserhalb des Repositories, heisst das Praefix `[Mensch]` statt `[Task]`.** Gemeint ist eine Handlung, die kein Zug einer Sitzung ausfuehren kann: eine Einstellung in einer Weboberflaeche, ein Konto, ein Zugang, eine Freigabe. Am Body aendert sich nichts — dasselbe Vier-Abschnitt-Format, dieselbe Stufe `issue` bei `issue check-form`; die Aufgabe beschreibt die Handlung, das Akzeptanzkriterium, woran der Mensch erkennt, dass sie getan ist. Nur umsetzen wird es niemand ausser ihm: `implement-*` und der Nacht-Runner stellen ein `[Mensch]`-Paket kommentiert ins Backlog zurueck, ohne eine Session zu starten. Ohne das Praefix startete der Runner eine Session, die den Fall richtig erkennt und nichts tut — eine richtige Untaetigkeit, die er nicht von einem Fehlschlag unterscheiden kann. Konvention „Geschuetzte Datei“: Nennt die Anforderung zusaetzlich eine Aenderung an einem geschuetzten Pfad (`GESCHUETZTE_PFADE` in `kit/board.mjs`), wird diese als eigene `[Mensch]`-Karte herausgetrennt, und der `[Task]` nennt sie unter `## Abhaengigkeiten` als `Issue #N`; eine Aenderung an der installierten Kopie statt an der Quelle ist falsch geschnitten — `issue check-form` weist beides ab (I8, I9), Einzelheiten in `/issues`, Abschnitt 2. Konvention „Dateien in Backticks“: `## Aufgabe` nennt die geaenderten Dateien als Backtick-Token, sonst weist `issue check-form` ab (I7).

**Guetemess-Konvention:** Der Abschnitt `## Akzeptanzkriterium` ruft **keine Guetemessung** auf — kein `mutationCommand`, kein Kommando eines `buildChecks`-Eintrags mit `guete`-Block und keins aus dem Config-Feld `guetekommandos`. Eine Mutationspruefung laeuft einmal je Veroeffentlichung an ihrer Stufe, nicht einmal je Paket: In der Runde kostet sie Zeit, die dem Paket fehlt, und ein Vollauf sprengt das Rundenzeitlimit. Wo die Guete fuer ein Paket zaehlt, steht sie als Marke in der Konfiguration, nicht als Zeile in der Karte. `issue check-form` weist ein Paket ab, dessen Akzeptanzkriterium eines dieser Kommandos nennt (I6).

**Die Konvention gilt ohne Ausnahme — auch fuer das Paket, das den Mess-Treiber selbst baut.** Genau dort ist die Versuchung am groessten: Die Config kennt den Treiber noch nicht, also schweigt I6, und ein echter Vollauf wandert als Nachweis ins Kriterium. In kanban-kit #1215 waren es drei Vollaeufe, weit ueber eine Stunde; der Code war nach 15 Minuten fertig, die Runde starb an der Nachweiszeile. Was das Kriterium belegt, sind **Tests auf Fixtures oder abgelegten Berichten** — dass der Treiber wirklich durchlaeuft, steht unter `### Manuelle Pruefung (Mensch, nicht Teil des Session-Abschlusses)`, nie im Akzeptanzkriterium. Und **keine `Entscheidung:`-Zeile hebt die Konvention auf**: Eine Zeile im `## Kontext`, die einen Vollauf oder eine Guetemessung mit `Gewaehlt: ja` ins Paket holt, weist `issue check-form` als I6-Verstoss ab. Ein Treiber, den das Projekt erst baut, gehoert mit seinem Kommando-Praefix ins Config-Feld `guetekommandos` — dann greift I6, bevor er existiert.

### 4. Anlegen

Nach der Transportregel aus `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board": Der Body entsteht stueckweise per Shell ausserhalb des Projektverzeichnisses, jedes Stueck hoechstens 6.000 Zeichen und ein **eigener** Werkzeugaufruf mit woertlichem Pfad, dann geht er in einem Aufruf ans Board. Bleibt `printenv TMPDIR` leer (Git Bash unter Windows), gilt `cygpath -m "$TEMP"`:

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

**Die `hinweise` aus `check-form` und `create` werden gelesen.** Vor dem Anlegen laeuft `node .claude/kit/board.mjs issue check-form --body-file <tmpdir>/neues-issue.md --title "[Task] <Titel>"`; erst bei `ok: true` folgt `issue create`. Jede lokale `#N` im Abschnitt `## Abhängigkeiten` zaehlt als Abhaengigkeit, auch in Erlaeuterungen; nur eine Verweiszeile (`Issue #N` am Zeilenanfang, keine weitere Nummer) ist als solche gemeint. Das JSON beider Aufrufe kann den Schluessel `hinweise` tragen: Ein Eintrag mit `art: schreibweise` nennt eine Nummer aus erlaeuterndem Text, ein Eintrag mit `art: dokument` einen Verweis auf ein `[Plan]`-, `[Fachlich]`- oder `[Idee]`-Dokument, das nicht durch Umsetzung erledigt wird. Beide beruehren weder `ok` noch den Exit-Code. Ist die Nummer nicht gemeint, wird der Text vor dem Anlegen korrigiert — die Nummer verlaesst den Abschnitt oder wandert in den `## Kontext` —, und `check-form` laeuft erneut; meldet erst `create` den Hinweis, geht die Korrektur per `issue update <id> --body-file <tmpdir>/neues-issue.md` an die Karte. Ist sie gemeint, bleibt der Text, und der Abschluss nennt den Hinweis mit der Nummer. Unbeaufsichtigt gilt dasselbe ohne Rückfrage — auch wenn dieser Skill dort heute in Schritt 0 endet.

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
