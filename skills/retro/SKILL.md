---
name: retro
description: KI-Retrospektive, die die Mensch-KI-Zusammenarbeit reflektiert, Memory konsolidiert, Workflow-Regeln schärft und die Kennzahlen des Prozesses ausweist. Nutze diesen Skill wenn der Nutzer /retro aufruft oder eine KI-Retrospektive starten will (alle 1-2 Wochen empfohlen).
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

Vier Kennzahlen für den Retro-Zeitraum, jede mit ihrer Quelle. Gezählt wird aus dem Board (`node .claude/kit/board.mjs issue list`, `issue get <N>` mit Kommentaren, `issue activity <N>` wo der Tracker es kann) und aus `git log`. Eine Zahl, die sich nicht ermitteln lässt, steht als „nicht ermittelbar: <Grund>" — nie geschätzt.

- **Gekippte Entscheidungen.** Zahl der Einträge unter `### Entscheidungen` in den Abschlussberichten und unter `## Architektonische Entscheidungen` in den Plänen des Zeitraums (E-Einträge nach `CLAUDE-workflow.md`, „Entscheiden statt fragen"), und davon die Zahl, die der Mensch danach gekippt hat — erkennbar an einem Kommentar oder Commit, der die Entscheidung umkehrt. Die Quote ist die Kennzahl: Bleibt sie nahe null, trägt „Entscheiden statt fragen"; steigt sie, nennt die Retro die betroffene Entscheidungsklasse als Kandidat für die Stopp-Klasse.
- **Stopp-Fragen.** Zahl der Halte mit `kit:klaeren` im Zeitraum und je Halt der Punkt der Stopp-Klasse.
- **Anforderung bis GO.** Je Vorhaben die Kalendertage vom Anlegen des ersten Dokuments (`[Fachlich]`, `[Plan]` oder `[Task]`) bis zum Ziehen nach Ready.
- **GO bis Push.** Je Vorhaben die Kalendertage vom Ziehen nach Ready bis zum Push des letzten Commits.

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
| Stopp-Fragen | <Zahl>, Punkte: <1–5> | Karten mit kit:klaeren |
| Anforderung bis GO | <Tage je Vorhaben> | Board-Verlauf |
| GO bis Push | <Tage je Vorhaben> oder nicht ermittelbar: <Grund> | Board-Verlauf, git log |

### Vorschlag für die Stopp-Klasse
- <Entscheidungsklasse und Grund> oder: keiner

### Neue Issues
- #N: <Titel>
```

## Takt

Empfohlen alle 1–2 Wochen. Nicht beim ersten Anzeichen von Reibung — die Retro fasst mehrere Sessions zusammen und sucht nach Mustern, nicht nach Einzelfällen.
