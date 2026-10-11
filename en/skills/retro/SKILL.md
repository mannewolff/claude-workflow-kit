---
name: retro
description: AI retrospective that reflects on the human-AI collaboration, consolidates memory, sharpens workflow rules and reports the key figures of the process. Use this skill when the user calls /retro or wants to start an AI retrospective (recommended every 1-2 weeks).
user-invocable: true
---
<!-- de: dbc8f684aff1 -->

# Retro
<!-- de: 8679a90ec843 -->

A tool next to the process, every one to two weeks: AI retrospective. Not a team event — a format of its own that reflects on the human-AI collaboration, sharpens workflow rules and measures the process by numbers instead of feelings.

## Four guiding questions
<!-- de: 3542dacc3cff -->

### 1. Where did the human-AI collaboration get stuck?
<!-- de: 16fc339ab1f2 -->

Look at the last commits, issues and sessions:
- Where did the human frequently have to correct?
- Which misunderstandings caused work?
- Which questions should I have asked earlier?
- Where did I cross scope boundaries?

### 2. Which memory entries are outdated?
<!-- de: af61cbf5da40 -->

Check existing memory files (e.g. in `.claude/`, `CLAUDE*.md`, vault notes):
- Rules that are no longer true
- Decisions that have been superseded
- Conventions that have not proven themselves in practice

Propose concrete changes. Outdated memory is worse than no memory.

### 3. Which workflow rule needs sharpening?
<!-- de: c550e8ea90a1 -->

Identify anti-patterns that have repeated themselves:
- Where was the boundary between AI step and human step unclear?
- Which stop point was almost bypassed?
- Which skill text led to misunderstandings?

### 4. What do the numbers say?
<!-- de: 1117b69a0bc5 -->

Five key figures for the retro period, each with its source. Counted from the board (`node .claude/kit/board.mjs issue list`, `issue get <N>` with comments, `issue activity <N>` where the tracker can do it) and from `git log`. A number that cannot be determined is written as "not determinable: <reason>" — never estimated.

- **Overturned decisions.** Number of entries under `### Decisions` in the completion reports and under `## Architectural decisions` in the plans of the period (E entries according to `CLAUDE-workflow.md`, "Decide instead of asking"; in older or German documents `### Entscheidungen` and `## Architektonische Entscheidungen`), and of those the number the human overturned afterwards — recognisable by a comment or commit that reverses the decision. The ratio is the key figure: if it stays close to zero, "Decide instead of asking" holds; if it rises, the retro names the affected decision class as a candidate for the stop class.
- **Stop questions.** Number of halts with `kit:clarify` (or its old name `kit:klaeren`) in the period and, per halt, the point of the stop class.
- **Requirement to GO.** Per initiative the calendar days from creating the first document (`[Requirement]`, `[Plan]` or `[Task]`, old prefix `[Fachlich]`) to pulling it into Ready.
- **GO to push.** Per initiative the calendar days from pulling into Ready to the push of the last commit.
- **Night packages without objection.** Per comment with the anchor `## Night report, chain` (old anchor `## Nachtbericht, Kette`) in the period, the packages named by its section `### Stages`, in three numbers: without objection (pulled into Ready without a prior body change and without a comment by the human), after change (pulled only after a body change or a comment), held back (not pulled or closed by the day of the retro). Pulled means: the first change to Ready according to `issue activity`; changes and comments before that from `issue activity` and `issue get`. The number is the argument for or against variant B from idea #637 (the marker on the requirement as GO): if "without objection" stays high, the pulling merely repeats the judgement on the plan. If the tracker delivers no history: "not determinable: <reason>".

## Output
<!-- de: e8c3043fd47f -->

The retro produces concrete changes:
- **Update memory files** (write directly, no asking back)
- **Adjust CLAUDE*.md or skill texts** (sharpen rules, remove ambiguities)
- **Create new follow-up issues** if a structural problem needs a fix
- **Mark a decision class as a proposal for the stop class** if it was overturned repeatedly — as a proposal in the summary, not entered into `CLAUDE-workflow.md` yourself: the stop class is process (W1 to W4) and thus the human's business.

At the end, write a short summary:

```
## Retro result <DATE>

### Friction points
- ...

### Memory changes
- <file> — <what changed and why>

### Rule sharpenings
- <skill or CLAUDE.md> — <what was made more precise>

### Key figures
| Key figure | Value | Source |
|----------|------|--------|
| Overturned decisions | <overturned> of <total> | completion reports, plans, comments |
| Stop questions | <number>, points: <1–6> | cards with kit:clarify |
| Requirement to GO | <days per initiative> | board history |
| GO to push | <days per initiative> or not determinable: <reason> | board history, git log |
| Night packages without objection | <without objection> / <after change> / <held back> | night reports, board history |

### Proposal for the stop class
- <decision class and reason> or: none

### New issues
- #N: <title>
```

## Cadence
<!-- de: e09cc6c84c46 -->

Recommended every 1–2 weeks. Not at the first sign of friction — the retro sums up several sessions and looks for patterns, not for individual cases.
