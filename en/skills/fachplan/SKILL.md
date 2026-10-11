---
name: fachplan
description: Old name of /requirement — runs /requirement with the same arguments. Use this skill when the user calls /fachplan.
user-invocable: true
---
<!-- de: 4a94de74e2da -->

# Fachplan — old name of requirement
<!-- de: 6e200e3c4fbb -->

This skill is now called **`requirement`** and carries no instructions of its own. Immediately
run the skill `requirement` with the same arguments and follow its instructions alone:

```
Skill(skill: "requirement", args: "$ARGUMENTS")
```

The old name stays callable so that existing habits and references keep working
(Issue #1463, plan #1420 E16). What the skill does is in `skills/requirement/SKILL.md`.
