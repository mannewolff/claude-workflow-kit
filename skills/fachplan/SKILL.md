---
name: fachplan
description: Überführt eine rohe Anforderung in ein fachliches Issue im Story-Format für die PO-Schleife, ohne Technik und ohne Implementierung. Nutze diesen Skill wenn der Nutzer /fachplan aufruft oder eine Anforderung erst fachlich mit einem Product Owner klären will, bevor ein technischer Plan entsteht.
user-invocable: true
---

# Fachplan
Werkzeug neben dem Prozess, vor Schritt 2 (`/techplan`): Eine rohe Anforderung (diktiert, aus einer Mail, aus dem Chat) wird in ein **fachliches Issue** überführt — die Diskussionsgrundlage für den Product Owner. Fachliche Issues beschreiben das Was und Warum, nie das Wie. Sie werden gegroomt, nie implementiert. Die PO-Schleife ist **opt-in**: Wer keinen PO hat, überspringt diesen Skill und ruft direkt `/techplan` auf.

## Eingang `/fachplan #T`: ein angehaltener `[Task]` als Quelle
Ein `[Task]`, bei dem `/implement-next` oder `/implement-ready` an einer Frage der Stopp-Klasse angehalten haben, trägt den Halt als Kommentar am Board und wartet im Backlog. Die Nummer kommt als Argument: `/fachplan #T` nimmt **den Task samt Halt-Kommentar als Eingang der Anforderung**, nicht den Chat.

1. Den Task vollständig lesen, Body **und** Kommentare — der Halt-Kommentar benennt den Punkt der Stopp-Klasse und die eine Frage, nicht der Body.
2. Daraus die fachliche Anforderung entwickeln: Was die Frage fachlich offenlässt, wird zu Ziel, Akzeptanzkriterien und offenen Fragen an den PO. Technische Wege aus dem Kommentar gehen **nicht** mit — sie sind das Wie.

**Jede andere Karte wird abgelehnt.** Trägt `#T` nicht das Präfix `[Task]` oder keinen Kommentar mit dem wörtlichen Folgesatz `Daraus soll per /fachplan eine fachliche Anforderung entstehen.` (Konstante `HALT_FOLGESATZ` in `kit/night.mjs`), endet der Skill mit der Meldung, dass `/fachplan #T` nur fuer einen angehaltenen `[Task]` gilt, und legt nichts an. Eine `[Idee]` und ein `[Fachlich]` sind keine Vorgänger: Die eine wird per `/task` zum Arbeitspaket, das andere ist selbst die Wurzel.

## Ablauf
### 1. Anforderung fachlich verdichten
Extrahiere aus der Anforderung die fachliche Substanz. Frage nach, wenn Ziel oder Nutzen unklar sind — aber kläre nur Fachliches, keine Technik.

### 2. Genau ein fachliches Issue anlegen
Titel: `[Fachlich] <Titel>` — das Präfix ist die verbindliche Konvention, an der alle anderen Skills und der Nacht-Runner fachliche Issues erkennen. Body im Story-Format mit vier Abschnitten:
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

**Die `Autor-Modell:`-Zeile gehört in den Abschnitt `## Ziel`**, analog zur Konvention in `/issues`. Der Wert entsteht in drei Stufen: `KIT_AGENT_MODEL`, sofern nicht leer — sonst die **Selbstauskunft der Session** — und nur, wenn beides nicht zu ermitteln ist, wörtlich `unbekannt`. Die Zeile wird nie weggelassen; `board.mjs issue create` legt kein Issue ohne sie an.

Der Grund ist nicht die Leitplanke, sondern das, wofür es sie gibt: Ohne die Autor-Modell-Angabe ist nicht bestimmbar, welches Modell das fachliche Issue prüfen darf, ohne sein eigenes Dokument zu prüfen. Ein Prüfer, der seinen eigenen Text liest, ist keiner.

Der Body entsteht nach der Transportregel aus `CLAUDE-workflow.md`, Abschnitt „Lange Texte ans Board": stückweise per Shell in eine Datei außerhalb des Projektverzeichnisses, jedes Stück höchstens 6.000 Zeichen und ein **eigener** Werkzeugaufruf mit wörtlichem Pfad, nie als Kommandozeilen-Argument:
```bash
printenv TMPDIR
```

```bash
cat  > <tmpdir>/neues-issue.md <<'TEIL1'
## Ziel
...
TEIL1
```

```bash
cat >> <tmpdir>/neues-issue.md <<'TEIL2'
… weitere Stuecke …
TEIL2
```

Vor dem Anlegen prüft ein Kommando die Form; erst bei `ok: true` folgt `issue create`, Verstöße werden in der Datei behoben und erneut geprüft:
```bash
node .claude/kit/board.mjs issue check-form --body-file <tmpdir>/neues-issue.md --title "[Fachlich] <Titel>"
```

```bash
node .claude/kit/board.mjs issue create --title "[Fachlich] <Titel>" --body-file <tmpdir>/neues-issue.md
```

Scheitert ein Dateischritt, wird die unvollstaendige Datei nicht uebertragen; scheitert der Board-Aufruf, meldet der Skill den Fehler mit dem Pfad und endet ohne weitere Mutation.

**Kein `--derived-from` — nie.** Die Option trägt die Kartennummer des nächsten Vorfahren ans Board. Das fachliche Issue **ist** die Wurzel der Kette: Es hat keinen Vorfahren, und ein Verweis von hier aus zeigte ins Leere oder auf eine fremde Karte. `/techplan` setzt die Option auf dieses Issue, `/issues` auf das Plandokument — die Wurzel selbst bleibt ohne.

**Sonderfall Toolbox-/kanban-kit-Tracker (Ideen-Pool):** Liefert `issue create` eine `ideaId` mit `pending: true`, liegt das fachliche Issue als board-lose Idee im Projekt-Ideen-Pool. Adressierbar (#N) und groombar wird es erst, wenn der Mensch es einplant — Pool = ungesichtete Rohanforderung, Backlog = fachlich in Arbeit.

**Nach dem Anlegen aus einem angehaltenen `[Task]`: die Spur zurück.** Ist die fachliche Anforderung `#N` über den Eingang `/fachplan #T` entstanden, hängt der Skill genau einen Kommentar an **#T**:
```bash
node .claude/kit/board.mjs issue comment <T> --text "Fortsetzung: Issue #N"
```

Am neuen `[Fachlich]`-Issue entsteht dabei **keine** Herkunftszeile und kein `--derived-from`; `CLAUDE-Fachplan.md` (F9) verbietet sie an der fachlichen Wurzel. Die Spur läuft in die andere Richtung, weil die Nummer der neuen Anforderung erst hier entsteht. Ohne Argument `#T` entfaellt der Aufruf **ersatzlos**. Liefert `issue create` nur eine `ideaId` mit `pending: true`, entfällt der Kommentar ebenfalls ersatzlos, und die Meldung nennt die `ideaId`, damit der Mensch die Spur beim Einplanen selbst legt.

### 3. Abschluss
Melde das angelegte Issue (Nummer bzw. `ideaId` + Titel) und den weiteren Weg:

> "Das fachliche Issue ist angelegt. Groomt es mit dem PO — Antworten und Ergänzungen direkt in den Body. Wenn der PO sagt: das ist es — dann `/techplan #N` für den technischen Plan."

## Grooming findet im Body statt, nie in Kommentaren
**Verbindlich:** Alles, worauf sich ein späterer Plan stützen muss, gehört in den **Body** des Issues — Antworten des PO ebenso wie Ergänzungen der KI. Kommentare sind für Verlauf und Diskussion, nicht für Entscheidungen. Der Body ist der **verhandelte Stand**, Kommentare sind **Verlauf**; wer eine Entscheidung nur kommentiert, zwingt jede spätere Session, sie aus einer Diskussion zu rekonstruieren. `board.mjs issue get` liefert die Kommentare zwar mit, aber das ändert die Regel nicht: Was gilt, steht im Body.

**Antworten des PO** direkt hinter die jeweilige Frage unter „Offene Fragen an den PO" in den Body schreiben. **Rohe Issues des Menschen ergänzen:** Wirft der Mensch nur Ziel und grobe Anforderung hin (der Normalfall), füllt die KI beim Groomen im Body `## Fachliche Akzeptanzkriterien`, `## Nicht-Ziele` und `## Offene Fragen an den PO` nach — nicht als Kommentar.

So kommt der ergänzte Body ins Board, wieder über eine Datei **außerhalb des Projektverzeichnisses**:
```bash
node .claude/kit/board.mjs issue update <id> --body-file <pfad>
```

**Die vorhandene `Autor-Modell:`-Zeile muss dabei erhalten bleiben.** Anders als `issue create` prüft `issue update` sie nicht: Der Body wird durchgeschrieben, wie er kommt. Eine Grooming-Session, die den Body neu formuliert und die Zeile dabei vergisst, verliert sie stillschweigend. Wer den Body ersetzt, übernimmt die Zeile aus dem alten Stand.

## Stop-Punkte
- Kein technischer Plan, keine technischen Issues — das kommt erst nach der PO-Freigabe über `/techplan #N` und `/issues`.
- Kein Code, kein Commit.
- Fachliche Issues nie nach Ready ziehen — Ready heißt implementierbar, und fachliche Issues werden nie implementiert.
