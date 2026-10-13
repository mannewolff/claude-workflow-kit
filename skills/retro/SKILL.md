---
name: retro
description: AI retrospective that reflects on the human-AI collaboration, consolidates memory, sharpens workflow rules, and reports the key figures of the process. Use this skill when the user invokes /retro or wants to start an AI retrospective (suggested every 1-2 weeks).
user-invocable: true
---

# Retro

Werkzeug neben dem Prozess, alle ein bis zwei Wochen: KI-Retrospektive. Kein Team-Event — ein eigenes Format, das die Mensch-KI-Zusammenarbeit reflektiert, Workflow-Regeln schärft und den Prozess an Zahlen misst statt an Gefühlen.

## Vier Leitfragen

### 1. Wo hat die Mensch-KI-Zusammenarbeit gehakt?

Schau auf die letzten Commits, Issues und Sessions:
- Wo musste der Mensch häufig korrigieren?
- Welche Missverständnisse haben Arbeit verursacht?
- Welche Fragen hätte ich früher stellen sollen?
- Wo habe ich Scope-Grenzen überschritten?

### 2. Welche Memory-Einträge sind veraltet?

Prüfe vorhandene Memory-Dateien (z.B. in `.claude/`, `CLAUDE*.md`, Vault-Notizen):
- Regeln, die nicht mehr stimmen
- Entscheidungen, die überholt sind
- Konventionen, die sich in der Praxis nicht bewährt haben

Schlage konkrete Änderungen vor. Veraltertes Memory ist schlechter als kein Memory.

### 3. Welche Workflow-Regel braucht eine Schärfung?

Identifiziere Anti-Patterns, die sich wiederholt haben:
- Wo war die Grenze zwischen KI-Schritt und Mensch-Schritt unklar?
- Welcher Stop-Punkt wurde fast umgangen?
- Welcher Skill-Text hat zu Missverständnissen geführt?

### 4. Was sagen die Zahlen?

Fünf Kennzahlen für den Retro-Zeitraum, jede mit ihrer Quelle. Gezählt wird aus dem Board (`node .claude/kit/board.mjs issue list`, `issue get <N>` mit Kommentaren, `issue activity --ids <n,n,…>` wo der Tracker es kann) und aus `git log`. Eine Zahl, die sich nicht ermitteln lässt, steht als „nicht ermittelbar: <Grund>" — nie geschätzt.

- **Gekippte Entscheidungen.** Zahl der Einträge unter `### Entscheidungen` in den Abschlussberichten und unter `## Architektonische Entscheidungen` in den Plänen des Zeitraums (E-Einträge nach `CLAUDE-workflow.md`, „Entscheiden statt fragen"), und davon die Zahl, die der Mensch danach gekippt hat — erkennbar an einem Kommentar oder Commit, der die Entscheidung umkehrt. Die Quote ist die Kennzahl: Bleibt sie nahe null, trägt „Entscheiden statt fragen"; steigt sie, nennt die Retro die betroffene Entscheidungsklasse als Kandidat für die Stopp-Klasse.
- **Stopp-Fragen.** Zahl der Halte mit `kit:clarify` im Zeitraum und je Halt der Punkt der Stopp-Klasse.
- **Anforderung bis GO.** Je Vorhaben die Kalendertage vom Anlegen des ersten Dokuments (`[Requirement]`, `[Plan]` oder `[Task]`) bis zum Ziehen nach Ready.
- **GO bis Push.** Je Vorhaben die Kalendertage vom Ziehen nach Ready bis zum Push des letzten Commits.
- **Pakete der Nacht ohne Einwand.** Grundmenge sind die Pakete, die der Abschnitt `### Stufen` / `### Stages` jedes Kommentars mit dem Anker `## Nachtbericht, Kette` im Zeitraum nennt, jedes Paket einmal, eingeordnet nach seinem ersten Zug nach Ready; Stichtag ist der Tag der Retrospektive. Vier Zahlen: ohne Einwand (vom Menschen gezogen, ohne vorherige Änderung oder Kommentar des Menschen), nach Änderung (vom Menschen erst danach gezogen), zurückgehalten (bis zum Retro-Tag nicht gezogen und nicht geschlossen) und von der Kette gezogen. Der erste Zug ist der erste Verlaufseintrag `MOVED` nach Ready aus `issue activity --ids <n,n,…>`, die Zielspalte aus `columnKey` `READY`, fehlt das Feld, aus `detail` „Verschoben nach Ready“; `origin` `SESSION` ist der Mensch, ein Zug mit `origin` `TOKEN` war die Kette, wenn ein Nachtbericht des Zeitraums das Paket unter `### Umsetzung` / `### Implementation` führt (in `umgesetzt`, `angehalten` oder `festgefahren`, oder unter `nicht begonnen` / `not started` mit dem Grund einer Rückstellung) und der Zug zwischen Laufbeginn und Bericht liegt; jeder andere `TOKEN`-Zug zählt als Zug des Menschen. Fehlt der Verlauf oder `origin`, steht das Paket als „nicht ermittelbar: Akteur des ersten Zugs unbekannt“, die Zielstufe allein genügt nicht. Eine Änderung des Menschen ist ein Eintrag `UPDATED` mit `origin` `SESSION`; ein Kommentar des Menschen kommt aus `issue get`, entstand vor dem Zug und beginnt weder mit einer festen Zeile aus `node .claude/kit/board.mjs names` (Feld `lines`) noch mit `Nachtlauf:` oder `Night run:`. Die Erkennung irrt in zwei Richtungen: Ein nicht erkannter Kit-Kommentar verschiebt ein Paket nach „nach Änderung“, eine Body-Änderung des Menschen über eine Claude-Session nach „ohne Einwand“. Liefert `issue activity --ids` für eine Nummer einen Fehlereintrag, steht das Paket als „nicht ermittelbar: archiviert“, und für diese Nummer folgt kein `issue get`; ein geschlossenes Paket ohne Zug steht als „nicht ermittelbar: geschlossen ohne Zug“. Der Anteil ist ohne Einwand ÷ (ohne Einwand + nach Änderung), ohne die Pakete der Kette; hat der Mensch kein Paket gezogen, steht dort „nicht ermittelbar: kein Zug durch den Menschen“. Die Zahl ist das Argument für oder gegen Variante B aus Idee #637 (das Kennzeichen am Fachplan als GO): Bleibt „ohne Einwand“ hoch, wiederholt das Ziehen nur das Urteil über den Plan. Jedes Paket landet in genau einer Gruppe oder steht als „nicht ermittelbar: <Grund>“.

**Feste Zeilen.** Überschriften, Marker, Review- und Einarbeitungs-Köpfe und Fundblock-Zeilen, die dieser Skill in Dokumente, Kommentare oder Markerzeilen schreibt, stehen hier deutsch. Vor dem ersten Schreiben `node .claude/kit/board.mjs names` aufrufen: Das Feld `lines` nennt je deutscher Zeile die Fassung der Projektsprache, und der Skill schreibt die ausgegebene Fassung. Eine Zeile mit veränderlichem Rest (`## Einarbeitung, Runde 2`) steht dort mit ihrem festen Anfang, eine Überschrift mit `## ` davor gilt auf jeder Ebene, und was `names` nicht nennt, bleibt, wie es hier steht.

## Output

Die Retro produziert konkrete Änderungen:
- **Memory-Dateien aktualisieren** (direkt schreiben, kein Rückfragen)
- **CLAUDE*.md oder Skill-Texte anpassen** (Regeln schärfen, Unklarheiten beseitigen)
- **Neue Folge-Issues anlegen** wenn ein strukturelles Problem einen Fix braucht
- **Eine Entscheidungsklasse als Vorschlag für die Stopp-Klasse ausweisen**, wenn sie wiederholt gekippt wurde — als Vorschlag in der Zusammenfassung, nicht selbst in `CLAUDE-workflow.md` eingetragen: Die Stopp-Klasse ist Prozess (W1 bis W4) und damit Sache des Menschen.

Schreibe am Ende eine kurze Zusammenfassung:

```
## Retro-Ergebnis <DATUM>

### Reibungspunkte
- ...

### Memory-Änderungen
- <Datei> — <was geändert und warum>

### Regel-Schärfungen
- <Skill oder CLAUDE.md> — <was präzisiert>

### Kennzahlen
| Kennzahl | Wert | Quelle |
|----------|------|--------|
| Gekippte Entscheidungen | <gekippt> von <gesamt> | Abschlussberichte, Pläne, Kommentare |
| Stopp-Fragen | <Zahl>, Punkte: <1–6> | Karten mit kit:clarify |
| Anforderung bis GO | <Tage je Vorhaben> | Board-Verlauf |
| GO bis Push | <Tage je Vorhaben> oder nicht ermittelbar: <Grund> | Board-Verlauf, git log |
| Pakete der Nacht ohne Einwand | <ohne Einwand> / <nach Änderung> / <zurückgehalten> / <von der Kette gezogen>, Anteil <Prozent> oder nicht ermittelbar: <Grund>; nicht ermittelbar: <Zahl je Grund> | Nachtberichte, Board-Verlauf |

### Vorschlag für die Stopp-Klasse
- <Entscheidungsklasse und Grund> oder: keiner

### Neue Issues
- #N: <Titel>
```

## Takt

Empfohlen alle 1–2 Wochen. Nicht beim ersten Anzeichen von Reibung — die Retro fasst mehrere Sessions zusammen und sucht nach Mustern, nicht nach Einzelfällen.
