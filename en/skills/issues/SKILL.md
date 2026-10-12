---
name: issues
description: Step 3 of the 9-step process — turns a released plan into small-scale GitHub issues in the four-section format. Use this skill when the user calls /issues, wants to create issues from a plan or starts step 3 of the process.
user-invocable: true
---
<!-- de: 74497ece3a1a -->

# Issues
<!-- de: 23f9a3c9c6cf -->

Step 3 of the 9-step process: the released plan is turned into one or more issues. From now on the issue is the source of truth, not the chat.

## Procedure
<!-- de: d8278c44e20b -->

### 1. Check the plan
<!-- de: e79a9c7fa5b2 -->

**Unattended** (set `KIT_AGENT_MODEL`): the distinguishing mark is **a set `KIT_AGENT_MODEL`** and explicitly no second signal. The night runner does put a sentence in front of the assignment that names the mode of operation; **only `KIT_AGENT_MODEL` counts, the hint in the prompt merely repeats it** — its absence is no all-clear.

The input is a `[Plan]` document, passed as `/issues #N` and read with `node .claude/kit/board.mjs issue get <N>`. The session checks two conditions itself: `title` carries the prefix `[Plan]`, and the first non-empty line under `## Open questions` — outside of code blocks — begins with `- Keine.`; text behind it on the same line is allowed. The word is a machine value and stays German in every language. A marker on the plan is no condition: whether the plan was checked is decided by the human with the routing label, which the runner reads when selecting candidates and the session does not re-check.

**Error path:** if one of the two conditions is missing unattended, **nobody is asked** — at night nobody answers. The session writes a board comment on the document whose first line reads `No input for /issues: <missing prefix | open stop question>`, creates **no** issue and ends.

**Interactive:** check whether a plan released in **this session** exists. If not: **STOP — do not create issues.** Point out that `/techplan` must run and be released first. A list of ideas or use cases in the chat is **no** released plan.

### Decide instead of asking
<!-- de: d70d0909e047 -->

What is unclear while cutting and does not belong to the stop class from `CLAUDE-workflow.md` (section "Decide instead of asking") is decided by the session, which writes it as a line into the `## Context` of the affected package, in the format from there:
```
Decision: <question>. Chosen: <route>. Rejected: <alternative>. Reason: <one sentence>. Rollback: <trivial | one file | migration>.
```

A stop question is asked interactively; unattended the skill ends with the comment `No input for /issues: open stop question` on the plan and creates no package. Stop class and format are not repeated.

### 2. Cut issues
<!-- de: 007a7609f3cf -->

One issue = one logical step that can be tested on its own. Criteria:
- An issue solves exactly one thing and can be committed and reviewed in isolation
- It has measurable acceptance criteria
- Dependencies on other issues are explicit
- What cannot be done with manageable effort is cut into sub-issues
- Portability convention: if a file or an artefact is meant to be portable on its own (installer, single-file tool, copyable script), the acceptance criterion must explicitly contain: "runs without further repo context". Without this test case the portability stays untested.
- Template convention: if the human brings a template — a design draft, a mockup, a sketch —, every document of the chain carries the line `Template: <path> — verbindlich | Anregung` (binding | suggestion; the values are machine values and stay German): `/requirement` in the section `## Goal`, `/techplan` in the head of the plan, `/issues` in the `## Context` of every package that touches the look or structure of a view. With `verbindlich`, `/techplan` decides no open design question against the template — a contradiction is a stop question, at night `kit:clarify` —, and every such package names the place in the template and carries as acceptance criterion the acceptance by screenshot (`Bildschirmfoto`) next to the template; `issue check-form` rejects a package with a binding template without `Bildschirmfoto` in the acceptance criterion (I5).
- Session-scope convention: every package carries in `## Context` the line `Session scope: passt | reisst — <one sentence>` (fits | exceeds), following the pattern of `Task-Tier:`. Two values and a sentence — explicitly **no estimated number of minutes** and **no third intermediate level**: a number of minutes would claim a measurement nobody made, and an intermediate level takes away the assessment's only statement. The yardstick is the time limit of **one session** from `--timeout-min` (default 60 minutes) — also in the night chain, where every session starts with the same limit. Explicitly **not meant** are the target mark `night.zielUmsetzungMin` and `night.kette.umsetzungMin`: the latter is the budget of the whole stage, is only checked between two sessions and says nothing about a single package. The line is a **hint, not a lock** — it holds nothing up and does not block the way to Ready; `issue check-form` knows no rule for it.
- Quality-measurement convention: the section `## Acceptance criteria` calls **no quality measurement** — no `mutationCommand`, no command of a `buildChecks` entry with a `guete` block and none from the config field `guetekommandos`. A mutation check runs once per release at its stage, not once per package: in the round it costs time the package lacks, and a full run blows the round's time limit. Where quality counts for a package, it stands as a mark in the configuration, not as a line in the card. `issue check-form` rejects a package whose acceptance criteria name one of these commands (I6).
  - **The convention applies without exception — also to the package that builds the measurement driver itself.** That is exactly where the temptation is greatest: the config does not know the driver yet, so I6 stays silent, and a real full run wanders into the criterion as evidence. In kanban-kit #1215 there were three full runs, well over an hour; the code was done after 15 minutes, the round died on the evidence line. What the criterion proves are **tests on fixtures or stored reports** — that the driver really runs through stands under `### Manual check (human, not part of the session close)`, never in the acceptance criteria.
  - **No `Decision:` line lifts the convention.** A line in `## Context` that pulls a full run or a quality measurement into the package with `Gewaehlt: ja` is rejected by `issue check-form` as an I6 violation. A driver the project is only building belongs with its command prefix into the config field `guetekommandos` — then I6 applies before it exists.

Author-model convention: every issue carries in the context section the line `Author-Model: <value>`. The value comes about in this order:

1. `KIT_AGENT_MODEL`, if set — the night runner fills it from `--model`.
2. otherwise the **session's own statement**: the model it runs under.
3. only if neither can be determined: literally `unbekannt`.

**The line is never left out** — a missing line and an unknown author are two different states, and the check must be able to tell them apart. The value is a statement, not proof; that is enough for its purpose: the author should not become their own reviewer. **This is not a request but a guardrail.** `board.mjs issue create` creates no issue if the line is missing and reports an error instead. Two ways to supply it: write it in the `--body` (the normal case of this skill) or pass `--author-model <model>` — then the adapter puts it into the context section itself. If `KIT_AGENT_MODEL` is set and neither line nor flag is present, the value comes from it; at night a session can therefore not fail on its own guardrail.

Plan-model convention: if the underlying plan names a line `Plan-Model: <value>` (see `/techplan`), every technical issue carries it **additionally** in the context section:
```
Author-Model: claude-opus-5
Plan-Model: claude-sonnet-5
```

If both agree, the `Author-Model` line is enough. **If they differ, both stand there** — that is not an error case but the interesting one: a plan by one model and issues by another are two authorships, and whoever looks for a defect later must know which of the two is meant.

Copies convention: if an issue changes a file of which the repo keeps a dogfooding copy (skills, kit tools), the task requires **`node tools/sync-blobs.mjs`** — not "carry the copy along". The tool reconciles `.claude/kit/` and `.claude/skills/` itself and turns `--check` red when something drifts.

Criteria convention: the section `## Acceptance criteria` contains **only criteria a session can check itself** — executable commands, file states, test results. What needs a human judgement or a human action (clicking through a UI, looking at a rendered document, judging text quality, a live test against a foreign instance) goes into a block of its own with **literally this heading**:
```markdown
## Acceptance criteria
- <machine-checkable>

### Manual check (human, not part of the session close)
- <what a human checks before the issue goes to Done>
```

The heading is the anchor by which `implement-*` and the night runner recognise the block — reworded in spirit, it does not work. What the convention does **not** allow: declaring a criterion manual just because it would be tedious to check automatically. The question is not "is it inconvenient" but "does it need a human judgement or a human action". Creating a throw-away directory and running a command in it can be automated and belongs above; judging whether a document is understandable belongs below. Without this boundary everything inconvenient wanders into the lower block over time.

Human-step convention: if the **whole** task of a package lies outside the repository — a setting in a web interface, an account, an access, a release — and no move of a session can do it, it is a human package: it is created with `issue create --art human`, and the kit puts the title prefix `[Human]` in front; the title itself then carries no prefix. That is something different from the block `### Manual check` above: that one takes a **part** of a package out of the session close, `[Human]` takes the **whole** package out of the implementation. Otherwise it stays a work package in the four-section format and falls into the stage `issue` with `issue check-form`; the task describes the action, the acceptance criteria how the human recognises that it is done. Without the prefix the night runner starts a session that recognises the case correctly and does nothing — but it cannot tell this correct inaction apart from a failure, and the card wanders into the backlog, where it looks like a failed package.

Convention "Protected file": if a planned change names a protected path — a file only a human may write —, it is separated out while cutting as a `[Human]` card of its own (`--art human`). The remaining package names this card under `## Dependencies` as `Issue #N`; as long as it is not done, the dependency mechanism holds the remaining package back. Which paths are protected is not copied here: what counts are `GESCHUETZTE_PFADE` in `kit/board.mjs` and the `deny` entries of the settings. Separate from that is the installed copy (`.claude/kit/`, `.claude/skills/`, `.claude/CLAUDE-*.md`): a package that wants to change the copy is cut wrongly — the source is meant, and `node tools/sync-blobs.mjs` or a kit update carries the copy along. `issue check-form` rejects both: a protected path as I8, the installed copy in `## Task` as I9. A human package itself is exempt from I7 to I9. If a package only talks about a protected path without changing it — in a test, a block list, the documentation —, `(nur genannt)` directly behind the backtick path marks the mere mention, for example ``Extend the list `AUSNAHMEN` by `.claude/settings.json` (nur genannt).``: this path then counts on this line neither for I8 nor for I7. The marker is a machine value and stays German. A second occurrence without the marker stays a hit, and if the session does write the path, Claude Code rejects the write.

Convention "Files in backticks": `## Task` names the files the package changes as backtick tokens — a token with `/` or with a file extension, not a label or a constant. Every detection starts from there; `issue check-form` rejects a package without such a file path in `## Task` (I7).

### 3. Create issues in the four-section format
<!-- de: 42f190942935 -->

Every issue gets four sections:
```
## Context
Why is this task done? What is missing before, which history belongs to it?
Author-Model: <value of KIT_AGENT_MODEL, otherwise 'unbekannt'>

## Task
What concretely is to be done? Affected files, tests to write (with TDD first), concrete changes.

## Acceptance criteria
How is it verified that the task is done? Concrete, measurable or executable.

## Dependencies
Which other issues must be finished first? Or: "None."
```

**Dependency convention (machine-readable):** the section contains either exactly `None.` or explicit references of the form `Issue #N` (several possible, one per line). Explanatory free text is allowed in addition — but if another issue is meant, the `#N` reference must stand with it. The reason: the night runner (`kit/night.mjs`) evaluates only `#N` references and automatically holds back issues with unmet dependencies; a dependency described only in prose is invisible to it. A dependency is unmet only as long as its card lies in Backlog, Ready or In progress; every other location — In review, Done, archived, not on the board — counts as met, even a mistyped number. Write dependencies on foreign repos as `owner/repo#N` (with repo prefix) — they are deliberately not counted as local issues.

**Every local `#N` in the section counts — also in explanations.** "Not #N: …" holds the package just as `Issue #N` does. A reference line begins, after optional white space and an optional list marker (`-`, `*`, `+`, `1.`), with `Issue #N` and carries no further local number; every other number comes from explanatory text, also one in the section's code block. What does not come from a reference line or points to a document (`[Plan]`, `[Requirement]`, `[Idea]`) is reported by `check-form` and `create` when writing under `hinweise` (see when creating below). A number that only explains belongs in `## Context`.

**If a package waits for a push, it says so on the reference line:** `Issue #N (wartet auf Push)`. The addition is a machine value and stays German. It applies if the package needs the changed tool, skill or rule text from #N **as a tool**; if it only builds on its code, that does not count, and the addition is dropped. The reason: unattended runs work with the kit state of the last push, so a tool from #N only takes effect there after `push main`, even if #N is already in In review. `/issues` sets the addition while cutting; the chain does not move a package marked like this to Ready, not even under variant B.

**Back references to plan and business source:** the chain should be readable at every point — from the work package to the plan, from the plan to the requirement. Both references stand **in the context section**, directly below each other and in this order:

```
Plan: Issue #M
Requirement: Issue #N
Plan-Decisions: E<n>, …
```

- `Plan: Issue #M` — if the work packages come from a `[Plan]` issue `#M` (created by `/techplan`, see issue #275), each of them carries this line.
- `Requirement: Issue #N` — if they come from a business issue (`[Requirement]` title, via `/techplan #N`), this reference is added.
- `Plan-Decisions: E<n>, …` — every package from a `[Plan]` issue names the entries under `## Architectural decisions` of the plan that its task relies on, or literally `Plan-Decisions: None.`. `issue brief` reads the line in order to hand exactly these decisions to the implementation word for word; if it is missing, the brief returns all entries of the plan and says that the package names no selection.

**Never in the dependencies section — neither of them.** The night runner counts every `Issue #N` reference there as a dependency. Neither the plan document nor the business issue becomes Done while its work packages run: the business issue only becomes Done when its technical children are finished, the plan document never through implementation anyway. If the reference stood below, all children would be held back permanently at night (chicken and egg).

The sentence stays correct despite the field `--derived-from` (see below): `derivedFrom` is no body line and can stand in no section at all; "neither of them" still means the two lines. The reason is sharper than the wording suggests — `parseDeps` in `kit/night.mjs` counts via `LOKALE_REFERENZ` **every** `#N` in the dependencies section as a dependency, even without the word `Issue` in front.

**The same additionally as a field to the board: `--derived-from`.** Besides the body lines, `issue create` gets the card number of the **nearest ancestor** (issue #356) — the `[Plan]` issue `#M`, otherwise the business issue `#N`, otherwise nothing at all:

```bash
node .claude/kit/board.mjs issue create --title "Title" --derived-from <M> --body-file <tmpdir>/neues-issue.md
```

- If a `[Plan]` issue exists: `--derived-from <M>`.
- If it is missing (plan only released in the session, or lane 1 without plan document): fall back to `--derived-from <N>`, the business issue.
- If both are missing: the option is dropped without replacement — no placeholder, no zero.
- **Special case pool idea:** if `issue create` returned `{ideaId, pending: true}` for the plan document, no number `#M` exists. Then **the same fallback** to the business issue applies — no branch of its own, just the same one.

**Field and line say the same, but last differently — and neither replaces the other.** The field is the **queryable** form: the board can group by it without taking bodies apart. The line is the **lasting** one: a **project move deletes the ancestry** on the board — that of the moved card and that of all cards pointing to it —, the body lines survive it. In addition, `github`, `gitlab` and `local` know no such field at all. Whoever later strikes the lines as duplicates of the field loses the ancestry at the first move.

**Distinction from the plan-model convention (issue #266):** `Plan-Model:` says **which model** wrote the plan — the originator. `Plan: Issue #M` says **where it stands** — the location. Both lines are independent of each other: `Plan-Model:` may be dropped with identical plan and issue author, the `Plan:` line is not affected by that and stands then too.

**Two edge cases:**

- **Plan without `[Plan]` issue:** `/issues` also accepts a plan that was merely released in the same session. Then **no `Plan:` line** comes about, no `Plan-Decisions:` line and no placeholder either — the line depends solely on whether a `[Plan]` issue exists as source.
- **Plan without business source:** if no requirement stands behind the plan document, only `Plan: Issue #M` stands.

Create the issue via the board adapter:
```bash
printenv TMPDIR
```

If the output of `printenv TMPDIR` stays empty (Linux and WSL2 without sandbox), `/tmp` applies as `<tmpdir>`.

```bash
cat  > <tmpdir>/neues-issue.md <<'TEIL1'
## Context
...
TEIL1
```

```bash
cat >> <tmpdir>/neues-issue.md <<'TEIL2'
… further pieces, each at most 6,000 characters …
TEIL2
```

Before creating, a command checks the form of every package; only with `ok: true` does `issue create` follow, violations are fixed in the file and checked again:
```bash
node .claude/kit/board.mjs issue check-form --body-file <tmpdir>/neues-issue.md --title "<title>"
```

```bash
node .claude/kit/board.mjs issue create --title "Title" --body-file <tmpdir>/neues-issue.md
```

The skill checks and creates a human package with `--art human`, both times with the same title without prefix:
```bash
node .claude/kit/board.mjs issue check-form --body-file <tmpdir>/neues-issue.md --title "<title>" --art human
```

```bash
node .claude/kit/board.mjs issue create --title "Title" --body-file <tmpdir>/neues-issue.md --art human
```

**The `hinweise` from `check-form` and `create` are read.** Besides `ok` and `verstoesse`, the JSON can carry the key `hinweise`. An entry with `art: schreibweise` names a number from explanatory text, an entry with `art: dokument` a reference to a document, an entry with `art: unbekannt` a number the board does not know — it counts as met, so a typo would hold nothing. None of the three touches `ok` or the exit code, but they show what the night run will read as a dependency. Per entry: if the number is not meant, the text is corrected before creating — the number leaves the section or moves into `## Context` —, and `check-form` runs again. If it is meant, the text stays, and the close names the hint with package and number. If only `create` reports a hint, the same rule applies; the correction then goes via `issue update <id> --body-file <tmpdir>/neues-issue.md` to the created card. Unattended the same applies without asking back: the session decides on each number itself.

Every block is an **own** tool call, the file lies outside the project directory, and the path stands literally — the limit of 6,000 characters applies per call, and a variable in the redirect target is rejected unattended. Why is in `CLAUDE-workflow.md`, section "Long texts to the board". **If a file step fails**, the incomplete file is not transferred; if the board call fails, the skill reports the error with the path of the file and ends without further mutation.

**Special case Toolbox/kanban-kit tracker (idea pool):** if `issue create` returns an `ideaId` with `pending: true` instead of a number, the issue has landed as a board-less idea in the project's idea pool — the board number only comes about when the human schedules the idea. Consequences for this skill:
- The close lists such issues with **titles** (plus `ideaId`), not with numbers, and points out that the numbers come about on scheduling.
- Dependencies between freshly created issues cannot carry an `Issue #N` reference yet. They are noted as explanatory free text with the **title** of the other issue; the human adds the `Issue #N` reference when scheduling. For the night runner free text without `#N` counts as no checkable dependency — deliberately accepted, the Ready order is set by the human anyway.

Status stays **Backlog**. The move to Ready is the human GO (step 4) — Claude never moves issues to Ready on its own authority. (In the idea pool flow accordingly: scheduling and moving to Ready are human.)

### 3b. Cross-check incorporated review findings
<!-- de: d2c1e1856a97 -->

If a `[Plan]` issue `#M` exists, the session reads its comments **before cutting** with `node .claude/kit/board.mjs issue get <M>` — the findings of the plan check and above all `## Incorporation, Round 1` (in older plans `## Einarbeitung, Runde 1`) with the list of findings taken over. After cutting it checks per finding taken over whether it arrives in at least one package: as task, as acceptance criterion or as `Decision:` line. A finding that stands in the plan body but arrives in no package gets lost in the transfer. The close names every such finding under **Review findings not transferred** with its identifier and one sentence, otherwise "none" stands there. Unattended the same list goes as a comment on the plan. If the plan carries no incorporation comment, the step is dropped, and the close says so.

### 4. Close
<!-- de: df3f353b6adc -->

**The recommendation stands in the package, not only in the report.** If `night.stufen` in `.claude/workflow.config.json` is not active, every created issue carries in the section `## Context` — next to `Author-Model:` — the line `Recommended model: <name>`. The night runner reads exactly this one and starts the card's session with it; a recommendation that only stands in the table below it does not find. The name comes from `night.modelle`, ordered by strength in descending order: **first entry** for tasks with architecture, security or complex interaction logic (OAuth flows, new components with a lot of state, concurrency, data migrations), **last entry** for mechanical, clearly specified tasks (extending an enum, carrying types along, restyling after a template, a change following an existing pattern). If the list is missing or empty, **the line is dropped without replacement** — an invented statement would be worse than none, and without a line the runner falls back to the model of the run.

**If `night.stufen` is active**, every package instead carries the lines `Task-Tier: <schwer|mittel|leicht>` (hard | medium | easy; the values are machine values and stay German) and `Tier-Reason: <one sentence>` and **no** `Recommended model:` line — `Author-Model:` stays, it is a statement of origin, not a recommendation. The rule shipped, exactly once in the kit: **schwer** with architecture, security or complex interaction logic, **mittel** with changes at several places following an existing pattern, **leicht** with mechanical, clearly outlined changes; a filled `night.stufenRegel` replaces it. The tier applies regardless of when and on which way a package comes about — also for packages from the night chain.

Then list all created issues with numbers and titles and add the table: without active setting with recommendation and reason, with active setting with tier, reason and the model assigned to it. It helps the human decide before the GO — the line(s) in the package carry the value for the machine, the table the reason for the reader:

| Issue | Recommendation/tier | Session scope | Reason |
|-------|---------------------|---------------|--------|
| #N | <model or schwer\|mittel\|leicht> | <passt\|reisst> | <one sentence> |

Below it, name the packages with `Session scope: reisst` by name — "Probably above the session time limit: #N, #M", otherwise "none" —, so that the assessment does not only stand in the cards before the GO. Then write: "All issues lie in Backlog. Move the issues you want implemented to Ready — that is your GO." Whoever wants a package checked calls `/issue-review #N`; the normal case is Ready without a package review.

## Stop point
<!-- de: cdc1bdeb424f -->

This skill ends after creating the issues. No code, no commit. The GO (move to Ready) is made by the human. Exception, exclusively in the implementation stage of the night chain under variant B: there the night runner moves the resulting work packages to Ready itself. The exception applies to the runner, not to this skill — no move to Ready by this skill.
