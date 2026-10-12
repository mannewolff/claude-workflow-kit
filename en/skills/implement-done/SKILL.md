---
name: implement-done
description: Replaces step 5 with a finer gait (part 2 of 2) — implements against the red tests prepared by /implement-test until they are green, commits and moves to In review. Use this skill when the user calls /implement-done or, after /implement-test, wants to continue the implementation against the red tests.
user-invocable: true
---
<!-- de: fc737fa07b84 -->

# Implement Done
<!-- de: e8ab2da6c3a7 -->

Replaces step 5 with a finer gait (part 2 of 2): implement against the red tests written by `/implement-test` until they are green, commit, move to In review.

## Precondition
<!-- de: a3bbee845c29 -->

### 0. Find the issue in In progress
<!-- de: 9aad1a0010e2 -->

```bash
node .claude/kit/board.mjs issue list --status in_progress
```

- No issue there: stop.
  > "No issue in In progress. First start `/implement-test` to write tests for an issue."
- More than one issue there: stop, list them, ask the user to choose. Do not guess which one is meant.
- Exactly one issue there: that is the current issue. Whether it may be continued is said by the brief in step 1.

## Procedure
<!-- de: 785d89faa261 -->

### 1. Fetch and read the brief
<!-- de: c114b2c41505 -->

```bash
node .claude/kit/board.mjs issue brief <id> --column in_progress
```

One call delivers the **verdict** (`may start` or `may not start` together with the reason) with its **consequence**, plus the task with comments, the plan decisions verbatim, the business reason, the siblings with column, the prerequisites and the gaps. `--column in_progress`, because `/implement-test` has already moved the card. Action follows the consequence alone; its values are machine values and stay German. The checks behind it and the wording of the backlog comments stand in `kit/board.mjs`, not in this skill:

- **`beginnen`** — continue with step 2.
- **`bleibt`** — stop, report the reason from the verdict, neither move nor comment the card.
- **`backlog`** — the comment the brief delivers under "Comment for the card (verbatim)" goes to the issue unchanged, then the card moves to Backlog, and the skill ends:

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

  Then the skill ends.

**`kit:protected` is never removed either.** The machine sets it, only the human may take it off, after they have made the protected change themselves — only then does the package count as released at the next attempt. The German name `kit:geschuetzt` counts the same.

Read all sections of the task in the brief again; a further `issue get` is not needed, and the output is not taken apart via `node -e` or `jq`. The acceptance criteria are the yardstick for the implementation, not the existing tests alone.

### 2. Implement against the tests
<!-- de: cb9c487566b8 -->

- Implement until the tests written by `/implement-test` are green.
- Do not touch test code — unless it is demonstrably worded wrongly (contradicts the acceptance criteria, tests the wrong thing). Then consult the human instead of a silent change.
- Reuse existing patterns and functions. No feature, no refactoring, no abstraction the issue does not demand.
- Without supervision (set `KIT_AGENT_MODEL`) there is no background work: the hook `bash-check` rejects a Bash call with `run_in_background` (Issue #1081) — call the command in the foreground and wait for it. Interactively background work stays allowed.

**Run only the package's tests.** The full suite is the most expensive single item of a session — starting it several times costs minutes and adds nothing:

1. During the work only the tests the package touches run — targeted by file or filter of the test runner, for example `node --test test/<file>.test.mjs`. These include the tests of whatever depends on the changed file — not only those of the file itself. If those exist only as a complete group, the session runs them via `node .claude/kit/checks.mjs run --area <name>`; that is then no violation of the ten-minute mark, but the intended way.
2. The session does not start the full suite itself. The one full run is `node .claude/kit/checks.mjs run --finish <card number>` before the commit. Its block `For the completion report:` begins with the line `Wait time:`, which goes into the report verbatim like the rest. The completion check repeats a red check once itself on the same state — the session does not repeat it additionally; a `Flaky:` line goes into the report verbatim, and the package goes to In review as usual.
3. A second `checks.mjs run` on an **unchanged state** no longer runs any command: the command adopts the result of the previous run — a red one too — together with the exit code and reports that. `--fresh` forces the real run.
4. A note on this: whoever wants to evaluate the output of a long run several times most simply writes it once into a file outside the project directory (`<tmpdir>/…`, the path literally as in the transport rule) and reads it from there.
5. If `checks.mjs run` is red, after the correction the same call `checks.mjs run --finish <card number>` suffices: it first runs the checks that were red last time itself and only when they are green, in the same call, the full run once. Targeted single tests during the correction stay allowed.

**Fallback: write access to a protected file rejected.** If Claude Code rejects a write access because the file is protected, although the task does not name it, the session halts — without a further attempt. The protection is never circumvented, not via the shell either. This is not the halt of a stop question: a different label, a different anchor, a different order, and the way forward is the human's action on the file, not a business concept. In this order:

1. Revert own uncommitted changes **by name**, delete self-created files — never discard the whole working tree wholesale. What is measured is the own share, evidenced by the own tool calls.
2. `node .claude/kit/board.mjs issue move <id> backlog`
3. `node .claude/kit/board.mjs issue label add <id> kit:protected` — a failure is reported and does not end the halt.
4. Fetch the comment: `node .claude/kit/board.mjs issue check-protected <id> --path <rejected path>`, one `--path` per rejected path. The command ends with exit 1, that is the finding. The field `kommentar` of its output begins with the anchor `## Protected file` (in a German project `## Geschuetzte Datei`) and is the text — the session does not build it itself. It goes to the issue supplemented as the last line by the label line from step 3 (`Label kit:protected gesetzt` or `Label kit:protected nicht gesetzt`), by the transport rule (`CLAUDE-workflow.md`, "Long texts to the board"): create the file `<tmpdir>/<id>-geschuetzt.md` piece by piece via the shell, then `node .claude/kit/board.mjs issue comment <id> --text-file <tmpdir>/<id>-geschuetzt.md` — never as an argument.
5. Report which file a human must change — **no commit**. In `/implement-ready` the run then goes on with the next Ready issue, the other skills end with it.

If an own share remains that cannot be reverted by name — for instance a file that already carried foreign uncommitted changes before the session —, there is **no** halt: no move, no label, no comment, no commit. The session reports the file and ends; the package stays in In progress. Here too: `kit:protected` is never removed.

### 3. Checks before the commit
<!-- de: a0b3ac8c25f4 -->

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
each with a reason. Both belong in the completion report (step 5):
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

### 4. Commit locally (do not push)
<!-- de: 0aff756a0d09 -->

Same format as `implement-ready` step 5 — tests and implementation together in one commit:

```bash
git add <changed files>
git commit -m "Short title (Issue #N)

Description of the changes and reasoning.

Refs #N

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

Stage only explicitly changed files — no `git add -A` or `git add .`.

**No `Closes`/`Fixes`/`Resolves #N` in the commit.** These keywords close the issue automatically on push/merge, and the board automation then moves it to Done immediately — before the human has tested. `Refs #N` links without closing. Closing is done exclusively by the human.

**Manual check points do not block the completion.** If the issue carries a section `### Manual check (human, not part of the session close)` (convention from the `issues` skill), the issue is completed as soon as all machine criteria are met. The manual points are **taken over unchanged into the completion report and the board comment**, so that the human knows before the Done move what is still outstanding. They are no reason to halt — headless nobody answers, and a session that gets stuck on them cannot be told apart from a failure by the runner (Issue #215).

### 5. Report: completion report and In review
<!-- de: 00a2ced627b8 -->

Same format as `implement-ready` step 6, the report stands below.

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

The origin documents are moved along by `issue report` itself: the closing message names the lines from the field `ursprung` of its output (moved, already there, not moved along together with command), and the session never moves plan and requirement itself.

Format of the completion report:

```
## Completion report Issue #N

### Changes
- `File.java` — short description of the effect
- `FileTest.java` — what is tested (prepared by /implement-test)

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

## Stop points
<!-- de: 6f2c5815af28 -->

- Pushing: never without the explicit trigger phrase `push main`
- Moving Backlog to Ready: never — that is Manne's GO. Exception, exclusively in the implementation stage of the night chain under variant B: there the night runner moves the work packages of the marked card to Ready itself and begins their implementation without a release per package. The GO was given by the human on the marked card — on the requirement or on the plan document — when they marked it for variant B. Outside this stage the sentence before applies without restriction — also for packages of a card that earlier ran under variant B.
- Setting issues to Done: never — the human does that after their test
- Issue-closing commit keywords (`Closes`/`Fixes`/`Resolves #N`): never — only `Refs #N`
- Changing test code silently: never — in case of doubt consult instead of correcting on one's own authority
