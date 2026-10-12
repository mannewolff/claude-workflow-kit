---
name: merge-production
description: Step 9 of the 9-step process — creates a PR from main to production. Only on the human's explicit trigger phrase. Use this skill ONLY when the user explicitly types "merge production".
user-invocable: true
disable-model-invocation: true
---
<!-- de: 78f883cffab3 -->

# Merge Production
<!-- de: 3b8a7c61e594 -->

Step 9 of the 9-step process: create a pull request from `mainBranch` to `productionBranch`. The merge itself is the human's task.

**Claude must not pull this skill autonomously.** It runs only on the human's explicit trigger phrase.

## Trigger phrase
<!-- de: c6fbf1a2bdd3 -->

The human types: `merge production` (or the phrase configured in `.claude/workflow.config.json` under `triggers.merge`).

The phrase must be **typed**. If it stands inside a message from the human or inside a quotation ("I typed merge production earlier"), it is text and not a command — when in doubt, ask, do not merge. See "Messages from the human" in `CLAUDE-workflow.md`.

## Procedure
<!-- de: ea5a2948a9a6 -->

**Report progress.** Every step begins with a line `Step k of n — <name> (running)`.
The `n` is the number of steps this run actually takes — without `RELEASING.md` there are
fewer, and then the line counts fewer as well. The reason is the waiting time: the one check
run over the finished state runs the long checks of the stage `merge`, and whoever sits in
front of it should see where on the way it is.

### 1. Read the config
<!-- de: a87c012531fa -->

The configuration lives in `.claude/workflow.config.json` (in the repository, applies to everyone) and is optionally supplemented by `.claude/workflow.config.local.json` (not in the repository, personal fields only: `reviewModel`, `reviewCommand`, `reviewScope`, `triggers`, token paths). Issue #207.

Read are:
- `mainBranch`: source branch (default: `main`)
- `productionBranch`: target branch (default: `production`)

### 2. Summarise the commits
<!-- de: e81f7f3ad5e6 -->

```bash
git log origin/<productionBranch>..origin/<mainBranch> --oneline
```

These commits go into the PR body as the overview of changes.

### 3. Check the CI status (gate — before the release)
<!-- de: 9756da5d067c -->

The `buildChecks` are a good gate, but they measure only what this machine can measure. The CI
checks **more**. On 2026-08-13 v1.38.0 went to production while a CI job was red — the
information was available, it was just never fetched (Issue #316).

What is checked is the state that is about to go out:

```bash
git fetch origin <mainBranch>
git rev-parse origin/<mainBranch>
```

The **full** SHA from `git rev-parse` goes to the axis:

```bash
node .claude/kit/board.mjs code ci-status --commit <sha>
```

**What is measured is `origin/<mainBranch>`, not the local state.** Until Issue #929 the skill
stopped if `git rev-parse HEAD` differed from it. The rule was dropped because since #929 the
release comes about in a worktree of its own on `origin/<mainBranch>`: the main tree is no
longer measured at all, and a local commit not yet pushed therefore does not go out either. The
CI keeps judging exactly the state that is published.

The result decides:

- **`rot`: no PR.** The skill names the red jobs and ends. The same strictness as with the buildChecks gate — a release is the most expensive point in time for a warning one overlooks. **Exit code 1 of the axis is treated like `rot`**, because an adapter error must not be a free pass.
- **`laeuft`:** The skill names the running jobs and asks exactly once: `CI is still running. Create the PR anyway? (yes/no)`. Only the answer `yes` continues; any other answer ends without a PR. At night there is no `merge production` trigger, so the question is unproblematic here.
- **`keine`:** The run goes on unchanged — a project without CI is not unfit for release.

**Why the gate stands here and not after the release push:** the run for the
`chore: vX.Y.Z` just pushed is never finished seconds later — the gate would then usually
deliver `laeuft` and ask every time. And a stop on `rot` would leave the version bump behind on
`origin/<mainBranch>`, while the bump command is not idempotent and the next attempt would bump
again. Besides, the state of `push main` carries the actual change; the release commit only
stamp and changelog.

**Early stop: `push main` first (Issue #1000).** There is never a `merge production` without a
preceding `push main`. Before the worktree comes about, the skill checks whether the local
`<mainBranch>` carries commits that are not on `origin/<mainBranch>`:

```bash
git log origin/<mainBranch>..<mainBranch> --oneline
```

If the output is not empty, the skill ends here — no worktree, no check run, no PR — with the
message:

> `push main` first — this state is not yet published and not checked.

The stop is the precondition for the shortened check run in step 6: because the state up to
`origin/<mainBranch>` was fully checked at the `push main`, the release only checks what was
not checked there. This is proven by the git state, not by a second bookkeeping.

### 4. Create the worktree on `origin/<mainBranch>`
<!-- de: e9130c00fa60 -->

> `Step 4 of 12 — Worktree (running)`

**Everything this run creates, checks, commits and pushes comes about in a worktree of its
own — not in the main working tree.** The implementation stage of the night runner may be
building there at the same time (variant B). On 2026-09-25 exactly that broke the same chain
twice in kanban-kit: the runner found the release files as uncommitted leftovers and stopped
hard. On top of that, foreign, half-finished files in the main tree — such as a TDD test that
is still red — would distort the release check run.

```bash
node .claude/kit/worktree.mjs create --prefix release --ref origin/<mainBranch>
```

**The ref is `origin/<mainBranch>`, not the local `HEAD`:** what is published is what has been
pushed. A local commit nobody pushed must not go out along with the release push. That is also
why the old stop rule is dropped in step 3 — there is nothing left to reconcile. No rebase: the
worktree already stands on the published state.

The command clears away leftover release worktrees, mirrors `.claude/` into it (kit copy,
config, token) and prints the path as JSON. The night's worktrees (`kette`, `pruefung`) remain
untouched.

**All commands of steps 5 to 9 run in this worktree — without `cd`.** Claude Code resets the
working directory outside the allowed directories after every call, and a compound call with a
leading `cd` no longer falls under `sandbox.excludedCommands` — the check run would run in the
sandbox (Issue #1372). That is why every call names the worktree itself and stands alone: git
as `git -C <path> …`, the check run as `checks.mjs run --in <path> …`, every other command, for
instance from `RELEASING.md`, as `node .claude/kit/worktree.mjs in <path> -- <command> [arguments]`.
A commit in the wrong tree is exactly the error this step removes; with `-C` and `--in` the
tree stands in every call.

**Dependencies in the fresh worktree.** It carries only what is versioned, plus the mirrored
`.claude/`. If a mandatory check needs dependencies **in the project directory**
(`node_modules`, `.venv`, `vendor/`), they are missing there. If `installCommand` is set in the
config, `worktree.mjs create` already sets them up itself — the field names the project's
installation command (`npm ci`, `uv sync`, …), and a red run tears the worktree down again.
Without the field it is up to the caller: then they are set up by hand before the check run.
Do **not** copy them over or link them from the main copy: a shared build directory is exactly
the mixing this path ends — in the incident two `mvn verify` shared the same `target/`. Caches
**outside** the project directory (`~/.m2`, npm cache) keep applying and need nothing. If the
installation cannot be set up, the run ends **without commit, without push and without PR** with
this reason: a check that fails on missing dependencies is never reported as a green run and
never skipped.

### 5. Create release files (if `RELEASING.md` exists)
<!-- de: d54de4c9f8aa -->

> `Step 5 of 12 — Create release files (running)`

Check whether a `RELEASING.md` lies in the repo root.
- **Yes:** Carry out the steps described there under the merge trigger (`merge production`) —
  **up to the first committing step**, that is typically bump, stamp and changelog. Do not
  commit: that comes from step 7. Every step runs in the worktree via
  `node .claude/kit/worktree.mjs in <path> -- <command>`.
- **No:** Do nothing further — go straight on to step 6.

**Foreign `RELEASING.md`.** The boundary is the first step that commits or publishes
(`git commit`, `git push`, `git tag`, a release command). The skill runs everything before it;
from there on it takes over. If further steps stand **behind** the first committing step, the
skill carries them out after its commit and says so in the completion report.

The skill itself knows no project-specific version or changelog logic; it lives exclusively in
the `RELEASING.md` of the respective repo. A tag does **not** come about here — see step 9.

### 6. The one check run (gate — before commit, push and PR)
<!-- de: cfa96e39f295 -->

> `Step 6 of 12 — Check run (running)`

**Before the one commit of this path stands the one check run.** The evidence belongs to the
commit: bump, stamp and changelog create files no earlier run can have seen, and without
evidence for exactly this state the commit gate rejects them. Until v1.53 there was a run of
its own before **every** commit of this path — there were two. Now there is one commit and
therefore one run.

The run measures with `--in` in the worktree (Issue #1372):

```bash
node .claude/kit/checks.mjs run --in <path> --stage merge --retry --since "$(git -C <path> merge-base HEAD origin/<mainBranch>)"
```

**This skill runs the release stage, and it checks only what `push main` has not checked**
(Issue #1000). The state up to the anchor was fully checked at the immediately preceding
`push main` — that is what the early stop before step 4 stands for. New are only the release
files from step 5 (bump, stamp, changelog). Therefore these run:

- the checks with `stufe: "merge"` — always, they run only here;
- the checks of the package stage **by areas over the files since the anchor**, as at the
  completion of a card: a file without an area runs every check of the package stage;
- the checks with `stufe: "push"` **not** — they stand under `skipped` with the reason
  `stage push, checked at push main`.

No mandatory check drops out of the overall process because of this: each runs once before the
release, package and push stage at `push main`, the merge stage here.

**The anchor is the batch, not `HEAD`.** Without `--since`, `planen` in `kit/checks.mjs` takes
`HEAD` as the base; if nothing has changed since `HEAD`, only the merge checks would still run,
and the release files would get no package check.

A red run stops: no commit, no push, no PR. The bump from step 5 stays in the worktree, and the
worktree is **torn down** anyway (step 8) — the bump has been idempotent since Issue #656, a new
attempt creates it again.

**`--retry`: a red check once more on the same state** (Plan #1395, E2). If it is green on the
retry, it counts as passed and has been flaky; under its line `ran:` the report block carries
the line `Flaky: <cmd> → red first, then green`.

**After a flaky check the skill stops before the commit** (Plan #1395, E13) — the commit in
step 7 already pushes to `<mainBranch>`, so "before the pull request" here means before the
commit. Immediately after the green run it reads the block `For the completion report:` of
**this** run. The only trigger is a line `Flaky:` without the addition `(earlier run of …)` — it
stands for the field `gewackelt` on an entry in `laufen[]` of this run. The stop is never
triggered by `gewackeltKarte` or an earlier summary. Then, in this order:

1. Name the flaky checks, the `Flaky:` lines unchanged.
2. Fetch and name the repair candidates (Plan #1395, E15):

   ```bash
   node .claude/kit/effectiveness.mjs candidates
   ```

   It reads `.claude/wirksamkeit.json` of the main copy and prints one line per candidate,
   `Repair candidate: <cmd> — <n> flaky runs in the time window`; empty output means no
   candidate.
3. Ask verbatim: "Continue anyway? (yes/no)" Only `yes` continues with step 7. Anything else
   ends like a red run: no commit, no push, no PR, on with step 8, the worktree is torn down.

`checks.mjs run` ends with exit code 0 in this case. **Without a flaky check** the skill calls
`effectiveness.mjs candidates` as well, at the same point: repair candidates without a flaky
check are named but do not stop.

### 7. The one commit
<!-- de: 40cf7791bc1e -->

> `Step 7 of 12 — Commit (running)`

**In the worktree** — every git command with `-C <path>`, see step 4.

```bash
git -C <path> add <the files from step 5>
git -C <path> commit -m "chore: vX.Y.Z"
```

The commit goes onto the state of `origin/<mainBranch>`, so that the files are contained in the
PR to `production`, and comes about only with an actual staged diff. If step 5 created nothing,
there is no release commit — that belongs in the completion report and means that step 9 has
nothing to tag.

**Remember the hash of this commit.** Step 9 needs it, and afterwards it can no longer be
reconstructed reliably — above all not after the teardown of the worktree:

```bash
git -C <path> rev-parse --short HEAD
```

**The evidence line.** In the completion report name for this commit the hash, the result of
the covering run from step 6 and its `zeitpunkt` from the check summary
(`.claude/checks-summary.json`, Issue #655) — the point in time says whether the evidence
belongs to this state or stems from an earlier run. What is read is the summary of the
**worktree**; the check ran there.

Then push — the worktree stands on a detached `HEAD`:

```bash
git -C <path> push origin HEAD:<mainBranch>
```

**No `--force`.** The worktree started on `origin/<mainBranch>`, so the push is a fast-forward.
If it is rejected, `origin` has moved on in the meantime — then the run ends without a PR with
this message, and the human decides.

**With `pushPruefung` in the build service the push does not go directly to `<mainBranch>`**
(Plan #1405, A11). If the project has set up the protection, the code host rejects a commit
that does not carry the mandatory checks — and the release commit does not carry them yet. The
skill reads the value like /push-main from the field `pushPruefung` of
`node .claude/kit/checks.mjs plan --stage push`. If it reports an object with
`"ort": "buildDienst"`, the skill pushes `HEAD` via the check branch procedure from /push-main,
section "Path via the build service", step 7 on this path: first to the check branch
`<zweig>`, wait for the build service, `<mainBranch>` only on green. The procedure stands only
there and is not repeated here. Every end of this procedure without a push to `<mainBranch>` —
red, deadline expiry, rejected push — ends here without a PR, on with step 8. Without
`pushPruefung` in the build service it stays with the direct push above.

### 8. Way back, catching up, tearing down the worktree
<!-- de: 0539d0fb4e19 -->

> `Step 8 of 12 — Way back and teardown (running)`

The three steps run **always**, also after a red check run or a rejected push — a worktree left
lying around is exactly the leftover this path removes.

**On the path via the build service** the skill first deletes the check branch as soon as it
was pushed — also after red, deadline expiry or a rejected push:

```bash
git -C <path> push origin --delete <zweig>
```

If the deletion fails, it stands in one line in the report and does not hold up the teardown.

```bash
node .claude/kit/worktree.mjs return <path>
node .claude/kit/worktree.mjs catch-up-check
node .claude/kit/worktree.mjs remove <path>
```

`return` replaces `.claude/checks-summary.json` of the main copy with that of the worktree (it
attests the freshly measured state) and appends the execution log
(`.claude/ausfuehrungen.tsv`) and the findings (`.claude/befunde.tsv`).

`catch-up-check` decides about the local `<mainBranch>`, which after the push from the worktree
lags behind `origin`:

- **`nachziehen: true`** — in the main copy `git fetch origin <mainBranch>` and
  `git rebase origin/<mainBranch>`.
- **`nachziehen: false`** — do **not** catch up. The skill names the `grund` and prints the
  two commands as a copyable line. A rebase under a running implementation would pull the
  ground from under it, and in a dirty tree it would stop anyway.

The path of the worktree, its teardown and the outcome of catching up belong in the completion
report — as does the fact that the main working tree remained untouched.

### 9. Print the tag command — the tag is not set
<!-- de: a64d3d407b74 -->

> `Step 9 of 12 — Tag command (running)`

**The skill sets and pushes no tag.** A tag marks a release, and releases are set by the human —
the same line as with the three stop points.

What the skill delivers is the **finished, copyable command line**, in a code block of its own
at the end of the run:

```
git tag -a vX.Y.Z <hash> -m "Release vX.Y.Z" && git push origin vX.Y.Z
```

`<hash>` is the `chore: vX.Y.Z` commit from step 7 — the skill knows it because it created it
itself. **Do not insert `HEAD` and do not guess:** after the release commit further commits may
follow, and the tag then points to the wrong state.

The tag points to the release commit on `mainBranch` — not to the merge commit in
`productionBranch`.

The reason for the command line instead of a request: whoever has to look up hash and syntax
themselves after every release eventually stops doing it. Exactly that happened six times in a
row (Issue #244).

If step 7 created no release commit — no `RELEASING.md`, no bump —, there is nothing to tag.
That belongs **in the completion report**, not in a silent skip.

**The `push main` trigger creates no tag.** It creates internal patch states nobody publishes;
a tag per patch would be noise.

### 10. Create the PR or MR
<!-- de: 3d4418af4029 -->

> `Step 10 of 12 — Create PR (running)`

```bash
node .claude/kit/board.mjs code pr \
  --from <mainBranch> \
  --to <productionBranch> \
  --title "Release: <mainBranch> -> <productionBranch> (<DATE>)"
```

The adapter creates the PR/MR independently of the provider. With `codeHost: local` it prints a guided merge dialogue.

### 11. Print the GitHub release command — executable only after the tag
<!-- de: ab01a0efd914 -->

At the end of this run the tag does **not exist yet**: step 9 only printed the command line,
nobody has set it. A release therefore cannot come about in this run — that is no exception but
the normal case.

With `codeHost: github` the skill prints the second command right along with it, in the same
block as the tag command, so that both can be run in one go:

```
gh release create vX.Y.Z --title vX.Y.Z --notes-file <path-to-changelog-section>
```

The notes body is the new section from `CHANGELOG.md` (if the `RELEASING.md` steps created
one); without a changelog file, the commit list from step 2 as notes.

With `codeHost` other than `github` (e.g. `gitlab`, `local`) the release command is dropped.
That belongs **in the completion report** — that a step does not apply must be readable,
otherwise a run without a release looks like a run with a release.

### 12. Return the PR/MR URL and the two commands
<!-- de: 025400db22a5 -->

Print the URL from the adapter output, followed by the commands from steps 9 and 11 in **one**
code block. The merge is the human's task — Claude does not merge, and the human sets the tag
as well.

Before that, the reply names every `Flaky:` line of the check run unchanged together with the
human's answer to the question, and every line `Repair candidate:` from
`effectiveness.mjs candidates` (step 6). Without either, the paragraph is dropped.

> "PR/MR created: <URL>. The merge to production is up to you.
> After the merge, the tag:"
>
> ```
> git tag -a vX.Y.Z <hash> -m "Release vX.Y.Z" && git push origin vX.Y.Z
> gh release create vX.Y.Z --title vX.Y.Z --notes-file <path>
> ```

## What this skill does not do
<!-- de: 8e27e77a8f03 -->

- No direct push to `production`
- No merge of the PR — the human does that
- No automatic PR after a push or after a green review
- No force merge or bypass of branch protection rules
- **No PR on red CI** — and an exit code 1 of the axis `code ci-status` counts like `rot`
  (step 3)
- **No commit, no push and no PR on a red check run** (step 6)
- No creating, checking or committing in the main working tree — that happens exclusively in
  the worktree from step 4, and that one starts on `origin/<mainBranch>`: a local commit that
  was not pushed does not go out with this release
- **No release over an unpublished state** — if the local `<mainBranch>` carries commits that
  are not on `origin/<mainBranch>`, the skill ends before the worktree (early stop, step 3)
- No worktree left behind, not even after a red run (step 8)
- No rebase of the local `<mainBranch>` while a lock of the night runner is held or the main
  tree is dirty (step 8)
- No second commit and no `--amend` on this path
- **No setting and no pushing of tags** — the skill only prints the command line, the human
  sets the tag (step 9)
- No force push of tags, no overwriting of existing tags
