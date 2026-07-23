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

> "Das fachliche Issue ist angelegt. Groomt es mit dem PO (Kommentare und Edits direkt am Issue). Wenn der PO sagt: das ist es — dann `/plan #N` für den technischen Plan."

## Stop-Punkte

- Kein technischer Plan, keine technischen Issues — das kommt erst nach der PO-Freigabe über `/plan #N` und `/issues`.
- Kein Code, kein Commit.
- Fachliche Issues nie nach Ready ziehen — Ready heißt implementierbar, und fachliche Issues werden nie implementiert.
