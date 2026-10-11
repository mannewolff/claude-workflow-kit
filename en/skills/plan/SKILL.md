---
name: plan
description: Signpost — the kit's planning step is now called /techplan. This skill does not create a plan.
user-invocable: true
---
<!-- de: 9de4e0f7e437 -->

# Plan — now called techplan
<!-- de: 55a8a36ba1a3 -->

**This skill does not create a plan.** It only says where the planning step has gone.

The kit's planning step — step 2 of the 9-step process — has been called **`/techplan`**
since 2026-09-07. Call it like this:

```
/techplan #N
```

## Why
<!-- de: 4e9135207e60 -->

Under the old name, two tools of the same name were on offer: the development
environment's built-in planning mode and the kit's skill. On 2026-09-04 the kit skill
could no longer be called at all because of it, on 2026-09-07 it only came overlaid. A
step of the process thus depended on which of the two tools the environment happened to
offer.

The new name also names both halves of the chain alike: first the requirement
(`/requirement`), then the techplan (`/techplan`).

## What else has changed: nothing
<!-- de: 188621471e72 -->

The procedure, the binding format of the plan document and the stop points are
unchanged. Equally unchanged are the title prefix `[Plan]`, the review stage `plan` in
`/issue-review` and the header lines `Plan-Model:` and `Plan-Review:`. Only the name under
which the skill is called was changed (Issue #478).

This signpost is not maintained. What the planning step does is in
`skills/techplan/SKILL.md`.
