---
name: plan
description: Schritt 2 des 9-Schritt-Prozesses — erstellt einen Implementierungsplan, stellt ihn zur Diskussion und implementiert nichts. Nutze diesen Skill wenn der Nutzer /plan aufruft, einen Plan erstellen will oder Schritt 2 des Prozesses startet.
user-invocable: true
---

# Plan

Schritt 2 des 9-Schritt-Prozesses: Die KI erstellt einen Plan. Der Plan wird zur Diskussion gestellt, nicht zur Implementierung.

## Plan-Modell: wer den Plan geschrieben hat

Der Plan nennt in seinem Kopf die Zeile:

```
Plan-Modell: <Selbstauskunft der Session>
```

Der Wert entsteht wie beim `Autor-Modell` in `/issues`: `KIT_AGENT_MODEL`, wenn gesetzt — sonst die Selbstauskunft der laufenden Session.

**Läuft der Skill als `/plan #N` gegen ein fachliches Issue, geht die Angabe zusätzlich als Kommentar ans Issue:**

```bash
node .claude/kit/board.mjs issue comment <N> --text "Plan erstellt von <modell> am <JJJJ-MM-TT>"
```

Der Grund ist die Lückenlosigkeit der Kette. Ein fachliches Issue wird zur Quelle beliebig vieler technischer Issues, und die tragen alle „Fachliche Quelle: Issue #N" plus ihr eigenes `Autor-Modell`. Ohne diesen Kommentar bricht die Nachvollziehbarkeit genau zwischen beiden ab: Man sieht, welches Modell die Issues formuliert hat, aber nicht, welches den Plan entworfen hat, aus dem sie stammen. Der Tracker kann das nicht ergänzen — dort steht als Autor immer der Inhaber des Tokens (Issue #266).

## Eingang `/plan #N`: fachliches Issue als Quelle

Wird der Skill mit einer Issue-Nummer aufgerufen und trägt dieses Issue das Titel-Präfix `[Fachlich]` (PO-Schleife, siehe `/fachplan`), dann ist **das Issue die Anforderungsquelle, nicht der Chat**:

1. Das fachliche Issue vollständig lesen — **den kompletten Body**, denn dort steckt die Groom-Historie mit den PO-Entscheidungen. Die Verhandlung findet im Body statt, nicht in Kommentaren: Der Body ist der verhandelte Stand, Kommentare sind Verlauf. `board.mjs issue get` liefert zusätzlich ein `comments`-Array (Verlauf, Abschlussberichte, Review-Befunde) — das ergänzt den Body, ersetzt ihn aber nicht als Quelle der Anforderung.
2. Den technischen Plan aus Ziel, fachlichen Akzeptanzkriterien und Nicht-Zielen entwickeln; die Nicht-Ziele sind Scope-Grenzen, keine Anregungen.
3. Das fachliche Issue im Plan ausdrücklich referenzieren („Fachliche Quelle: Issue #N"), damit `/issues` den Rückverweis in die technischen Issues übernimmt.

Trägt #N kein `[Fachlich]`-Präfix, gilt der normale Ablauf unten — kein Sonderweg.

## Ablauf

### 0. Bahn bestimmen

Ist die Anforderung Bahn 1 (kleine Änderung nach der Definition in CLAUDE-workflow.md), sag das und biete an, sie **direkt** umzusetzen statt zu planen — kein Plan-Overhead. Nur bei Bahn 2 den vollen Plan erstellen.

### 1. Anforderung verstehen

Kläre zuerst:
- Was soll gebaut werden? (Was fehlt dir noch, um das sicher zu sagen?)
- Welche Bereiche des Codes sind betroffen?
- Gibt es Abhängigkeiten zu anderen Issues oder laufenden Arbeiten?

Frage nach, wenn etwas unklar ist. Raten ist kein Ersatz für eine kurze Rückfrage.

### 2. Relevante Dateien lesen

Lies die betroffenen Dateien und vorhandene Muster. Nutze einen Explore-Agenten, wenn der Scope unklar ist. Suche aktiv nach wiederverwendbaren Funktionen und Mustern — vermeide neuen Code, wenn eine passende Implementierung bereits existiert.

### 3. Plan erstellen

Der Plan benennt:
- **Ziel** und Nutzerwirkung
- **Betroffene Bereiche** (Dateien, Module, Schichten)
- **Architektonische Entscheidungen** mit Begründung
- **Geplante Änderungen** je Datei
- **Offene Fragen** die vor der Umsetzung geklärt sein müssen — diese als explizite Stopp-Fragen hervorheben, nicht am Ende vergraben. Wenn eine Frage die Architektur betrifft, ist sie kein optionales Detail.
- **Verifizierung** — wie wird geprüft, dass die Implementierung korrekt ist?

### 4. Plan zur Diskussion stellen

Präsentiere den Plan und warte auf Feedback. Implementiere **nicht**, bevor der Plan freigegeben wurde. Plan-Akzeptanz ist kein GO — das GO kommt separat (Schritt 4).

Typischer Abschluss:
> "Soll ich so vorgehen? Dann lege ich auf GO die GitHub-Issues an (Schritt 3)."

## Stop-Punkt

Dieser Skill endet mit einem Plan-Dokument zur menschlichen Freigabe. Kein Code, kein Commit, keine Issues — erst nach explizitem GO.
