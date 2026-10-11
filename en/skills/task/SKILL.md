---
name: task
description: Turns a requirement without need for weighing up into exactly one work package with the title prefix [Task] — without business concept, without plan, without decomposition. Use this skill when the user calls /task or wants to implement a requirement above the trifle level where there is nothing to weigh up.
user-invocable: true
---
<!-- de: e440aea76e95 -->

# Task
<!-- de: 3f47b78f8c91 -->

Lane 3: above the trifle level, but without need for weighing up. This skill **replaces steps 2 and 3** and therefore carries no process number: a `[Task]` is exactly one work package without business concept, without plan and without decomposition. What comes afterwards — GO, implementation, review, push — is the normal way.

## Procedure
<!-- de: 785d89faa261 -->

### 0. Name the lane
<!-- de: daa8c8eb8bd5 -->

**Unattended** (set `KIT_AGENT_MODEL`): the skill ends with the message that the `[Task]` route needs a human confirmation, and creates **nothing**. No fallback "unattended the route counts as confirmed": at night nobody answers.

**Interactive:** one sentence — "This is lane 3: <reason in half a sentence>" — then the skill waits for a word of confirmation. Only afterwards does something come about. If it does not come, the skill ends without creating anything.

### 1. Take up the requirement
<!-- de: 65feb2ca09ec -->

Two inputs, and only two: the chat (`/task <requirement>`) or an `[Idea]` (`/task #N`; read body **and** comments). `/task` is the lane without need for weighing up, and the idea has two ways: if it demands weighing up, `/requirement #N` is the way; if there is nothing to weigh up or the human has already decided, `/task #N`. Which case applies is decided by the human with the call — the skill does **not** reject an idea with weighing up, because it cannot decide that; the distinction stands here so that it is known at the call.
Every other number is rejected by the skill with a message, and it creates nothing; the message names the prefix. If `#N` carries `[Requirement]` or `[Plan]`, the full way has already begun there — the way forward is `/techplan #N` or `/issues #N` respectively.

### 2. Read the existing code
<!-- de: 28d913a0813b -->

Read the affected files and existing patterns, look for reusable functions.

### Decide instead of asking
<!-- de: 09daaab45a4a -->

Every unclarity that comes up while writing the package and does not belong to the stop class from `CLAUDE-workflow.md` (section "Decide instead of asking") is decided by the skill itself and recorded in `## Context`, one line per entry:

```
Decision: <question>. Chosen: <route>. Rejected: <alternative>. Reason: <one sentence>. Rollback: <trivial | one file | migration>.
```

A question from the stop class it asks the human — exactly one per halt — before anything comes about. Stop class and format stand only there; the skill does not repeat them.

### 3. Write the body
<!-- de: beba405fe42f -->

The same sections as every work package from `/issues`, in this order:

```markdown
## Context
Why is the task done? History, decisions made.

Author-Model: <value>

## Task
What concretely is to be done: files, tests, changes.

## Acceptance criteria
How it is verified: concrete, measurable or executable.

## Dependencies
None. (or: Issue #N must be finished first)
```

`## Dependencies` as the **last** section — `parseDeps` in `kit/night.mjs` presupposes that. `Author-Model:` comes from `KIT_AGENT_MODEL`, otherwise from the session's own statement, otherwise literally `unbekannt`; the line is never missing. If `night.stufen` is active, the context section additionally carries `Task-Tier: <schwer|mittel|leicht>` and `Tier-Reason: <one sentence>` according to the rule from `/issues`, section 4 — the wording stands there, not here once more; without active setting nothing changes in the skill. And like every work package the context section carries the line `Session scope: passt | reisst — <one sentence>` according to the same rule from `/issues`, section 2: two values and a sentence, no estimated number of minutes and no third intermediate level, the yardstick the time limit of one session from `--timeout-min` and explicitly not meant `night.kette.umsetzungMin`, the budget of the whole stage — before the same GO stands the same reader.

**No `Plan:` and no `Requirement:` line.** A `[Task]` has no ancestor; the idea is the occasion, not the ancestor.

**If the task lies outside the repository, the prefix is `[Human]` instead of `[Task]`.** Meant is an action that no move of a session can carry out: a setting in a web interface, an account, an access, a release. Nothing changes in the body — the same four-section format, the same stage `issue` with `issue check-form`; the task describes the action, the acceptance criteria how the human recognises that it is done. Only nobody but them will implement it: `implement-*` and the night runner put a `[Human]` package back into the backlog with a comment, without starting a session. Without the prefix the runner would start a session that recognises the case correctly and does nothing — a correct inaction it cannot tell apart from a failure. Convention "Protected file": if the requirement additionally names a change to a protected path (`GESCHUETZTE_PFADE` in `kit/board.mjs`), it is separated out as a `[Human]` card of its own, and the `[Task]` names it under `## Dependencies` as `Issue #N`; a change to the installed copy instead of the source is cut wrongly — `issue check-form` rejects both (I8, I9), details in `/issues`, section 2. If a protected path is only mentioned, not changed, `(nur genannt)` stands directly behind the backtick path, for example ``Extend the list `AUSNAHMEN` by `.claude/settings.json` (nur genannt).`` — then it counts neither for I8 nor for I7. Convention "Files in backticks": `## Task` names the changed files as backtick tokens, otherwise `issue check-form` rejects (I7).

**Quality-measurement convention:** the section `## Acceptance criteria` calls **no quality measurement** — no `mutationCommand`, no command of a `buildChecks` entry with a `guete` block and none from the config field `guetekommandos`. A mutation check runs once per release at its stage, not once per package: in the round it costs time the package lacks, and a full run blows the round's time limit. Where quality counts for a package, it stands as a mark in the configuration, not as a line in the card. `issue check-form` rejects a package whose acceptance criteria name one of these commands (I6).

**The convention applies without exception — also to the package that builds the measurement driver itself.** That is exactly where the temptation is greatest: the config does not know the driver yet, so I6 stays silent, and a real full run wanders into the criterion as evidence. In kanban-kit #1215 there were three full runs, well over an hour; the code was done after 15 minutes, the round died on the evidence line. What the criterion proves are **tests on fixtures or stored reports** — that the driver really runs through stands under `### Manual check (human, not part of the session close)`, never in the acceptance criteria. And **no `Decision:` line lifts the convention**: a line in `## Context` that pulls a full run or a quality measurement into the package with `Gewaehlt: ja` is rejected by `issue check-form` as an I6 violation. A driver the project is only building belongs with its command prefix into the config field `guetekommandos` — then I6 applies before it exists.

### 4. Create
<!-- de: f4edf4d012ef -->

Following the transport rule from `CLAUDE-workflow.md`, section "Long texts to the board": the body comes about piece by piece via the shell outside the project directory, each piece at most 6,000 characters and an **own** tool call with a literal path, then it goes to the board in one call. If `printenv TMPDIR` stays empty (Linux and WSL2 without sandbox), `/tmp` applies:

```bash
printenv TMPDIR
```

```bash
cat  > <tmpdir>/neues-issue.md <<'TEIL1'
## Context
...
TEIL1
```

```bash
cat >> <tmpdir>/neues-issue.md <<'TEIL2'
... further pieces ...
TEIL2
```

```bash
node .claude/kit/board.mjs issue create --art task --title "<title>" --author-model "<value>" --body-file <tmpdir>/neues-issue.md
```

**The `hinweise` from `check-form` and `create` are read.** Before creating, `node .claude/kit/board.mjs issue check-form --art task --body-file <tmpdir>/neues-issue.md --title "<title>"` runs; the title carries no prefix, `--art task` puts the one of the project language in front (`[Task]` in both languages), for a task outside the repository `--art mensch` on both calls (`[Human]` in an English project; the values of `--art` are machine values and stay German); only with `ok: true` does `issue create` follow. Every local `#N` in the section `## Dependencies` counts as a dependency, also in explanations; only a reference line (`Issue #N` at the start of the line, no further number) is meant as one. The JSON of both calls can carry the key `hinweise`: an entry with `art: schreibweise` names a number from explanatory text, an entry with `art: dokument` a reference to a `[Plan]`, `[Requirement]` or `[Idea]` document that is not done through implementation. Neither touches `ok` or the exit code. If the number is not meant, the text is corrected before creating — the number leaves the section or moves into `## Context` —, and `check-form` runs again; if only `create` reports the hint, the correction goes via `issue update <id> --body-file <tmpdir>/neues-issue.md` to the card. If it is meant, the text stays, and the close names the hint with the number. Unattended the same applies without asking back — even though this skill ends there in step 0 today.

If a file step fails, the incomplete file is not transferred; if the board call fails, the skill reports the error with the path and ends without further mutation. **No `--derived-from`** — a `[Task]` has no ancestor, a reference would point into the void or to a foreign card.

**The trace to the source idea.** If the `[Task]` `#T` came about via `/task #N`, the skill attaches exactly one comment to the idea:

```bash
node .claude/kit/board.mjs issue comment <N> --text "Continuation: Issue #T"
```

If `issue create` returns `{ ideaId, pending: true }` instead of a number (idea pool of the Toolbox tracker), the `[Task]` lies as a board-less idea in the pool; the skill reports the `ideaId`, and the human schedules it first. The comment then reads `Continuation: Idea <ideaId> (not scheduled yet)`. Without the argument `#N` the comment is dropped without replacement. **Error case:** if creating fails, the skill reports **neither a number nor a successful close**.

### 5. Close
<!-- de: 8a48054c9476 -->

Number (or `ideaId`) and title, then literally:

> "The task lies in **Backlog**. Move it to Ready — that is your GO. Whoever wants it checked first calls `/issue-review #N`."

## A `[Task]` that rejects a finding
<!-- de: 4d38b46c7ef6 -->

A tool reports a finding, the rejection is defensible and is meant to hold. **The acceptance criterion is the versioned suppression rule** that the checking tool itself evaluates, with the reason directly next to it: the tool reads the rule, the reason addresses humans. The example is in the existing code: `sonar-project.properties` keeps the exclusion of `javascript:S4036` as a versioned line with the reason above it.

If a tool lacks a versionable way, its development belongs in an undertaking of its own; no cross-tool register comes about — it would be a list that no tool reads. **Verified** by running the same tool again: the rejected finding stays away, **and an independent control finding is still reported** — otherwise a mute tool cannot be told apart from an effective exclusion.

## Stop points
<!-- de: 8db9e91c1e1e -->

- **No creating without confirmation** — unattended the skill ends in step 0 and creates nothing.
- **No code, no commit.** This skill writes a work package, it does not implement it.
- **No move to Ready.** Ready is the human's GO. Exception, exclusively in the implementation stage of the night chain under variant B: there the night runner moves the resulting work packages to Ready itself. The exception applies to the runner, not to this skill — no move to Ready by this skill.
- **No `[Requirement]` and no `[Plan]` document as source** — there the full way has already begun.
