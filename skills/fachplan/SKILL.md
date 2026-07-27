---
name: fachplan
description: Schritt 1.5 des 9-Schritt-Prozesses (optional) — überführt eine rohe Anforderung in ein fachliches Issue im Story-Format für die PO-Schleife, ohne Technik und ohne Implementierung. Nutze diesen Skill wenn der Nutzer /fachplan aufruft oder eine Anforderung erst fachlich mit einem Product Owner klären will, bevor ein technischer Plan entsteht.
user-invocable: true
---

# Fachplan

Schritt 1.5 des 9-Schritt-Prozesses (optional): Eine rohe Anforderung (diktiert, aus einer Mail, aus dem Chat) wird in ein **fachliches Issue** überführt — die Diskussionsgrundlage für den Product Owner. Fachliche Issues beschreiben das Was und Warum, nie das Wie. Sie werden gegroomt, nie implementiert.

Die PO-Schleife ist **opt-in**: Wer keinen PO hat, überspringt diesen Skill und ruft direkt `/plan` auf — am übrigen Prozess ändert sich nichts.

## Ablauf

### 1. Anforderung fachlich verdichten

Extrahiere aus der Anforderung die fachliche Substanz. Frage nach, wenn Ziel oder Nutzen unklar sind — aber kläre nur Fachliches, keine Technik.

### 2. Genau ein fachliches Issue anlegen

Titel: `[Fachlich] <Titel>` — das Präfix ist die verbindliche Konvention, an der alle anderen Skills und der Nacht-Runner fachliche Issues erkennen.

Body im Story-Format mit vier Abschnitten:

```markdown
## Ziel
Wer braucht was, und warum? (Nutzerwirkung in PO-Sprache)

## Fachliche Akzeptanzkriterien
Woran erkennt der PO, dass es das ist? Konkret und aus Nutzersicht prüfbar.

## Nicht-Ziele
Was gehört ausdrücklich nicht dazu? (Scope-Grenze)

## Offene Fragen an den PO
Was muss im Groomen geklärt werden?
```

**Strikt technikfrei:** keine Dateien, keine Architektur, keine Implementierungsdetails. Der Maßstab: Ein PO ohne Code-Kenntnis versteht jede Zeile.

```bash
node .claude/kit/board.mjs issue create --title "[Fachlich] Titel" --body "..."
```

**Sonderfall Toolbox-/kanban-kit-Tracker (Ideen-Pool):** Liefert `issue create` eine `ideaId` mit `pending: true`, liegt das fachliche Issue als board-lose Idee im Projekt-Ideen-Pool. Adressierbar (#N) und groombar wird es erst, wenn der Mensch es einplant — Pool = ungesichtete Rohanforderung, Backlog = fachlich in Arbeit.

### 3. Abschluss

Melde das angelegte Issue (Nummer bzw. `ideaId` + Titel) und den weiteren Weg:

> "Das fachliche Issue ist angelegt. Groomt es mit dem PO — Antworten und Ergänzungen direkt in den Body. Wenn der PO sagt: das ist es — dann `/plan #N` für den technischen Plan."

## Grooming findet im Body statt, nie in Kommentaren

**Verbindlich:** Alles, worauf sich ein späterer Plan stützen muss, gehört in den **Body** des Issues — Antworten des PO ebenso wie Ergänzungen der KI. Kommentare sind für Verlauf und Diskussion, nicht für Entscheidungen.

Der Grund ist nicht Geschmack, sondern Werkzeug: `board.mjs issue get` liefert Titel, Body und Status — **keine Kommentare**, bei keinem Tracker. Eine Entscheidung, die als Kommentar abgelegt wird, ist für jede spätere Session unsichtbar, und `/plan #N` verlangt ausdrücklich die Groom-Historie. (Beim Toolbox-/kanban-kit-Tracker kommt hinzu, dass seine API für Kommentare nur ein `POST` kennt, kein `GET` — dort sind sie also gar nicht abrufbar.)

**Antworten des PO** direkt hinter die jeweilige Frage unter „Offene Fragen an den PO" in den Body schreiben.

**Rohe Issues des Menschen ergänzen.** Wirft der Mensch nur **Ziel** und grobe Anforderung hin (der Normalfall), füllt die KI beim Groomen im Body nach:
- `## Fachliche Akzeptanzkriterien` — konkret und aus Nutzersicht prüfbar
- `## Nicht-Ziele` — die Scope-Grenze
- `## Offene Fragen an den PO` — die offenen Punkte, die der PO beantwortet

Diese Abschnitte kommen in den Body, nicht als Kommentar.

**Werkzeug-Einschränkung, solange sie besteht:** `board.mjs` hat keinen Befehl, den Body eines bestehenden Issues zu ändern (nur `create`, `get`, `list`, `move`, `comment`), und nicht jede Tracker-API bietet dafür ein Update. Wo die KI den ergänzten Body nicht selbst schreiben kann, gibt sie ihn vollständig im Chat aus, und der Mensch fügt ihn im Board ein. Fällt die Einschränkung weg, schreibt die KI direkt.

## Stop-Punkte

- Kein technischer Plan, keine technischen Issues — das kommt erst nach der PO-Freigabe über `/plan #N` und `/issues`.
- Kein Code, kein Commit.
- Fachliche Issues nie nach Ready ziehen — Ready heißt implementierbar, und fachliche Issues werden nie implementiert.
