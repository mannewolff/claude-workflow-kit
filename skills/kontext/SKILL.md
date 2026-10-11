---
name: kontext
description: Altname von /context — führt /context mit denselben Argumenten aus. Nutze diesen Skill wenn der Nutzer /kontext aufruft.
user-invocable: true
---

# Kontext — Altname von context

Dieser Skill heisst jetzt **`context`** und trägt keine eigene Anleitung. Führe sofort
den Skill `context` mit denselben Argumenten aus und folge allein seiner Anleitung:

```
Skill(skill: "context", args: "$ARGUMENTS")
```

Der Altname bleibt aufrufbar, damit bestehende Gewohnheiten und Verweise weiter tragen
(Issue #1463, Plan #1420 E16). Was der Skill tut, steht in `skills/context/SKILL.md`.
