---
name: requirement
description: Turns a raw requirement into a business issue in story format for the PO loop, without technology and without implementation. Use this skill when the user calls /requirement (old name /fachplan) or wants to clarify a requirement with a product owner in business terms first, before a technical plan is made.
user-invocable: true
---
<!-- de: 1bed4501cc18 -->

# Requirement
<!-- de: e2f238d8f8e4 -->

A tool next to the process, before step 2 (`/techplan`): a raw requirement (dictated, from an email, from the chat) becomes a **business issue** — the basis for discussion with the product owner. Business issues describe the what and the why, never the how. They are groomed, never implemented. The PO loop is **opt-in**: whoever has no PO skips this skill and calls `/techplan` directly.

## Input `/requirement #T`: a source card instead of the chat
<!-- de: d8cda177a669 -->

Two cards are a permitted input, and the number comes as an argument: `/requirement #T` takes **the source card with its comments as the input of the requirement**, not the chat. First, a **halted `[Task]`** — `/implement-next` or `/implement-ready` halted at a question of the stop class, the halt stands as a comment on the board, the card waits in the backlog. Second, an **`[Idea]` that calls for weighing up**: if an idea calls for weighing up, `/requirement` with its number is the way; if there is nothing to weigh up or the human has already decided, `/task`. Which case applies, the human decides with the call — no skill reads it off the card, because whether there is something to weigh up is exactly the question a human answers.

1. Read the source card completely, body **and** comments — for a halted task, the halt comment names the point of the stop class and the one question, not the body.
2. Develop the business requirement from it: what the question leaves open in business terms becomes goal, acceptance criteria and open questions for the PO. Technical routes from the comment do **not** come along — they are the how.

**Every other card is rejected.** If `#T` carries neither the prefix `[Idea]` nor the prefix `[Task]` with a comment containing the literal follow-up sentence `A requirement is to be created from this via /requirement.` (in a German project `Daraus soll per /fachplan eine fachliche Anforderung entstehen.`, constant `HALT_FOLGESATZ` in `kit/night.mjs`), the skill ends with the message that `/requirement #T` only applies to a halted `[Task]` or to an `[Idea]` with something to weigh up, and creates nothing. `[Requirement]` and `[Plan]` stay rejected: the one is itself the root, in the other the full way has already begun. The German prefixes `[Idee]` and `[Fachlich]` count the same.

## Procedure
<!-- de: d8278c44e20b -->

### 1. Condense the requirement in business terms
<!-- de: 752d4dd7918c -->

Extract the business substance from the requirement. Ask when goal or benefit are unclear — but clarify only business matters, no technology.

### 2. Create exactly one business issue
<!-- de: 88f1a65efeb7 -->

Title: `<title>` without a prefix — `--art fachlich` on `issue check-form` and `issue create` puts the prefix of the project language in front (`[Requirement]` in an English project); by it all other skills and the night runner recognise business issues. The value `fachlich` of the option is a machine value and stays as it is in every language. Body in story format with four sections:
```markdown
## Goal
Who needs what, and why? (Effect for the user in PO language)

Author-Model: <value>

## Business acceptance criteria
How does the PO recognise that this is it? Concrete and checkable from the user's point of view.

## Non-goals
What explicitly does not belong to it? (Scope boundary)

## Open questions for the PO
What must be clarified in grooming? Once all questions are answered, the **first** line here is a note that begins with "Keine" (see "Grooming takes place in the body").
```

**Strictly free of technology:** no files, no architecture, no implementation details. The yardstick: a PO without knowledge of code understands every line.

**The `Author-Model:` line belongs in the section `## Goal`**, analogous to the convention in `/issues`. The value comes about in three stages: `KIT_AGENT_MODEL`, if not empty — otherwise the **session's own statement** — and only if neither can be determined, literally `unknown`. The line is never left out; `board.mjs issue create` creates no issue without it.

The reason is not the guard rail but what it is there for: without the author model it cannot be determined which model may check the business issue without checking its own document. A reviewer who reads their own text is none.

**Template convention.** If the human brings a template — a design draft, a mockup, a sketch —, every document of the chain carries the line `Template: <path> — binding | suggestion`: `/requirement` in the section `## Goal`, `/techplan` in the head of the plan, `/issues` in the `## Context` of every package that touches the look or structure of a view. With "binding", `/techplan` decides no open design question against the template — a contradiction is a stop question, at night `kit:clarify` —, and every such package names the place in the template and carries as acceptance criterion the acceptance by screenshot next to the template; `issue check-form` rejects a package with a binding template without a screenshot in the acceptance criterion (I5). With "binding", `/requirement` asks whether the project's design source (for example `CLAUDE-design.md`) should first be switched to the template; the answer stands in the body, and if yes, the switch is the first package.

The body comes about by the transport rule from `CLAUDE-workflow.md`, section "Long texts to the board": piece by piece via the shell into a file outside the project directory, each piece at most 6,000 characters and its **own** tool call with a literal path, never as a command-line argument; if `printenv TMPDIR` stays empty (Linux and WSL2 without sandbox), `/tmp` applies:
```bash
printenv TMPDIR
```

```bash
cat  > <tmpdir>/neues-issue.md <<'TEIL1'
## Goal
...
TEIL1
```

```bash
cat >> <tmpdir>/neues-issue.md <<'TEIL2'
… further pieces …
TEIL2
```

Before creating, a command checks the form; only with `ok: true` does `issue create` follow, violations are fixed in the file and checked again:
```bash
node .claude/kit/board.mjs issue check-form --art fachlich --body-file <tmpdir>/neues-issue.md --title "<title>"
```

```bash
node .claude/kit/board.mjs issue create --art fachlich --title "<title>" --body-file <tmpdir>/neues-issue.md
```

If a file step fails, the incomplete file is not transferred; if the board call fails, the skill reports the error with the path and ends without further mutation.

**No `--derived-from` — never.** The option carries the card number of the nearest ancestor to the board. The business issue **is** the root of the chain: it has no ancestor, and a reference from here would point into the void or to a foreign card. `/techplan` sets the option to this issue, `/issues` to the plan document — the root itself stays without.

**Special case Toolbox/kanban-kit tracker (idea pool):** If `issue create` returns an `ideaId` with `pending: true`, the business issue lies as a board-less idea in the project's idea pool. It becomes addressable (#N) and groomable only when the human schedules it — pool = unsighted raw requirement, backlog = in business work.

**After creating from a source card: the trail back.** If the business requirement `#N` came about via the input `/requirement #T` — from a halted `[Task]` as from an `[Idea]` —, the skill attaches exactly one comment to **#T**:
```bash
node .claude/kit/board.mjs issue comment <T> --text "Continuation: Issue #N"
```

On the new `[Requirement]` issue there is **no** origin line and **no** `--derived-from` — for the idea the same trail convention applies as for the task; `CLAUDE-Fachplan.md` (F9) forbids it at the business root. The trail runs in the other direction because the number of the new requirement only comes about here. Without the argument `#T` the call is dropped **without replacement**. If `issue create` returns only an `ideaId` with `pending: true`, the comment is dropped without replacement as well, and the message names the `ideaId`, so that the human lays the trail themselves when scheduling.

### 3. Close
<!-- de: 5a024214e249 -->

Report the created issue (number or `ideaId` + title) and the way forward:

> "The business issue is created. Groom it with the PO — answers and additions directly in the body. When the PO says: that's it — then `/techplan #N` for the technical plan."

## Grooming takes place in the body, never in comments
<!-- de: 93f58b177eb8 -->

**Binding:** everything a later plan must rely on belongs in the **body** of the issue — the PO's answers as well as the AI's additions. Comments are for history and discussion, not for decisions. The body is the **negotiated state**, comments are **history**; whoever only comments on a decision forces every later session to reconstruct it from a discussion. `board.mjs issue get` returns the comments as well, but that does not change the rule: what applies stands in the body.

Write the **PO's answers** directly behind the respective question under "Open questions for the PO" in the body. **If that answers all questions, the section gets as its first line a note that begins with "Keine"** — for example "Keine. The PO decided the 3 questions on 2026-09-24, the answers stand under each question." The word `Keine` is a machine value and stays German in every language: the night runner recognises the note only by it. Questions and answers stay below it; they are the negotiated state on which the plan relies (F8). The reason: the night runner reads only the **first** non-empty line of the section and holds the requirement as long as a question stands there — it does not recognise answered questions without this note. **Complete the human's raw issues:** if the human only throws down goal and rough requirement (the normal case), the AI fills in `## Business acceptance criteria`, `## Non-goals` and `## Open questions for the PO` in the body while grooming — not as a comment.

This is how the completed body gets to the board, again via a file **outside the project directory**:
```bash
node .claude/kit/board.mjs issue update <id> --body-file <path>
```

**The existing `Author-Model:` line must be kept.** Unlike `issue create`, `issue update` does not check it: the body is written through as it comes. A grooming session that rephrases the body and forgets the line loses it silently. Whoever replaces the body takes over the line from the old state.

## Stop points
<!-- de: 5cbb510971de -->

- No technical plan, no technical issues — those only come after the PO's release via `/techplan #N` and `/issues`.
- No code, no commit.
- Never move business issues to Ready — Ready means implementable, and business issues are never implemented.
