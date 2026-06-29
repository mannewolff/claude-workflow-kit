---
name: document
description: Schritt 9.5 des 9-Schritt-Prozesses — schreibt nach der Session einen Tageslog-Eintrag in den Vault und aktualisiert die Projektnotiz. Nutze diesen Skill wenn der Nutzer /document aufruft oder die Session dokumentieren will.
user-invocable: true
---

# Document

Schritt 9.5: Session-Ende. Was in dieser Session gebaut, entschieden und gelernt wurde, in den Memory-Vault schreiben.

## Vorbedingung

Suche die Config in dieser Reihenfolge (erstes gefundenes gewinnt):
1. `.claude/kontext.config.json` im aktuellen Projektverzeichnis
2. `~/.claude/kontext.config.json` (global)

Wenn keine Config gefunden: Fehlermeldung ausgeben und abbrechen.

```
Keine kontext.config.json gefunden.
Erstelle ~/.claude/kontext.config.json mit:
{
  "vault": "/pfad/zum/vault",
  "always": ["Index.md", "Profil.md"],
  "projectDocs": ["CLAUDE-workflow.md"]
}
```

## Ablauf

### 1. Config und Projektname lesen

Lies `kontext.config.json` (lokale Version hat Vorrang). Extrahiere `vault`.

Projektname:
```bash
gh repo view --json name --jq '.name'
```

### 2. Tageslog schreiben

Ziel-Datei: `{vault}/Log/JJJJ-MM-TT.md` (heutiges Datum).

- Wenn die Datei noch nicht existiert: neu anlegen.
- Wenn sie schon existiert (zweite Session am selben Tag): neuen Abschnitt anhängen, nicht überschreiben.

**Format** (analog zu bestehenden Log-Einträgen im Vault):

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

Synthetisiere den Inhalt aus dem Session-Kontext: Issues, Commits, Entscheidungen, was als nächstes kommt. Kein Template-Fill-In, sondern lesbare Zusammenfassung.

### 3. Projektnotiz aktualisieren

Projektnotiz: `{vault}/Projekte/{name}/{name}.md`

Aktualisiere den Abschnitt `## Zuletzt aktualisiert` mit einem neuen Eintrag oben (neueste Einträge zuerst):

```
- JJJJ-MM-TT: {Kurze Zusammenfassung: was wurde umgesetzt, was steht noch aus}
```

Bestehende Einträge bleiben erhalten.

### 4. Bestätigung

Melde was geschrieben wurde:

```
Dokumentiert:
- Log/JJJJ-MM-TT.md (neu / ergänzt)
- Projekte/{name}/{name}.md (Zuletzt aktualisiert)
```

## Was dieser Skill nicht tut

- Kein Lesen von Vault-Dateien in den Kontext (das ist /kontext)
- Keine Code-Änderungen
- Kein Commit, kein Push
- Kein Überschreiben bestehender Log-Abschnitte — nur anhängen
