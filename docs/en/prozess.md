# The process
<!-- de: d8138c0b031d -->

The kit takes a requirement (Anforderung) through nine steps into production. Three belong to the human: the GO, the push and the merge. Alongside them there are tools that supplement the process or split a step more finely.

## The nine steps
<!-- de: 10d52693607a -->

| Step | What | Who | Skill |
|---------|-----|-----|-------|
| **1** | **Formulate the requirement** | **Human** | (no skill) |
| 2 | Plan the requirement | AI | /techplan |
| 3 | Create issues | AI | /issues |
| **4** | **GO: pull issues to Ready** | **Human** | (no skill) |
| 5 | Implement Ready issues | AI | /implement-ready |
| 6 | Run local checks | AI | /local-check |
| 7 | Carry out the review | AI | /kit-review |
| **8** | **Push to main** | **Human** | /push-main |
| **9** | **Merge to production** | **Human** | /merge-production |

Between steps 8 and 9 you check the test server in the browser; there is no skill for this.

## Tools alongside the process
<!-- de: 57f02d451fe9 -->

The tools carry no number, because a number would claim an order and an obligation.

**Supplement the process**

| Skill | What for |
|-------|-------|
| `/session-start` | Session start: load the vault, project status |
| `/triage` | talk an idea through with the human and bring it onto its lane (Bahn) |
| `/requirement` | requirement as a business issue for grooming with the PO |
| `/issue-review` | have a business requirement, plan document **or** work package reviewed, one command for three stages |
| `/groom` | decide the open questions of a reviewed business plan (Fachplan) one by one with the PO |
| `/retro` | AI retrospective, consolidate memory |
| `/document` | Session end: daily log and project note |

**Replaces steps 2 and 3**

| Skill | What for |
|-------|-------|
| `/task` | requirement without anything to weigh up as a single work package (Arbeitspaket) `[Task]` |

**Replace step 5 with a finer gait**

| Skill | What for |
|-------|-------|
| `/implement-next` | exactly one Ready issue instead of the whole column |
| `/implement-test` | only the red tests, stop before the implementation |
| `/implement-done` | implementation against the prepared red tests |

## The skills
<!-- de: 2587afd1e05e -->

The eighteen skills in the order of the flow, each with purpose, when to call it and the next step.

### /session-start
<!-- de: 46aeaf57fd41 -->

**What for:** The skill loads the context you need to work. With a vault it reads profile, working rules and project note, otherwise the board. It reports running projects, recent decisions and what is due.

**When:** at the start of every session.

**Next:** the step the overview names.

### /triage
<!-- de: a2cb8dd79059 -->

**What for:** An `[Idea]` is a raw idea, not yet a requirement. `/triage #N` reads it with its attachments, presents every unclear point on its own with a recommendation and writes the clarified state into the idea right after each confirmation. Finally the skill proposes a lane with its reason; you choose one of four outcomes.

**When:** as soon as an idea is on the board and you want to tackle it. The skill runs only interactively.

**Next:** the chosen outcome. `1` implements a trifle right away and closes the idea with a reference to the commit. `2, fachlich` leads via `/requirement #N` into a business requirement, `2, technisch` via `/techplan #N` directly into a technical plan, `3` via `/task #N` into exactly one work package.

If you already know what the idea wants, you call two of these routes directly: if it requires a trade-off (Abwägung), `/requirement #N` turns it into a business requirement; if there is nothing to weigh up, it becomes exactly one work package via `/task #N`. Whether there is something to weigh up is decided by the human. An idea goes directly to a technical plan only via `/triage` with the lane `2, technisch`.

### /requirement
<!-- de: 8f12b9cea292 -->

**What for:** The skill turns a raw requirement into exactly one business issue: title with the prefix `[Requirement]`, body in story format with goal, business acceptance criteria, scenarios, non-goals and open questions to the PO. The text is free of technology and written in the PO's language. Before creating, `issue check-form` checks the form.

**When:** in projects with a product owner, before the plan. Input is a requirement from the chat, an `[Idea]` that needs a trade-off, or a halted task.

**Next:** `/issue-review #N` on the business plan, then `/groom #N`. Without a PO you start directly with `/techplan`. What a business plan looks like is described under [PO loop](#po-loop-business-and-technical-issues).

### /issue-review
<!-- de: 62ef9c398bc1 -->

**What for:** Models that did not write the document read a business plan, a plan document (Plandokument) or, on request, a work package and deliver findings as a comment. The calling session incorporates every finding or rejects it with one sentence. At the end it sets the label `review:done` as a trace on the board; a finding of the stop class (Stopp-Klasse) sets `kit:clarify` instead. The skill reads the stage from the title prefix; which roles review is said by `reviewStufen`. Details under [Issue review across multiple models](/en/dokumentation#issue-review-across-multiple-models).

**When:** after `/requirement` on the business plan and after `/techplan` on the plan document. Work packages are reviewed only on explicit request.

**Next:** on the business plan `/groom #N`, on the plan document `/issues #N`. `review:done` is also a prerequisite of the night chain (Nacht-Kette). The label does not release the content: if a document changes substantially afterwards, have it reviewed again.

### /groom
<!-- de: 46224877b7cd -->

**What for:** The skill decides the open questions of a reviewed business plan with the PO. Every question under `## Offene Fragen an den PO` comes on its own, with recommendation and reason, and you decide exactly this one. After your approval the session writes the answer into the body right away. A question can be deferred. Once all questions are decided, the skill sets the note “Keine” (none); the night chain reads it. `/groom` also adds scenarios to a business plan without them.

**When:** after `/issue-review` on the business plan and before `/techplan`. Input is a `[Requirement]` with `review:done` or `kit:clarify`; with `kit:clarify` the stop question comes first. The skill runs only interactively, writes nothing without approval and removes no label.

**Next:** `/techplan #N`. If an answer changed criteria or non-goals, the skill first proposes another review.

### /techplan
<!-- de: bf9cbbfad064 -->

**What for:** Step 2. The requirement becomes a plan with goal, affected areas, architectural decisions, planned changes, open questions and verification. Under “open questions” there are only questions of the stop class; everything else the skill decides and records as a decision. The skill implements nothing; technical issues are created only in `/issues`. Once you approve the plan, for lane 2 it creates it as a plan document with the title prefix `[Plan]`, with `Plan-Modell:` in the header and, if the plan came from a business plan, `Fachliche Quelle: Issue #N`.

**When:** after `/groom` or, without a PO, directly after the requirement. `/techplan #N` reads a business plan or an idea after `/triage` as its source.

**Next:** `/issue-review #N` on the plan document, then `/issues #N`.

### /task
<!-- de: 1b02c9104401 -->

**What for:** The skill replaces steps 2 and 3 for a task with nothing to weigh up, for instance a renaming across several files. It creates exactly one work package with the title prefix `[Task]` in the four-section format, without business plan, plan and origin lines. Beforehand it names the lane and waits for your word; unattended it creates nothing. Uncertainties outside the stop class it decides itself and records as an `Entscheidung:` line. A `[Task]` is a work package and is implemented like any other.

**When:** when [lane 3](/en/dokumentation#three-lanes) applies. Source is the chat or an `[Idea]` (`/task #N`); the skill rejects a business plan or plan document.

**Next:** the GO, that is pulling the package to Ready.

### /issues
<!-- de: ff34263675ef -->

**What for:** Step 3. The approved plan becomes work packages in the four-section format: context, task, acceptance criterion, dependencies. Every package can be tested on its own and carries in its context back references to plan and business plan as well as `Empfohlenes Modell:` or, with `night.stufen` active, `Aufgabenstufe:` and `Stufengrund:`. From here on the issue is the source of truth. The skill decides uncertainties as an `Entscheidung:` line; `issue check-form` checks every package before it is created.

**When:** after approval and review of the plan, with `/issues #N` and the number of the plan document.

**Next:** the GO.

The section `## Abhängigkeiten` contains `Keine.` or references `Issue #N`. Every local `#N` in the section counts as a dependency, also in explanations; only references `owner/repo#N` do not count. A reference line starts with `Issue #N` and carries no further number. When writing, `issue check-form`, `issue create` and `issue update` report every number from text and every reference to a document under `hinweise`; a document is not a work package. Dry run and deferral comment name the origin of each dependency. If packages hold each other, it says `Kreis: #A -> #B -> #A` there, and a package behind it waits for a cycle.

**GO (step 4, human):** You pull the packages that go into this pass to Ready on the board. The AI never pulls to Ready itself, except in the night chain under variant B, for which you gave the GO in advance on the card.

### /implement-ready
<!-- de: 317241748af5 -->

**What for:** Step 5. The skill works through the Ready column from top to bottom. Per issue: move to In progress, read it completely, implement test-driven, run the affected checks before the commit with `node .claude/kit/checks.mjs run`, commit locally, move to In review with a completion report (Abschlussbericht). It never pushes and pulls nothing out of the backlog. After the last package of a plan the final message starts with `## Stand des Vorhabens`: what a user sees now and what is missing.

**When:** after the GO.

**Next:** `/local-check`.

### /implement-next
<!-- de: 01886f1fcbf6 -->

**What for:** implement exactly one Ready issue, run the affected checks before the commit, commit locally, move to In review and end. Without an argument the skill takes the top Ready issue. `/implement-next #N` is a binding order: if `#N` is not in Ready, the run ends without a substitute.

**When:** when you want to implement exactly one package. In night mode the runner starts a fresh session with this skill per package.

**Next:** the next package or `/local-check`.

### /implement-test
<!-- de: cd022cb89461 -->

**What for:** the first part of step 5 split in two halves. The skill takes the next Ready issue, moves it to In progress and writes only the tests, which run red. No production code, no commit. If an issue is already in In progress, it refers to `/implement-done`.

**When:** when you want to see the transition from red to green yourself.

**Next:** `/implement-done`.

### /implement-done
<!-- de: 1429b5da14d3 -->

**What for:** the second part. The skill finds the issue in In progress, implements against the red tests until they are green, runs the affected checks before the commit and commits tests and code together. Format and limits are those of `/implement-ready`.

**When:** after `/implement-test`.

**Next:** `/local-check`.

### /local-check
<!-- de: 01a489d87f34 -->

**What for:** Step 6. The skill calls `node .claude/kit/checks.mjs run --since "$(git merge-base HEAD origin/<mainBranch>)"`. The command selects the affected `buildChecks` and measures everything since the last push. Then `mutationCommand` runs, if set. The package stage (Paketstufe) is run; checks of the stage `push` or `merge` appear in the checklist as omissions with their reason. With frontend changes the skill reminds you of the check in the browser. A red check stops the process.

**When:** after the implementation, before the review.

**Next:** `/kit-review`.

### /kit-review
<!-- de: e51c2df71691 -->

**What for:** Step 7. A reviewer without the context of the implementation reads the code as a stranger. Depending on `reviewScope` it reads the diff or the whole repo, as the agent `kit-pruefer` in the model from `reviewModel` or as the CLI from `reviewCommand`. The findings end up as a comment on the issue. If the call fails, the skill aborts visibly.

**When:** after `/local-check`.

**Next:** work in the findings (back to step 5) or `push main`.

### /push-main
<!-- de: 1fa8f342863c -->

**What for:** Step 8. The skill pushes the batch of commits to main. It reacts only to the typed trigger phrase `push main`, and every batch needs its own approval. It runs `checks.mjs run --stage push` with `--retry`, that is every check up to the stage `push` without selection by areas; if one wobbles, it asks before the commit. Generation steps from the project's `RELEASING.md`, such as version bump and changelog, it runs before the check run; pre- and post-push steps from it around the push.

**Prepared at night.** A night chain with the goal `goal:push-prepared` starts `/push-main prepare`. This session does not push: in a worktree of its own it runs the generation steps, the full check run of the stage `push` and the commit. The result `gruen`, `gruen-offen` or `rot` lies in `.claude/push-vorbereitung.json`. If you type `push main` in the morning and nothing has changed since, the skill takes over the state with the line `Übernimmt den Stand der Nacht vom <zeitpunkt> (<commit>)` and does not check again. If the project runs the full run in the build service (Build-Dienst), the open item `voller Lauf im Build-Dienst (Prüfzweig <zweig>)` remains at night; in the morning the skill pushes the commit to the check branch (Prüfzweig), waits for the build service and pushes main only on green.

**Emergency route.** If the build service fails, `/push-main emergency` pushes despite a protected main after a full green run on your own machine, only interactively.

**When:** after the review, on your command.

**Next:** check the test server in the browser.

### /merge-production
<!-- de: 26b63723de07 -->

**What for:** Step 9. The skill creates a pull request (GitHub) or merge request (GitLab) from main to production; you merge yourself. It reacts only to the trigger phrase `merge production` and stops if your local main carries commits that have not been pushed yet.

Before the PR there is a CI gate: `node .claude/kit/board.mjs code ci-status --commit <sha>` queries the state of the CI for the state on `origin/main`, before version bump and release commit. If it is red, no PR is created, and the skill names the red jobs. If it is still running, it asks once. The reason: the local `buildChecks` do not measure what the CI measures, for instance a different runtime or a fresh checkout. Then the skill runs the release stage with `checks.mjs run --stage merge`, that is only what was not checked at the push.

The skill does not set a Git tag. At the end it prints the finished command line with the hash of the version commit:

```
git tag -a vX.Y.Z <hash> -m "Release vX.Y.Z" && git push origin vX.Y.Z
```

**When:** after you have checked the test server, on your command.

**Next:** merge the PR, set the tag, move the cards to Done.

### /retro
<!-- de: 113d0e7af068 -->

**What for:** an AI retrospective on the collaboration. The skill asks where things got stuck, what is outdated in memory and which rule needs sharpening, and reports the key figures of the process. The result is changes to convention files and memory.

**When:** every one to two weeks.

**Next:** continue in the normal flow.

### /document
<!-- de: 176dc537f66b -->

**What for:** The skill writes a daily log with what was decided and implemented and updates the project note. With a vault the entry goes to `{vault}/Log/YYYY-MM-DD.md`, without a vault to `docs/session-log/`.

**When:** at the end of every session.

**Next:** the next session starts with `/session-start`.

## A complete pass
<!-- de: 57e472599ed8 -->

| Step | What you do | What you see afterwards |
|---------|-------------|----------------------|
| Business plan | `/requirement` with the requirement | a `[Requirement]` in the backlog |
| Review | `/issue-review #N` | findings as a comment, worked in; label `review:done` |
| Groom | `/groom #N`, question by question | answers in the body, “Keine” under the open questions |
| Plan | `/techplan #N`, read, approve | a `[Plan]` in the backlog |
| Packages | `/issue-review #N` on the plan, then `/issues #N` | work packages in the backlog, each with back references |
| GO | pull packages to Ready on the board | the packages in Ready, in your order |
| Implementation | `/implement-ready` | local commits, packages in In review, one completion report each |
| Local check | `/local-check` | a checklist, all green |
| Code review | `/kit-review` | the reviewer's findings as a comment |
| `push main` | type the trigger phrase | main up to date on the remote, the test server follows |
| Test server | golden path and edge cases in the browser | the result works, or you go back to step 5 |
| `merge production` | type the trigger phrase | a PR to production and the line for the tag |
| Done | merge the PR, move the cards to Done | business plan, plan and packages in Done |

Without a PO the pass starts at `/techplan`. The kit moves plan and business plan to In review as soon as all packages are there; you move them to Done.

## PO loop: business and technical issues
<!-- de: d8604542a560 -->

A product owner wants to accept the requirement on the business side before technology is created. For this the kit separates two kinds of issue:

- **Business issues** (`[Requirement]`, created with [/requirement](#requirement)) describe the what and why. They are groomed on the board; the answers are in the body, not in comments. They are never implemented.
- **Technical issues** are created only after the business approval: `/techplan #N` reads the business issue with its complete body, `/issues` cuts the packages from it.

The flow: `/requirement`, `/issue-review #N`, `/groom #N`, `/techplan #N`, `/issues #N`, then GO and implementation. Without a PO you start at `/techplan`.

**The rules behind it:**

- **Two back references in the context section.** Every work package carries, one below the other:

  ```
  Plan: Issue #M
  Fachliche Quelle: Issue #N
  ```

  The `Plan:` line names where the plan is found, `Plan-Modell:` in the plan its author. Neither line ever goes into the dependencies: the night runner would read them as an unfulfilled dependency, and since plan and business plan are finished only after their packages, the packages would stay deferred for good.
- **Four kinds of card never go into implementation.** Business issues (`[Requirement]`), ideas (`[Idea]`), plan documents (`[Plan]`) and human steps (Menschenschritte, `[Human]`) are put back into the backlog with a comment by `/implement-ready`, `/implement-next` and the night runner, without starting a session. A human step is a work package whose task lies outside the repository, for instance a setting, an account, an access or an approval; its comment says that the card is waiting and has not failed.
- **Life cycle:** The human moves business issues and plan documents out of the backlog only to Done or not at all. For them In review means “everything built, review due”, and this column is set by the kit: as soon as all packages of a plan are in In review or Done, it moves plan document and business requirement there. The night chain (`night.mjs --chain`) reads only the backlog column and places plan and packages there. Whoever moves a business issue out of the backlog before its chain takes it away from the night run: it is then no longer a candidate, without anything failing. The way out is the interactive route with a number, `/techplan #N`, `/issue-review #N`, `/issues #M`; it works regardless of column and marker.

### Scenarios in the business plan
<!-- de: 4241c04041f5 -->

Every business plan carries, between `## Fachliche Akzeptanzkriterien` and `## Nicht-Ziele`, a section `## Szenarien` with at least one scenario. A scenario has a heading `### Szenario: <Titel>` and list lines below it:

- `Angenommen` (given) describes the starting situation,
- `Wenn` (when) the action,
- `Dann` (then) the observable result,
- `Und` (and) continues the line before.

A scenario is complete with a title and at least one line each of `Angenommen`, `Wenn` and `Dann` in this order. In English projects the keywords are `Given`, `When`, `Then`, `And`. Not every criterion needs a scenario. An example:

```markdown
## Szenarien

### Szenario: Fachplan ohne Szenarien wird abgewiesen
- Angenommen ein Projekt hat den Stichtag szenarienAb gesetzt
- Und ein Fachplan hat fachliche Akzeptanzkriterien, aber keinen Abschnitt Szenarien
- Wenn er über das Kit angelegt wird
- Dann wird er nicht angelegt
- Und die Meldung sagt in einem Satz, was fehlt, und zeigt die Form eines Szenarios
```

`issue check-form` and `issue create` reject a business plan that lacks the section, whose section is empty or carries no complete scenario; the message shows the form of a scenario. For cards on the board the obligation applies from the cut-off date [`szenarienAb`](/en/einstellungen); `node .claude/kit/board.mjs scenarios baseline` names the matching value. Without scenarios no technical plan is created; `/groom` adds them.

## Statements: believe instead of checking
<!-- de: ea25f7012643 -->

If you tell the session something about a fact, such as what is running right now, that is a statement (Mitteilung) and not an order. The session takes it over unchecked and verifies it with no tool. It answers in a fixed form that names scope and consequence:

```
Mitteilung übernommen, ungeprüft — gilt, bis du Entwarnung gibst. Folge: Ich starte keinen zweiten Nachtlauf.
```

This makes a wrong classification visible at once. A statement does not replace a mandatory check, and a quoted trigger phrase does not trigger a push. At night there are no statements. The binding wording is in `CLAUDE-workflow.md`, section “Mitteilungen des Menschen”.
