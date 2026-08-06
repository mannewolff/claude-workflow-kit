---
name: document
description: Schritt 9.5 des 9-Schritt-Prozesses — schreibt nach der Session einen Tageslog-Eintrag in den Vault und aktualisiert die Projektnotiz. Nutze diesen Skill wenn der Nutzer /document aufruft oder die Session dokumentieren will.
user-invocable: true
---

# Document

Schritt 9.5: Session-Ende. Was in dieser Session gebaut, entschieden und gelernt wurde, in den Memory-Vault schreiben.

## Tragendes Prinzip: Eine Datei, ein Schreiber

Jede Vault-Datei, in die dieser Skill automatisch schreibt, gehoert genau einem Repo. Teilen sich mehrere Service-Repos einen Vault, ist eine gemeinsam beschriebene Datei die Kollisionsstelle: parallele Sessions ueberschreiben Abschnitte, in einem synchronisierten Vault entsteht ein Sync-Konflikt. Geteilte Dateien werden deshalb gelesen oder nur mit ausdruecklicher Zustimmung geschrieben — die Dach-Notiz ist der einzige geteilte Schreibort und bewusst nicht automatisiert.

## Ablauf

### 1. Zielpfade holen

Der Skill baut keine Vault-Pfade selbst zusammen. Ein Aufruf liefert alles:

```bash
node .claude/kit/board.mjs kontext paths
```

Das JSON enthaelt:
- `mode`: `"full"` (Vault konfiguriert) oder `"degraded"` (kein Vault)
- `log`: absolute Zieldatei fuer den Tageslog
- `projectNote`: absolute Zieldatei fuer die Projektnotiz
- `parentNote`: absolute Datei der Dach-Notiz — nur gesetzt wenn `parentProject` konfiguriert ist, sonst `null`
- `project`, `parentProject`, `vault`: fuer die Bestaetigungsmeldung

**Wenn das Kommando fehlschlaegt** (unbekannte Achse `kontext` — ein Projekt mit aelterer `board.mjs`): auf das bisherige Verhalten zurueckfallen statt abzubrechen. Also `kontext.config.json` selbst lesen (lokal `.claude/kontext.config.json` vor global `~/.claude/kontext.config.json`), Projektname ueber `node .claude/kit/board.mjs code repo-name` (letztes Segment; im lokalen Modus ohne git-Remote liefert der Adapter den Verzeichnisnamen — erwartetes Verhalten, kein Fehler), Log nach `{vault}/Log/JJJJ-MM-TT.md`, Projektnotiz nach `{vault}/Projekte/{name}/{name}.md`, keine Dach-Notiz. In der Bestaetigung ausdruecklich sagen, dass der Fallback gegriffen hat und `board.mjs` veraltet ist. Ein fehlendes Kommando darf `/document` nicht scheitern lassen.

### 2. Tageslog schreiben

**Modus `full`:** Ziel-Datei ist `log` aus dem JSON.

**Modus `degraded`:** Ziel-Datei `docs/session-log/JJJJ-MM-TT.md` im Projektverzeichnis. Verzeichnis anlegen wenn nicht vorhanden.

In beiden Modi:
- Wenn die Datei noch nicht existiert: neu anlegen.
- Wenn sie schon existiert (zweite Session am selben Tag): neuen Abschnitt anhaengen, nicht ueberschreiben.

**Format:**

```markdown
# JJJJ-MM-TT — {Projektname} Session

{Kurzer Einstiegssatz: was war der Schwerpunkt dieser Session?}

## Einstieg

- {Welche Dateien/Ressourcen wurden zu Beginn geladen?}

## {Abschnitt pro umgesetztem Issue oder Thema}

{Freier Text: was wurde gebaut, warum so, wichtige Entscheidungen}

Committet {HASH} / Commits: {Liste}

## Offene Punkte

- {Was bleibt offen, welche manuellen Schritte stehen an?}
```

Synthetisiere den Inhalt aus dem Session-Kontext: Issues, Commits, Entscheidungen, was als naechstes kommt. Kein Template-Fill-In, sondern lesbare Zusammenfassung.

### 3. Projektnotiz aktualisieren (nur Modus `full`)

Zieldatei ist `projectNote` aus dem JSON. Sie gehoert diesem Repo und wird ohne Rueckfrage aktualisiert.

Aktualisiere den Abschnitt `## Zuletzt aktualisiert` mit einem neuen Eintrag oben (neueste Eintraege zuerst):

```
- JJJJ-MM-TT: {Kurze Zusammenfassung: was wurde umgesetzt, was steht noch aus}
```

Bestehende Eintraege bleiben erhalten.

### 4. Dach-Notiz nur mit Rueckfrage (nur wenn `parentNote` gesetzt ist)

`parentNote` wird **nie automatisch geschrieben** — sie gehoert allen Services gemeinsam.

Pruefe, ob die Session Cross-Service-Wirkung hatte:
- geteiltes Datenmodell oder Schema geaendert
- API-Vertrag zwischen Services geaendert
- gemeinsame Infrastruktur angefasst
- systemweite Architektur-Entscheidung getroffen

**Ohne Cross-Service-Wirkung: nicht fragen, nichts schreiben.**

**Mit Cross-Service-Wirkung:** einmal nachfragen, mit dem konkret vorgeschlagenen Eintragstext, und erst nach ausdruecklicher Zustimmung schreiben:

```
Die Session hat Cross-Service-Wirkung ({kurze Begruendung}).
Eintrag in die Dach-Notiz Projekte/{parent}/{parent}.md:

- JJJJ-MM-TT ({project}): {vorgeschlagener Eintragstext}

Eintragen? (ja/nein)
```

Diese Rueckfrage ist der einzige Stopp-Punkt in `/document`. Sie im Zweifel zu stellen ist billiger als ein Sync-Konflikt in der Datei, die das Systemwissen traegt.

### 5. Bestaetigung

Melde die tatsaechlich geschriebenen Ziele mit ihrem Vault-relativen Pfad.

**Modus `full`, ohne `parentProject`:**
```
Dokumentiert:
- Log/JJJJ-MM-TT.md (neu / ergaenzt)
- Projekte/{name}/{name}.md (Zuletzt aktualisiert)
```

**Modus `full`, mit `parentProject`:** zusaetzlich ausdruecklich sagen, ob die Dach-Notiz angefasst wurde:
```
Dokumentiert:
- {logPfad relativ zum Vault} (neu / ergaenzt)
- Projekte/{parent}/{project}.md (Zuletzt aktualisiert)
- Dach-Notiz Projekte/{parent}/{parent}.md: nicht angefasst (keine Cross-Service-Wirkung)
```
bzw. `... : ergaenzt (nach Zustimmung)`, wenn geschrieben wurde.

**Modus `degraded`:**
```
Dokumentiert:
- docs/session-log/JJJJ-MM-TT.md (neu / ergaenzt)

Kein Vault konfiguriert. Log ins Projektverzeichnis geschrieben.
Fuer Vollmodus: ~/.claude/kontext.config.json anlegen mit vault-Pfad.
```

## Was dieser Skill nicht tut

- Kein Lesen von Vault-Dateien in den Kontext (das ist /kontext)
- Kein automatisches Schreiben in die Dach-Notiz — nur nach Rueckfrage
- Kein Selbst-Zusammenbauen von Vault-Pfaden (das macht `board.mjs kontext paths`)
- Keine Code-Änderungen
- Kein Commit, kein Push
- Kein Überschreiben bestehender Log-Abschnitte — nur anhängen
