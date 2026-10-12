---
name: implement-ready
description: Step 5 of the 9-step process — works through all issues in the Ready column sequentially in board order, commits locally, does not push. Use this skill when the user calls /implement-ready, wants to implement Ready issues or gives the GO for implementation.
user-invocable: true
---
<!-- de: cb6e1ab96b77 -->

# Implement Ready
<!-- de: fe8416b43701 -->

Step 5 of the 9-step process: the AI works through the Ready issues sequentially. Every issue is implemented completely, committed locally and moved to In review before the next one begins.

## Precondition
<!-- de: 67f762502775 -->

The configuration lies in `.claude/workflow.config.json` (in the repository, applies to everyone) and is optionally supplemented by `.claude/workflow.config.local.json` (not in the repository, only personal fields: `reviewModel`, `reviewCommand`, `reviewScope`, `triggers`, token paths). Issue #207.

Relevant field:
- `mainBranch`: branch for local commits (default: `main`)

## Procedure per issue (order: as delivered by the adapter = board order)
<!-- de: 61517d5a750e -->

### 0. Load the Ready issues and fetch the brief
<!-- de: f04d63e2f8ae -->

```bash
node .claude/kit/board.mjs issue list --status ready
```

Returns the issues as a JSON array in the order of the board's Ready column (top first; only the local file tracker returns them numerically by ID). This order is binding — the human sets it before the GO by drag and drop in the Ready column. Do not re-sort numerically.

**For every issue first fetch the brief — one call, before every move:**

```bash
node .claude/kit/board.mjs issue brief <id>
```

The brief delivers in one go the **verdict** (`may start` or `may not start` together with the reason) with its **consequence**, plus the task with comments, the plan decisions verbatim, the business reason, the siblings with column, the prerequisites and the gaps. It runs **before** step 1: it expects the card in Ready; after the move to In progress its consequence would read `bleibt`. Action follows the consequence alone; its values are machine values and stay German. The checks behind it — the title prefixes `[Requirement]`, `[Idea]`, `[Plan]` and `[Human]`, the label `kit:clarify`, the label `kit:protected` and the protected files the package names, the column, the prerequisites — and the wording of the backlog comments stand in `kit/board.mjs`, not in this skill; the German names (`[Fachlich]`, `[Idee]`, `[Mensch]`, `kit:klaeren`, `kit:geschuetzt`) count the same:

- **`beginnen`** — continue with step 1.
- **`bleibt`** — the card is neither moved nor commented. The skill reports the reason from the verdict, and the run goes on with the next issue.
- **`backlog`** — the card is no implementation task or carries an open question to a human. The comment the brief delivers under "Comment for the card (verbatim)" goes to the issue unchanged, then the card moves to Backlog, and the run goes on with the next issue:

  ```bash
  node .claude/kit/board.mjs issue comment <id> --text '<comment from the brief, verbatim>'
  ```

  ```bash
  node .claude/kit/board.mjs issue move <id> backlog
  ```

- **`geschuetzt`** — the package names a protected file that only a human may write, and is not released. It is not started, no file is touched. The steps are also named by the reason in the verdict, in this order — first to Backlog:

  ```bash
  node .claude/kit/board.mjs issue move <id> backlog
  ```

  Then the label:

  ```bash
  node .claude/kit/board.mjs issue label add <id> kit:protected
  ```

  A failure of this call is reported and does not stop anything. Then the comment the brief delivers under "Comment for the card (verbatim)" goes to the issue, supplemented as the last line by the label line that records the outcome: `Label kit:protected gesetzt`, or `Label kit:protected nicht gesetzt` if the call before failed. Only the first releases the package later. The comment goes by the transport rule (`CLAUDE-workflow.md`, "Long texts to the board"): create the file `<tmpdir>/<id>-geschuetzt.md` piece by piece via the shell, then

  ```bash
  node .claude/kit/board.mjs issue comment <id> --text-file <tmpdir>/<id>-geschuetzt.md
  ```

  Then the run goes on with the next issue.

**The label `kit:clarify` is never removed in the process.** The machine may set it, only the human may take it off (plan #368, A4) — a run that were allowed to clear its own `kit:clarify` could release itself.

**`kit:protected` is never removed either.** The machine sets it, only the human may take it off, after they have made the protected change themselves — only then does the package count as released at the next attempt.

Whether a Ready issue was reviewed is no question for this skill — Ready is the GO.

### 1. Move the issue to In progress
<!-- de: 8c5e72856256 -->

```bash
node .claude/kit/board.mjs issue move <id> in_progress
```

### 2. Read the issue completely
<!-- de: 6a285997c353 -->

What is read is the brief from step 0. It already carries task, comments and context: a further `issue get` for the card, the plan or the business source is not needed, and its output is not taken apart via `node -e` or `jq`. What it names under "Gaps" is really missing and is not silently supplemented. Read all sections of the task. Implement **against the issue**, not against the chat. What is in the issue gets built. What is not in it stays out.

**If the issue carries a line `Recommended model: <name>` or `Task-Tier: <schwer|mittel|leicht>`, name it** — together with the note that the running session does not change its model. Both are a statement, not an instruction: at night it takes effect by itself (the runner starts the card's session with it), during the day the human chooses their model themselves and sits alongside anyway. **No halt, no asking back, no change to the procedure** — whoever asks a running session to restart for a recommendation costs more than the recommendation is worth.

**If the package carries a note with the anchor `## Night run: waiting session`, `## Night run: time limit reached` or `## Night run: stuck on a check`, name it** — then it has already been started once, and the last known state stands in the note. The second anchor additionally says that the previous run ended at the session time limit, the third that the brake ended it at a check that kept failing the same way; the note names check and error. The German anchors (`## Nachtlauf: …`) count the same. **No halt, no consultation**, only the message: whoever keeps quiet about the note silently continues halfway.

### 3. Implement
<!-- de: eb49fe63b831 -->

- TDD: write tests first and let them run red, then implement against the tests until green
- Reuse existing patterns and functions
- No feature, no refactoring, no abstraction the issue does not demand
- For UI changes: start the dev server, click through the golden path and edge cases
- For new or changed logic: covered or excluded with reason according to the project's coverage/quality policy (see project guide or `workflow.config.json`). Never silently exclude untested logic, never lower thresholds just so a gate turns green.
- Do not fix recurring, class-wide model errors (outdated idioms, deprecated APIs) only at the places found: propose them as a hard lint/compiler guard rail for the `buildChecks`, derived from existing annotations (e.g. `@typescript-eslint/no-deprecated`, Java `-Xlint:deprecation` with `-Werror`) instead of a hand-maintained ban list or a request in a CLAUDE-`*`.md — see the guard-rail principle in the `local-check` skill.
- Call long-running build, test and mutation-test commands (`mvn verify`, PIT, Testcontainers ITs) with an explicitly set, generous timeout instead of the generic default — see the timeout guard rail in the `local-check` skill.
- Always actively wait for a mandatory check started in the background before finishing the report — never end with a mere announcement like "I'll get back once the run is through", see the guard rail on the background check in the `local-check` skill.
- More generally, and therefore the rule behind the line before: **No session ends with its own work still running** — whatever it is, not only for a mandatory check. Whoever has kicked off a long run waits for its result or aborts it and reports the abort as a failure; a closing message that only says it is still waiting is no close, but the failure itself (Issue #754). Whoever waits checks two things in the process: whether the result is there and whether the run **still exists** — a waiting loop without the second check waits out its full length in the error case, and a run that no longer exists is a failure and is reported as such, not as a timeout (Issue #983).
- Without supervision (set `KIT_AGENT_MODEL`) there is no background work: the hook `bash-check` rejects a Bash call with `run_in_background` (Issue #1081) — call the command in the foreground and wait for it. Interactively background work stays allowed.
- If `checks.mjs run` reports `Pruefung festgefahren:` (exit code 3), the session ends without further change: no fix, no further run, no commit, no report. The brake only takes effect unattended; the rest — stash, note `## Night run: stuck on a check`, Backlog — is taken over by the night runner. Interactively the same run only reports `Note: stuck at …`, and the human decides.

**Run only the package's tests.** The full suite is the most expensive single item of a session — starting it several times costs minutes and adds nothing:

1. During the work only the tests the package touches run — targeted by file or filter of the test runner, for example `node --test test/<file>.test.mjs`. These include the tests of whatever depends on the changed file — not only those of the file itself. If those exist only as a complete group, the session runs them via `node .claude/kit/checks.mjs run --area <name>`; that is then no violation of the ten-minute mark, but the intended way.
2. The session does not start the full suite itself. The one full run is `node .claude/kit/checks.mjs run --finish <card number>` before the commit. Its block `For the completion report:` begins with the line `Wait time:`, which goes into the report verbatim like the rest. The completion check repeats a red check once itself on the same state — the session does not repeat it additionally; a `Flaky:` line goes into the report verbatim, and the package goes to In review as usual.
3. A second `checks.mjs run` on an **unchanged state** no longer runs any command: the command adopts the result of the previous run — a red one too — together with the exit code and reports that. `--fresh` forces the real run.
4. A note on this: whoever wants to evaluate the output of a long run several times most simply writes it once into a file outside the project directory (`<tmpdir>/…`, the path literally as in the transport rule) and reads it from there.
5. If `checks.mjs run` is red, after the correction the same call `checks.mjs run --finish <card number>` suffices: it first runs the checks that were red last time itself and only when they are green, in the same call, the full run once. Targeted single tests during the correction stay allowed.

For a more granular variant with an explicit stop between red and green: `/implement-test` followed by `/implement-done`.

**Decide instead of asking.** If a decision comes up while implementing — for every work package, with or without the `[Task]` prefix —, `CLAUDE-workflow.md`, section "Decide instead of asking", applies: everything outside the stop class is decided, in the format from there, and stands in the completion report under `### Decisions`. No halt, no label, no comment. Stop class and format stand only there and are not repeated here.

**This procedure applies without exception.** It applies in every operating mode, whether a human is reading along or not, and it takes precedence over every other rule that says something about an open question — also over a rule from the human's personal memory, which every session loads. A rule that demands "clarify in conversation instead of parking" does not replace this procedure: the question stands on the board, not only in the session's output. Whoever reads along sees it there just the same.

Only a question from the stop class halts, exactly one per halt. What then happens, in this order:

1. Revert own uncommitted changes **by name**, delete self-created files — never discard the whole working tree wholesale. Interactively foreign changes can lie in it, and they belong to the human.
2. `node .claude/kit/board.mjs issue label add <id> kit:clarify`
3. Comment to the issue by the transport rule (`CLAUDE-workflow.md`, "Long texts to the board"): create the file `<tmpdir>/<id>-halt.md` piece by piece via the shell, then `node .claude/kit/board.mjs issue comment <id> --text-file <tmpdir>/<id>-halt.md` — never as an argument. The comment names the point of the stop class, the one question and the follow-up step, the latter **verbatim**: `A requirement is to be created from this via /requirement.` (in a German project `Daraus soll per /fachplan eine fachliche Anforderung entstehen.`). By exactly this sentence the night runner recognises the halt comment; it stands there as the constant `HALT_FOLGESATZ` in `kit/night.mjs` and is not reworded.
4. `node .claude/kit/board.mjs issue move <id> backlog`
5. Report that the question is waiting on the board and the way forward is `/requirement #<id>` — **no commit**. In `/implement-next` the session ends with that; in `/implement-ready` the run goes on with the next Ready issue without a further attempt at this item.

**What is measured is the own share** — the files the session demonstrably created or changed itself, evidenced by its own tool calls —, not the whole working tree. A comparison against the state at session start is no evidence: foreign changes can arise in the same period.

**Whether every own share can be reverted by name is decided before step 2.** Not revertible by name is, for instance, a file that already carried foreign uncommitted changes before the session and that the session changed further — `git restore` would take the human's share away from them. If such an own change remains, there is **no** halt: none of steps 2 to 5, so no label, no comment, no move, no commit. The session reports which file remains and why, and ends; the issue stays in In progress. Interactively the human decides, at night the runner's dirty guard takes effect as with every round without an In review result.

The label is **never** removed in the process — the same reasoning as for the `kit:clarify` guard rail in step 0: the machine may set it, only the human may take it off.

**Fallback: write access to a protected file rejected.** If Claude Code rejects a write access because the file is protected, although the task does not name it, the session halts — without a further attempt. The protection is never circumvented, not via the shell either. This is not the halt of a stop question: a different label, a different anchor, a different order, and the way forward is the human's action on the file, not a business concept. In this order:

1. Revert own uncommitted changes **by name**, delete self-created files — never discard the whole working tree wholesale. What is measured is the own share, evidenced by the own tool calls.
2. `node .claude/kit/board.mjs issue move <id> backlog`
3. `node .claude/kit/board.mjs issue label add <id> kit:protected` — a failure is reported and does not end the halt.
4. Fetch the comment: `node .claude/kit/board.mjs issue check-protected <id> --path <rejected path>`, one `--path` per rejected path. The command ends with exit 1, that is the finding. The field `kommentar` of its output begins with the anchor `## Protected file` (in a German project `## Geschuetzte Datei`) and is the text — the session does not build it itself. It goes to the issue supplemented as the last line by the label line from step 3 (`Label kit:protected gesetzt` or `Label kit:protected nicht gesetzt`), by the transport rule (`CLAUDE-workflow.md`, "Long texts to the board"): create the file `<tmpdir>/<id>-geschuetzt.md` piece by piece via the shell, then `node .claude/kit/board.mjs issue comment <id> --text-file <tmpdir>/<id>-geschuetzt.md` — never as an argument.
5. Report which file a human must change — **no commit**. In `/implement-ready` the run then goes on with the next Ready issue, the other skills end with it.

If an own share remains that cannot be reverted by name — for instance a file that already carried foreign uncommitted changes before the session —, there is **no** halt: no move, no label, no comment, no commit. The session reports the file and ends; the package stays in In progress. Here too: `kit:protected` is never removed.

### 4. Checks before the commit
<!-- de: a56bb78821e3 -->

```bash
node .claude/kit/checks.mjs run --finish <card number>
```

The command selects the affected `buildChecks` and runs exactly those.
**Without `--since`** — the anchor is determined by the command (default `HEAD`), the skill
never passes one itself. Because the call stands **before** the commit, `HEAD` measures
exactly this one work package: a failure belongs to the package that triggered
it — in both operating modes and also when a session commits several times.

**The package stage is run.** The skill never passes `--stage` either: the package stage
is the default, and here it is the right one — a work package is measured. If
a check in the project carries the stage `push` or `merge`, it therefore appears in the list
`skipped`, with its stage as the reason. That is **no deficiency**, but its point in time:
it runs in `/push-main` or `/merge-production` respectively. In the report it stands like
every other skip.

**`--finish <card number>` — this is the completion of exactly one card.** Only such
a run may skip the checks marked with `nichtBeimAbschluss` as
interplay checks: they measure what several packages produce together,
and run in full before publishing in `/push-main`. The
**card number** is that of the issue this run completes — without it the
effectiveness could not compute its metric per card (Issue #951).

A red run prevents the commit, as every red mandatory check did before.

A hint check, by contrast, never halts: it ends green and writes its findings as
`note: <file and reason>` into the block `For the completion report:`. The
`note:` lines go into the report part Tests and checks verbatim and do not hold up the done message —
no fix in the same package, no asking back, no halt (Issue #1156).

The command names in its output the checks **that ran and those that were skipped**,
each with a reason. Both belong in the completion report (step 6):
naming only the runs is not enough — then the skips would have to be
inferred indirectly, and a shortened run would look like a complete one. The
skips are taken over from the output **with their reason**, verbatim and not
shortened to "skipped" — only the reason says whether a check is waiting for its point in time
or dropped out. If the
command reports `leeresPaket`, that stands explicitly as "no check, because nothing
was changed" in the report, not as an empty list.

**Whoever creates a file assigns it.** If the block `For the completion report:`
names `full scope` because of a file this package created, the package supplements
`checkAreas` with a fitting pattern (or justifies an entry in `ohnePruefung`)
and runs the check again. If Claude Code rejects the write access to the config
(night run, protected file), the file stands under `### Notes` in the report — no
halting, no detour via the shell.

### 5. Commit locally (do not push)
<!-- de: 3c4461cbf8a4 -->

```bash
git add <changed files>
git commit -m "Short title (Issue #N)

Description of the changes and reasoning.

Refs #N

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

Stage only explicitly changed files — no `git add -A` or `git add .`.

**No `Closes`/`Fixes`/`Resolves #N` in the commit.** These keywords close the issue automatically as soon as the commit reaches the default branch (`push`/merge), and the board automation moves closed issues to *Done* immediately — before the human could test. `Refs #N` links the issue without closing it. Closing (→ Done) is done exclusively by the human after their test.

**Manual check points do not block the completion.** If the issue carries a section `### Manual check (human, not part of the session close)` (convention from the `issues` skill), the issue is completed as soon as all machine criteria are met. The manual points are **taken over unchanged into the completion report and the board comment**, so that the human knows before the Done move what is still outstanding. They are no reason to halt — headless nobody answers, and a session that gets stuck on them cannot be told apart from a failure by the runner (Issue #215).

### 6. Report: completion report and In review
<!-- de: 98edece150f5 -->

Filing the report and moving the card to In review is **one** call. The report stands as an argument in single quotes, without intermediate file, without heredoc, without pipe:

```bash
node .claude/kit/board.mjs issue report <id> --text '## Completion report Issue #N
…'
```

**Escaping:** a `'` in the report is written as `'\''` — that is the only rule, everything else stands in the report as it is.

**Over 6,000 characters** the report goes in numbered pieces, each an **own** tool call, because the limit applies per call. A piece does not touch the board, and a repetition overwrites it:

```bash
node .claude/kit/board.mjs issue report <id> --part <n> --text '<piece n>'
```

Then the closing call without `--text` — it puts the pieces together in number order, files, moves to In review and clears the pieces only afterwards:

```bash
node .claude/kit/board.mjs issue report <id>
```

The last line `Report-Run: <stamp>` is set by the kit; the session does not write it. By it `issue report` recognises the report of this run: a repetition does not create a second one, but leaves it standing with the same content and replaces it with changed content. **If the report fails**, the card is not moved, and the output names the reason. The repetition is the closing call alone — in the piece form `issue report <id>` without `--text`, the pieces are still there; in the single form the same call with `--text`. Why `issue report` is exempt from the transport rule stands in `CLAUDE-workflow.md`, section "Long texts to the board".

Format of the completion report:

```
## Completion report Issue #N

### Changes
- `File.java` — short description of the effect
- `FileTest.java` — what is tested

### Tests and checks
<the lines from the block `For the completion report:` of the output of `checks.mjs run`, verbatim, not reworded or shortened:>
- Wait time: <s> s, together <s> s in <n> runs for card #<n>   (without card number: Wait time: <s> s)
- Partial run: only the checks red last time   (only after a red partial run)
- ran: <command> → <result>, <duration> — <reason>
- note: <file and reason>   (per finding of a hint check, directly below its line)
- skipped: <command> → <reason>
- for `leeresPaket`: no check, because nothing was changed

### Notes
- <remaining risks, open points, manual follow-up steps>

### Decisions
- E1: <question>. Chosen: … Rejected: … Reason: … Rollback: …
```

`### Decisions` is dropped if there was nothing to decide; otherwise the block carries the entries in the format from `CLAUDE-workflow.md`, section "Decide instead of asking".

### 7. Next issue
<!-- de: 081ba13d19ef -->

As soon as the issue lies in In review: work through the next issue from the previously loaded Ready array (in array order). If Ready is empty: report completion.

### State of the project
<!-- de: c48b6c1aaf00 -->

If this run has brought the last open package of a project to In review — a package with `Plan: Issue #M`, and no other card with the same line still stands in Backlog, Ready or In progress according to `node .claude/kit/board.mjs issue list` —, the closing message begins with the section `## State of the project`:

1. **What the human sees now** — what has visibly changed for someone who uses the software, in a few sentences.
2. **What of the occasion is not contained** — every goal and every business acceptance criterion of the business source that no package has produced, and with a `Template:` line every deviation from the template. "Nothing" stands there only after a point-by-point comparison.
3. Only afterwards commits, checks and notes.

The business source comes from the line `Requirement: Issue #N` (German `Fachliche Quelle: Issue #N`) of the plan `#M`, fetched with `node .claude/kit/board.mjs issue get <N>` — never from the conversation. Green means "fulfils what was written down", not "fulfils what was meant"; whoever reads what is missing further down takes the project for finished. A package without a `Plan:` line belongs to no project, the section is dropped. Unattended the same section stands at the beginning of the completion report of the last package.

The origin documents are moved along by `issue report` itself: the closing message names the lines from the field `ursprung` of its output (moved, already there, not moved along together with command), and the session never moves plan and requirement itself. The session's verdict applies to the section `## State of the project`, the kit's to the move; both follow the same column rule, and if they deviate (`ursprung.durch` is false although the section stands), the closing message names that.

## Behaviour with an empty Ready
<!-- de: c3f23a6f4d97 -->

> "Ready is empty. All issues in In review. I am waiting for your GO for the next batch."

No pulling from Backlog on one's own authority. No guessing which issue would make sense.

## Stop points
<!-- de: 8a0c053dc0bf -->

- Implementing requirement issues (`[Requirement]` title), ideas (`[Idea]` title), plan documents (`[Plan]` title) and human steps (`[Human]` title): never — commented back to Backlog
- Pushing: never without the explicit trigger phrase `push main`
- Moving Backlog to Ready: never — that is Manne's GO. Exception, exclusively in the implementation stage of the night chain under variant B: there the night runner moves the work packages of the marked card to Ready itself and begins their implementation without a release per package. The GO was given by the human on the marked card — on the requirement or on the plan document — when they marked it for variant B. Outside this stage the sentence before applies without restriction — also for packages of a card that earlier ran under variant B.
- Setting issues to Done: never — the human does that after their test
- Issue-closing commit keywords (`Closes`/`Fixes`/`Resolves #N`): never — they close the issue on push/merge and the board automation moves it to Done before it was tested. Use only `Refs #N`.
