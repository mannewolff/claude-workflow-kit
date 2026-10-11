---
name: techplan
description: Step 2 of the 9-step process — creates an implementation plan, puts it up for discussion and implements nothing. Use this skill when the user calls /techplan, wants to create a plan or starts step 2 of the process.
user-invocable: true
---
<!-- de: 52c30da409cc -->

# Techplan
<!-- de: 5c77afcfbe90 -->

Step 2 of the 9-step process: the AI creates a plan. The plan is put up for discussion, not for implementation.

## In night mode
<!-- de: acf33728b3e6 -->

The distinguishing mark is **a set `KIT_AGENT_MODEL`** and explicitly no second signal — the same condition as in the section "In night mode" of `/issue-review`. The night runner does put a sentence in front of the assignment that names the mode of operation. **Only `KIT_AGENT_MODEL` counts; the hint in the prompt merely repeats it** — its absence is no all-clear.

At night the skill is started by the night runner with `node .claude/kit/night.mjs --chain`, per requirement with the label `kit:night` a fresh session with `/techplan #N` against the `[Requirement]` issue — the first stage of the night chain; the check of the plan and the cut into work packages follow in the same chain.

**At night nobody is asked — in no situation.** This applies to the lane (step 0), to every unclarity in the requirement (step 1) and to the discussion of the plan (step 4). A session waiting for an answer cannot be told apart from a failure by the runner. This rule applies to **every unattended run**, not only to this runner — also when another runner starts the skill.

Unchanged at night: no code, no commit, no technical issues, no move to Ready — the stop point at the end applies unattended as well. Unattended, the plan document from step 5 comes about **immediately after step 3**; the release then takes place on the board.

## Plan-Model: who wrote the plan
<!-- de: 5dedd17de1a6 -->

The plan names in its head the line:
```
Plan-Model: <the session's own statement>
```

The value comes about as for the `Author-Model` in `/issues`: `KIT_AGENT_MODEL`, if set — otherwise the running session's own statement. **If the skill runs as `/techplan #N` against a business issue, the statement additionally goes to the issue as a comment:**
```bash
node .claude/kit/board.mjs issue comment <N> --text "Plan created by <model> on <YYYY-MM-DD>"
```

The reason is the completeness of the chain: the technical issues carry their own `Author-Model`, and without this comment it would no longer be readable which model drafted the plan; the tracker always names the owner of the token as author.

## Input `/techplan #N`: business issue as source
<!-- de: 976986a02e59 -->

If the skill is called with an issue number and this issue carries the title prefix `[Requirement]` (PO loop, see `/requirement`; in older projects `[Fachlich]`), then **the issue is the source of the requirement, not the chat**:

1. Read the business issue completely — **the whole body**, because the grooming history with the PO's decisions is in there. The negotiation takes place in the body, not in comments: the body is the negotiated state, comments are history. `board.mjs issue get` additionally returns a `comments` array (history, completion reports, review findings) — it complements the body but does not replace it as the source of the requirement.
2. Develop the technical plan from goal, business acceptance criteria and non-goals; the non-goals are scope boundaries, not suggestions.
3. Reference the business issue explicitly in the plan ("Requirement: Issue #N"), so that `/issues` takes over the back reference into the technical issues.
4. **Template convention.** If the human brings a template — a design draft, a mockup, a sketch —, every document of the chain carries the line `Template: <path> — binding | suggestion`: `/requirement` in the section `## Goal`, `/techplan` in the head of the plan, `/issues` in the `## Context` of every package that touches the look or structure of a view. With "binding", `/techplan` decides no open design question against the template — a contradiction is a stop question, at night `kit:clarify` —, and every such package names the place in the template and carries as acceptance criterion the acceptance by screenshot next to the template; `issue check-form` rejects a package with a binding template without a screenshot in the acceptance criterion (I5).

## Procedure
<!-- de: d8278c44e20b -->

### 0. Determine the lane
<!-- de: 557a5fded1ce -->

**Unattended** (set `KIT_AGENT_MODEL`): **lane 2 always** applies. A plan document comes about even if the requirement would be lane 1 or lane 3 according to CLAUDE-workflow.md. The verdict is **not discarded**, but stands as the first line in `## Architectural decisions` — depending on the lane one of the two lines, literally:
```
- Lane 1 according to CLAUDE-workflow.md; recorded as a plan at night, decision with the human.
- Lane 3 according to CLAUDE-workflow.md; recorded as a plan at night, decision with the human.
```

For lane 3 there is a reason of its own: a `[Task]` only comes about after explicit human confirmation of the route (see `/task`). At night no confirmation can be obtained, so **no `[Task]` can come about at night** — the plan is then the only form in which the verdict reaches the morning.

**Interactive:** not every requirement needs a plan. Two lanes lead past it, and the skill names them instead of planning:

- **Lane 1** (small change according to the definition in CLAUDE-workflow.md): say so and offer to implement it **directly** — no plan overhead.
- **Lane 3**: if there is **nothing to weigh up** — that is, several defensible routes are not open —, say so, offer `/task` and **do not plan**. The matter then becomes a single work package with the title prefix `[Task]`, without business concept and without plan.

**The lane 3 offer only applies as long as no `[Requirement]` and no `[Plan]` document is present as source.** With `/techplan #N` against a `[Requirement]` issue, the full way that has begun is kept: `/task` explicitly rejects this source, and pointing to a skill that rejects the number would be a dead end. An **`[Idea]`** as source, by contrast, does **not** stand in the way of the offer — it is a raw requirement, not a way begun, and `/task #N` accepts it.

### 1. Understand the requirement
<!-- de: 82f960f0b4cb -->

Clarify first: what is to be built, which areas of the code are affected, are there dependencies on other issues or ongoing work?

**Unattended** (set `KIT_AGENT_MODEL`): there is **no asking back**. Every open point is decided according to `CLAUDE-workflow.md`, section "Decide instead of asking", and recorded as an E entry under `## Architectural decisions`, in the format from there. Only a question from the stop class stands in `## Open questions` — there and only there does the runner read it —, exactly one per halt; the plan then stays as a draft and is no input for `/issues`. A record outside the plan document does not count: what stands only in the session log or in a board comment, the next step does not see.

**Interactive:** ask when something is unclear. What the human decides stands in the same format under `## Architectural decisions`.

### 2. Read the relevant files
<!-- de: e4e5f69fa4f8 -->

Read the affected files and existing patterns. Use an Explore agent when the scope is unclear. Actively look for reusable functions and patterns — avoid new code when a suitable implementation already exists.

### 3. Create the plan
<!-- de: a444c46d1e71 -->

The plan has a **binding format** — like the four-section format of the work packages in `/issues`, not as a suggestion. Every plan contains the following six `##` headings **exactly once and in this order**. Sub-headings from level `###` may stand in between, but no further headings of level `##`:
```markdown
## Goal
## Affected areas
## Architectural decisions
## Planned changes
## Open questions
## Verification
```

The headings are the anchor on which the plan check and `/issues` work — **reworded in spirit, they do not work**. They are taken over literally: not renamed, not merged, not reordered. The German headings (`## Ziel` … `## Verifizierung`) count the same. **The order has a reason:** `## Open questions` stands **before** `## Verification`. Open questions should not be buried at the end — as the last section of the document they would be exactly that. What belongs in the sections:

- `## Goal` — what is built and what effect it has for the user.
- `## Affected areas` — files, modules, layers.
- `## Architectural decisions` — the decisions made, each with its reason:

  > Every architectural decision must carry a reason, so that its assumptions and trade-offs can be checked and attacked in the review.

  In addition the E entries from "Decide instead of asking": every question decided while planning, in the format from `CLAUDE-workflow.md`, numbered consecutively.

- `## Planned changes` — per file, what changes.
- `## Open questions` — **stop questions**: questions from the stop class in `CLAUDE-workflow.md`, section "Decide instead of asking". Questions that can be decided later do not belong here, they are decided and stand as an E entry under `## Architectural decisions`. **Error path:** if the section contains at least one open stop question, the plan must not be turned into work packages. Only after answering and incorporating is it put up for release again.
- `## Verification` — **describes the checks to be run, not their anticipated result.**

**There are no empty mandatory sections.** All six stay, even if there is nothing to say for one; in `## Architectural decisions` and `## Open questions` there is then `- Keine.` — the word is a machine value and stays German in every language: the night runner recognises a plan without a stop question only by `- Keine.` as the first line of `## Open questions`. **The metadata do not count.** The header lines `Plan-Model: …` and, where applicable, `Requirement: Issue #N` stand **before** `## Goal`. They are not a heading and thus not a seventh section of the format.

### 4. Put the plan up for discussion
<!-- de: 32b3cfe34b66 -->

**Unattended** (set `KIT_AGENT_MODEL`): the discussion is **dropped**, step 5 follows immediately. Without this exception no artefact comes about at night at all: the skill would wait for feedback that nobody gives, and the runner would see a failure. The release is not bypassed by this but postponed — it takes place on the board.

**Interactive:** present the plan and wait for feedback. Do **not** implement before the plan has been released. Accepting the plan is no GO — the GO comes separately (step 4).

**Test hints before presenting (lane 2, interactive):** write the plan draft with header lines to `<tmpdir>/plandokument.md` (as in step 5) and run `issue check-form --art plan --body-file <tmpdir>/plandokument.md --title "<title>"`. If the result reports `hinweise` — tests of their own for guided building blocks that the plan does not name —, they stand in **the same answer** as the plan, building block and test by name. The author takes the test into `## Planned changes`, as changed or as "stays green", always by name, or deliberately leaves the hint standing. A hint is no violation and does not hold up the discussion.

### 5. Create the plan document (lane 2 only — interactive after the release, unattended immediately after step 3)
<!-- de: 34164c939b87 -->

Once the plan stands — interactively after the release, unattended after step 3 —, the skill records it as an issue of its own: the **plan document**. Without it the plan is the only artefact of the chain without a place: it comes about in conversation, is skimmed once and disappears. The technical issues later refer to the business source, but what was decided **in between** — architecture, cut, trade-offs — could no longer be reconstructed after the session.

**With lane 1 no plan document comes about.** There is no plan there; an empty `[Plan]` ticket per trifle would be noise.

**Title:** `<title of the undertaking>` without a prefix — `--art plan` on `issue check-form` and `issue create` puts the prefix of the project language in front (`[Plan]` in both languages). The prefix is the binding convention by which the other skills and the night runner recognise plan documents and tell them apart from work packages — the same mechanism as `[Requirement]` and `[Idea]`. With `/techplan #N` the title comes from the title of the source issue **without its `[Requirement]` prefix**; otherwise from a brief name for the `## Goal` section.

**Body:** the released plan in the binding format from step 3 — all six sections, taken over unchanged. Above, before `## Goal`, the header lines:

- `Plan-Model: <value>` — **always**.
- `Requirement: Issue #N` — **only** if the plan came about from `/techplan #N` against a `[Requirement]` issue. For a plan from the chat this line is missing; inventing it would claim a source that does not exist.

Before creating, a command checks the form; only with `ok: true` does `issue create` follow, violations are fixed in the file and checked again:
```bash
node .claude/kit/board.mjs issue check-form --art plan --body-file <tmpdir>/plandokument.md --title "<title>"
```

The test hints stand in the result next to `ok` (`json.hinweise ?? []`); they touch neither `ok` nor the exit code. **Hints never halt.** Interactively the human saw them in step 4: what still stands afterwards does not halt again and stands in the closing answer. Unattended, the session decides without asking back — take the test in or leave the hint standing — and creates the plan. The comment `## Testhinweise der Formpruefung` with what stays standing is written to the plan afterwards by the night runner, not by the session.

**Created via:**
```bash
node .claude/kit/board.mjs issue create \
  --art plan \
  --title "<title>" \
  --author-model "<value from Plan-Model>" \
  --derived-from <N> \
  --body-file <tmpdir>/plandokument.md
```

The plan text comes about beforehand piece by piece, each piece in its **own** tool call, and the path stands literally — the limit of 6,000 characters applies per call, and a variable in the redirect target is rejected unattended. Why is in `CLAUDE-workflow.md`, section "Long texts to the board". **If a file step fails**, the incomplete file is not transferred; if the board call fails, the skill reports the error with the path of the file and ends without further mutation — the existing error case ("neither a number nor a successful close") stays unchanged:
```bash
printenv TMPDIR
```

If the output of `printenv TMPDIR` stays empty (Linux and WSL2 without sandbox), `/tmp` applies as `<tmpdir>`.

```bash
cat  > <tmpdir>/plandokument.md <<'TEIL1'
Plan-Model: <value>
Requirement: Issue #N

## Goal
…
TEIL1
```

```bash
cat >> <tmpdir>/plandokument.md <<'TEIL2'
… further pieces, each at most 6,000 characters …
TEIL2
```

**`--derived-from <N>` exactly when the plan came about from `/techplan #N` against a `[Requirement]` issue.** The option carries the card number of the nearest ancestor as a field to the board, so that it knows the chain requirement → plan → work package as data and not only as characters in the description text. For a plan from the chat it is **dropped** — just as the `Requirement:` line is dropped there; inventing a number would claim a source that does not exist.

**`--author-model` is mandatory.** The adapter rejects every body without an `Author-Model:` line unless the flag or `KIT_AGENT_MODEL` is set (`kit/board.mjs`). A plan body, however, carries `Plan-Model:`, not `Author-Model:` — without the flag, creating fails at runtime on every interactive run, while every text test stays green.

**Special case Toolbox/kanban-kit tracker (idea pool):** if `issue create` returns `{ ideaId, pending: true }` instead of a number, the plan document lies as a board-less idea in the project's idea pool. The skill then reports the `ideaId` and points out that the human must schedule it first — before that, no number exists under which it would be addressable.

**Error case:** if creating fails, the skill reports **neither a number nor a successful close**. A plan that stands nowhere is no recorded plan.

## Stop point
<!-- de: cd2b62e00a83 -->

This skill ends with a plan document for human release. No code, no commit, no **technical** issues, no move to Ready — only after an explicit GO. The `[Plan]` document is the only exception: it comes about with lane 2 interactively after the release, unattended immediately after step 3 — the release then takes place on the board —, because it records the state reached and does not anticipate its implementation. Exception to the move to Ready, exclusively in the implementation stage of the night chain under variant B: there the night runner moves the resulting work packages to Ready itself. The exception applies to the runner, not to this skill — no move to Ready by this skill.
