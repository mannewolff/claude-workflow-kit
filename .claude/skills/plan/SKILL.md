---
name: plan
description: Schritt 2 des 9-Schritt-Prozesses — erstellt einen Implementierungsplan, stellt ihn zur Diskussion und implementiert nichts. Nutze diesen Skill wenn der Nutzer /plan aufruft, einen Plan erstellen will oder Schritt 2 des Prozesses startet.
user-invocable: true
---

# Plan

Schritt 2 des 9-Schritt-Prozesses: Die KI erstellt einen Plan. Der Plan wird zur Diskussion gestellt, nicht zur Implementierung.

## Ablauf

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
