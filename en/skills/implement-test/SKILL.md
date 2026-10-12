---
name: implement-test
description: Replaces step 5 with a finer gait (part 1 of 2) — writes only the tests (red) against the next Ready issue and stops before the implementation. Use this skill when the user calls /implement-test or, test-driven, first wants to see only the red tests before implementing.
user-invocable: true
---
<!-- de: d726886b1489 -->

# Implement Test
<!-- de: 6f52a2b6ca4d -->

Replaces step 5 with a finer gait (part 1 of 2): write tests against a Ready issue, let them run red, stop. For newcomers who want to see the red→green transition consciously, instead of test and implementation in one go as with `/implement-ready`.

## Precondition
<!-- de: a3bbee845c29 -->

### 0. Is an issue already running?
<!-- de: 100f991a38d7 -->

```bash
node .claude/kit/board.mjs issue list --status in_progress
```

If an issue already stands there: stop.

> "Issue #N already lies in In progress (tests presumably already written). First run `/implement-done` for it before a new issue starts."

Do not touch a second issue in parallel — one issue in work at a time.

## Procedure
<!-- de: 785d89faa261 -->

### 1. Load Ready issues and fetch the brief
<!-- de: 260d405d095b -->

```bash
node .claude/kit/board.mjs issue list --status ready
```

Take the issue with the lowest ID. This choice is binding, no guessing which issue would make more sense.

Then fetch the brief — one call, **before** the move to In progress, because it expects the card in Ready:

```bash
node .claude/kit/board.mjs issue brief <id>
```

It delivers the **verdict** (`may start` or `may not start` together with the reason) with its **consequence**, plus the task with comments, the plan decisions verbatim, the business reason, the siblings with column, the prerequisites and the gaps. Action follows the consequence alone; its values are machine values and stay German. The checks behind it and the wording of the backlog comments stand in `kit/board.mjs`, not in this skill:

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

### 2. Move the issue to In progress
<!-- de: e0fb60106293 -->

```bash
node .claude/kit/board.mjs issue move <id> in_progress
```

### 3. Read the issue completely
<!-- de: 1fd6ab9b0a97 -->

What is read is the brief from step 1; a further `issue get` is not needed, and its output is not taken apart via `node -e` or `jq`. Read all sections of the task. The tests are written against the issue, not against the chat.

### 4. Write only the tests
<!-- de: 340067438b67 -->

- Write test file(s) against the acceptance criteria — so that they fail at the current state of the code (red).
- No production logic. No stub, no mock implementation that already makes the test green.
- Reuse the project's existing test patterns and helpers.
- Without supervision (set `KIT_AGENT_MODEL`) there is no background work: the hook `bash-check` rejects a Bash call with `run_in_background` (Issue #1081) — call the command in the foreground and wait for it. Interactively background work stays allowed.

**Run only the package's tests.** The full suite is the most expensive single item of a session — starting it several times costs minutes and adds nothing:

1. During the work only the tests the package touches run — targeted by file or filter of the test runner, for example `node --test test/<file>.test.mjs`. These include the tests of whatever depends on the changed file — not only those of the file itself. If those exist only as a complete group, the session runs them via `node .claude/kit/checks.mjs run --area <name>`; that is then no violation of the ten-minute mark, but the intended way.
2. The session does not start the full suite itself. The one full run is `node .claude/kit/checks.mjs run --finish <card number>` before the commit. Its block `For the completion report:` begins with the line `Wait time:`, which goes into the report verbatim like the rest. The completion check repeats a red check once itself on the same state — the session does not repeat it additionally; a `Flaky:` line goes into the report verbatim, and the package goes to In review as usual.
3. A second `checks.mjs run` on an **unchanged state** no longer runs any command: the command adopts the result of the previous run — a red one too — together with the exit code and reports that. `--fresh` forces the real run.
4. A note on this: whoever wants to evaluate the output of a long run several times most simply writes it once into a file outside the project directory (`<tmpdir>/…`, the path literally as in the transport rule) and reads it from there.
5. If `checks.mjs run` is red, after the correction the same call `checks.mjs run --finish <card number>` suffices: it first runs the checks that were red last time itself and only when they are green, in the same call, the full run once. Targeted single tests during the correction stay allowed.

Letting the new tests from step 4 run red is exactly such a targeted run: only the written test file, not the suite. The full run is made up for by `/implement-done` before the commit. There it carries `--finish <card number>`, because it is the
completion of exactly one card; this skill completes nothing and does not run it.

**Fallback: write access to a protected file rejected.** If Claude Code rejects a write access because the file is protected, although the task does not name it, the session halts — without a further attempt. The protection is never circumvented, not via the shell either. This is not the halt of a stop question: a different label, a different anchor, a different order, and the way forward is the human's action on the file, not a business concept. In this order:

1. Revert own uncommitted changes **by name**, delete self-created files — never discard the whole working tree wholesale. What is measured is the own share, evidenced by the own tool calls.
2. `node .claude/kit/board.mjs issue move <id> backlog`
3. `node .claude/kit/board.mjs issue label add <id> kit:protected` — a failure is reported and does not end the halt.
4. Fetch the comment: `node .claude/kit/board.mjs issue check-protected <id> --path <rejected path>`, one `--path` per rejected path. The command ends with exit 1, that is the finding. The field `kommentar` of its output begins with the anchor `## Protected file` (in a German project `## Geschuetzte Datei`) and is the text — the session does not build it itself. It goes to the issue supplemented as the last line by the label line from step 3 (`Label kit:protected gesetzt` or `Label kit:protected nicht gesetzt`), by the transport rule (`CLAUDE-workflow.md`, "Long texts to the board"): create the file `<tmpdir>/<id>-geschuetzt.md` piece by piece via the shell, then `node .claude/kit/board.mjs issue comment <id> --text-file <tmpdir>/<id>-geschuetzt.md` — never as an argument.
5. Report which file a human must change — **no commit**. In `/implement-ready` the run then goes on with the next Ready issue, the other skills end with it.

If an own share remains that cannot be reverted by name — for instance a file that already carried foreign uncommitted changes before the session —, there is **no** halt: no move, no label, no comment, no commit. The session reports the file and ends; the package stays in In progress. Here too: `kit:protected` is never removed.

### 5. No commit
<!-- de: 92da312c7aaf -->

The red tests stay unstaged in the working tree. That is the stop point — the next step (`/implement-done`) commits tests and implementation together.

### 6. Closing output
<!-- de: c2b2a86a5c9d -->

List the written test files as clickable Markdown links, so that they can be opened directly in the IDE:

```
### Tests written (red) — Issue #N

- [FileTest.java](path/to/FileTest.java:1)
- [AnotherTest.java](path/to/AnotherTest.java:1)

Tests are red. Continue with /implement-done.
```

## Stop points
<!-- de: 5fcaca9b44a1 -->

- No production code: this skill writes tests exclusively.
- No commit: it only comes about in `/implement-done`.
- Do not start a second issue in parallel as long as one lies in In progress.
- Pushing, moving Backlog to Ready, setting issues to Done: as with `/implement-ready` never on one's own authority — including the exception there for the implementation stage of the night chain under variant B, which concerns the night runner, not this skill.
