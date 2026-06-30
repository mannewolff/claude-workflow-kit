---
name: document
description: Schritt 9.5 des 9-Schritt-Prozesses — schreibt nach der Session einen Tageslog-Eintrag in den Vault und aktualisiert die Projektnotiz. Nutze diesen Skill wenn der Nutzer /document aufruft oder die Session dokumentieren will.
user-invocable: true
---

# Document

Schritt 9.5: Session-Ende. Was in dieser Session gebaut, entschieden und gelernt wurde, in den Memory-Vault schreiben.

## Vorbedingung: Modus bestimmen

Suche die Config in dieser Reihenfolge (erstes gefundenes gewinnt):
1. `.claude/kontext.config.json` im aktuellen Projektverzeichnis
2. `~/.claude/kontext.config.json` (global)

Daraus ergibt sich einer von zwei Modi:

**Modus A (Vollmodus):** Config gefunden und `vault`-Feld gesetzt. Tageslog in den Vault schreiben, Projektnotiz aktualisieren.

**Modus B (Degraded Mode):** Config fehlt oder kein `vault`-Feld. Log in `docs/session-log/JJJJ-MM-TT.md` im Projektverzeichnis schreiben. Kein Abbruch.

## Ablauf

### 1. Config und Projektname lesen

Lies `kontext.config.json` (lokale Version hat Vorrang). Extrahiere `vault` wenn vorhanden.

Projektname (funktioniert fuer GitHub und GitLab):
```bash
git remote get-url origin
```
Extrahiere den Repo-Namen aus der Remote-URL (letztes Segment ohne `.git`).

### 2. Tageslog schreiben

**Modus A:** Ziel-Datei `{vault}/Log/JJJJ-MM-TT.md`

**Modus B:** Ziel-Datei `docs/session-log/JJJJ-MM-TT.md` im Projektverzeichnis. Verzeichnis anlegen wenn nicht vorhanden.

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

### 3. Projektnotiz aktualisieren (nur Modus A)

Projektnotiz: `{vault}/Projekte/{name}/{name}.md`

Aktualisiere den Abschnitt `## Zuletzt aktualisiert` mit einem neuen Eintrag oben (neueste Eintraege zuerst):

```
- JJJJ-MM-TT: {Kurze Zusammenfassung: was wurde umgesetzt, was steht noch aus}
```

Bestehende Eintraege bleiben erhalten.

### 4. Bestaetigung

Melde was geschrieben wurde:

**Modus A:**
```
Dokumentiert:
- Log/JJJJ-MM-TT.md (neu / ergaenzt)
- Projekte/{name}/{name}.md (Zuletzt aktualisiert)
```

**Modus B:**
```
Dokumentiert:
- docs/session-log/JJJJ-MM-TT.md (neu / ergaenzt)

Kein Vault konfiguriert. Log ins Projektverzeichnis geschrieben.
Fuer Vollmodus: ~/.claude/kontext.config.json anlegen mit vault-Pfad.
```

## Was dieser Skill nicht tut

- Kein Lesen von Vault-Dateien in den Kontext (das ist /kontext)
- Keine Code-Änderungen
- Kein Commit, kein Push
- Kein Überschreiben bestehender Log-Abschnitte — nur anhängen
