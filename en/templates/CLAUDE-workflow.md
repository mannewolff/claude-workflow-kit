# CLAUDE-workflow.md — claude-workflow-kit process
<!-- de: 82353c334d94 -->

Binding process for AI-assisted software development in this project. Based on the 8-step process (white paper "Ein Prozess zur KI-gestuetzten Softwareentwicklung", Manne Wolff, 2026).

---

## The eight steps
<!-- de: a655deb8ecb0 -->

| Step | Actor | What happens | Skill |
|------|-------|--------------|-------|
| 1. Requirement | Human | Formulates or dictates the requirement | — |
| 2. Plan | AI | Creates a plan, puts it up for discussion, implements nothing | `/techplan` |
| 3. Plan to issues | AI | Transfers the plan into issues (four-section format) | `/issues` |
| 4. GO | Human | Moves issues to Ready — that is the GO | — |
| 5. Implementation | AI | Works through Ready issues sequentially, commits locally | `/implement-ready` |
| 6. Code review | AI | Starts a foreign model from `reviewCommand` or `reviewModel` in a fresh session | `/kit-review` |
| 7. Push | Human | Types `push main` — Claude pushes the batch | `/push-main` |
| 8. Merge | Human | Types `merge production` — Claude creates the PR | `/merge-production` |

---

## Tools beside the process
<!-- de: 6510c0a25633 -->

The eight steps above are the process from the white paper. What stands here is a tool of the kit: helpful, often used — but **the process runs without these skills as well**. They therefore carry no number; a number would claim an order and an obligation that do not exist.

**Supplement the process**

| Skill | What for |
|-------|----------|
| `/session-start` | Session start: load the memory vault, fetch the state of the project |
| `/triage` | talk an idea through with the human and bring it onto the chosen lane |
| `/requirement` | Requirement as a business issue for grooming with the PO |
| `/issue-review` | have a requirement, a plan document **or** a work package checked — one command, three stages |
| `/groom` | decide the open questions of a reviewed business plan one by one with the PO |
| `/retro` | AI retrospective, consolidate memory |
| `/document` | Session end: write the daily log and the project note |

**Replaces steps 2 and 3**

| Skill | What for |
|-------|----------|
| `/task` | Requirement without need for weighing as a single work package `[Task]` |

**Replace step 5 with a finer gait**

| Skill | What for |
|-------|----------|
| `/implement-next` | exactly one Ready issue instead of the whole column |
| `/implement-test` | only the red tests, stop before the implementation |
| `/implement-done` | implementation against the prepared red tests |

---

## The three stop points (never automated)
<!-- de: ebca8bcd3862 -->

1. **GO (step 4):** move the issue to Ready. Claude waits. Exception, exclusively in the implementation stage of the night chain under variant B: there the night runner itself moves the work packages of the marked card to Ready and starts their implementation without a release per package. The human gave the GO on the marked card — on the requirement or on the plan document — when marking it for variant B. Outside this stage the sentence before applies without restriction — also for packages of a card that ran under variant B earlier. The GO on the marked card is given by `kit:carry-through` or by a goal from `implementation` on (`goal:implementation`, `goal:push-prepared`); both only take effect together with `kit:night`. The push in the morning (step 7) takes the decisions of the night along.
2. **Push (step 7):** trigger phrase `push main`. Claude does not push autonomously.
3. **Merge (step 8):** trigger phrase `merge production`. Claude does not merge.

What gets checked are the requirement and the plan document: `/issue-review` has them read by models that did not write them; how many, `reviewStages` says. A work package is not checked by default — whoever wants it calls `/issue-review #N`. The switch `issueReview.requiredBeforeReady` remains for projects that want the gate; switched off is the rule. With `issueReview.requiredBeforeReady` set, the night runner puts unchecked Ready issues back.

**The call is always the same: `/issue-review #N`.** Which stage applies — requirement, plan document or work package — the skill reads from the title prefix; there is deliberately no command of its own per stage. That applies interactively just as in night mode: a plan document can be checked at any time during the day. The marker the check leaves behind is a trace and not a release. Besides, the check sets the label `review:done` as a visible trace on the board; it has to be created once per board (GitHub and GitLab as a repo label, kanban-kit via `POST /api/boards/{boardId}/labels`).
The label remains a trace of the check and does not release the content; the night chain does require this trace as a precondition, though — a marked card without `review:done` is skipped even if it carries the chain label; that applies to the requirement as well as to the plan document. Alongside it, the label `kit:clarified` shows on the board that no question to the PO is open on a business requirement; `/issue-review` and `/groom` set it as soon as the first line under `## Offene Fragen an den PO` begins with `Keine`. It is a help, not a criterion: the chain keeps checking the note, not the label. Only the human removes it. A business requirement can also wait for an external event, say until a tariff can be chosen. What counts is the line `Waiting for event: <reason>` in the section `## Goal`; the label `kit:on-hold` shows the waiting on the board and is a help, not a criterion. `node .claude/kit/board.mjs issue hold <N> --reason "<reason>"` sets line and label, `issue hold <N> --lift` removes both. Only the human lifts it, the kit never does. As long as the line stands, the night chain skips the requirement and every plan for it and names the reason in the report; `kit:night` stays on the card and applies again after lifting. Waiting is not an open question: no answer is missing, an event is. `kit:clarify` and `## Open questions for the PO` stay separate from it, `--lift` touches neither of them. The check run keeps running, and lifting needs no new check.

---

## Decide instead of asking
<!-- de: ffb807fe07d6 -->

A session that writes a document or runs unattended decides every ambiguity outside the stop class itself and records the decision. Interactively it may ask; what the human decides is recorded in the same format.

**The decision format**, per entry, the numbers run consecutively per document:

```
- E1: <question in one sentence>
  Chosen: <way>. Rejected: <alternative>. Reason: <one sentence, referring to the requirement, the existing state or the order of priorities>. Rollback: <trivial | one file | migration>.
```

| Where | Place of the entries |
|-------|----------------------|
| Plan document | `## Architectural decisions` |
| Work package | `## Context`, one line per entry beginning with `Decision:` |
| Implementation | Completion report, subsection `### Decisions` |

**The stop class.** Only these questions halt:

1. Data loss or a migration without a way back.
2. Security: permissions, authentication, secrets, network access.
3. Contracts to the outside: an interface someone else uses, for instance a name, a marker or a format that the kit and kanban-kit both read or write (form in `CLAUDE-Plan.md`, P14).
4. A contradiction in the requirement itself, for instance two acceptance criteria that exclude each other.
5. A change to gates, stop points or the process (W1 to W4).
6. A deviation from the business occasion: a plan or an implementation deviates from a submitted template or from the goal of the requirement, or answers itself a question the requirement left open about appearance, the place of a view or a business boundary.

Only a question from this class halts, and every halt carries exactly one question. Everything else — explicitly also edge cases, naming questions (except names that such a contract fixes), error paths, orders and the question which test is meant — is decided. The arbiter is the order from "Priorities in conflicts of goals"; when in doubt the smallest reversible intervention wins. **A protected file is not a question but an action.** If a package has to change a file only a human may write (the settings under `.claude/`), it halts with the label `kit:protected` instead of `kit:clarify`: with `kit:clarify` a decision is waiting, with `kit:protected` an action. Like the trace label of the check, the label has to be created once per board; only the human may remove it, after making the change themselves. The halt comment begins with `## Protected file` (in a German project `## Geschuetzte Datei`), names every file with the quoted line and notes as its last line `Label kit:protected gesetzt` or, if the label is missing on the board, `Label kit:protected nicht gesetzt` — the card is only released after a halt with the label set, which the human answers by removing the label. The case is recognised before the start (gate in the runner, `issue brief`, `issue check-form` I8) and, if only the writing fails, in the fallback of the session or in the catch of the runner.

**Reviews are contributions.** A model review of a requirement, plan or work package delivers findings to the author of the stage; every finding comes with the three additional details from "Findings of the model reviews" — counter-check, its status and the kind of defect —, and the author reads them along before taking it over or rejecting it with one sentence. Whether a stage is finished is said by a command or a human, never by a model marker.

---

## Rule in the text or rule in the tool
<!-- de: 490cb1b15f28 -->

Every rule of a supplied instruction is of one of two kinds. The kind decides where it belongs.

**Operating instruction.** It says how a tool is to be operated. Following it can be read from output or result, and a tool could carry it out in place of the reader. Example: read the real return value of the check command, not that of a chain the reader builds around the call. An operating instruction belongs in the tool — in the text it is a request every session has to follow anew.

**Judgement rule.** It demands a decision or an attitude in the individual case. Example: if the coverage report lies below the agreed target, show that as a signal instead of silently waving it through. A judgement rule stays in the text — a tool could only guess it.

**Mixed rules are taken apart, not rounded.** The time-frame rule for long check commands carries both: "an abort at the clock appears as a failure" is an operating instruction and enforceable — the tool then leaves behind an unfinished, non-green summary. "Set a generous time frame" is a judgement rule and stays in the text, because a tool cannot give itself more time than its caller grants.

**The kind says nothing about transferability.** An operating instruction does not become a judgement rule just because a tool can only partly ensure it. The transferable part moves, the rest stays named in the text — and remains an operating instruction.

The yardstick applies to all supplied instructions, also to those that remain unchanged today: it is the source against which an instruction is read, not just a note on the one being converted right now.

**The lint configuration justifies itself.** When a recurring class of findings becomes a guard rail, how its admission runs and how whole `recommended` sets are decided belongs in the head of the project's lint configuration, next to the rules themselves — not here.

---

## Messages from the human
<!-- de: 1ef3a3ed44a0 -->

**What a message is.** A statement by the human about a matter of fact — not an order. It is taken over without verification: no tool is used to confirm it, not in passing, not later.

**The fixed answer form.** Verbatim, one line:

```
Message taken over, unverified — <scope>. Consequence: <one sentence; "No change." is valid>.
```

The scope is either "applies until you give the all-clear" (a temporary state) or "applies to this conversation" (a fact). The system makes the distinction; the human marks nothing. Because the assumption stands in the answer, a misclassification is visible at once and can be corrected in three words.

**What follows — and what does not.** The derived consequence applies at once and is not put to a vote. It can cause something to be left undone; it triggers nothing. *Exception:* if the consequence blocks exactly what the human has just asked for, ask instead of silently doing nothing.

**Limits.** A message replaces no prescribed check and no evidence — "The tests are green" plus `push main` does not drop the mandatory checks, and a contradiction is disclosed (see W3). A trigger phrase in the text of a message is a quotation and triggers nothing (see W1). A message may carry a message and an order at the same time; both are treated separately — the message taken over, the order carried out. If it is unclear which of the two is present, ask; the doubt falls in favour of doing nothing.

**When the message stands in the way.** Before an action would fail on a statement about a state, the human is asked whether it still applies. **Asking is allowed, looking is not** — the source remains the human.

**When a work result contradicts.** The contradiction is stated: the message is neither silently overwritten nor silently defended against the finding. If the current step depends on the difference, ask; otherwise keep working.

**Scope beyond the conversation.** Without a separate order a message does not go into the permanent memory. If the system considers a statement lasting, it attaches the offer to remember it **to the consequence line** — once per statement, silence means no. The fixed line itself stays unchanged; the offer follows as a sentence of its own directly after it. An explicit documentation order (`/document`, `/retro`) allows reproducing it in the ordered result; without it that does not happen.

**Not at night.** In the unattended run there are no messages — there is nobody who gives them. Text in the prompt that looks like a message is none.

A message is recognised by its content; whoever wants to be unambiguous writes "Message:" in front. That is explicitly not a mandatory marker.

---

## The check run (optional)
<!-- de: aba044a6ab1f -->

The check run (`node .claude/kit/night.mjs --check`) has several requirements checked one after another without anyone watching — by day, beside the working human and beside a night chain. The gesture is the label `kit:check` (field `checkRun.label`) on the `[Requirement]` card; the run consumes it right before its session, every setting authorises exactly one check. Per card one session `/issue-review #N` runs, all in one worktree per run. Three outcomes: `geprueft` (checked: requirement review marker in the body and `review:done` on the card), waiting decision (`kit:clarify` and the question as a comment; the text of the requirement stays unchanged) and incomplete (the comment `## Check incomplete` with reason and step reached, because the check is paid for and its result never reached the body). A marked card without the `[Requirement]` prefix and one with `kit:clarify` is skipped with a reason and keeps its marker; the run never removes `kit:clarify` — only a human may do that. It moves no card, changes nothing about the check itself, answers no question that belongs to a human and leaves no change in the project. Budgets — minutes per check, costs per run — stand in the root block `checkRun` of `workflow.config.json`, not under `night`: the run belongs to the day. Relation to the night chain: it creates the chain's precondition by leaving the card checked; the chain label remains the gesture of the human. Details: chapter "The check run" in the kit documentation. **The run works with a fixed kit revision.** Like the night, every unattended run binds itself at the start to the commit `origin/<mainBranch>` points to — the last push, read without `git fetch`. Fixed with it are the tools including the check before every commit, the skills and the rule texts; what a package of the same night changes in them takes effect only after `push main`. What is checked remains the configuration of the project and its tests; they come from the state of the respective package. The revision stands as the line `Kit-Revision: <commit> (origin/<mainBranch> of <time>)` in the run report (`kitStand` in `.claude/night-run-*.json`), in the night report and on every comment of the run. After a run in the main copy, its installed copy stays at that revision until `node tools/sync-blobs.mjs` brings it to the working copy; until then `sync-blobs --check` names it as outdated.

---

## Night mode (optional)
<!-- de: 2ccde11b8be9 -->

The night runner (`node .claude/kit/night.mjs`) works through the Ready column unattended: per issue with the routing label `kit:nightrun` a fresh headless session with `/implement-next #N`. Success is measured on the board (issue in In review); failures wander into the backlog with a comment, with an unclean working tree the run stops hard. At night there are commits, never pushes — review, test and `push main` happen in the morning through the human.

The second mode is the night chain (`node .claude/kit/night.mjs --chain`). The gesture is the label `kit:night` on the card that carries the order; the runner consumes it at the start, every setting authorises exactly one chain. The chain knows **two kinds of order**. On the groomed `[Requirement]` issue in the backlog a plan is created in a worktree of its own (`/techplan`), which is checked (`/issue-review`), from it the work packages (`/issues`) and a coverage against the requirement, for a plan without a requirement against the plan. On the checked `[Plan]` document in the backlog the same way runs as a **plan order** without the stage `plan` and starts at `pakete`; the stage `review` runs before it only if the review state on the plan reports that the plan has changed since its review beyond the entered answer. The plan is kept, its number wanders unchanged into packages and report, no second plan document is created, and no older one is noted as superseded. The condition in both cases is the Backlog column, a `review:done` and no `kit:clarify`; a plan without a line `Requirement:` (in a German project `Fachliche Quelle:`) runs as its own point of reference, the coverage is then against the plan; if it names a line that hits no card, it stays where it is. Nothing is built, the packages stay in the backlog, the GO to Ready stays with the human. The stage names (`plan`, `review`, `pakete`, `abdeckung`, `umsetzung`, `vorbereitung`) are machine values and stay German. The chain knows two variants: variant A (default) leaves the work packages in the backlog and waits for the GO of the human; variant B additionally sets the label `kit:carry-through` (field `night.chain.variantBLabel`) on the marked card. Exception, exclusively in the implementation stage of the night chain under variant B: there the night runner itself moves the work packages of the marked card to Ready and starts their implementation without a release per package. The human gave the GO on the marked card — on the requirement or on the plan document — when marking it for variant B. Outside this stage the sentence before applies without restriction — also for packages of a card that ran under variant B earlier. If the label is missing or removed again, the chain falls back to variant A. Three outcomes: finished, stopped (a stop question waits as the comment `## Kette angehalten` together with `kit:clarify` on the marked card; an open question in the plan stops the chain only after the stage `review`, that is after the review of the plan and before the cut into packages — also a question that only the review took into the plan as an open question; the comment lists the way forward: the answer as an entry under `## Architectural decisions` of the plan — not under `## Open questions`, there it counts as a further open question —, `## Open questions` back to `- Keine.`, remove `kit:clarify`, `kit:night` on the plan, which the next chain then continues as a plan order from the stage `pakete` on; if the answer has changed the plan beyond its entry, the chain reviews it again itself beforehand — a review by hand is not part of the way) and aborted (with a reason). With every outcome a night report stands as a comment on the marked card; it is history, a decision becomes binding only as a sentence in the requirement. The night report of every chain under variant B names the state of the origin documents: which have wandered to In review or, if the plan is not through, why not and which packages are missing. Budgets — minutes per stage, costs per chain, correction rounds — stand in `night.chain` of `workflow.config.json`. Chain, implementation night and check run run side by side, also several chains and check runs at once and on two machines on the same board. Per business root exactly one runner works (a plan without a requirement is its own root): it claims the root on selection with the run status `laeuft` (running), whose line `Run-ID: <host>/<pid>/<stamp>` identifies it, and leaves out a root with a living run ID (reason in the log: already claimed by a running runner). At the start only what belongs to a dead process is cleared — the working copy and kit revision of a living runner stay. If the claiming runner has crashed (same machine: process ended; other machine: `Updated:` older than the budget ceiling up to its position), a later start takes over the root and names the takeover in the log; nobody has to mark it again. Under variant B chain and implementation night take the lock `.claude/night-umsetzung.lock`; if it is taken, the chain waits for the implementation within its implementation budget (`night.chain.implementationMin`) and otherwise ends as incomplete. Details: chapter "Night mode" in the kit documentation. **The run works with a fixed kit revision.** Every unattended run binds itself at the start to the commit `origin/<mainBranch>` points to — the last push, read without `git fetch`. Fixed with it are the tools including the check before every commit, the skills and the rule texts; what a package of the same night changes in them takes effect only after `push main`. What is checked remains the configuration of the project and its tests; they come from the state of the respective package. The revision stands as the line `Kit-Revision: <commit> (origin/<mainBranch> of <time>)` in the run report (`kitStand` in `.claude/night-run-*.json`), in the night report and on every comment of the run. After a run in the main copy, its installed copy stays at that revision until `node tools/sync-blobs.mjs` brings it to the working copy; until then `sync-blobs --check` names it as outdated. If a package needs the changed tool, skill or rule text of another package as a tool, its reference line carries the addition `Issue #N (wartet auf Push)` (waits for push); the chain does not move it to Ready even under variant B, it stays waiting in the backlog and stands in the night report as not started.

**No session ends with its own work still running.** A session, attended or not, does not end its work as long as a long piece of work it started is still running — it waits for the result or aborts the long work and reports the abort as a failure. Interactively, background work explicitly remains allowed; the only thing not permitted is stopping while it still runs. Whoever waits checks two things: whether the result is there and whether the run **still exists**. A waiting loop that only polls the output waits its full length in the error case — and the most frequent error case is that the run never started. A run that no longer exists is a failure and is reported as such, not as a timeout (issue #983). Without supervision (with `KIT_AGENT_MODEL` set) there is no background work: the hook `bash-check` rejects a Bash call with `run_in_background` (issue #1081) — call the command in the foreground and wait for it. If an unattended session nevertheless ends with work still running, the runner names the case with a reason of its own, counts it as a quantity of its own and attaches a note `## Night run: waiting session` to the work package; the package is not done with that.

**A timeout abort is marked and claims no cause.** If a session ends at the session time limit (`--timeout-min`, default 60 minutes — explicitly not at the stage budget `night.chain.implementationMin`, which only applies between two sessions), the runner attaches a note `## Night run: time limit reached` to the work package and the unit in the result state carries `zeitlimitBeendet`. The note names the limit, the last reported state and a recommendation to the human — not a prescription. That is no failure in content: the session was aborted at the clock, not at its work, and what the time ran out on does not follow from the abort. **A stuck check brakes the session before the time limit.** `checks.mjs run` counts per check how often in a row it failed the same way — the same failed tests, otherwise the same first error message; only real runs count, partial runs included, no taken-over results. Green results of other checks do not interrupt the sequence; it ends only when exactly this check turns green or fails differently. If the sequence reaches the limit `night.stuckAfter` (default 3), unattended (with `KIT_AGENT_MODEL` set) the next call runs nothing any more, not even with `--fresh`: it outputs `Pruefung festgefahren: <command> — <error>` and ends with exit code 3. The session then ends without further change. The runner ends the round, saves the leftovers without a rescue attempt in the stash `nachtrest #<id> <run>` (if that fails, hard stop), attaches the note `## Night run: stuck on a check` with check, error, attempts, run time and time limit to the package, sets `run:aborted` and moves it to the backlog; the other packages keep running. In the night report it is an outcome of its own, stuck, separate from time limit and waiting session. Interactively nothing aborts: the run only outputs `Note: stuck at <command> — failed the same way <n> times (<error>)`, result and exit code remain, the human decides.

**The state of a run stands on the board, not in the process.** Every card of a chain or implementation night carries at most one of the three labels `run:running`, `run:aborted` and `run:waiting` and exactly one comment `## Run status`, which is replaced on every change. It is a board, not history; the night report remains history. Abort and halt can be told apart without interpretation: `run:aborted` means repeating suffices; `run:waiting` says verbatim in the run status what it waits for — `waiting: transition <x> not enabled in project — continue with kit:night`, `waiting: card without release for implementation` or, for a halt in content, "Stop: question waits for the human — see `## Kette angehalten`". The way for halts in content via `kit:clarify` stays as it is. Repeating uses the same gesture: `kit:night` on the card starts the chain at the first stage without a result, and what already exists is not created twice. An existing plan counts as a result; a fresh plan is only created when the old one stands in Done. Which transitions of the chain follow automatically is set by the project in `night.chain.transitions` (`planReview`, `reviewPackages`, `packagesCoverage`, `coverageImplementation`); `coverageImplementation` only takes effect together with `kit:carry-through` on the card, the GO stays on the single card; if the entry is missing, a chain with `kit:carry-through` implements after the coverage as before the setting, and only an explicit `false` stops it. An automatic attempt exists only for environment errors while the run lives — board not reachable, no session came about —, exactly one, after a pause, with the note "2nd attempt" in the run status. A session that came about and ended without a result is a package error. A dead run is not repeated: its cards show "not finished" after the deadline, and it only goes on with the gesture of the human. **How far a chain runs is said by the goal on the card.** Besides `kit:night` the marked card carries at most one of the four goal labels `goal:plan` (ends after the stage `review`), `goal:packages` (after `abdeckung`), `goal:implementation` (after `umsetzung`) or `goal:push-prepared` (after `vorbereitung`). The order of the stages is fixed, the goal only determines where the chain ends. A goal from `implementation` on is at the same time the GO for the packages of this card; `kit:carry-through` counts as `implementation`, and if both are present, the farther-reaching one applies. On the requirement, `planreview:1` or `planreview:2` sets how many models check the plan; without it the setting of the project applies. A goal without `kit:night` starts nothing. At the start the runner consumes `kit:night`, the goal and `planreview:*` together, every setting applies to exactly one run; their value then stands in the run status. A newly started chain only reads a newly set goal, without a goal it behaves as today. Whatever does not fit on the card — more than one goal, both `planreview:*`, `goal:plan` or `planreview:*` on a plan document, `planreview:*` on a requirement whose plan already carries a `Plan-Review:` marker — is rejected by the selection with the comment `## Chain not started: unsuitable setting`, and the card keeps its labels. **End at the goal and project limit.** If a chain ends at its goal, the run status carries the head `done up to <goal>` and the line `Next:` with the step that now belongs to the human. The project remains the ceiling: if `night.chain.transitions` blocks a transition before the goal, the chain ends there with the waiting form of the blocked transition, the run status names the last reachable stage in the line `Limit:`, and the night report says under `### Outcome` that it stopped at the project limit and not at the goal. The transition into the preparation is called `implementationPreparation` and has the default `true`; only an explicit `false` stops the chain before it. **The stage `vorbereitung` prepares the publication and does not push.** If a chain reaches the goal `push-prepared`, once after all chains of the run the stage `vorbereitung` follows for the whole state. It waits until nothing builds any more — the implementation lock is free and no other run of this project is still building —, at most `night.chain.preparationMin` minutes (default 120); if the deadline runs out, the result is `nicht-vorbereitet` (not prepared) with a reason. Then in the stage `vorbereitung` the session `/push-main prepare` runs in a worktree of its own: version note, change note, the check run of the push stage and a local commit, without a push — neither to `mainBranch` nor to a check branch or pre-release branch. What needs a human or a push is not started but stands as open in the message; the result is then `gruen-offen` (green, check pending) instead of `gruen` (green). If the project runs the full run with `pushCheck` in the build service, the preparation instead runs only the evidence run of the package stage over the release files, and the first open point reads `full run in the build service (check branch <branch>)`; in the morning `push main` runs the check branch. The result (`gruen`, `gruen-offen`, `rot` or `nicht-vorbereitet` — machine values that stay German) stands in a night report of its own on every card that triggered the preparation, and at the fixed place `.claude/push-vorbereitung.json`. If the state has not changed by `push main`, it takes over the prepared commit without a second check run; otherwise it checks completely.

---

## Effort of the process
<!-- de: f752273093f6 -->

Every unattended run writes its evaluation to `.claude/aufwand.md`; it lies there completely, even if nothing stands out. A finding appears unasked at exactly two places: in the closing block of the run log `.claude/night-run-<date>.log` and at the start of `/push-main`. The finding holds nothing up anywhere and is no gate. At the start of every run the runner deletes the daily logs `.claude/night-run-<date>.log` and the run folders under `.claude/protokolle/` that are older than `night.protokollFristTage` days (default 14); `night-run-*.json` and the `.tsv` files with the key figures remain.

Three terms carry the evaluation: **thinking** is the time in which the model works; **tool work** is the time in which something else works for the run; a **check** is an entry from `buildChecks`, multiple executions of the same entry are summed up. Time that cannot be assigned to either side is a third item of its own.

A block of its own shows the **target mark of the implementation**: how many implementations lie above the mark of the respective run and by how much, averaged over the overruns. Timeout aborts stand separately in it and enter no average — their completion time is unknown.

Number of runs and thresholds stand optionally in the config block `workload`; if it is missing, the built-in defaults apply.

---

## Effectiveness of the checks
<!-- de: 50d140066321 -->

What the mandatory checks yield stands in `.claude/wirksamkeit.md` for humans and in `.claude/wirksamkeit.json` for the output places; both lie there completely, even if nothing stands out. Per check it says how often it ran, how often it objected and how much time it cost, plus the rate of returns from "In review". A finding appears unasked at the same two places as the effort finding: in the closing block of the run log and at the start of `/push-main`. The finding holds nothing up anywhere and is no gate.

Four terms carry the evaluation: an **execution** is a run of a check for a work package — one line in the execution log; a **run** is an unattended run; **objected** means that an execution did not end green — a check that did not even start is no execution; a **return** is every move from "In review" back, no matter who triggers it. From this follows the difference that matters: "never objected" is a result of many executions, "not run" is none at all — only the first says something about the check. A **flaky** check is one that was first red and then green in the single repetition: such a pair counts as one flake and not as an objection; red that stayed red in the repetition counts as one objection, red without repetition as before, and taken-over results create no cases. From three flakes in the time window on, a check is marked as a **repair candidate** — information, not a gate.

What reducing the completion scope yields stands there as a key figure block of its own: the **average check time per card** — calculated over the **completion runs** of this card —, next to it the comparison value the same runs would have cost without the omissions of the completion, and per omitted check what it cost at publication. The reference quantity is the card, not the run; an average per run would be a different number. Only completion runs count — check times during the work and at publication stay out. If the basis is missing, it says "not measured" and no 0. Like the rest of the report the block is information and not a gate.

Window, rate and minimum quantities stand optionally in the config block `effectiveness`; if it is missing, the built-in defaults apply.

Two measurement limits belong to the picture: the post-check of the night runner runs past `checks.mjs` and therefore does not count; the salvage pre-check, by contrast, runs `checks.mjs` and counts (since Issue #919). And a card the kit never moved does not stand in the denominator of the return rate — what came about without the process, the process does not measure either.

---

## Findings of the model reviews
<!-- de: c02c4f45de03 -->

**Structure of a finding.** Every finding of a model review provided by the kit — requirement, plan, work package, code — carries, besides severity, location and suggestion, three further details: the observation that would refute it; the status of this counter-check, `geprueft, bestaetigt` (checked, confirmed) or `nicht geprueft` (not checked); and its kind of defect. A finding refuted by its own counter-check is not reported. The form words of the findings (`KRITISCH|BLOCKER|WICHTIG|HINWEIS`, `Fundstelle:`, `Vorschlag:`, `Gegenprobe:`, `Art:` and the kind names) are machine words and stay German in every project language.

**The list of kinds has exactly one wording:** `node .claude/kit/findings.mjs kinds`. This section does not list the kinds itself but refers to the command — two places drift apart as soon as a kind is added or changes its name. A project adds no kinds of its own.

**No gate comes out of this form.** A finding without a counter-check or with a missing detail holds nothing up. If a detail is missing, it is requested from the delivering reviewer exactly once; if it stays missing, the finding block carries `Angaben: unvollstaendig` (details: incomplete) and is incorporated anyway.

Four terms carry the evaluation: a **finding** is a reported objection of a model review; the **counter-check** is the observation that would refute the finding, together with its status; the **kind** is the classification from the fixed list; an **occurrence** is a taken-over finding with a confirmed counter-check — unchecked, incomplete and rejected findings are no occurrences.

Two measurement limits belong to the picture here as well: findings written before the introduction of this form do not count and are not classified retroactively. And bookings made in a crashed night worktree are lost — `worktreesAufraeumen` in `kit/night.mjs` clears leftover worktrees at the next start, together with everything still waiting unsaved in them.

---

## Three lanes
<!-- de: 08a3b87fc6c6 -->

**Lane 1 — Small change** (direct; no plan/issue/GO): exactly one file / one asset / one config; no Flyway migration; no new/changed endpoint; no data model; ≤ 1 module; no security-relevant logic → implement directly, one commit, no push without trigger. **This commit, too, requires a green `node .claude/kit/checks.mjs run` on the state to be committed** — the commit gate is mechanical and knows no lane. The same applies to every commit by hand. What the gate does not achieve — `--no-verify` and the fresh clone without an installer run — stands under "Git workflow (strictly binding)".

**Lane 2 — Feature** (full 8 steps): outside lane 1, as soon as there is something to weigh — or it is unclear whether there is something to weigh → `/techplan` → `/issues` → GO → `/implement-ready`. Typical: a data model with several defensible cuts, an endpoint whose contract is still open, a migration with a way-back question.

**Lane 3 — `[Task]`** (replaces steps 2 and 3): above the trifle, but without need for weighing. No `[Requirement]`, no `[Plan]`, no decomposition — one work package with the title prefix `[Task]`, created with `/task` after the human has confirmed the way, then released like every work package. Typical: a renaming across several files, a rejected tool finding, a mechanical follow-up job.

**The selection rule, in this order:**

1. If the counting lane-1 rule applies **and there is nothing to weigh**, lane 1 applies.
2. Otherwise the need for weighing decides: there is something to weigh if **several defensible ways** are open. A finding with exactly one correct outcome is no weighing. With a need for weighing lane 2 applies, without it lane 3.
3. If it is **unclear** whether there is something to weigh, lane 2 applies.

Scope alone therefore no longer decides: a change to twelve files without weighing is lane 3, an architecture change to a single file with several defensible cuts is lane 2.

**Meta rule:** before starting every new task, name the lane out loud ("This is lane 1/2/3, I …"); when in doubt lane 2 — that also covers the unclear need for weighing.

| Example | Lane |
|---------|------|
| Icon/favicon swap | 1 |
| Text correction | 1 |
| Config default | 1 |
| Renaming across several files without weighing | 3 |
| Architecture change to a single file (several defensible cuts) | 2 |
| New table | 2 |
| New endpoint | 2 |
| New UI feature | 2 |

---

## History
<!-- de: 98d1ac2aee35 -->

Applies unless `.claude/workflow.config.json` sets `history` to `false`; then the document comes about without section and without note. Otherwise the author of a requirement (`/requirement`) and of a plan (`/techplan`) reads, before writing, the earlier requirements on the same subject, archived ones included. An earlier decision blocks nothing; it only becomes visible.

**Searching.** A command searches, not the author:
```bash
node .claude/kit/board.mjs issue history --terms <term> [--terms <term>]... [--files <path>]... [--without <N>]...
```

The author chooses the search terms from title and goal of the new requirement, one `--terms` per term. The plan additionally passes one `--files` per file from `## Affected areas` and takes its business source out of the hits with `--without <N>` — it is the requirement itself, not history. The document names what was searched for in the line `Suchbegriffe: <a>; <b>; …`, the plan additionally in the line `Dateien: <path>; …`. From these lines the review brief of `/issue-review` repeats the same search and attaches the requirements found to the reviewers in full.

**Place.** In a requirement the section `## History` stands between `## Non-goals` and `## Open questions for the PO`. In a plan the subsection `### History` stands at the end of `## Affected areas` — a seventh `##` section would be a form violation.

**Content.** At most five places, each with number, title and one sentence that counts for the new requirement: a PO answer, a non-goal or a discarded option. If the new requirement contradicts an earlier PO answer or an earlier non-goal, every contradiction stands in full as a line of its own `- Widerspruch: #N „<Zitat>“ — <Fundstelle>; <warum>` (contradiction: quote, place, why); contradictions do not count towards the five. In addition exactly one of the three fixed notes, where it applies:

- `Nichts Einschlägiges gefunden.` (nothing relevant found) — searched, but no hit counts.
- `Keine Vorgeschichte gelesen: <Grund>` (no history read: reason) — the command reports `ok: false` (for instance without network or without a reachable archive); the document comes about anyway.
- `Weitere Treffer: <Zahl>` (further hits: number) — there were more hits than the document names. The number = (hits of the command − places named in the document) + `weitere`, where `weitere` is the field of that name in the output.

The notes, `Suchbegriffe:`, `Dateien:` and `- Widerspruch:` are fixed beginnings by which the night report and the reviewers read them; they stay German in every project language.

**A contradiction holds nothing up.** No halt, not at night either, no question to the PO from a contradiction and no entry under `## Open questions for the PO` or `## Open questions` — the contradiction stands in the history section, the night report names it, and the human sees it in the morning. The plan takes the `- Widerspruch:` lines from `## History` of its business source verbatim into `### History`; only so does a contradiction noted in the requirement reach the night report. If the section is missing while `history` is not `false`, `issue check-form` reports that as a hint, not as a violation.

---

## Kanban board (5 columns)
<!-- de: 83f11581b9fe -->

| Column | Meaning | Who moves |
|--------|---------|-----------|
| Backlog | Idea or issue with open questions | Both |
| Ready | Released, counts as GO | Only the human (exception: implementation stage of the night chain under variant B) |
| In progress | Current work, one issue at a time | AI at the start |
| In review | Locally finished, not pushed | AI at completion; origin documents: the kit, when the plan is through |
| Done | Human has tested, push done | Only the human |

---

## Git workflow (strictly binding)
<!-- de: ea7ddb077f03 -->

1. Claude commits locally, does NOT push automatically. Every commit — also lane 1, also by hand, also from a GUI client — requires a green `node .claude/kit/checks.mjs run` on the state to be committed; a tool without `node` in the PATH is rejected, not let through.
2. The human tests locally (start the dev server, click through the golden path).
3. The human types `push main` — Claude pushes to `mainBranch`.
4. The human tests on the test server.
5. The human types `merge production` — Claude creates the PR `mainBranch -> productionBranch`.
6. The human merges the PR.

Absolutely binding:
- No force push to `mainBranch` or `productionBranch` without an explicit individual instruction.
- Hooks (pre-commit / pre-push) are not bypassed with `--no-verify` without an explicit individual instruction; unattended there is no individual instruction.
- `productionBranch` is never pushed directly.

**What the commit gate does not achieve.** `--no-verify` bypasses it (the line above forbids that without an explicit individual instruction, mechanically nothing prevents it), and a fresh clone only has it after an installer run or `git config core.hooksPath .githooks` — the files travel along, the activation is local git config. In both cases **at night** the assessment of the night runner applies, which turns missing or red evidence into a failure — **interactively nobody steps in**. There the line above remains the only rule.

**Steps 7 and 8 run in a worktree of their own.** `/push-main` and `/merge-production` create their release files, run their check run and commit not in the main working tree but in a fresh worktree outside the repo (`node .claude/kit/worktree.mjs create --prefix release`, the same way as for the worktree of the night chain); afterwards they push from there and remove it again, also after a red run. The reason is simultaneity: in the main tree the implementation stage of the night runner can be building under variant B, and two runs in one tree mix their files — the release check run would see foreign, half-finished work, and the runner found the release files as uncommitted leftovers and stopped hard. `/merge-production` builds on `origin/<mainBranch>`, because what is published is what has been pushed; `/push-main` on the local `<mainBranch>`, rebased onto `origin/<mainBranch>` in the worktree. The skill afterwards only moves the local `<mainBranch>` along if no lock of the runner is held and the main tree is clean — otherwise it outputs the command.

---

## Config (.claude/workflow.config.json)
<!-- de: ae8edcde47a3 -->

The file is the only project-local place the skills read from. Fields: `codeHost` (github | gitlab | local) and `issueTracker` (github | gitlab | local | toolbox); `buildChecks` with optional `checkAreas` for area-related checks, optional stage `stage`, optional quality measurement `quality` and optional `notAtCompletion` for checks the completion of a single work package does not have to carry; `mutationCommand` (or empty); `mainBranch` and `productionBranch`; `reviewScope` (`diff` or `all`) and exactly one of `reviewCommand` (foreign CLI) or `reviewModel`; `triggers` for GO, push and merge; `local.issuesDir`; optionally `issueReview` with `reviewers`, `pairs` and `reviewStages`. Personal deviations belong in `.claude/workflow.config.local.json`. An example per stack and the field description stand in the kit documentation, section "The config file". The German field names (`stufe`, `guete`, `nichtBeimAbschluss`, `reviewStufen` and so on) remain valid as old names.

---

## Mandatory checks before push
<!-- de: 8f40224311f5 -->

All **affected** `buildChecks` from the config run green; untouched areas are left out with evidence. Red checks still block the push mechanically. For UI changes: start the dev server, check the golden path and at least one edge case manually. If a check cannot be run locally: note it in the completion report, do not conceal it. **The checks run staggered:** each carries a stage — `package` at the completion of a work package, `push` before publishing, `merge` before the release; without a value `package` applies. A later stage does **not run along** with the earlier one (a check of the stage `push` stays out at the completion of a work package), and `push` runs the **preceding stage** along (`push` executes `package` and `push`). `merge` only checks what `push main` did not check, because there is never a `merge production` without a preceding `push main`: the stage `merge` always, the package stage by areas over the release files, the stage `push` not. **No mandatory check drops out of the overall process with this**; it only runs at the point in time at which its result counts, and not twice for the same state. Which check belongs in which stage is decided by the project. The stage of a mandatory check (`stage`) is something different from the review stages (`reviewStages`) and from the stages of the night chain: it says *when* a check runs, not how thoroughly is read and not which section of an unattended run is due. **One** of its checks a project may also name as a **quality measurement** (`quality` with `pattern` and `marker`): it measures how many deliberately inserted faults the tests notice. If the measured share lies below the mark, that is **the same halt as a red mandatory check** — no new stop point, no exception, no personal mark (the mark applies team-wide, a deviation in `workflow.config.local.json` stays ineffective). The halt costs no work: it is a red run **before commit and push**, the already finished packages stay committed locally, and the version bump of `/push-main` stays in place idempotently — after the rework the same batch continues. **Without naming there is neither measurement nor mark nor halt.**

**The completion of a work package does not have to carry every check.** Besides assignment (`areas`/`always`), point in time (`stage`) and quality measurement (`quality`), `notAtCompletion` stands as a fourth axis on an entry: it says **why** a check does not have to carry the completion of a single card — `interplay`, because it checks the interplay of several parts, or `fullTestSet`, because it only gains its finding from the complete test set. It only takes effect **in the run with `--finish <card number>`**, which the implement skills run at the completion of exactly one card, and only at the stage `package`; if the entry names in `completionAreas` an area the package touches directly, it runs at completion as well. **Postponed, not waived:** every check left out in this way runs **before publishing** in `/push-main` — there the run unchanged covers the full scope, and in the report of the completion run it stands as an omission with its reason. **Without `--finish` every run covers today's scope** — a check run by hand, the commit gate, the post-check of the night runner; whoever does not set the axis notices nothing of it either. If the run before publishing halts, it names on its own the cards whose change the red check touches; the repair is a **new card** — the named card does not wander back out of "In review".
**The full run before `push main` takes place locally, unless the project moves it to its build service with `pushCheck`** — then `/push-main` first pushes to a check branch and to `mainBranch` only when the build service reports green; the obligation is the same in both places. If the project has set up the protection, the code host rejects unchecked states on `mainBranch`; only the owner gets past the protection via `/push-main notfall` (emergency), after a green full local run. **The push stage runs at `push main` or in the preparation of the night for exactly the commit `push main` takes over unchanged; if the project runs it in the build service, it always runs at `push main` on the check branch.** No commit without green evidence, no takeover of a red or changed state: `push main` only takes over a preparation of the night (`.claude/push-vorbereitung.json`) with the result green or green with an open check, and only as long as `mainBranch`, `origin/<mainBranch>` and the prepared commit stand unchanged; otherwise it checks completely as without a preparation. What stayed open at night, `push main` catches up on. **A red check is repeated once — only where its result decides:** if the run runs with `--finish <card number>` (completion of a work package) or with `--retry` (check before `push main` and `merge production`), `checks.mjs` repeats every red check exactly once on the same state, only this one and not the whole run; green afterwards stands as a `Flaky:` line in the report. During the implementation, in a check run by hand, in the commit gate and in the build service there is never a repetition. If a run of the package stage is red and `formatFixCommand` is set, `checks.mjs run` runs the fix once and a second pass; that is not a repetition in the sense of `--retry`.

---

## Guardrails of the checks
<!-- de: bf65ced20845 -->

Three guardrails apply to every session that starts check commands or reads their result — at the completion of a work package, before `push main` and in a check run by hand. The implementation skills refer here.

**Guardrail: A coverage/quality gate is a floor, not proof of full coverage.** Green means "above the agreed threshold", not "completely tested". As a signal of trust a metric only carries if it stays honest: a gap must mean genuinely untested logic, never silently excluded noise. If the coverage report lies below the target agreed in the project (see the project guide or `workflow.config.json`), flag that explicitly as a signal instead of silently waving it through — the human decides whether to take a look or add tests.

**Guardrail: Recurring, class-wide model errors belong in the gate, not in prompts.** An AI model reproduces the most frequent, not the most current pattern of its training corpus — deprecated APIs and outdated idioms therefore show up repeatedly and across the board. Such error classes belong as a hard lint/compiler guardrail in the `buildChecks` of the mandatory checks, not as a request in a CLAUDE-`*`.md: an appeal to discipline is skipped under time pressure, a guardrail in the gate cannot commit green in the first place. The guardrail derives from the existing annotations instead of keeping a hand-maintained ban list (which itself goes stale) — e.g. `@typescript-eslint/no-deprecated` (reads JSDoc `@deprecated`), Java `-Xlint:deprecation` with `-Werror`. SonarQube or similar remains a safety net, not the main catch: the round trip via `main` catches reliably, but late — the check belongs up front, in the mandatory checks.

**Guardrail: Long-running checks need a generous time frame.** The Bash tool kills commands after a generic default of about two minutes if no larger value is passed. An `mvn verify` with a full Testcontainers IT run, a mutation test or a multi-module build regularly exceed that under load — the check then dies not of a real error but of the clock. Therefore always set a generous time frame explicitly for such commands: as a guide at least 5 minutes, for IT-heavy multi-module builds 15 minutes and more. That remains a request to the caller, because a tool **cannot give itself more time than its caller** grants it. If a check still runs into the timeout, do **not** silently restart it with the same value — either raise the timeout and say so, or report the check unambiguously as a failure. A second run into the same limit costs twice the time and delivers the same non-answer. An abort at the clock does not stay invisible: `checks.mjs run` writes its summary as it goes, and only the last version is complete — if the run dies at the clock, it stays **incomplete and not green**.

The fourth, waiting for one's own running work, stands in the section "Night mode (optional)" and also applies interactively.

---

## Long texts to the board
<!-- de: 24646d74747b -->

**Every text a session writes to the board goes via a file outside the project directory — never in the command itself.** First `printenv TMPDIR` — if the output stays empty (Linux and WSL2 without a sandbox), `/tmp` applies —, then piece by piece `cat >` and `cat >>` into `<tmpdir>/<name>.md`, then a call with `--text-file` or `--body-file`. Four rules, each with evidence behind it:

1. **At most 6,000 characters per tool call**, not per file. The 6,000 are an **observation** of 2026-09-10 in the kit repo: calls up to 9,722 characters went through, from 10,154 on the command parser rejected them — also a `cat >>`, not only the board call.
2. **The target path stands verbatim in the command, never as a variable.** A variable redirect is rejected unattended as "path is runtime-determined".
3. **Only the shell, no file-writing tool.** Unattended, write accesses outside the project directory are rejected with it, inside `.claude/` they need approval.
4. **No pipe, no grouping around the board call.**

A file in the repo would make the working tree unclean, and on that the night runner stops hard. Whoever writes tersely notices nothing of the limit; whoever checks thoroughly would otherwise lose everything. **Named exception: `issue report --text` and `--part`.** The completion report of an implementation is carried by `issue report <id> --text '<report>'` as an argument in single quotes — without an intermediate file, without a heredoc, without a pipe; a `'` in the report is written as `'\''`. Above 6,000 characters it goes in numbered pieces (`issue report <id> --part <n> --text '…'`, each a tool call of its own), the closing call `issue report <id>` without `--text` puts them together. Reason: the storage place outside the project directory was, in the measured run, exactly the spot where a report failed and went out twice. For `issue create`, `update` and `comment` the rule above applies unchanged.

---

## Issue format (four sections)
<!-- de: 3db4c9da1e3a -->

```markdown
## Context
Why is this task being done?

## Task
What concretely has to be done?

## Acceptance criteria
How is it verified that the task is done?
Portability convention: if a file is meant to be portable on its own (installer, copyable script), this must state: "runs without further repo context".

## Dependencies
Keine. (or: Issue #N must be finished before)
```

Dependency convention: exactly "Keine." or explicit references of the form `Issue #N`. Free text is additionally allowed, but the `#N` reference is mandatory when another issue is meant — the night runner (`kit/night.mjs`) only evaluates `#N` references. Refer to foreign repos as `owner/repo#N` (does not count as a local issue). Every local `#N` in the section counts as a dependency, also in explanations: "Not #N: …" holds the package just as firmly as `Issue #N`. Only references of the form `owner/repo#N` do not count. A reference line begins, after optional whitespace and an optional list marker (`-`, `*`, `+`, `1.`), with `Issue #N` and carries no further local number; the addition `(wartet auf Push)` (waits for push) behind it says that the package needs the changed tool, skill or rule text of the other package as a tool and can only run after its push — if it only builds on its code, the addition is dropped; every other number comes from explanatory text, also one in the code block of the section. When writing, `issue check-form`, `issue create` and `issue update` report under `hinweise` per number from text an entry `schreibweise` and per reference to a document (`[Plan]`, `[Requirement]`, `[Idea]`) an entry `dokument`, also from a reference line, and per number the board does not know an entry `unbekannt` — without touching `ok` or the exit code. A dependency is unfulfilled only as long as its card lies in Backlog, Ready or In progress; every other position — In review, Done, archived, not on the board — counts as fulfilled, also a mistyped number. If the board does not answer, the package stays where it is. The document hint says: the document is no work package and is not done through implementation, a plan document never, a requirement or idea only when its packages are finished; the night run nevertheless counts the reference as a dependency. Dry run (`night.mjs --dry-run`) and the deferral comment name per dependency, fulfilled or unfulfilled, its origin (reference line or explanatory text) with the text passage. If packages hold each other, directly or via a chain, the cycle finding stands as a line of its own `Kreis: #A -> #B -> #A`; a package that does not stand in the cycle itself but hangs on it via its unfulfilled dependencies gets the addition "this package waits for a cycle".

Derivation convention: `issue create --derived-from <number>` additionally carries the card number of the nearest ancestor to the board as a field — `/requirement` never (root), `/task` never (no ancestor), `/techplan` to the business issue, `/issues` to the plan document. The body lines `Plan:` and `Requirement:` (in a German project `Fachliche Quelle:`) stay alongside: a project change deletes the field, the text survives it. Only effective at creation, there is no adding later.

### Four title prefixes, four special cases
<!-- de: 026935c5530d -->

An issue without a prefix is a work package in the four-section format above. Four prefixes mark cards that **no session implements**; implement skills and night runner mechanically put them back into the backlog with a comment, without starting a session. The first three are documents and never go to Ready; `[Human]` is a work package only a human can do. **The kit writes English, recognises both.** New cards carry only the English prefixes, and the kit sets only English labels, also in a German project; `issue create --art requirement|plan|idea|human|task` sets the English prefix. Cards with the earlier German names keep working: the kit recognises them when reading, treats them the same, also with regard to release rights, and removes a German label where it would remove the English one. `[Plan]`, `[Task]`, `kit:night`, `kit:nightrun` and `planreview:1|2` are the same in both languages. The complete name table stands in the section "Labels and title prefixes" of the kit documentation, with the earlier names.

| Prefix | What it is | Way forward |
|--------|------------|-------------|
| `[Requirement]` | requirement from `/requirement`, story format | groom with the PO, then `/techplan #N` |
| `[Plan]` | plan document from `/techplan`, binding plan format | `/issues #N` breaks it down into work packages |
| `[Idea]` | raw idea, not yet a document | `/triage #N` — directly: weighing needed `/requirement #N`, otherwise `/task #N` |
| `[Human]` | work package whose task lies outside the repository | the human acts and moves the card on themselves |

**Plan documents** (`[Plan]`) record the released state instead of implementing it. A plan describes a way, it is no task: it is **never implemented**, **never goes to Ready** and is first broken down into work packages with `/issues #N`. Its format is binding — exactly these six headings in this order:

```markdown
## Goal
## Affected areas
## Architectural decisions
## Planned changes
## Open questions
## Verification
```

**Done is set by the human** — here too. The kit moves plan document and requirement to **In review** as soon as the plan is through: at least one of its work packages lies verifiably in In review or Done, none in Backlog, Ready or In progress. It moves the requirement only when every one of its plans not noted as superseded is through. What already lies in In review or Done stays there. That applies no matter which way built the last package — night chain, implementation night or session by day. In review means for origin documents exclusively: everything built, review is due.

**Ideas** (`[Idea]`) are a raw requirement, not an implementable issue. Their regular way is `/triage #N`: the skill talks the idea through with the human, proposes a lane with its reason, and the human chooses one of four exits — `1` implements the trifle at once and closes the idea with a reference to the commit, `2, fachlich` leads via `/requirement #N` into a requirement, `2, technisch` via `/techplan #N` directly into a technical plan, `3` via `/task #N` into exactly one work package. Whoever already knows what the idea wants calls two of these ways without `/triage`: if the idea demands a weighing, `/requirement #N` is the way and turns it into a requirement; if there is nothing to weigh or the human has already decided, it becomes exactly one work package via `/task #N`. The human chooses the way, in `/triage` or with the call — a skill that answers it for itself would make the decision it is supposed to hand over. An idea goes directly to the technical plan only after `/triage` with the chosen lane `2, technisch`: there the goal is decided, and the human chooses the lane; without this place the way would skip it. Such a plan has no business source and is therefore no input for the night chain — it runs by day via `/issues #N` with the number of the plan. Without the gate a session would correctly reject an idea in Ready, but the runner cannot tell this rejection apart from a failure — the session is burnt and the comment on the board misleading.

**Human steps** (`[Human]`) are work packages in the four-section format, but their task lies outside the repository: a setting in a web interface, an account, an access, a release. No move of a session does them, therefore none starts. In the form check they fall into the stage `issue` like every other package. The return comment says explicitly that the card **waits** and has not failed — in the backlog it otherwise looks like a failed package, and whoever reads the columns in the morning no longer finds it where they put it. Without the gate the runner would start a session that recognises the case correctly and does nothing; it cannot tell this correct inaction apart from a failure.

**`[Task]` is the only prefix that marks an implementable work package**; it is implemented and moved to Ready like a package without a prefix. The four prefixes of the table above denote cards no session implements — `[Task]` explicitly does not belong to them, and adding it to the same list would reverse its purpose. `[Human]` is a work package too, but one that does not have its task in the repository; `[Task]` remains the only prefix whose package a session builds.

---

## Completion report format
<!-- de: 7f0775acc4a7 -->

```
### Changes
- `File` — short description of the effect

### Tests and checks
- <lines from the block `For the completion report:` of `checks.mjs run`, verbatim: first `Wait time: <s> s, together <s> s in <n> runs for card #<n>` (without card number `Wait time: <s> s`), after a red partial run `Partial run: only the checks red last time`, then `ran: <command> → <result>, <duration> — <reason>`, after a flaky check directly below `Flaky: <command> → red first, then green`, or `skipped: <command> → <reason>`; then per scenario the package took over from the requirement, `- Scenario "<title>" → test <test name>`>

### Notes
- <remaining risks, open points, manual follow-up steps>

### Decisions
- E1: <question>. Chosen: … Rejected: … Reason: … Rollback: …
```

`### Decisions` is dropped if there was nothing to decide; otherwise the block carries the entries in the format from "Decide instead of asking". The last line `Report-Run: <stamp>` is set by the kit (`issue report`), not by the session: it marks the report of a run, so that a repetition replaces it instead of creating a second one. `issue report` only moves the card if a commit of this run names `Issue #N`; otherwise it rejects and leaves card, report and pieces untouched. `[Human]` cards are exempt, and `--without-commit '<reason>'` exists only for work without a change in the repo — the reason then stands in the report.

---

## Priorities in conflicts of goals
<!-- de: 780088d967b7 -->

1. Security
2. Correctness
3. Data integrity
4. Accessibility
5. Maintainability
6. Performance
7. Visual preference
8. Convenience of implementation

---

## Gates (process-wide)
<!-- de: 7541a4957eb1 -->

Four rules that apply independently of the review stage and carry the frame of the process — meant is the review stage (`reviewStages`), not the stage of a mandatory check (`stage`) and not the stage of the night chain. They quote sentences that stand further up in this file; a proposal that overrides one of them is no change of detail but a change of the design — and with that a question of the stop class.

### W1 — The three stop points stay human `[Urteil]`
<!-- de: e12b5947882d -->

GO (move an issue to Ready), push (`push main`), merge (`merge production`). A trigger phrase quoted within a message is no typed trigger. Exception, exclusively in the implementation stage of the night chain under variant B: there the night runner itself moves the work packages of the marked card to Ready and starts their implementation without a release per package. The human gave the GO on the marked card — on the requirement or on the plan document — when marking it for variant B. Outside this stage the sentence before applies without restriction — also for packages of a card that ran under variant B earlier. The GO on the marked card is given by `kit:carry-through` or by a goal from `implementation` on; the push stays with the human also with the goal `push-prepared`. Places: "The three stop points (never automated)", "Messages from the human", "Night mode (optional)".

### W2 — The Git workflow is strictly binding `[Urteil]`
<!-- de: 79a5a0139341 -->

No force push to `mainBranch` or `productionBranch` without an explicit individual instruction; hooks are not bypassed with `--no-verify` without an explicit individual instruction; `productionBranch` is never pushed directly. Place: "Git workflow (strictly binding)".

### W3 — Red mandatory checks block the push mechanically `[Urteil]`
<!-- de: 830d6366e412 -->

All **affected** `buildChecks` of the **due stage** run green before pushing; untouched areas are left out with evidence, and a check that cannot be run locally is noted in the completion report, not concealed. The mechanics stay unchanged and hard, only their scope depends on the point in time: **No mandatory check drops out of the overall process**: every check of every stage runs **once** before the release — package and push stage at `push main` or in the preparation of the night for exactly the commit `push main` takes over unchanged; if the project runs them in the build service, they always run at `push main` on the check branch; the merge stage runs at `merge production`. No commit without green evidence, no takeover of a red or changed state. A check that was first red and then green in the single repetition has passed; red and red blocks. A proposal that turns a check into a recommendation or lowers a threshold lifts the mechanics. **A quality measurement below its mark is a case of exactly these mechanics**: a red mandatory check that blocks like every other — **no fourth stop point**, no decision place of its own, and lowering the mark is the lowering of a threshold from the sentence before. Place: "Mandatory checks before push".

### W4 — The order of priorities in conflicts of goals `[Urteil]`
<!-- de: d768008dde2b -->

Security, correctness, data integrity, accessibility, maintainability, performance, visual preference, convenience — in this order; it is the arbitration for every conflict a document does not decide itself. Place: "Priorities in conflicts of goals".

---

## AI retro (every 1-2 weeks)
<!-- de: 19e8c2ee8395 -->

`/retro` starts the AI retrospective. Four questions:
- Where did the human-AI collaboration get stuck?
- Which memory entries are outdated?
- Which workflow rule needs sharpening?
- What do the numbers say? (overturned night decisions, stop questions, requirement to GO, GO to push)

Output: concrete changes to memory files and CLAUDE*.md files, plus the key figures as a table.
