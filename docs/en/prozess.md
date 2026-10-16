# The process
<!-- de: 2253b4c80cbe -->

The kit takes a requirement (Anforderung) through eight steps into production. Three belong to the human: the GO, the push and the merge. Alongside them there are tools that supplement the process or split a step more finely.

## The eight steps
<!-- de: 2c7891dd9d34 -->

| Step | What | Who | Skill |
|---------|-----|-----|-------|
| **1** | **Formulate the requirement** | **Human** | (no skill) |
| 2 | Plan the requirement | AI | /techplan |
| 3 | Create issues | AI | /issues |
| **4** | **GO: pull issues to Ready** | **Human** | (no skill) |
| 5 | Implement Ready issues | AI | /implement-ready |
| 6 | Carry out the review | AI | /kit-review |
| **7** | **Push to main** | **Human** | /push-main |
| **8** | **Merge to production** | **Human** | /merge-production |

Between steps 7 and 8 you check the test server in the browser; there is no skill for this.

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
<!-- de: fde55327faae -->

The seventeen skills in the order of the flow, each with purpose, when to call it and the next step.

### /session-start
<!-- de: 46aeaf57fd41 -->

**What for:** The skill loads the context you need to work. With a vault it reads profile, working rules and project note, otherwise the board. It reports running projects, recent decisions and what is due.

**When:** at the start of every session.

**Next:** the step the overview names.

### /triage
<!-- de: bc637046a83d -->

**What for:** An `[Idea]` is a raw idea, not yet a requirement. `/triage #N` reads it with its attachments, presents every unclear point on its own with a recommendation and writes the clarified state into the idea right after each confirmation. Attachments of a kanban-kit card land in the folder `.claude/ideas/<N>/` on their own; with other trackers you put them there. Finally the skill proposes a lane with its reason; you choose one of four outcomes.

**When:** as soon as an idea is on the board and you want to tackle it. The skill runs only interactively.

**Next:** the chosen outcome. `1` implements a trifle right away and closes the idea with a reference to the commit. `2, fachlich` leads via `/requirement #N` into a business requirement, `2, technisch` via `/techplan #N` directly into a technical plan, `3` via `/task #N` into exactly one work package.

If you already know what the idea wants, you call two of these routes directly: if it requires a trade-off (Abwägung), `/requirement #N` turns it into a business requirement; if there is nothing to weigh up, it becomes exactly one work package via `/task #N`. Whether there is something to weigh up is decided by the human. An idea goes directly to a technical plan only via `/triage` with the lane `2, technisch`.

### /requirement
<!-- de: 8f12b9cea292 -->

**What for:** The skill turns a raw requirement into exactly one business issue: title with the prefix `[Requirement]`, body in story format with goal, business acceptance criteria, scenarios, non-goals and open questions to the PO. The text is free of technology and written in the PO's language. Before creating, `issue check-form` checks the form.

**When:** in projects with a product owner, before the plan. Input is a requirement from the chat, an `[Idea]` that needs a trade-off, or a halted task.

**Next:** `/issue-review #N` on the business plan, then `/groom #N`. Without a PO you start directly with `/techplan`. What a business plan looks like is described under [PO loop](#po-loop-business-and-technical-issues).

### /issue-review
<!-- de: 250678412893 -->

**What for:** Models that did not write the document read a business plan, a plan document (Plandokument) or, on request, a work package and deliver findings as a comment. The calling session incorporates every finding or rejects it with one sentence. At the end it sets the label `review:done` as a trace on the board; a finding of the stop class (Stopp-Klasse) sets `kit:clarify` instead. The skill reads the stage from the title prefix; which roles review is said by `reviewStages`. Details under [Issue review across multiple models](#issue-review-across-multiple-models).

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
<!-- de: 745f0c86d539 -->

**What for:** Step 3. The approved plan becomes work packages in the four-section format: context, task, acceptance criterion, dependencies. Every package can be tested on its own and carries in its context back references to plan and business plan as well as `Empfohlenes Modell:` or, with `night.tiers` active, `Aufgabenstufe:` and `Stufengrund:`. From here on the issue is the source of truth. The skill decides uncertainties as an `Entscheidung:` line; `issue check-form` checks every package before it is created.

**When:** after approval and review of the plan, with `/issues #N` and the number of the plan document.

**Next:** the GO.

The section `## Abhängigkeiten` contains `Keine.` or references `Issue #N`. Every local `#N` in the section counts as a dependency, also in explanations; only references `owner/repo#N` do not count. A reference line starts with `Issue #N` and carries no further number. When writing, `issue check-form`, `issue create` and `issue update` report every number from text and every reference to a document under `hinweise`; a document is not a work package. Dry run and deferral comment name the origin of each dependency. If packages hold each other, it says `Kreis: #A -> #B -> #A` there, and a package behind it waits for a cycle.

**GO (step 4, human):** You pull the packages that go into this pass to Ready on the board. The AI never pulls to Ready itself, except in the night chain under variant B, for which you gave the GO in advance on the card.

### /implement-ready
<!-- de: 0a4d70634316 -->

**What for:** Step 5. The skill works through the Ready column from top to bottom. Per issue: move to In progress, read it completely, implement test-driven, run the affected checks before the commit with `node .claude/kit/checks.mjs run`, commit locally, move to In review with a completion report (Abschlussbericht). It never pushes and pulls nothing out of the backlog. After the last package of a plan the final message starts with `## Stand des Vorhabens`: what a user sees now and what is missing.

**When:** after the GO.

**Next:** `/kit-review`.

### /implement-next
<!-- de: 693640258d17 -->

**What for:** implement exactly one Ready issue, run the affected checks before the commit, commit locally, move to In review and end. Without an argument the skill takes the top Ready issue. `/implement-next #N` is a binding order: if `#N` is not in Ready, the run ends without a substitute.

**When:** when you want to implement exactly one package. In night mode the runner starts a fresh session with this skill per package.

**Next:** the next package or `/kit-review`.

### /implement-test
<!-- de: cd022cb89461 -->

**What for:** the first part of step 5 split in two halves. The skill takes the next Ready issue, moves it to In progress and writes only the tests, which run red. No production code, no commit. If an issue is already in In progress, it refers to `/implement-done`.

**When:** when you want to see the transition from red to green yourself.

**Next:** `/implement-done`.

### /implement-done
<!-- de: 6d6a7a07855a -->

**What for:** the second part. The skill finds the issue in In progress, implements against the red tests until they are green, runs the affected checks before the commit and commits tests and code together. Format and limits are those of `/implement-ready`.

**When:** after `/implement-test`.

**Next:** `/kit-review`.

### /kit-review
<!-- de: 6ec6b512232a -->

**What for:** Step 6. A reviewer without the context of the implementation reads the code as a stranger. Depending on `reviewScope` it reads the diff or the whole repo, as the agent `kit-pruefer` in the model from `reviewModel` or as the CLI from `reviewCommand`. The findings end up as a comment on the issue. If the call fails, the skill aborts visibly.

**When:** after the implementation.

**Next:** work in the findings (back to step 5) or `push main`.

### /push-main
<!-- de: 0519126b8a25 -->

**What for:** Step 7. The skill pushes the batch of commits to main. It reacts only to the typed trigger phrase `push main`, and every batch needs its own approval. It runs `checks.mjs run --stage push` with `--retry`, that is every check up to the stage `push` without selection by areas; if one wobbles, it asks before the commit. Generation steps from the project's `RELEASING.md`, such as version bump and changelog, it runs before the check run; pre- and post-push steps from it around the push.

**Prepared at night.** A night chain with the goal `goal:push-prepared` starts `/push-main prepare`. This session does not push: in a worktree of its own it runs the generation steps, the full check run of the stage `push` and the commit. The result `gruen`, `gruen-offen` or `rot` lies in `.claude/push-vorbereitung.json`. If you type `push main` in the morning and nothing has changed since, the skill takes over the state with the line `Übernimmt den Stand der Nacht vom <zeitpunkt> (<commit>)` and does not check again. If the project runs the full run in the build service (Build-Dienst), the open item `voller Lauf im Build-Dienst (Prüfzweig <zweig>)` remains at night; in the morning the skill pushes the commit to the check branch (Prüfzweig), waits for the build service and pushes main only on green.

**Emergency route.** If the build service fails, `/push-main emergency` pushes despite a protected main after a full green run on your own machine, only interactively.

**When:** after the review, on your command.

**Next:** check the test server in the browser.

### /merge-production
<!-- de: f7b62e80a44a -->

**What for:** Step 8. The skill creates a pull request (GitHub) or merge request (GitLab) from main to production; you merge yourself. It reacts only to the trigger phrase `merge production` and stops if your local main carries commits that have not been pushed yet.

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
<!-- de: 762de9b650e4 -->

| Step | What you do | What you see afterwards |
|---------|-------------|----------------------|
| Business plan | `/requirement` with the requirement | a `[Requirement]` in the backlog |
| Review | `/issue-review #N` | findings as a comment, worked in; label `review:done` |
| Groom | `/groom #N`, question by question | answers in the body, “Keine” under the open questions |
| Plan | `/techplan #N`, read, approve | a `[Plan]` in the backlog |
| Packages | `/issue-review #N` on the plan, then `/issues #N` | work packages in the backlog, each with back references |
| GO | pull packages to Ready on the board | the packages in Ready, in your order |
| Implementation | `/implement-ready` | local commits, packages in In review, one completion report each |
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
<!-- de: ec6ae8c0bcf8 -->

Every business plan carries, between `## Fachliche Akzeptanzkriterien` and `## Nicht-Ziele`, a section `## Szenarien` with at least one scenario. A scenario has a heading `### Szenario: <Titel>` and list lines below it:

- `Angenommen` (given) describes the starting situation,
- `Wenn` (when) the action,
- `Dann` (then) the observable result,
- `Und` (and) continues the line before.

A scenario is complete with a title and at least one line each of `Angenommen`, `Wenn` and `Dann` in this order. In English projects the keywords are `Given`, `When`, `Then`, `And`. Not every criterion needs a scenario. An example:

```markdown
## Szenarien

### Szenario: Fachplan ohne Szenarien wird abgewiesen
- Angenommen ein Projekt hat den Stichtag scenariosFrom gesetzt
- Und ein Fachplan hat fachliche Akzeptanzkriterien, aber keinen Abschnitt Szenarien
- Wenn er über das Kit angelegt wird
- Dann wird er nicht angelegt
- Und die Meldung sagt in einem Satz, was fehlt, und zeigt die Form eines Szenarios
```

`issue check-form` and `issue create` reject a business plan that lacks the section, whose section is empty or carries no complete scenario; the message shows the form of a scenario. For cards on the board the obligation applies from the cut-off date [`scenariosFrom`](/en/einstellungen); `node .claude/kit/board.mjs scenarios baseline` names the matching value. Without scenarios no technical plan is created; `/groom` adds them.

## History
<!-- de: 58a216d1a368 -->

Before `/requirement` writes a business plan or `/techplan` a plan, the kit searches for earlier business plans on the same subject, archived ones included. That way an earlier decision is not silently overridden. The search (Vorgeschichte) locks nothing, it only makes things visible.

**Switching it off.** The switch [`history`](/en/einstellungen) is on by default; only with `false` is it off, then every document arises without a section and without a note. The search needs a tracker that searches archived cards; the Toolbox tracker (kanban-kit) can do that. With GitHub, GitLab and the local file tracker the document carries the note that no history was read.

**Searching.** Both skills call it themselves:

```bash
node .claude/kit/board.mjs issue history --terms <begriff> [--files <pfad>]... [--without <N>]...
```

The search terms come from the title and goal of the new requirement. The plan additionally passes the files from `## Betroffene Bereiche` and so also finds the business plans from which these parts arose. The document names what was searched for in the line `Suchbegriffe:` (search terms), and `/issue-review` hands the reviewers the business plans found in full.

**What you see afterwards.** In the business plan the section `## Vorgeschichte` stands between the non-goals and the open questions to the PO, in the plan the subsection `### Vorgeschichte` at the end of `## Betroffene Bereiche`. It names at most five references, each with number, title and the sentence that counts for the new requirement, and where it applies one of these notes:

- `Nichts Einschlägiges gefunden.` (nothing relevant found) — searched, no hit counts.
- `Keine Vorgeschichte gelesen: <Grund>` (no history read) — the archive was not reachable; the document arises anyway.
- `Weitere Treffer: <Zahl>` (further hits) — there were more hits than the document names.

**A contradiction stops nothing.** If the new requirement contradicts an earlier PO answer or an earlier non-goal, the contradiction stands with quote and reference in the history section, not under the open questions. At night, too, the night chain (Nacht-Kette) keeps running; the night report names the contradiction.

## Issue review across multiple models
<!-- de: fe75dcb46178 -->

A document is the source of truth for the next step. An error in it propagates, and its author does not see it, because they have the context in their head. `/issue-review` has models read it that did **not** write the document. They deliver findings; the calling session incorporates each one or rejects it with one sentence. Findings are support, not a gate.

### Three review stages
<!-- de: 7481454964ea -->

Which stage applies is decided by the title prefix:

| Stage | Reviews | Proof |
|---|---|---|
| `fachlich` | a business plan `[Requirement]` from [/requirement](#requirement) | `Fachplan-Review: …` |
| `plan` | a plan document `[Plan]` from [/techplan](#techplan) | `Plan-Review: …` |
| `issue` | a work package from [/issues](#issues) or a `[Task]` from [/task](#task); `[Task]` is not a document prefix | `Issue-Review: …` |

**The call is always `/issue-review #N`.** There is deliberately no command of its own per stage; the skill reads it from the title prefix. That applies interactively just as in night mode, only interactively the session asks before writing. Without a number the skill takes all business plans and plan documents from the backlog that do not yet carry a proof of their stage. It reviews work packages only with a number; what a package does wrong is caught by the checks before the commit and by the code review. It never reviews an `[Idea]`.

**Where the proof is:** for the work package in the section `## Kontext`, for the business requirement in the section `## Ziel` next to `Autor-Modell:`, for the plan document before `## Ziel` next to `Plan-Modell:`. It is a trace, not a release.

**Why the review starts at the top.** The reach of an error grows downwards: an error in the business plan goes into the plan, from there into every work package and into the code. The earlier it is found, the cheaper it is.

**Who reviews.** The business plan gets the roles `form-beobachtbarkeit` and `abgrenzung`, the plan `architektur-bestand` and `schnitt-abhaengigkeiten`, the work package `pruefbarkeit`. Scope, dependencies and consequences in the existing code are reviewed at the plan stage, because the whole cut is there. Every role also asks “What can go?”. The plan's reviewer additionally reads the card from `Fachliche Quelle:` (business source) and checks whether the plan delivers every goal and every criterion of that source.

How many reviewers carry which roles is said by [`reviewStages`](/en/einstellungen). Without this block each stage is reviewed by one reviewer per role: business `form-beobachtbarkeit` and `abgrenzung`, plan `architektur-bestand` and `schnitt-abhaengigkeiten`, work package `pruefbarkeit`. Which models are available as reviewers is in [`issueReview`](/en/einstellungen); `issue-review matrix` shows the assignment.

**Form before content.** The yardstick of every stage is its format: the sections of the business plan, the six headings of the plan, the four sections of the work package. The form is not checked by a model but by `issue check-form`; the session fixes violations before a reviewer starts.

### What you see afterwards
<!-- de: 3379ed610e07 -->

On the document there is a comment `## <Stufe>-Review, Runde 1` (review, round 1) with the findings and a comment `## Einarbeitung, Runde 1` (incorporation, round 1) with the list adopted or rejected including the reason. The new text is in the body, with the proof line of the stage, plus the label `review:done`. If a finding raises a question of the stop class (Stopp-Klasse), a business plan or a work package carries `kit:clarify` instead and the question as a comment. On the plan document the question stands, when unattended, for instance in the night chain, as an entry under `## Offene Fragen` of the plan; the other findings are worked in, and `review:done` is set. If not a single reviewer ran, the skill does not set `review:done`. There is no second round.

A Claude reviewer runs as the agent `kit-pruefer` and may only read. A third-party reviewer such as Codex runs via its command with its tool's read-only switch; without a known switch it does not start.

## The plan format
<!-- de: a354435ad54c -->

A plan document carries exactly these six sections, each exactly once and in this order:

```markdown
## Ziel
## Betroffene Bereiche
## Architektonische Entscheidungen
## Geplante Änderungen
## Offene Fragen
## Verifizierung
```

These rules apply as well:

- **Head.** Before `## Ziel` stands `Plan-Modell:` (plan model) with the model that drafted the plan. If the plan arose from a business plan, `Fachliche Quelle: Issue #N` stands there too, otherwise the line is missing. A plan document never carries an `Issue-Review:` line; its proof is called `Plan-Review:`.
- **No further `##` heading** between the six sections. Subsections from `###` on are allowed, for instance `### Vorgeschichte`.
- **No empty section.** Only under `## Architektonische Entscheidungen` and `## Offene Fragen` may `- Keine.` (none) stand, as the first line.
- **Every decision carries a reason.** Decisions the plan makes itself stand as `E` entries with question, choice, what was rejected, reason and rollback.
- **Under `## Offene Fragen` stand only questions of the stop class.** Everything else the plan decides.
- **`## Verifizierung` names checks, not their result:** “`node --test` runs”, not “all tests are green”.
- **Every statement about the existing code is true:** named files, functions, commands and settings exist under this name.
- **New names are checked.** If the plan introduces a name a human types, it says that it collides with no built-in command of Claude Code.

## Checks before the commit
<!-- de: 82b64c0c84c5 -->

Every implementation ends with `node .claude/kit/checks.mjs run` before it commits. The skills call it themselves; you see its result in the completion report under “Tests und Checks”: which checks ran, with result and duration, and which were skipped, each with its reason.

**Areas.** A check from `buildChecks` can name areas from `checkAreas`; it then runs only if the package touches one of them. A file without an area makes all checks run. `node .claude/kit/checks.mjs plan` shows the selection without running anything.

**Stages.** Every check has a point in time:

| Stage | Point in time | Skill |
| --- | --- | --- |
| `paket` | before the local commit of a work package | `/implement-ready`, `/implement-next`, `/implement-done` |
| `push` | before publishing on main | `/push-main` |
| `merge` | before the release to production | `/merge-production` |

The stages build on each other: `push main` runs the package and push stages in full, `merge production` runs only what `push main` did not check. A check of a later stage appears beforehand as a skip with its stage as the reason. That is not a defect but its point in time.

**The commit gate.** If it is hooked in, it rejects every commit that was not preceded by a green check run on the same state. It compares the checked files with what is really committed; a file changed after the check does not get through. A red run means: correct and repeat the same call. It first runs the checks that were last red and then the full run once.

How to set up areas, stages and the gate is described under [The config file](/en/einrichtung#the-config-file) and in the [settings](/en/einstellungen).

### Check run by hand
<!-- de: b004c41472bf -->

If you want to check without a card, for instance after a change by hand or before `push main`, you call the command yourself:

```bash
node .claude/kit/checks.mjs run --since "$(git merge-base HEAD origin/<mainBranch>)"
```

`<mainBranch>` is the value from `.claude/workflow.config.json`. The anchor is the last pushed state: the run measures everything since the last push, that is the batch that goes out next. Without `--since` the command measures against `HEAD` and would see nothing on a committed state. The package stage (Paketstufe) is run; checks of the stage `push` or `merge` appear in the output as omissions with their reason.

**Empty anchor.** If `git merge-base` fails, for instance without `origin` or without a common ancestor, the call becomes `--since ""`. The command treats an empty anchor like one that cannot be resolved and runs the full scope, never no check at all.

## The check run
<!-- de: 527e753dba37 -->

The check run (Prüflauf) has several business requirements reviewed one after another during the day, without anyone sitting next to it. For each card a session `/issue-review #N` runs. Afterwards every card shows where you stand: reviewed, or a decision is waiting. Everything outside the stop class was decided by the review and recorded in the document.

**What you do.** You set the label `kit:check` on every business requirement that is to be reviewed; the name comes from [`checkRun`](/en/einstellungen). Then you start:

```bash
node .claude/kit/night.mjs --check
```

The run has no preview; `/issue-review --dry-run` shows documents and reviewers. Candidates are all cards with the label and the title prefix `[Requirement]`, whatever their column. A plan document, a work package or a card with `kit:clarify` appears as skipped in the list and keeps its label. If the reviewers' pre-flight fails before the first review, every card gets the comment `Pruefung nicht gestartet` (review not started) with a reason. The run works in a worktree of its own per run and leaves no change in the project.

**The label is consumed with the start.** The run removes it immediately before the card's session, together with a `review:done` from an earlier review. Every setting allows exactly one review; after an abort you set it again.

The run never removes `kit:clarify`. Only a human may do that, otherwise a run would give itself its own approval.

**What you see afterwards.** On the console and in the log there is one line per card with number, title, result and the version reviewed, a fingerprint of the card text. If someone changes the text during the review, the fingerprint shows which version was reviewed.

| Result | Trace on the card | next |
|---|---|---|
| reviewed | `Fachplan-Review:` in the body, label `review:done`, findings and incorporation as comments | nothing; the card can go into the night chain |
| pending decision | `kit:clarify` and the question as a comment; the text stays unchanged | answer the question and remove `kit:clarify` |
| incomplete | comment `## Pruefung unvollstaendig` (review incomplete) with reason, step reached and route forward | run `/issue-review #N` by hand |

**Budgets.** Time per reviewer session and cost per run are in [`checkRun`](/en/einstellungen). Once the cost budget is exhausted, the remaining cards stay and keep their label.

**What the run does not do.** It moves no card between columns, pulls nothing to Ready and sets no chain label. The chain label for the night chain is still set by a human.

With the tracker `local` the board lies in the repo, and the sessions write to `issues/` of the main copy. These changes to the cards are the result and not a leftover.

## Statements: believe instead of checking
<!-- de: ea25f7012643 -->

If you tell the session something about a fact, such as what is running right now, that is a statement (Mitteilung) and not an order. The session takes it over unchecked and verifies it with no tool. It answers in a fixed form that names scope and consequence:

```
Mitteilung übernommen, ungeprüft — gilt, bis du Entwarnung gibst. Folge: Ich starte keinen zweiten Nachtlauf.
```

This makes a wrong classification visible at once. A statement does not replace a mandatory check, and a quoted trigger phrase does not trigger a push. At night there are no statements. The binding wording is in `CLAUDE-workflow.md`, section “Mitteilungen des Menschen”.
