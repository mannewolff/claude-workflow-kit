---
name: kontext
description: Old name of /context — runs /context with the same arguments. Use this skill when the user calls /kontext.
user-invocable: true
---
<!-- de: cf146163da26 -->

# Kontext — old name of context
<!-- de: dfc22b0cb805 -->

This skill is now called **`context`** and carries no instructions of its own. Immediately
run the skill `context` with the same arguments and follow its instructions alone:

```
Skill(skill: "context", args: "$ARGUMENTS")
```

The old name stays callable so that existing habits and references keep working
(Issue #1463, plan #1420 E16). What the skill does is in `skills/context/SKILL.md`.
