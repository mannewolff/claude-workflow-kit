---
name: review
description: Starts a review by an Opus subagent in a fresh session without implementation context. Use this skill when the user calls /review or starts step 7 of the process (code review by a second model).
user-invocable: true
---
<!-- de: ce16254dad47 -->

# Review
<!-- de: 1eed64d904e4 -->

Starts step 7 of the 9-step process: code review by a second model in a fresh session, without knowledge of the implementation session.

## Precondition
<!-- de: 48e26faa6309 -->

The configuration lies in `.claude/workflow.config.json` (in the repository, applies to everyone) and is optionally supplemented by `.claude/workflow.config.local.json` (not in the repository, only personal fields: `reviewModel`, `reviewCommand`, `reviewScope`, `triggers`, token paths). Issue #207.

`reviewModel`, `reviewCommand` and `reviewScope` are the classic personal fields: whoever prefers to review with a different model, with a foreign CLI or always over the full source code sets that in `.claude/workflow.config.local.json` — without affecting the team.

The relevant fields:

- `reviewScope`: `"diff"` (only git diff since the last push) or `"full"` (entire source code)
- `reviewModel`: model ID for the reviewer subagent (default: `claude-opus-4-8`)
- `reviewCommand`: command line of a foreign CLI (e.g. `codex exec --model gpt-5`) that gets the review prompt via stdin
- `mainBranch`: base branch for the diff (default: `main`)

**`reviewModel` and `reviewCommand` are a pair: exactly one of the two is set** (Issue #432). They describe the same role in two ways — a Claude subagent or a foreign tool —, and the skill starts the one or the other depending on the field that is set (step 2).

Two situations still arise at runtime:

- **If both fields are missing**, the default `reviewModel: "claude-opus-4-8"` applies — with a note. Configs from the time before the pair know neither of the two, and `/review` must not break for them.
- **If both are set**, `/review` aborts with a reference to the either-or rule instead of silently preferring one. The installer does not allow this situation (Issue #433), a hand edit of the config does — and which of the two was meant then, only the human knows.

If `reviewScope` is missing, use `"diff"` as the default and point that out.

## Procedure
<!-- de: 785d89faa261 -->

### 1. Assemble the review material
<!-- de: ac23509efe69 -->

The material goes into a file outside the project directory:

```bash
printenv TMPDIR
```

If the output of `printenv TMPDIR` stays empty (Linux and WSL2 without sandbox), `/tmp` counts as `<tmpdir>`. The path stands literally in every call.

**With `reviewScope: "diff"`:**
```bash
git diff origin/<mainBranch>...HEAD > <tmpdir>/review-material.txt
```
`<mainBranch>` is the value from the config (default: `main`). If no remote commit exists: `git diff HEAD~1 HEAD > <tmpdir>/review-material.txt` (last commit).

**With `reviewScope: "full"`:**
All relevant source files (no build artefacts, no `node_modules`, no `.git` contents) one after another into `<tmpdir>/review-material.txt`, each with a header line `=== <path> ===` in front.

### 2. Start the reviewer
<!-- de: 3fa73083b887 -->

The kit assembles the review brief from the role `kit/rollen/code-review.md`, the list of kinds and the material from step 1; the session writes no prompt and fills in nothing itself:

```bash
node .claude/kit/board.mjs issue-review review-brief --role code-review --material-file <tmpdir>/review-material.txt --file <tmpdir>/review-auftrag.md
```

Which of the two ways applies is decided by the field set in the precondition:

**With `reviewModel` set — subagent via the Agent tool** with `subagent_type: kit-pruefer` and the model from `reviewModel` (Opus pin), in a fresh session without implementation context. The order reads only `Lies <tmpdir>/review-auftrag.md`, with a literal path. The agent may only read, its final message is the finding.

**With `reviewCommand` set — the kit starts the configured command** at its read limit (`reviewReadLimit`, German name `reviewLesegrenze`), the brief via stdin, the answer from stdout into the output file:

```bash
node .claude/kit/board.mjs issue-review start --code-review --brief <tmpdir>/review-auftrag.md --output <tmpdir>/review-antwort.md
```

The Agent tool is not used here: it knows only Claude models, and passing a `reviewCommand` through this tool would be a silent failure.

**Failure path: if `review-brief` or `start` ends with an exit code other than 0, `/review` aborts** — with a visible error message including the error from the output, for `start` together with an stderr excerpt. The issue does **not** change to In review, and **no board comment** is created. A review that did not run must leave no trace that looks like a check: a comment under "Code review (step 7)" without findings reads like a clean pass, and an issue in *In review* claims the check is done. Both would be worse than the visible abort.

### 3. Document the result
<!-- de: 28b580ddece9 -->

Write the findings as a comment on the current issue:

```bash
cat  > <tmpdir>/id-review.md <<'TEIL1'
## Code review (step 7)

<FINDINGS>
TEIL1
```

```bash
cat >> <tmpdir>/id-review.md <<'TEIL2'
… further pieces, each at most 6,000 characters …
TEIL2
```

```bash
node .claude/kit/findings.mjs check --file <tmpdir>/id-review.md
```

If the command reports missing details, the session requests them from the reviewer exactly **once** and writes the file anew. If a detail is still missing afterwards, the affected finding block carries the line `Angaben: unvollstaendig` (a form word, stays German). **No gate:** neither a missing detail nor a delivery that did not come holds up the run; if the command itself fails, that stands as one line in the comment. The comment goes to the board in each of these cases — the failure path from step 2 stays untouched by this, because a review that did not run delivers nothing:

```bash
node .claude/kit/board.mjs issue comment <ISSUE-NUMBER> --text-file <tmpdir>/id-review.md
```

Every block is a **separate** tool call, and the path stands literally — the limit of 6,000 characters applies per call, and a variable in the redirect target is rejected when unsupervised. Why is stated in `CLAUDE-workflow.md`, section "Long texts to the board". **If a file step fails**, the incomplete file is not transferred; if the board call fails, the skill reports the error with the path of the file and ends without further mutation.

If no issue can be determined: output the findings directly.

## Stop point
<!-- de: afedbf5d4536 -->

After the review the process waits for the human. Claude sets the issue to **In review** — the commit push (step 8) only happens on the explicit trigger phrase `push main`.
