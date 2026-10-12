---
name: fachplan
description: Altname von /requirement — führt /requirement mit denselben Argumenten aus. Nutze diesen Skill wenn der Nutzer /fachplan aufruft.
user-invocable: true
---

# Fachplan — Altname von requirement

Dieser Skill heisst jetzt **`requirement`** und trägt keine eigene Anleitung. Führe sofort
den Skill `requirement` mit denselben Argumenten aus und folge allein seiner Anleitung:

```
Skill(skill: "requirement", args: "$ARGUMENTS")
```

Der Altname bleibt aufrufbar, damit bestehende Gewohnheiten und Verweise weiter tragen
(Issue #1463, Plan #1420 E16). Was der Skill tut, steht in `skills/requirement/SKILL.md` — auch der Weg nach der Prüfung über `/groom #N` zu `/techplan #N`.
