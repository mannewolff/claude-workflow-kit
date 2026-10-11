---
name: local-check
description: Step 6 of the 9-step process — runs the mandatory checks from the config and returns a green checklist. Use this skill when the user calls /local-check or starts step 6 (local check).
user-invocable: true
---
<!-- de: e2e82c6d2310 -->

# Local Check
<!-- de: dc591c8615f1 -->

Step 6 of the 9-step process: all mandatory checks run through locally. The output is a green (or explicitly red) checklist.

## Precondition
<!-- de: 827c76341d10 -->

The configuration lies in `.claude/workflow.config.json` (in the repository, applies to everyone) and is optionally supplemented by `.claude/workflow.config.local.json` (not in the repository, only personal fields: `reviewModel`, `reviewCommand`, `reviewScope`, `triggers`, token paths). Issue #207.

Relevant fields — all apply **team-wide** and cannot be overridden locally:
- `buildChecks`: list of the build/test commands to run (e.g. `["mvn verify", "npm run build"]`)
- `mutationCommand`: mutation test command (optional, e.g. `"mvn org.pitest:pitest-maven:mutationCoverage"`)
- `formatFixCommand`: command that fixes formatting violations mechanically (optional, e.g. `"mvn spotless:apply"` or `"npx prettier --write ."`). Today it is used only by the night runner (Issue #169).
- `mainBranch`: base branch for the check anchor (default: `main`). The placeholder `<mainBranch>` in the commands below stands for this value from `.claude/workflow.config.json` — the way the push skills already read it.

That these fields lie in the repository is the point: if everyone had their own `buildChecks`, "green" would not mean the same for two developers.

If the config is missing: run `buildChecks: []` and point out that no checks are configured.

## Mandatory checks
<!-- de: 20b38d7cf912 -->

**Guardrail: a coverage/quality gate is a floor, not proof of full coverage.** Green means "above the agreed threshold", not "completely tested". As a trust signal a metric only holds if it stays honest: a gap must mean genuinely untested logic, never silently excluded noise. If the coverage report lies below the target agreed in the project (see the project guide or `workflow.config.json`), flag that explicitly as a signal instead of silently waving it through — the human decides whether to look into it or add tests.

**Guardrail: recurring, class-wide model errors belong in the gate, not in prompts.** An AI model reproduces the most frequent, not the most current pattern of its training corpus — deprecated APIs and outdated idioms therefore show up repeatedly and across the board. Such error classes belong as a hard lint/compiler guardrail in the `buildChecks` of this gate, not as a request in a CLAUDE-`*`.md: a prompt to discipline gets skipped under time pressure, a guardrail in the gate cannot commit green in the first place. The guardrail derives from the existing annotations instead of keeping a hand-maintained deny list (which itself goes stale) — e.g. `@typescript-eslint/no-deprecated` (reads JSDoc `@deprecated`), Java `-Xlint:deprecation` with `-Werror`. SonarQube or similar stays the safety net, not the main catch: the round trip via `main` catches reliably, but late — the check belongs up front, in this gate.

**Guardrail: long-running checks need a generous time frame.** The Bash tool kills commands after a generic default of about two minutes if no larger value is passed. An `mvn verify` with a full Testcontainers IT run, a mutation test or a multi-module build regularly exceeds that under load — the check then dies not of a real error, but of the clock. Therefore always set a generous time frame explicitly for such commands: as a guideline at least 5 minutes, for IT-heavy multi-module builds 15 minutes and more. This stays a request to the caller, because a tool **cannot give itself more time than its caller** grants it. If a check still runs into the timeout, do **not** silently start it again with the same value — either raise the timeout and say so, or report the check back unambiguously as a failure. A second run into the same limit costs twice the time and delivers the same non-answer. An abort at the clock does not stay invisible, though: `checks.mjs run` writes its summary as it goes, and only the last version is complete — if the run dies at the clock, it stays **incomplete and not green**.

**Guardrail: no session ends with its own work still running.** "I will get back once the run is through" is only a valid statement if a further turn is guaranteed to follow that reads the result. That is not always the case: in some execution contexts the whole execution ends with exactly this announcement — the background process and its result are lost for good, and an outside observer (e.g. a Kanban board) only sees a failure, although the actual work was already done. Whoever started a long run therefore waits for its result or aborts it and reports the abort as a failure. Background work stays allowed; the only thing not allowed is stopping while it is still running (Issue #754). Whoever waits checks two things in doing so: whether the result is there and whether the run **still exists**. A wait loop that only polls the output waits its full length in the error case — and the most frequent error case is that the run never began, for instance because a path in the background command resolves differently than in the session. A run that no longer exists is a **failure** and is reported as such, not as a timeout (Issue #983). Without supervision (set `KIT_AGENT_MODEL`) there is no background work: the hook `bash-check` rejects a Bash call with `run_in_background` (Issue #1081) — call the command in the foreground and wait for it. Interactively background work stays allowed.

### 1. Build checks from the config
<!-- de: a2ae45d6eb56 -->

```bash
node .claude/kit/checks.mjs run --since "$(git merge-base HEAD origin/<mainBranch>)"
```

The command selects the affected `buildChecks` and runs exactly those. `<mainBranch>` is the value from `.claude/workflow.config.json` (default: `main`).

**The package stage is run.** The call carries no `--stage`: the package stage is the default, and it stays the right one here. The mechanical halt before the push sits in `/push-main` itself since skills-20 — this step is the local check before the human test round, and making it expensive would take away its use. If a check in the project carries the stage `push` or `merge`, it therefore appears in the list `skipped`, with its stage as the reason. That is **no deficiency**, but its point in time: it runs in `/push-main` or `/merge-production`. In the checklist it stands like any other skip.

**And no `--finish` is set here.** That is no oversight, but the
difference of the points in time: `--finish` belongs at the end of **one** card, where the
`implement-*` skills measure against `HEAD` before their commit. This step measures the state
of **several packages** against the merge base — it completes no card, and the
interplay checks (`notAtCompletion`, German name `nichtBeimAbschluss`) are exactly the ones needed here.

**Why this anchor and not `HEAD`.** This step runs **after** the local commit from step 5. On a clean working tree `git diff HEAD` would see nothing — the command would report `leeresPaket`, skip **every** check, and the report would show that as correct. The last pushed state is the right reference: the step secures everything that was added since the last push, that is, exactly what goes out next. (The `implement-*` skills, by contrast, check **before** the commit against the default `HEAD` — there it measures exactly one work package.)

**Edge case: empty anchor.** If `git merge-base` fails (no `origin`, detached HEAD, no common ancestor), the substitution yields an **empty string**, and the call becomes `--since ""`. `checks.mjs` treats an empty anchor like an unresolvable one and runs the **full scope** — never like a missing one. A missing one would yield the default `HEAD` and thus no check at all on a committed state. Do not "simplify" this assurance: it is the reason why a broken anchor leads to more checking instead of none.

On error: show the output, analyse the cause, propose a fix. Do not silently carry on.

**Preferably run in the foreground** — the result is then directly visible and unambiguously attributable to the check.

The **exit code** of the check command is read by `checks.mjs run` itself: it calls every command and evaluates its own value, not that of a chain someone builds around the call. An instruction to first write the value into a file and read it from there is no longer needed for this. That applies to the call through `run`; if a project builds a chain itself in its `cmd`, it takes care there that the value is not masked.

The check for **general error markers** is also taken over by `run`: it checks the output of every command against a fixed list, and a hit colours the check red, even with exit code 0.

Both are an operating rule that the tool carries instead of this text — see the yardstick "rule in the text or rule in the tool" in `CLAUDE-workflow.md`.

### 1b. Format fix on red checks (if configured)
<!-- de: 99e4debede3b -->

Only if at least one `buildChecks` command is red **and** `formatFixCommand` is set in the shared config:

```bash
<formatFixCommand>
```

Then run the check again **exactly once** — the same `checks.mjs run` call with the same anchor:

```bash
node .claude/kit/checks.mjs run --since "$(git merge-base HEAD origin/<mainBranch>)"
```

No loop, no second round — the same limit as in the night runner (Issue #169), for the same reason: a fix that achieves nothing the first time achieves nothing the second time either, but costs the full runtime once more.

That the selection can turn out larger on the second run than on the first is intended: the fix has changed files, so the affectedness has changed.

Do not ask before the fix runs — a formatting is mechanical and fully visible via `git diff`. But do report that it ran.

**Duty to report.** A format fix leaves uncommitted changes in the working tree. A checklist that afterwards only says "all green" is misleading: it describes a state that does not exist in the last commit. The report must show both:

```
- ❌ npm run lint → 3 formatting violations
- 🔧 Format fix (npx prettier --write .) → run, 3 files changed
- ✅ npm run lint → green (after format fix)

Note: The format fix has changed the working tree. The changes must
be committed, otherwise the next run is red again.
```

If the checks stay red after the fix, the rule is unchanged: a red check stops the process. The report then says explicitly that the format fix ran and **was not enough** — otherwise the human looks in the wrong place.

Without a set `formatFixCommand` this step is dropped without replacement.

### 2. Mutation test (if configured)
<!-- de: d2daf38f2563 -->

```bash
<mutationCommand>
```

Only if `mutationCommand` is set in the config. If the test cannot be run locally (no build tool, no daemon), note that explicitly.

**`mutationCommand` stays unchanged and still always runs.** It does not stand in `buildChecks` and is thus **not part of the area-based selection** — it is run directly, without `checks.mjs`, regardless of which areas the anchor finds. That is intent and no gap: in the existing setup it already came after the build, and pulling it into the selection would widen the scope of the conversion.

**`mutationCommand` is no quality measurement.** The two lie close together in content — the quality measurement also measures how many deliberately inserted errors the tests notice —, but `mutationCommand` stays what it was: a downstream command. It carries **no marker**, its result is not evaluated, and it triggers **no halt**; a value nobody likes stays a number in the report. Whoever wants the bindingness instead runs their command as a `buildChecks` entry with a `quality` block (`pattern` and `marker`; German names `guete`, `muster`, `marke`): only there is the measured share collected, held against the marker, and a value below it turned into a red run like any other red mandatory check. Setting both at once results in two runs of the same tool, of which only one counts.

### 3. Manual UI verification (for frontend changes)
<!-- de: 8092334bc846 -->

If the last commits touch frontend files:

> **Manual check required:** Start the dev server (`<start command>`) and click through:
> - Golden path: <description of the main case>
> - Edge cases: <description of the edge cases>
>
> Report the result before things go on.

The AI cannot operate a browser. This step stays with the human.

## Result
<!-- de: 524e5c599a4e -->

Checklist in the format:

```
### Local check

- ✅ <check that ran> → <result>
- ✅ <check that ran> → <result>
- ⏭️ <skipped check> → skipped (<reason from checks.mjs>)
- ✅ Mutation test → <result>
- ⏳ UI verification → manual check pending

All affected checks green. UI check pending.
```

The checklist names **checks that ran and those that were skipped**, each skip with the reason that `checks.mjs` outputs. Naming only the runs is not enough: a shortened run would otherwise look like a complete one, and the human would have to infer the skips indirectly. If the command reports `leeresPaket`, that stands explicitly as a line of its own ("no check, because nothing was changed since the last push") — not as an empty list.

If `buildChecks` is empty: output the note "No buildChecks configured. Adjust `.claude/workflow.config.json` — the file belongs in the repository, so commit the change." No error, no abort.

A red check (`❌`) stops the process. Do not go on before the error is resolved.

## Stop point
<!-- de: 5d1aba33b487 -->

After a green checklist the process waits for `/review` (step 7) to be started. The push only happens after the explicit trigger phrase `push main`.
