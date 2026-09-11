---
name: fachplan
description: Überführt eine rohe Anforderung in ein fachliches Issue im Story-Format für die PO-Schleife, ohne Technik und ohne Implementierung. Nutze diesen Skill wenn der Nutzer /fachplan aufruft oder eine Anforderung erst fachlich mit einem Product Owner klären will, bevor ein technischer Plan entsteht.
user-invocable: true
---

# Fachplan

Werkzeug neben dem Prozess, vor Schritt 2 (`/techplan`): Eine rohe Anforderung (diktiert, aus einer Mail, aus dem Chat) wird in ein **fachliches Issue** überführt — die Diskussionsgrundlage für den Product Owner. Fachliche Issues beschreiben das Was und Warum, nie das Wie. Sie werden gegroomt, nie implementiert.

Die PO-Schleife ist **opt-in**: Wer keinen PO hat, überspringt diesen Skill und ruft direkt `/techplan` auf — am übrigen Prozess ändert sich nichts.

## Eingang `/fachplan #T`: ein angehaltener `[Task]` als Quelle

Ein `[Task]`, bei dem `/implement-next` oder `/implement-ready` wegen Abwaegungsbedarf angehalten haben, traegt die Entscheidung als Kommentar am Board und wartet im Backlog. Die Nummer kommt als Argument — nach demselben Muster wie `/techplan #N`: `/fachplan #T` nimmt **den Task samt Entscheidungskommentar als Eingang der Anforderung**, nicht den Chat.

1. Den Task vollstaendig lesen, Body **und** Kommentare — die aufgetauchte Entscheidung und die vertretbaren Wege stehen im Halt-Kommentar, nicht im Body.
2. Daraus die fachliche Anforderung entwickeln: Was die Entscheidung fachlich offenlaesst, wird zu Ziel, Akzeptanzkriterien und offenen Fragen an den PO. Die technischen Wege aus dem Kommentar gehen **nicht** mit — sie sind das Wie.

**Jede andere Karte wird abgelehnt.** Traegt `#T` nicht das Praefix `[Task]` oder keinen Kommentar mit dem woertlichen Folgesatz `Daraus soll per /fachplan eine fachliche Anforderung entstehen.`, endet der Skill mit der Meldung, dass `/fachplan #T` nur fuer einen angehaltenen `[Task]` gilt, und legt nichts an. Eine `[Idee]` und ein `[Fachlich]` sind keine Vorgaenger: Die eine wird per `/task` zum Arbeitspaket, das andere ist selbst die Wurzel.

## Ablauf

### 1. Anforderung fachlich verdichten

Extrahiere aus der Anforderung die fachliche Substanz. Frage nach, wenn Ziel oder Nutzen unklar sind — aber kläre nur Fachliches, keine Technik.

### 2. Genau ein fachliches Issue anlegen

Titel: `[Fachlich] <Titel>` — das Präfix ist die verbindliche Konvention, an der alle anderen Skills und der Nacht-Runner fachliche Issues erkennen.

Body im Story-Format mit vier Abschnitten:

```markdown
## Ziel
Wer braucht was, und warum? (Nutzerwirkung in PO-Sprache)

Autor-Modell: <wert>

## Fachliche Akzeptanzkriterien
Woran erkennt der PO, dass es das ist? Konkret und aus Nutzersicht prüfbar.

## Nicht-Ziele
Was gehört ausdrücklich nicht dazu? (Scope-Grenze)

## Offene Fragen an den PO
Was muss im Groomen geklärt werden?
```

**Strikt technikfrei:** keine Dateien, keine Architektur, keine Implementierungsdetails. Der Maßstab: Ein PO ohne Code-Kenntnis versteht jede Zeile.

**Die `Autor-Modell:`-Zeile gehört in den Abschnitt `## Ziel`**, analog zur Konvention in `/issues`. Der Wert entsteht in drei Stufen:

1. `KIT_AGENT_MODEL`, sofern nicht leer — der Nacht-Runner füllt sie aus `--model`
2. sonst die **Selbstauskunft der Session**: das Modell, unter dem sie läuft
3. nur wenn beides nicht zu ermitteln ist, wörtlich `unbekannt`

Die Zeile wird nie weggelassen, und ihr Wert ist nie leer. Seit Issue #266 legt `board.mjs issue create` kein Issue mehr ohne sie an — das gilt für fachliche Issues genauso wie für Arbeitspakete.

Der Grund ist nicht die Leitplanke, sondern das, wofür es sie gibt: Ohne die Autor-Modell-Angabe ist nicht bestimmbar, welches Modell das fachliche Issue prüfen darf, ohne sein eigenes Dokument zu prüfen. Ein Prüfer, der seinen eigenen Text liest, ist keiner.

```bash
printenv TMPDIR
```

```bash
cat  > <tmpdir>/neues-issue.md <<'TEIL1'
## Ziel
...

Autor-Modell: <wert>

## Fachliche Akzeptanzkriterien
...
TEIL1
```

```bash
cat >> <tmpdir>/neues-issue.md <<'TEIL2'
… weitere Stuecke, je hoechstens 6.000 Zeichen …
TEIL2
```

```bash
node .claude/kit/board.mjs issue create --title "[Fachlich] Titel" --body-file <tmpdir>/neues-issue.md
```

Jeder Block ist ein **eigener** Werkzeugaufruf, und der Pfad steht woertlich — die Grenze von 6.000 Zeichen gilt je Aufruf, und eine Variable im Redirect-Ziel wird unbeaufsichtigt abgewiesen. Warum, steht in `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board". **Scheitert ein Dateischritt**, wird die unvollstaendige Datei nicht uebertragen; scheitert der Board-Aufruf, meldet der Skill den Fehler mit dem Pfad der Datei und endet ohne weitere Mutation.

Der Body geht nie als Kommandozeilen-Argument (Issue #271). Ein Story-Body mit Aufzählungen und Anführungszeichen läuft als Kommandozeilen-Argument in dieselbe Quoting-Grenze wie ein technischer. Der Heredoc-Marker ist **quotiert** (`<<'BODY'`), damit die Shell Backticks und `$` im Text nicht auswertet.

**Die Schlussfolgerung war bis zum 2026-09-10 „auch der Heredoc“; sie lautet jetzt „stueckweise in eine Datei“.** Der Heredoc loeste das Quoting-Problem, lief aber in eine andere Wand: Der Befehls-Parser weist einen Aufruf ab, der den ganzen Text traegt. Das Quoting-Argument bleibt gueltig — es spricht nur fuer den Dateiweg aus `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board“, statt fuer den Heredoc am Board-Aufruf (Issue #584).

**Kein `--derived-from` — nie.** Die Option trägt die Kartennummer des nächsten Vorfahren ans Board (Issue #356). Das fachliche Issue **ist** die Wurzel der Kette: Es hat keinen Vorfahren, und ein Verweis von hier aus zeigte entweder ins Leere oder auf eine fremde Karte. `/techplan` setzt die Option auf dieses Issue hier, `/issues` auf das Plandokument — die Wurzel selbst bleibt ohne.

**Nach dem Anlegen `label-sync`:**

```bash
node .claude/kit/board.mjs issue-review label-sync <neue-id>
```

Ein frisches Dokument ist ungeprüft; das Kommando setzt `review:offen`. Ohne den Aufruf trägt es gar kein Zustandslabel und fällt in der Board-Ansicht aus der Reihe. Bei einer Pool-Idee ohne Nummer entfällt er ersatzlos.

**Sonderfall Toolbox-/kanban-kit-Tracker (Ideen-Pool):** Liefert `issue create` eine `ideaId` mit `pending: true`, liegt das fachliche Issue als board-lose Idee im Projekt-Ideen-Pool. Adressierbar (#N) und groombar wird es erst, wenn der Mensch es einplant — Pool = ungesichtete Rohanforderung, Backlog = fachlich in Arbeit.

**Nach dem Anlegen aus einem angehaltenen `[Task]`: die Spur zurueck.** Ist die fachliche Anforderung `#N` ueber den Eingang `/fachplan #T` entstanden, haengt der Skill genau einen Kommentar an **#T**:

```bash
node .claude/kit/board.mjs issue comment <T> --text "Fortsetzung: Issue #N"
```

Am neuen `[Fachlich]`-Issue entsteht dabei **keine** Herkunftszeile und kein `--derived-from`; `CLAUDE-Fachplan.md` (F9) verbietet sie an der fachlichen Wurzel. Die Spur laeuft deshalb in die andere Richtung: Zum Zeitpunkt des Halts gab es die neue Anforderung noch nicht, ihre Nummer kann erst dort entstehen, wo sie angelegt wird.

Ohne Argument `#T` entfaellt der Aufruf **ersatzlos**. Liefert `issue create` nur eine `ideaId` mit `pending: true`, entfaellt der Kommentar ebenfalls ersatzlos — wie `label-sync` in demselben Fall — und die Meldung nennt die `ideaId`, damit der Mensch die Spur beim Einplanen selbst legt.

### 3. Abschluss

Melde das angelegte Issue (Nummer bzw. `ideaId` + Titel) und den weiteren Weg:

> "Das fachliche Issue ist angelegt. Groomt es mit dem PO — Antworten und Ergänzungen direkt in den Body. Wenn der PO sagt: das ist es — dann `/techplan #N` für den technischen Plan."

## Grooming findet im Body statt, nie in Kommentaren

**Verbindlich:** Alles, worauf sich ein späterer Plan stützen muss, gehört in den **Body** des Issues — Antworten des PO ebenso wie Ergänzungen der KI. Kommentare sind für Verlauf und Diskussion, nicht für Entscheidungen.

Der Grund ist inhaltlich: Der Body ist der **verhandelte Stand**, Kommentare sind **Verlauf**. Wer eine Entscheidung nur kommentiert, zwingt jede spätere Session, sie aus einer Diskussion zu rekonstruieren, statt sie zu lesen — und die Anforderung hat dann keinen eindeutigen Stand mehr. `board.mjs issue get` liefert seit kanban-kit#449 zwar auch die Kommentare mit, aber das ändert die Regel nicht: Was gilt, steht im Body.

**Antworten des PO** direkt hinter die jeweilige Frage unter „Offene Fragen an den PO" in den Body schreiben.

**Rohe Issues des Menschen ergänzen.** Wirft der Mensch nur **Ziel** und grobe Anforderung hin (der Normalfall), füllt die KI beim Groomen im Body nach:
- `## Fachliche Akzeptanzkriterien` — konkret und aus Nutzersicht prüfbar
- `## Nicht-Ziele` — die Scope-Grenze
- `## Offene Fragen an den PO` — die offenen Punkte, die der PO beantwortet

Diese Abschnitte kommen in den Body, nicht als Kommentar.

**So kommt der ergänzte Body ins Board:**

```bash
node .claude/kit/board.mjs issue update <id> --body-file <pfad>
```

`issue update` gibt es seit Issue #237, `--body-file` seit #270. Die Datei gehört **außerhalb des Projektverzeichnisses** — eine Datei im Repo macht den Working Tree unsauber, und darauf stoppt der Nacht-Runner hart.

**Die vorhandene `Autor-Modell:`-Zeile muss dabei erhalten bleiben.** Anders als `issue create` prüft `issue update` sie nicht: Der Body wird durchgeschrieben, wie er kommt. Eine Grooming-Session, die den Body neu formuliert und die Zeile dabei vergisst, verliert sie stillschweigend — ohne Fehler, ohne Warnung. Wer den Body ersetzt, übernimmt die Zeile aus dem alten Stand.

## Stop-Punkte

- Kein technischer Plan, keine technischen Issues — das kommt erst nach der PO-Freigabe über `/techplan #N` und `/issues`.
- Kein Code, kein Commit.
- Fachliche Issues nie nach Ready ziehen — Ready heißt implementierbar, und fachliche Issues werden nie implementiert.
