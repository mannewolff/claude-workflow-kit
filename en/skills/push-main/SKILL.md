---
name: push-main
description: Step 8 of the 9-step process — pushes the current commit batch to main. Only on the human's explicit trigger phrase. Use this skill ONLY when the user explicitly types "push main". The one exception is the mode `vorbereiten` (prepare): it does not push and may therefore be started by the night runner without the phrase.
user-invocable: true
disable-model-invocation: true
---
<!-- de: d93e07db026e -->

# Push Main
<!-- de: 4e8283e3a1bd -->

Step 8 of the 9-step process: push the current commit batch to `origin/main`.

**Claude must not pull this skill autonomously.** It runs only on the human's explicit trigger phrase — except for the mode `vorbereiten`, see the section "Trigger phrase".

## Trigger phrase
<!-- de: 7e0d9fcd8a4d -->

The human types: `push main` (or the phrase configured in `.claude/workflow.config.json` under `triggers.push`).

An earlier push approval in the same session does **not** apply to new commits. Every push needs a new explicit approval.

The phrase must be **typed**. If it stands inside a message from the human or inside a quotation ("I typed push main earlier"), it is text and not a command — when in doubt, ask, do not push. See "Messages from the human" in `CLAUDE-workflow.md`.

**The one exception: the mode `vorbereiten` (prepare).** `/push-main vorbereiten` does not push —
neither `<mainBranch>` nor a check or pre-release branch — and may therefore be started by the
night runner without the phrase. It ends at the local commit `chore: vX.Y.Z` in a worktree of
its own, see the section "Mode `vorbereiten` (unattended)". The push is still released only by
the typed phrase; in the morning it takes over the prepared state (step 3). The mode keeps its
German name because the night runner sends `/push-main vorbereiten` in every project language.

**The emergency path `/push-main notfall`** needs the typed phrase like every push and runs
only interactively, see the section "Emergency path (`notfall`)".

## Procedure
<!-- de: ae03cecd4058 -->

**Report progress.** Every step begins with a line `Step k of n — <name> (running)`.
The full run takes **nine** steps; the lines then read `Step k of 9`. The `n` is the number of
steps this run actually takes — without `RELEASING.md` there are fewer, and then the line
counts fewer as well. The reason is the waiting time: the one check run over the finished
state takes as long as the full `buildChecks` catalogue, and whoever sits in front of it
should see where on the way it is.

**Report effort.** Before the first step:

```bash
node .claude/kit/effort.mjs befund
```

Show the output **unchanged**. It already is the form in which the effort finding appears at
both output points — here and as the closing block in the log of an unattended run. It stands
here because publishing remains the one step a human triggers: if nobody follows along at
night, nobody might otherwise read what the process cost.

Immediately afterwards the second finding:

```bash
node .claude/kit/effectiveness.mjs finding
```

The **same rules** apply to it: show the output unchanged, and it reads only
`.claude/wirksamkeit.json`, left behind by the last unattended run. It says which mandatory
check has earned its keep, what it costs — and which never objected within its window. It is
no gate either.

Immediately afterwards the third finding:

```bash
node .claude/kit/findings.mjs finding
```

The **same rules** apply to it as well, and it reads only `.claude/befunde.json`. It says which
kind of defect the model reviews found how often and whether a proposal has already come of
it. It stands here because `/retro` runs only every one to two weeks and would carry the number
too late. In a project **without model reviews** there is no log, the finding stays empty, and
that is not commented on — the absence of the review already decides it; no switch is needed.

An **empty output** means: no finding. It is not commented on — no "nothing unusual", no
empty heading. A **failure** of the command is noted in **one line**, and it holds nothing up.
Both apply **per finding**: an empty or failed effort finding says nothing about the other two,
and the same holds the other way round. None of the three needs the config; they read only
`.claude/aufwand.json`, `.claude/wirksamkeit.json` and `.claude/befunde.json` respectively. If
the file is missing, the output is empty and the exit code 0.

This block deliberately carries **no number** and is counted in no progress line: a number
would shift every following step number by one and make every cross-reference to "step 4" and
"step 6" wrong. The progress lines of the nine steps are unaffected by it.

### 1. Read the config
<!-- de: 0c8684b377ce -->

The configuration lives in `.claude/workflow.config.json` (in the repository, applies to everyone) and is optionally supplemented by `.claude/workflow.config.local.json` (not in the repository, personal fields only: `reviewModel`, `reviewCommand`, `reviewScope`, `triggers`, token paths). Issue #207.

Read are:
- `mainBranch`: target branch (default: `main`)
- `buildChecks`: list of mandatory checks (the same ones `/local-check` runs)
- `pushPruefung`: where the full run takes place — `"lokal"` is the default, an object
  `{ "ort": "buildDienst", "zweig": "<name>" }` moves it to the build service. The skill does
  not read the value from the config itself but from the field `pushPruefung` of:

  ```bash
  node .claude/kit/checks.mjs plan --stage push
  ```

  With `"lokal"` the steps below apply unchanged. With `buildDienst` the section "Path via the
  build service" replaces the check run in step 5 and the push in step 7; all other steps
  remain. If the call ends with an error (invalid value), the skill stops — no fallback to the
  local path.

### 2. Check the state
<!-- de: 252592151cfd -->

```bash
git status
git log origin/main..HEAD --oneline
```

Show which commits will be pushed. The human should know what goes out.

### 3. Create the worktree and merge it with `origin`
<!-- de: 7136c962e0df -->

> `Step 3 of 9 — Worktree (running)`

**Everything this run creates, checks, commits and pushes comes about in a worktree of its
own — not in the main working tree.** The implementation stage of the night runner may be
building there at the same time (variant B). On 2026-09-25 exactly that broke the same chain
twice in kanban-kit: the runner found the release files as uncommitted leftovers and stopped
hard. On top of that, foreign, half-finished files in the main tree — such as a TDD test that
is still red — would distort the release check run.

First the **main copy** fetches the published state and asks whether a preparation from the
night may be taken over — in this order:

```bash
git fetch origin <mainBranch>
node .claude/kit/worktree.mjs check-preparation
```

The command fetches nothing itself; it compares the file `.claude/push-vorbereitung.json` with
the state just fetched (Plan #1243, E10). Then the worktree comes about:

- **`uebernehmen: true`** — on the prepared commit:

  ```bash
  node .claude/kit/worktree.mjs create --prefix release --ref refs/kit/push-vorbereitet
  ```

- **`uebernehmen: false`** — as before on the local `<mainBranch>`:

  ```bash
  node .claude/kit/worktree.mjs create --prefix release --ref <mainBranch>
  ```

**After the push and on every non-takeover** the file and the reference are discarded — on a
non-takeover right here, otherwise after the push in step 7:

```bash
node .claude/kit/worktree.mjs check-preparation --discard
```

On a non-takeover the skill names the `grund` in one line; if the file is missing, the line
is dropped.

The command `create` clears away leftover release worktrees, creates the new one outside the
repo, mirrors `.claude/` into it (kit copy, config, token) and prints the path as JSON. The
night's worktrees (`kette`, `pruefung`) remain untouched.

The worktree starts on the **local** `<mainBranch>` — the batch that is to go out — or on the
prepared commit, and is merged there with the published state. The main copy has already
fetched it; the worktree shares its references:

```bash
git -C <path> rebase origin/<mainBranch>
```

The rebase is necessary because an earlier worktree release put its commit only on `origin`;
without it the push would run into `non-fast-forward`. The rebase skips commits already taken
over on its own. **A conflict stops:** no check run, no commit, no push. The skill reports the
conflicting files, removes the worktree (step 8) and ends — merging is the human's handwork.

**All commands of steps 4 to 7 run in this worktree — without `cd`.** Claude Code resets the
working directory outside the allowed directories after every call, and a compound call with a
leading `cd` no longer falls under `sandbox.excludedCommands` — the check run would run in the
sandbox (Issue #1372). That is why every call names the worktree itself and stands alone:

- **git:** `git -C <path> …`
- **the check run:** `checks.mjs run --in <path> …` (step 5)
- **every other command**, for instance from `RELEASING.md`:
  `node .claude/kit/worktree.mjs in <path> -- <command> [arguments]` — it starts the command
  without a shell with the worktree as working directory and passes output and exit code
  through.

A commit in the wrong tree is exactly the error this step removes; with `-C` and `--in` the
tree stands in every call.

**On takeover steps 4 to 6 are dropped.** The prepared commit already carries bump and
changelog, and its check run was green; a second bump would be another version. Instead of the
three steps there is one line with `zeitpunkt` and `commit` from the output of
`check-preparation`:

> `Takes over the night's state of <zeitpunkt> (<commit>)`

Step 7 then runs what remained open at night (the field `offen`): the pre-push step from
`RELEASING.md` as described. On the path via the build service that is the push to the check
branch, waiting for the build service and the push to `<mainBranch>` only on green, as in the
section "Path via the build service" (Plan #1243, E17). An open UI check is put to the human as
a question before the push; the push happens only after their `yes`. An open item
`Flaky: <cmd> — decision at push main` (a flaky check in the night's run, Plan #1395, E14) is
asked about before the push in step 7 like every open item, with the question from step 5: the
skill names the check and the repair candidates from `effectiveness.mjs candidates` and asks
"Continue anyway? (yes/no)"; only `yes` pushes. The progress lines do not count the dropped
steps.

**Dependencies in the fresh worktree.** It carries only what is versioned, plus the mirrored
`.claude/`. If a mandatory check needs dependencies **in the project directory**
(`node_modules`, `.venv`, `vendor/`), they are missing there. If `installCommand` is set in the
config, `worktree.mjs create` already sets them up itself — the field names the project's
installation command (`npm ci`, `uv sync`, …), and a red run tears the worktree down again.
Without the field it is up to the caller: then they are set up by hand before the check run.
Do **not** copy them over or link them from the main copy: a shared build directory is exactly
the mixing this path ends — in the incident two `mvn verify` shared the same `target/`. Caches
**outside** the project directory (`~/.m2`, npm cache) keep applying and need nothing. If the
installation cannot be set up, the run ends **without commit and without push** with this
reason: a check that fails on missing dependencies is never reported as a green run and never
skipped.

### 4. Create release files (if `RELEASING.md` exists)
<!-- de: 3b5904473e68 -->

> `Step 4 of 9 — Create release files (running)`

Check whether a `RELEASING.md` lies in the repo root.
- **Yes:** Carry out the steps described there under the push trigger (`push main`) —
  **up to the first committing step**, that is typically bump, stamp and changelog. Do not
  commit, do not push: that comes from steps 5 and 6. Every step runs in the worktree via
  `node .claude/kit/worktree.mjs in <path> -- <command>`, for instance
  `node .claude/kit/worktree.mjs in <path> -- node tools/version.mjs --patch`.
- **No:** Do nothing further — go straight on to step 5.

**Foreign `RELEASING.md`.** The boundary is the first step that commits or publishes
(`git commit`, `git push`, `git tag`, a release command). The skill runs everything before it;
from there on it takes over with run, commit and push. If further steps stand **behind** the
first committing step, the skill carries them out after its commit and says so in the
completion report.

The skill itself knows no project-specific version or release logic; it lives exclusively in
the `RELEASING.md` of the respective repo.

### 5. The one check run (gate — before commit and push)
<!-- de: ecadb6193a74 -->

> `Step 5 of 9 — Check run (running)`

Now all files of the path lie on disk: the release files from step 4 — **in the worktree**, and
there the run measures them. **One** run measures exactly this state:

The run measures with `--in` in the worktree (Issue #1372):

```bash
node .claude/kit/checks.mjs run --in <path> --stage push --retry --since "$(git -C <path> merge-base HEAD origin/<mainBranch>)"
```

`<mainBranch>` is the value from the config (default: `main`).

**`--retry`: a red check once more on the same state** (Plan #1395, E2). If it is green on the
retry, it counts as passed and has been flaky; under its line `ran:` the report block carries
the line `Flaky: <cmd> → red first, then green`. If it stays red, it is red as before.

**This skill runs the push stage, and that runs the full scope.** In addition to the checks of
the package stage, all checks run that the project has set aside for the time of publishing —
and **every one of them**, also for untouched areas and also when nothing has changed since the
anchor. Before the push the state that goes out is measured, and it consists of more than the
last work package. The run names the **additional checks up front** in a line of their own
(`Stage push: in addition to the package stage runs …`) — it will therefore take noticeably
**longer** than the run per work package in `/implement-next`. That is the intended time and no
reason to cut it short.

**The anchor is the batch, not `HEAD`.** It no longer decides **what** runs — at this stage
everything runs anyway — but which state the summary **attests**: `basis`, `geaendert` and the
blob hashes against which the commit gate checks the index. Without `--since`, `planen` in
`kit/checks.mjs` takes `HEAD` as the base, and the evidence would then speak about the last
piece instead of the batch that is about to go out.

- **Run in the foreground** and evaluate the exit codes honestly — never mask the exit code
  with a trailing `echo` or a redirection. The return value of every check command and the
  general error markers in its output are read by `checks.mjs run` itself; a hit turns the
  check red.
- **A red run stops everything:** no commit, no push. A clear message **which** check failed
  with which error. The run names for every red check the **causer cards** in a line of their
  own (`Causers (<cmd>): …`) — the cards whose commits since the anchor touched the files of
  this check. Take the lines unchanged into the report. The repair is a **new card**: the
  causing card does **not move back out of "In review"** — it is completed and waits for the
  human's test, and a withdrawal would lose exactly that state. It is named so that the new
  card knows where to start. The worktree is **torn down** anyway (step 8), and the report says
  so: the bump has been idempotent since Issue #656, a new attempt creates it again — a worktree
  left standing would be exactly the leftover this path removes.
- **Notes are shown, not judged.** A note check ends green and writes its findings as
  `note: <file and reason>` into the block `For the completion report:`. The `note:` lines go
  unchanged into the report to the human and hold up neither commit nor push — they require no
  approval (Issue #1156).
- If `buildChecks` is empty: note "No buildChecks configured." and on to step 6 (no abort).

**After a flaky check the skill stops before the commit** (Plan #1395, E13). Immediately after
the green run, before step 6, it reads the block `For the completion report:` of **this** run.
The only trigger is a line `Flaky:` without the addition `(earlier run of …)` — it stands for
the field `gewackelt` on an entry in `laufen[]` of this run. The stop is never triggered by
`gewackeltKarte` or an earlier summary. Then, in this order:

1. Name the flaky checks, the `Flaky:` lines unchanged.
2. Fetch and name the repair candidates (Plan #1395, E15):

   ```bash
   node .claude/kit/effectiveness.mjs candidates
   ```

   It reads `.claude/wirksamkeit.json` of the main copy and prints one line per candidate,
   `Repair candidate: <cmd> — <n> flaky runs in the time window`; empty output means no
   candidate.
3. Ask verbatim: "Continue anyway? (yes/no)" Only `yes` continues with step 6. Anything else
   ends like a red run: no commit, no push, on with step 8, the worktree is torn down.

`checks.mjs run` ends with exit code 0 in this case — the check has passed, the decision lies
with the human. **Without a flaky check** the skill calls `effectiveness.mjs candidates` as
well, at the same point: repair candidates without a flaky check are named but do not stop.

Why another run at all, when `/implement-ready` and `/local-check` already checked per issue:
the evidence belongs to the **commit**, and no earlier run has seen the files from step 4.
Without evidence for exactly this state the commit gate rejects the commit.

**Record findings if code review findings were incorporated.** If findings from a `/review`
were incorporated before this push, the session records that in an incorporation comment on
the issue — taken over / rejected with reason per finding, following the pattern of
`/issue-review` —, adds to the findings text per finding block the line
`Uebernahme: uebernommen` or `Uebernahme: abgelehnt` and writes it, following the transport
rule, as a file of its own outside the project directory:

```bash
node .claude/kit/worktree.mjs in <path> -- node .claude/kit/findings.mjs record --file <tmpdir>/<id>-buchung.md --stage code --card <id>
```

**Recording happens in the worktree**, because the comparison state reads the summary of the
check run — and that lies there. The record comes back into the main copy in step 8, and
**only there** a proposal arises per kind: the threshold counts the overall state of the
project, and that stands in the main copy.

**Here and not earlier.** The comparison state of the code stage asks whether every file
changed today is covered by `.claude/checks-summary.json`. Before step 5 the summary would carry
the state **before** the incorporation, and every file changed in it would make the state
`nicht-vergleichbar`, although the mandatory checks run green right afterwards. After the check
run there is a summary over exactly the state on which the record is made.

If there are no code review findings, this block is dropped **without a note**. **No gate:** a
failure of `record` or `suggest` is noted in **one line** and does not hold up commit and push.
Like the findings block before step 1, this block carries **no number** and is counted in no
progress line.

### 6. The one commit
<!-- de: fcf0895ced7f -->

> `Step 6 of 9 — Commit (running)`

**In the worktree** — every git command with `-C <path>`, see step 3.

```bash
git -C <path> add <the files from step 4>
git -C <path> commit -m "<subject following the rule below>"
```

**Subject.** If step 4 created release files: `chore: vX.Y.Z` with the identifier from the
bump.

**Never a suffix `(Issue #N)` at the end of the subject.** From that and only that
`tools/changelog.mjs` reads the package number, and this commit is no work package. It still
appears in the changelog, then without a package reference; that is intended. For the same
reason the message carries **no** `#N` references to non-packages.

A commit is made only with an actual staged diff. If nothing came out of step 4, there is
nothing to commit; the procedure goes on without a commit to step 7, and the push carries only
the commits from step 2.

### 7. Push
<!-- de: 2e8c2c9b1588 -->

> `Step 7 of 9 — Push (running)`

**Pre-push step.** If `RELEASING.md` names a pre-push step, the skill runs it after the commit
(step 6) and before the push, in the worktree via
`node .claude/kit/worktree.mjs in <path> -- <command>`, **in the background**, and waits for its
end — it can run longer than a foreground tool call may, and ends on its own after its own
deadline. The skill shows its progress lines and its final line before it pushes. It is not a
step of its own: the count stays `of 9`. If `RELEASING.md` names none, or there is no
`RELEASING.md`, it is dropped without replacement.

- Exit 0 — on to the push.
- Exit 1 — the check is red. The skill shows the result and asks verbatim:
  "Pre-push check red. Push anyway? (yes/no)" Only `yes` pushes;
  anything other than "yes" means no push, on with step 8.
- Any other exit — stop without push, with the tool's message; on with step 8.

From the worktree, which stands on a detached `HEAD`:

```bash
git -C <path> push origin HEAD:<mainBranch>
```

**No `--force`, not even after the rebase.** After step 3 the push is a fast-forward; if it is
rejected, `origin` has moved on in the meantime — then the run ends with this message, and the
human decides.

After the push to `<mainBranch>` — also on the path via the build service — the skill discards a
taken-over preparation with `check-preparation --discard`, as described in step 3. Without a
push it stays for the next attempt.

### 8. Way back, catching up, tearing down the worktree
<!-- de: 9a5cd13bd438 -->

> `Step 8 of 9 — Way back and teardown (running)`

The three steps run **always**, also after a red check run, a rebase conflict, a stop in the
pre-push step or a rejected push — a worktree left lying around is exactly the leftover this
path removes.

First what keeps counting in the main copy:

```bash
node .claude/kit/worktree.mjs return <path>
```

The command replaces `.claude/checks-summary.json` of the main copy with that of the worktree
(it attests the freshly measured state), appends the execution log
(`.claude/ausfuehrungen.tsv`) and the findings (`.claude/befunde.tsv`) and names in
`befundeArten` the kinds that thereby reach the threshold. For **each** of them one call:

```bash
node .claude/kit/findings.mjs suggest --kind <a>
```

Then the local `<mainBranch>`, which after the push from the worktree lags behind `origin`:

```bash
node .claude/kit/worktree.mjs catch-up-check
```

- **`nachziehen: true`** — in the main copy `git fetch origin <mainBranch>` and
  `git rebase origin/<mainBranch>`.
- **`nachziehen: false`** — do **not** catch up. The skill names the `grund` and prints the
  two commands as a copyable line. A rebase under a running implementation would pull the
  ground from under it, and in a dirty tree it would stop anyway.

Finally the teardown:

```bash
node .claude/kit/worktree.mjs remove <path>
```

### 9. Confirmation
<!-- de: 41e264848eb1 -->

Report the new state on `origin/<mainBranch>` with the last commit hash.

**The evidence line, per commit created.** Name the hash, the result of the covering run and
its `zeitpunkt` from the check summary (`.claude/checks-summary.json`, Issue #655):

```
<hash> — covered by: node --test, node tools/sync-blobs.mjs --check (green, 2026-09-16 08:14)
```

What is read is the summary of the **worktree** — the check ran there. After step 8 it lies in
the main copy and says the same; before the teardown the worktree is the source. The point in
time is the point: it says whether the evidence belongs to this state or stems from an earlier
run. If step 6 created no commit, **that** belongs in the report too — a run without a commit
otherwise looks like a run with a commit.

**Flaky checks and repair candidates.** The report names every `Flaky:` line of the check run
unchanged together with the human's answer to the question, and every line
`Repair candidate:` from `effectiveness.mjs candidates` (step 5). Without either, the paragraph
is dropped.

**The report also contains:** the path of the worktree and its teardown, whether the local
`<mainBranch>` was caught up or for what reason not, and that the main working tree remained
untouched.

**CI note, depending on `codeHost`.** With `github` and `gitlab` the completion report contains: "If the push triggers a CI run, it is not gated here; `merge production` checks the commit." The one exception is the pre-push check from step 7, if `RELEASING.md` names one: its result was available before the push, and the report names it. With `local` the note is dropped without replacement. The state of the CI is **not queried** here — the run for the commit just pushed is never finished seconds later, a gate would have to wait, and `push main` is the frequent trigger. The CI is checked at the release, in `/merge-production` (Issue #316).

Pointer to the next step:
> "Commit batch pushed. If the test server pulls automatically: check there. Then, if wanted, \`merge production\` for the PR to production."

## Path via the build service (`pushPruefung`)
<!-- de: 863c0fee93da -->

Applies only if `checks.mjs plan --stage push` in step 1 reports `pushPruefung` as an object
with `"ort": "buildDienst"` (Issue #1216, Plan #1199 E14). The full run then takes place in the
project's build service instead of on this machine. **The obligation is the same:** green before
the push to `<mainBranch>`, a red stops, `productionBranch` stays untouched. `<zweig>` is the
value from `pushPruefung.zweig`. Steps, count `of 9` and progress lines remain; only step 5 and
step 7 differ.

**What the build service must run.** A push to `<zweig>` starts the run of the stage `push` over
the batch there:

```bash
node .claude/kit/checks.mjs run --stage push --since "$(git merge-base HEAD origin/<mainBranch>)"
```

The project sets up this job in its build service — this skill does not create it. Because the
run there runs `checks.mjs`, on red the build log carries the same line `Causers (<cmd>): …` as
the local run.

**Step 5 on this path — evidence for the commit.** The full run is dropped here. The commit gate
still demands a green run for the release files from step 4 that has seen them. It is supplied
by a run of the package stage over exactly these files, in the worktree:

```bash
node .claude/kit/checks.mjs run --in <path> --since HEAD --retry
```

With `--retry` as in step 5 (Plan #1395, E3), and a flaky check stops before the commit as
there. The build service job above stays without the switch (E18).

Red stops as in step 5: no commit, no push, on with step 8. If step 4 created nothing, it reports
`leeresPaket`, and step 6 is dropped as described.

**Step 7 on this path — push via the check branch.** The pre-push step from `RELEASING.md` runs
before it as described. Then, from the worktree:

1. Push the state to the check branch:

   ```bash
   git -C <path> push origin HEAD:refs/heads/<zweig>
   ```

   The full name `refs/heads/<zweig>` is necessary: the worktree stands on a detached `HEAD`,
   and the check branch does not exist before the push, because step 8 deletes it after every
   run. With the short name git rejects the push, because it does not recognise the target as a
   branch (Issue #1518). If it is rejected, a foreign state still lies on `<zweig>` — the run
   ends with this message, on with step 8. No `--force`.
2. Wait until the build service is done. `<sha>` is the output of `git -C <path> rev-parse HEAD`:

   ```bash
   node .claude/kit/board.mjs code ci-status --commit <sha>
   ```

   The call is repeated every 30 seconds as long as `status` reports `laeuft`, with a
   **deadline of 60 minutes**. Immediately after the push it reports `laeuft`, because the run
   is not visible yet — that is no error. If the deadline runs out, that is a failure: no push
   to `<mainBranch>`, on with step 8. A failure of the call itself (network, login) counts the
   same. In both cases the skill names to the owner the emergency path `/push-main notfall` as
   an option in case the build service has failed (section "Emergency path"), and does not start
   it itself.
3. Push `<mainBranch>` only on `gruen` — with the same command as in step 7:

   ```bash
   git -C <path> push origin HEAD:<mainBranch>
   ```

   The paragraph on `--force` and on the rejected push from step 7 applies to it.

**On `rot` the skill stops as on a red run in step 5:** no push to `<mainBranch>`, a message
which job is red (the list `jobs` of the call), and the **address of the build log** for the
commit `<sha>` — there stand the red check and the line `Causers (<cmd>): …`. With `codeHost`
`github` that is `https://github.com/<repo>/commit/<sha>/checks`, with `gitlab` the project's
pipeline page for the commit (`<project-url>/-/pipelines?sha=<sha>`); `<repo>` is named by
`node .claude/kit/board.mjs code repo-name`. The repair is a new card, as in step 5.

**If the call reports `keine`**, the project has no build service (`codeHost` `local`). That is a
contradiction in the config: no push to `<mainBranch>`, a message with this reason, on with
step 8.

**Step 8 on this path** additionally deletes the check branch as soon as it was pushed — before
the way back, also after red, deadline expiry or a rejected push:

```bash
git -C <path> push origin --delete <zweig>
```

So the next run starts on an empty check branch and never needs `--force`. If the deletion
fails, it stands in one line in the report and does not hold up the teardown.

**Step 9 on this path** names in the evidence line the build service instead of the local
checks: `<hash> — covered by: build service, check branch <zweig> (green, <point in time>)`.
The CI note is dropped — the CI gated before the push.

## Emergency path (`notfall`)
<!-- de: 7a33f0ac6c7e -->

`/push-main notfall` publishes when the build service fails and the code host protects the main
branch (Plan #1405, A6). Only the owner of the repository gets past the protection: on GitHub
only someone with admin rights can suspend it — the code host enforces that, not the kit. The
rulesets carry no permanent bypass; the protection drops only for this one push.

**Interactive only.** If `KIT_AGENT_MODEL` is set, the skill stops before step 1 — no worktree,
no run, no push. `code protection suspend` aborts without supervision anyway (E8); the stop in
the skill comes before that. Here too the human's typed trigger phrase is needed.

**Steps 1 to 6 as on the local path**, even if `pushPruefung` names the build service: step 5 is
the full local run of the stage `push` with `--retry` in the worktree, the substitute check for
the failed build service. A red run stops as there. A flaky check stops before the commit and is
asked about as there.

**Instead of step 7**, from the worktree, in this order:

1. The pre-push step from `RELEASING.md` as in step 7, but **no "Push anyway?"**: every result other than exit 0 stops without push,
   on with step 8. The emergency path runs only after a green run, without exception.
2. Suspend the protection:

   ```bash
   node .claude/kit/board.mjs code protection suspend --in <path>
   ```

   The command suspends the main branch's ruleset only if the check summary of the worktree
   attests a green run of the stage `push` for exactly this state. If it refuses, the run ends
   without push with its message, on with step 8.
3. Push — with the same command as in step 7, no `--force`:

   ```bash
   git -C <path> push origin HEAD:<mainBranch>
   ```

4. **Immediately** restore the protection, also after a rejected push — however the push
   turned out:

   ```bash
   node .claude/kit/board.mjs code protection restore
   ```

   If `restore` fails, the run is a failure, even if the push succeeded (E10): the skill reports
   it as such and names the command to repeat it
   (`node .claude/kit/board.mjs code protection restore`). Until it succeeds, the main branch
   stands unprotected, and `code protection status` names that under `fehlt`.

Then step 8 as above, also after a stop.

**Step 9 on this path** names in the evidence line the local run as on the local path and in
addition that the state came via the emergency path. The final message contains the output of:

```bash
node .claude/kit/board.mjs code protection status
```

If it names the commit just pushed under `ungeprueft`, the message adds that the build service
can check it afterwards as soon as it runs again, with the command
`node .claude/kit/board.mjs code protection verify`. Until then the state stays visible as an
exception.

## Mode `vorbereiten` (unattended)
<!-- de: 9516757db5ef -->

The night runner starts `/push-main vorbereiten` at the end of a run when a chain has reached the
goal "publication prepared" (Plan #1243, A5). The session runs in the main copy while the runner
holds the implementation lock: nothing builds any more. It runs everything that can be done
before publishing without humans and without a push, and records the result. In the morning
`push main` takes over the state if it has not changed (step 3).

**Steps 1 to 6** as above, with these deviations:

- **Step 3:** The fetch in the main copy (`git fetch origin <mainBranch>`) is allowed, because
  the runner holds the implementation lock — no build loses its ground in the process.
  `check-preparation` is dropped. The worktree comes about with a prefix of its own:

  ```bash
  node .claude/kit/worktree.mjs create --prefix vorbereitung --ref <mainBranch>
  ```

  Then `git -C <path> rebase origin/<mainBranch>` as above. **If the fetch fails**, that is no
  abort: the rebase goes onto the existing reference `origin/<mainBranch>`, the run goes on and
  passes `--fetch fehlgeschlagen` when recording. A rebase conflict ends as above without
  recording; the runner then reads no preparation of this run.
- **Step 4:** Without `RELEASING.md` it is dropped as above (E15).
- **Step 5:** the full check run of the push stage. On the path via the build service, step 5 is
  the evidence run of the package stage from the section "Path via the build service"
  (`checks.mjs run --in <path> --since HEAD --retry`), followed by the commit (E17). The full run in the build service
  stays open and runs in the morning in step 7. A flaky check does not stop at night and is not
  asked about: `record-preparation` itself turns it into an open item
  `Flaky: <cmd> — decision at push main` (Plan #1395, E14).
- **Step 6:** the commit `chore: vX.Y.Z` in the worktree, as above.

**Instead of step 7** the session records the result, also after a red check run:

```bash
node .claude/kit/worktree.mjs record-preparation <path> --result <gruen|gruen-offen|rot>
```

- After a failed fetch additionally `--fetch fehlgeschlagen`.
- The pre-push step from `RELEASING.md` and a UI check that is needed according to
  `/local-check`, step 3, each go along as `--open "<text>"`. **They are not started** (E9):
  whether a pre-push step pushes cannot be checked at night. With an open item the result is
  `gruen-offen`.
- The build service item is set by the command itself — the session does not pass it.

**Then step 8 without catching up:** `return` and `remove` as above, `catch-up-check` and the
rebase of the local `<mainBranch>` are dropped. Step 9 reports the result of
`record-preparation`.

**No push** — neither to `<mainBranch>`, nor to the check branch, nor to a pre-release branch:
no check branch, no pre-release branch, no tag. The mode ends at the local commit in the
worktree; what would only be possible with a push stays open.

## What this skill does not do
<!-- de: 9af54ffca328 -->

- No commit and no push on a red check run (step 5)
- No creating, checking or committing in the main working tree — that happens exclusively in
  the worktree from step 3
- No worktree left behind, not even after a red run (step 8)
- No rebase of the local `<mainBranch>` while a lock of the night runner is held or the main
  tree is dirty (step 8)
- No second commit and no `--amend` on this path
- No force pushes
- No push to `production` or other branches — except the pre-release branch that a pre-push step creates and deletes itself
- No push to the check branch outside the path via the build service, and on it no push to
  `<mainBranch>` without a green result from the build service
- No push without prior confirmation by the human (trigger phrase)
- No push in the mode `vorbereiten`, not even to the check branch or a pre-release branch
- No automatic push after a commit, after a green check or after a review
- No stop because of the effort, effectiveness or model review finding: none of the three is
  **a gate**, neither their content nor their failure holds up publishing. They say what stands
  out — what follows from it, the human decides.
- No stop because of recording the code review findings: it is no gate either, and it records
  nothing without a takeover note — the human decided before anything was incorporated.
