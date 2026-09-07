---
name: plan
description: Wegweiser — der Planungsschritt des Kits heisst jetzt /techplan. Dieser Skill erstellt keinen Plan.
user-invocable: true
---

# Plan — heisst jetzt techplan

**Dieser Skill erstellt keinen Plan.** Er sagt nur, wo der Planungsschritt geblieben ist.

Der Planungsschritt des Kits — Schritt 2 des 9-Schritt-Prozesses — heisst seit dem
2026-09-07 **`/techplan`**. Rufe ihn so auf:

```
/techplan #N
```

## Warum

Unter dem alten Namen standen zwei gleichnamige Werkzeuge zur Auswahl: der eingebaute
Planungsmodus der Entwicklungsumgebung und der Skill des Kits. Am 2026-09-04 liess sich
der Kit-Skill dadurch gar nicht mehr aufrufen, am 2026-09-07 kam er nur ueberlagert. Ein
Schritt des Prozesses hing damit daran, welches der beiden Werkzeuge die Umgebung gerade
anbot.

Der neue Name benennt ausserdem beide Haelften der Kette gleich: erst der Fachplan
(`/fachplan`), dann der Techplan (`/techplan`).

## Was sich sonst geaendert hat: nichts

Der Ablauf, das verbindliche Format des Plandokuments und die Stop-Punkte sind
unveraendert. Ebenso unveraendert bleiben das Titel-Praefix `[Plan]`, die Pruefstufe
`plan` in `/issue-review` und die Kopfzeilen `Plan-Modell:` und `Plan-Review:`. Geaendert
wurde allein der Name, unter dem der Skill aufgerufen wird (Issue #478).

Dieser Wegweiser wird nicht gepflegt. Was der Planungsschritt tut, steht in
`skills/techplan/SKILL.md`.
