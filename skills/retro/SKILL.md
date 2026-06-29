---
name: retro
description: Schritt 7.5 des 9-Schritt-Prozesses — KI-Retrospektive, die die Mensch-KI-Zusammenarbeit reflektiert, Memory konsolidiert und Workflow-Regeln schärft. Nutze diesen Skill wenn der Nutzer /retro aufruft oder eine KI-Retrospektive starten will (alle 1-2 Wochen empfohlen).
---

# Retro

Schritt 7.5 des 9-Schritt-Prozesses: KI-Retrospektive. Kein Team-Event — ein eigenes Format, das die Mensch-KI-Zusammenarbeit reflektiert und Workflow-Regeln schärft.

## Drei Leitfragen

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

## Output

Die Retro produziert konkrete Änderungen:
- **Memory-Dateien aktualisieren** (direkt schreiben, kein Rückfragen)
- **CLAUDE*.md oder Skill-Texte anpassen** (Regeln schärfen, Unklarheiten beseitigen)
- **Neue Folge-Issues anlegen** wenn ein strukturelles Problem einen Fix braucht

Schreibe am Ende eine kurze Zusammenfassung:

```
## Retro-Ergebnis <DATUM>

### Reibungspunkte
- ...

### Memory-Änderungen
- <Datei> — <was geändert und warum>

### Regel-Schärfungen
- <Skill oder CLAUDE.md> — <was präzisiert>

### Neue Issues
- #N: <Titel>
```

## Takt

Empfohlen alle 1–2 Wochen. Nicht beim ersten Anzeichen von Reibung — die Retro fasst mehrere Sessions zusammen und sucht nach Mustern, nicht nach Einzelfällen.
