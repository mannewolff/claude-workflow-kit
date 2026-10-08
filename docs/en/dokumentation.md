# Documentation: claude-workflow-kit
<!-- de: 43a011243c37 -->

A thin tool layer that makes a 9-step core process for AI-assisted development executable in Claude Code. The kit automates the AI steps and deliberately leaves the three human responsibility thresholds in place.

## Concept
<!-- de: efe773ce86aa -->

The kit is not a platform and not an agent. It is a library of sixteen skills, a project-local config and an installer.

The skills are written independently of any project. Everything project-specific (build commands, branch names, review model) comes from the config file. An update to a skill therefore applies in every project in which you use the kit. You do not have to adjust anything in each repo when the process evolves.

The core process has nine steps. Step 1 is your requirement; the AI takes over steps 2, 3, 5, 6 and 7. The three human stop points (Stop-Punkte) are step 4 (GO), step 8 (push) and step 9 (merge); between push and merge you check the test server. Nine further skills stand outside the numbering and structure the working rhythm: /kontext, /fachplan, /issue-review, /task, /implement-test and /implement-done, /implement-next, /retro and /document.

## Prerequisites
<!-- de: c8c7a036ea0f -->

**Node.js 18 or later.** The installer is written in Node and therefore runs on macOS, Linux and Windows via WSL2 without depending on a particular shell ecosystem.

**Windows: WSL2.** The kit runs on macOS, Linux and Windows via WSL2 to the same extent. On Windows it works in WSL2; how to set it up is described in the guide [Windows via WSL2](/en/wsl2).

**git.** Claude Code and the whole process require git. Without a git repository, no skill works.

**Claude Code in a current version.** The skills use the skills system of Claude Code. Older versions may not know this system.

**A board adapter (Board-Adapter) — and the matching CLI.** All issue and board operations run through `.claude/kit/board.mjs`, the board adapter. The adapter shields the skills from the concrete platform. What you need depends on the chosen issue tracker:

| Issue tracker | Prerequisite |
|---------------|---------------|
| `github` | `gh` (GitHub CLI), once `gh auth login` |
| `gitlab` | `glab` (GitLab CLI), once `glab auth login` |
| `local` | Nothing — issues live as files in `issues/` |

**A project board, if you use GitHub or GitLab as issue tracker.** The board needs these five columns (Spalten): Backlog, Ready, In progress, In review, Done. On GitHub these are project board columns (GitHub Projects), on GitLab they are represented by labels. In local mode there is no board — the adapter writes and reads YAML frontmatter files directly.

**`kontext.config.json` for /kontext and /document (optional).** Both skills also run without this file, in degraded mode. If you want persistent cross-project memory: With a global installation the installer asks for the vault path and creates the file automatically; with a project-local installation you create it manually. Details in the section [kontext.config.json](/en/dokumentation#kontext-config-json-reference).

## Installation
<!-- de: 0e67b6dac800 -->

Change into your project folder and run:

```bash
npx claude-workflow-kit
```

Alternatively, you can download the installer and start it directly:

```bash
curl -O https://docs.mwolff.org/install.mjs
node install.mjs
```

Or in one step without a local file:

```bash
node <(curl -s https://docs.mwolff.org/install.mjs)
```

The installer asks nine questions — with a global installation a tenth follows:

**1. Global or project-local.** Global puts the skills into `~/.claude/skills/`. They are then available in all your projects. Project-local puts them into `./.claude/skills/`. They belong to the repo. For processes binding on a team choose project-local, for personal use global. With project-local, the installer automatically adds `.claude/` to `.gitignore`.

**2. Code host.** Where do pull requests and the repo live? `github`, `gitlab` or `local` (no remote, no PR).

**3. Issue tracker.** Where are issues managed? The default is the value of the code host. An independent choice is possible, e.g. `issueTracker: local` with `codeHost: github`.

**4. Name of the main branch.** In most repos `main`, sometimes `develop` or `master`. This branch is the target of /push-main.

**5. Name of the production branch.** Often `production` or `release`. /merge-production creates a PR or MR from main to this branch.

**6. Review scope (`diff` or `full`).** With `diff` the review skill only sees the changed lines. With `full` all files in the repo. For small changes `diff` is enough. For larger refactorings `full` is more meaningful, but in very large repos it can overload the context window.

**7. Review model** and **8. Review command.** Who runs the code review in step 7 — **exactly one of the two**. A model (default `claude-opus-4-8`) runs as a subagent; a command starts an external tool and receives the prompt via stdin. Setting both is rejected, setting neither as well: Otherwise step 7 would run into nothing. This applies to the **answers**. If, on the other hand, both fields are already **in the file**, the installer does not reject but resolves the contradiction: It proposes the existing command and says beforehand that the model is dropped. The other way round works by clearing the command with `-` and entering a model.

**9. Commit gate (project-local only).** Whether the installer hooks in the commit gate, i.e. sets `git config core.hooksPath .githooks` — see [The commit gate](#the-commit-gate). The question only appears if neither another `core.hooksPath` is in effect nor an active file lies in the hooks directory; the default is no.

**10. Vault path (global installation only).** Path to the memory vault for /kontext and /document. Leaving it empty skips the step; with a path the installer writes the global `~/.claude/kontext.config.json`.

The installer copies the sixteen skills, writes a `.claude/workflow.config.json` with your answers, places a `CLAUDE-workflow.md` with the process description as well as the two gate registers `CLAUDE-Fachplan.md` and `CLAUDE-Plan.md`, and writes the board adapter to `.claude/kit/board.mjs`. With GitLab it additionally asks whether it should create the five labels automatically. No background process, no service, no registry entries.

The former local Kanban GUI (`board-ui.mjs`) has been discontinued.

After the installation you restart Claude Code. The skills then appear under `/help`.

### What the installer writes — and why it does not belong in the repo
<!-- de: e94cb1d5045b -->

Everything the installer places under `.claude/` is **generated output**: the skills, `CLAUDE-workflow.md` and the two gate registers. On the next run it writes them anew. Versioning one of these files in the repo would mean keeping a second state that drifts until the next install — and it would take from everyone the decision **whether** to reinstall at all.

This repo therefore handles it this way itself, and for your project it is the recommended split:

```gitignore
.claude/*
!.claude/workflow.config.json
```

The first line must read `.claude/*`, not `.claude`: Inside an excluded directory git no longer evaluates any `!` pattern — the exception would silently drop out too.

`workflow.config.json` is the justified exception. The installer **does not overwrite it, it merges**: The base is the default values, above that the existing file, on top the answers asked for. Fields not asked for, such as `buildChecks` or `issueReview`, are kept. It is a team setting, not generated output — and therefore belongs under version control.

### The commit gate
<!-- de: 45e2c9f3e33c -->

With a project-local installation, the installer asks whether the **commit gate** should be hooked in. It rejects every commit that was not preceded by a green `node .claude/kit/checks.mjs run` on the same state.

Two files carry it, both under `.githooks/` and thus **versioned**:

| File | Role |
|---|---|
| `.githooks/pre-commit` | POSIX sh, a few lines, delegates to the gate |
| `.githooks/gate.mjs` | the check itself |

They live there and not under `.claude/kit/` because the `.gitignore` block above excludes `.claude/*`: A fresh clone would otherwise have the hook without the program it calls.

**What travels along and what does not.** The files travel with the clone, the **activation does not** — `core.hooksPath` is local git config. Whoever clones has the gate only once they run the installer or set `git config core.hooksPath .githooks` themselves.

**An occupied `core.hooksPath` is not overwritten.** If the project runs Husky or its own hook framework, the installer reports the value it found and changes nothing — otherwise the project would lose all existing hooks with one write command. To hook it in, add `node .githooks/gate.mjs pre-commit` to your own hook. The same applies to an already existing `.githooks/pre-commit` that does not come from this kit: It stays untouched.

**Outside a git repo** — and when `git` is not in the PATH — the question is dropped; the installer writes the files and says why the gate is not active. With a global install it is dropped as well.

**The summary accompanies the run.** It is created **before** the first command, overwritten **before** each further one and written one last time at the end. Only this last version carries `abgeschlossen: true` (completed: true); in every other one the command currently running still stands at `nicht gestartet` (not started). From this follows what an abort leaves behind — if the run dies by the clock, by a signal or with its session, a version is left that is **never fully green**. Previously the file was missing entirely in this case, and a missing file means "unchecked", i.e. unmeasured instead of objected to. The gate and the night runner (Nacht-Runner) evaluate `ergebnis` and not `abgeschlossen`: The moment of writing is the actual rule, the field only says whether the run reached its end.

**What the gate checks.** `checks.mjs run` leaves a summary under `.claude/checks-summary.json`. Besides selection and result, it carries a **blob hash** for each changed file, formed **before** the first command — so it attests the content that went into the check (Prüfung), and not one that a formatter wrote afterwards. On commit the gate compares these hashes against the **index**, i.e. against what is actually committed. Green only if the summary is readable, no run was non-green and every staged file is in it with a matching hash. A staged **deletion** is covered by a `null` entry; if the check found nothing to do (`leeresPaket`, empty package), it covers nothing either.

**Whom it applies to.** Every commit in the repo: the implementation skills, **lane 1** (Bahn 1), the commit by hand, the one from a GUI client. A tool without `node` in the PATH is **rejected**, not let through — a gate that cannot run does not let anything through.

**What it does not achieve** — four limits, and they are stated here because a rule that keeps quiet about its gaps creates false trust:

1. `--no-verify` bypasses the hook. The git workflow forbids it, nothing prevents it mechanically.
2. A fresh clone has the gate only after an installer run or `git config core.hooksPath .githooks`.
3. With an occupied `core.hooksPath`, a project with its own hook manager hooks in the call itself.
4. The assurance applies **per committed file**, not to the state as a whole: Whoever commits `A` and leaves the corresponding `B` unstaged creates a state that nobody has ever checked in that form. That is the price for the skills being allowed to stage selectively.

**What takes effect in the gaps.** If the night runner is running, it evaluates the evidence afterwards: If it is missing or red, the round counts as a failure, with its own board comment. **Interactively nobody steps in** — there the rule in the git workflow remains the only safeguard.

### Which version is my installation?
<!-- de: 95428666b541 -->

The board adapter and the night runner are copies — after the installation they live in your project and age there while the kit is developed further. Both tell you on request which kit version they come from:

```bash
node .claude/kit/board.mjs --version
node .claude/kit/night.mjs --version
```

```
board.mjs (claude-workflow-kit v1.22.0)
```

Compare this with the current kit version (`node install.mjs --version`, or the version shown on the download page). If your copy is behind, simply run the installer again — it overwrites the kit files and leaves your `workflow.config.json` untouched except for the fields it asks for.

The version number is deliberately the same as that of the kit, not a separate count per file: A copy with `v1.22.0` is exactly the state that kit 1.22.0 shipped. If the two files drift apart — for instance because only one of them was replaced —, the night runner warns at start and keeps running anyway.

## What is the vault?
<!-- de: 9be3897f8ddc -->

The vault is a personal memory store outside the repo. It holds cross-project knowledge: your profile, working rules, decision history and daily logs. /kontext loads it at the start of a session, /document writes into it at the end of a session.

The vault is optional. Without a vault, both skills run in degraded mode (details in the section [What happens without a vault?](/en/dokumentation#what-happens-without-a-vault)).

If you want to set up a vault, create a directory and enter the path in `~/.claude/kontext.config.json`. The expected structure:

```
/path/to/your/memory-vault/
  Index.md                          (overview of what is in the vault)
  Profil.md                         (or comparable always files)
  Projekte/
    {repo-name}/
      {repo-name}.md                (project note, updated by /document)
  Log/
    YYYY-MM-DD.md                   (daily logs, written by /document)
```

You configure the file names of the always files (Index.md, Profil.md) yourself in `kontext.config.json`. The directory structure under `Projekte/` and `Log/` is expected by the skills and must be created manually once.

## The config file
<!-- de: da6dab78e039 -->

`.claude/workflow.config.json` is the only project-local place. All skills read exclusively from this file (project parameters are hard-coded nowhere else).

```json
{
  "codeHost": "github",
  "issueTracker": "github",
  "buildChecks": ["<your build command>", "<your test command>"],
  "mutationCommand": "",
  "mainBranch": "main",
  "productionBranch": "production",
  "reviewScope": "diff",
  "reviewModel": "claude-opus-4-8",
  "triggers": { "go": "GO", "push": "push main", "merge": "merge production" },
  "local": { "issuesDir": "issues" },
  "github": { "projectNumber": 11 }
}
```

`codeHost` controls which platform is used for the repository and pull requests (`github`, `gitlab` or `local`). `issueTracker` controls where issues are created and moved — selectable independently of `codeHost`. The board adapter `.claude/kit/board.mjs` reads both fields and routes all board operations accordingly.

`local.issuesDir` names the directory in which local issues live as Markdown files (`issues/0001.md`, `issues/0002.md`, …). `github.projectNumber` is the project number of the GitHub Projects board — only relevant for `issueTracker: github`. If it is missing, the adapter tries to detect the owner's only existing GitHub Project automatically (with a notice on stderr, no automatic write to the config); if there is no project or there are several, it aborts with an error message asking you to add the field.

With `issueTracker: github`, the adapter creates a cache file `.claude/board-meta-cache.json` with the project metadata (project ID, status field and option IDs) on first access. It saves every further `board.mjs` call two GraphQL queries and so spares the GitHub quota. The file is local to the machine and does not belong in the repository — the installer ignores `.claude/` completely anyway; if you commit `.claude/` yourself, add `.claude/board-meta-cache.json` to your `.gitignore`. If you delete it, it is rebuilt on the next call; the adapter heals outdated IDs automatically.

`columns` controls the column names on the board. The five keys (`backlog`, `ready`, `in_progress`, `in_review`, `done`) are fixed — they appear in the frontmatter of the issue files and are the internal status values. The values are the displayed names and can be chosen freely. On GitHub the values correspond to the column names in the project board, on GitLab to the label names. Without `columns` in the config, the defaults apply: Backlog, Ready, In progress, In review, Done.

`buildChecks` holds the commands that `/local-check` runs — the **affected** ones, selected by the areas (Bereiche) the work package (Arbeitspaket) has touched (see [Area-based checks](#area-based-checks-checkareas)); all commands that run must be green before the skill reports completion. Without `checkAreas`, all of them run as before. `mutationCommand` is kept out of `buildChecks` because mutation testing runs considerably longer (an empty string disables it). `reviewScope` controls the scope for `/review`. `reviewModel` pins the model across session boundaries. `triggers` holds the natural-language phrases in case you prefer typing to slash commands.

**Backward compatibility:** Repos that still have `"provider": "github"` or `"provider": "gitlab"` in their config keep working. The adapter migrates the field to `codeHost` and `issueTracker` automatically when reading it.

Examples for different stacks:

| Stack | buildChecks | mutationCommand |
|-------|-------------|-----------------|
| Java / Maven | `["mvn verify"]` | `"mvn org.pitest:pitest-maven:mutationCoverage"` |
| Node / npm | `["npm test", "npm run build"]` | `""` |
| Python | `["pytest", "python -m build"]` | `""` |
| Go | `["go test ./...", "go build ./..."]` | `""` |

You can edit the config file manually at any time. When run again, the installer only overwrites it if you explicitly confirm that.

### Area-based checks: `checkAreas`
<!-- de: e666f88d2d20 -->

A work package rarely touches the whole project. A `buildChecks` entry can therefore say which areas it is responsible for — then it only runs if one of them was touched. Selection and execution are done by the bundled command `.claude/kit/checks.mjs`; the skills call it themselves. You only need it if you want to take a look: `node .claude/kit/checks.mjs plan` shows the selection as JSON without running anything.

**The three forms of a `buildChecks` entry:**

```json
{
  "buildChecks": [
    "npx eslint .",
    { "cmd": "npm --prefix frontend run build", "areas": ["frontend"] },
    { "cmd": "mvn verify", "always": true }
  ],
  "checkAreas": {
    "frontend": ["frontend/**"],
    "backend": ["src/main/**", "pom.xml"]
  }
}
```

1. **The bare command string** — not assigned, always runs. An object with only `cmd` means the same.
2. **`{ "cmd", "areas" }`** — runs if at least one of the named areas is touched. The names are defined in `checkAreas`.
3. **`{ "cmd", "always": true }`** — decidedly always runs.

Form 1 and form 3 behave the same and still mean different things: **forgotten** versus **decided**. Whoever leaves an entry as a string may simply not have made the assignment; whoever writes `always: true` has made it and made it visible. The difference costs nothing and carries the intent to the next reader.

`areas` and `always` **are mutually exclusive** — a precedence rule for the case that both are present would be read by no one. `areas` must not be empty either: An empty array would never run, and a check that never runs belongs deleted rather than shelved.

**`checkAreas`: area name → path patterns.** The patterns know `*` within one path segment (`src/*.ts` does not cover subdirectories) and `**` across segment boundaries; `/` is the separator to which paths are normalised beforehand. A directory with its contents is covered as `frontend/**`. The kit brings the evaluation itself: **no external runtime dependency**, as with all shipped tools.

**Two anchors — and they differ.** Which files count as "touched" is decided by an anchor: the Git state that is compared against. The `implement-*` skills check **before the commit** against the default `HEAD`; the diff against `HEAD` is then exactly this one work package, and a red check belongs to the package that triggered it — even if a session commits several times. `/local-check` checks **before the push** against `git merge-base HEAD origin/<mainBranch>` and so measures everything added since the last push, that is, exactly what is about to go out.

Both mix-ups go wrong, and both would look correct in the report. A `merge-base` anchor **before the commit** would collect other work packages: A red check would then speak about changes the running package has nothing to do with — at night the failure would be attributed to the wrong issue.

Conversely, a `HEAD` anchor **before the push** would speak about the wrong piece: What runs there is no longer decided by the anchor — the [push stage runs the full scope](#staged-checks-stufe) —, but which state the summary attests is. `basis`, `geaendert` and the blob hashes would then describe the last work package instead of the batch that is about to go out, and the commit gate checks the index against exactly these hashes. That is why every skill contains exactly one anchor, and it is justified there.

**When in doubt, everything runs. Cannot be switched off.** Three paths lead to the full scope: a changed file that **cannot be assigned to any area**; an **unassigned check**, which runs anyway; and an **empty or unresolvable anchor**. An empty anchor counts like an unresolvable one, never like a missing one — a missing one would yield the default `HEAD` and, on a committed state, no check at all. There is no switch that turns the rule off: A selection that turns out wrong takes checking away, and this error goes in the direction in which nobody notices it.

If changes frequently end up in the doubtful case, that is a finding about the **assignment**, not about the rule: Then an area is missing, or a pattern is too narrow. The assignment needs improving then, not the rule softening — the time a softened rule saves is paid back by the first bug nobody looked for.

**The one exception: `ohnePruefung`.** For some files there really is nothing to check — a release log, say, whose content no test reads. They would match no pattern and thus pull in the full scope, although nobody needs it. For them there is a third answer, and it must justify itself:

```json
{
  "ohnePruefung": [
    { "muster": "CHANGELOG.md", "grund": "release log; no check reads its content" }
  ]
}
```

A file that matches such a pattern counts neither as touched nor as unassigned: It triggers no check and no full scope. In return it appears in the report of every run — `ohne Pruefung: CHANGELOG.md — Release-Protokoll; …` ("no check: … — reason"), **before** the omissions. The reason is mandatory: An exception to "when in doubt, everything runs" is only bearable if the next reader sees why it applies. An area name could not carry that.

**`checkAreas` takes precedence.** If a file matches both kinds of pattern, it counts as touched and triggers its area checks; the exemption has no effect for it. The selection may only err in one direction, namely towards more checking — the other way round, a pattern in `ohnePruefung` that turned out too broad would silently switch off a whole area, and an area that no longer runs is noticed by nothing except the time.

**A JavaScript file without a pattern inherits the areas of its importers.** A new test helper usually matches no pattern, and which check it needs is already in the code: It is the files that load it. If a changed `.mjs`, `.js` or `.cjs` file matches no pattern and no exemption, `checks.mjs` searches the versioned files (`git ls-files`) for those that import it statically and relatively — `import … from`, `export … from`, `import "…"`, `import(…)` and `require(…)` —, also across further files without a pattern; a cycle ends at the file already visited. The file touches the areas of those importers that match a pattern, and the block `Fuer den Abschlussbericht:` ("for the completion report") names the derivation: `abgeleitet: test/helpers/x.mjs ueber test/night-y.test.mjs → nachtrunner` ("derived: … via … → area"). If nobody with a pattern imports it, it triggers no check and appears in the report like an exemption with a reason — `ohne Pruefung: test/helpers/x.mjs — von keiner Datei importiert` ("no check: … — imported by no file"; or `von keiner Datei mit Muster importiert`, "imported by no file with a pattern", if the chain ends without a pattern): A helper that no test loads cannot break a test. Other file types and a search that fails (`git ls-files` fails, a file cannot be read) pull in the full scope as before. Only imports are recognised: If a test starts a file as a child process without importing it, the derivation does not see that — such files need a pattern in `checkAreas`.

**Blob-only lines in `install.mjs` touch nothing.** `install.mjs` carries skills, templates and kit files as blob constants (`const …_B64 = "…"`, one line each), and `node tools/sync-blobs.mjs` changes these lines along with every change to a source. If every changed line of the file — added or removed — is such a constant, `install.mjs` does not count as changed for the area assignment: The source itself is in the diff and selects the checks it needs, and the mirrored line carries no statement of its own. A pure text package on a template therefore no longer runs the checks of the area that contains `install.mjs`. The omission says so in its reason: `ausgelassen: <Kommando> → Bereich installer unberuehrt (install.mjs: nur Blobs)` ("skipped: `<command>` → area installer untouched, `install.mjs` carries blobs only"). A single other changed line, a newly created `install.mjs` or a diff that cannot be read touch the area as before. As with `ohnePruefung`, the file stays in the evidence.

**Nothing changes in the evidence.** The file stays in `geaendert` and among the blob hashes of the summary. That is no minor matter: The [commit gate](#the-commit-gate) checks the index against exactly these hashes, and an index entry without a hash counts as unchecked to it. If the exempted file dropped out of the evidence, the gate would no longer let through any commit that brings it along. `ohnePruefung` changes the assignment, not the evidence.

**Without `checkAreas`, nothing changes.** A project without this block gets the previous behaviour, unchanged: Every entry is the string form, therefore unassigned, therefore all checks run as before. The switch takes no checking away from anyone silently — whoever wants the selection configures it.

**`mutationCommand` stays out.** It is not in `buildChecks` and therefore **not part of the selection**: It always runs, unchanged and directly, regardless of which areas the anchor finds.

What was skipped remains visible: in the checklist of `/local-check` and in the completion report (Abschlussbericht) on the work package, each omission with its reason — and at night additionally in the [run report of the pass](/en/dokumentation#night-mode).

**`stufe` is on an axis of its own.** `areas` and `always` say **whether** a check is affected; **when** it is due is said by [Staged checks](#staged-checks-stufe).

### Staged checks: `stufe`
<!-- de: 36e57fdb2e75 -->

Not every mandatory check belongs at every point in time. Running an integration test that takes twenty minutes after every work package makes the check before the commit so expensive that nobody waits for it any more — leaving it out makes the check worthless. A `buildChecks` entry can therefore say **when** it is due:

```json
{
  "buildChecks": [
    "node --test",
    { "cmd": "mvn verify -Pintegration", "stufe": "push" },
    { "cmd": "npm run e2e", "areas": ["frontend"], "stufe": "merge" }
  ]
}
```

| Stage | Point in time | Skill |
| --- | --- | --- |
| `paket` | completion of a work package, before the local commit | `/implement-next`, `/implement-ready`, `/implement-done`, `/local-check` |
| `push` | before publishing to `main` | `/push-main` |
| `merge` | before the release to `production` | `/merge-production` |

**The stages (Stufen) are cumulative, and every check runs once before the release.** `push` runs the package stage (Paketstufe) along with it. `merge` runs what `push main` has not checked — because there is never a `merge production` without a preceding `push main`: The package and push stages run at `push main`, the merge stage at `merge production`. No check drops out of the process this way; it only runs at the point in time at which its result counts, and not twice for the same state.

**The push stage runs the full scope.** `push` runs **every due** check — even for untouched areas and even for an empty package. There the state that goes out is measured, and it consists of more than the last work package; an omission would point to the wrong comparison. Narrowing by areas belongs to the package stage, where it speaks about one work package. Cumulation is unaffected by this: What is due later stays out here too.

**The release stage only checks what `push main` has not checked.** `merge` always runs the checks with `stufe: "merge"`, those of the package stage **by areas over the files since the anchor** — as at the completion of a card (Karte), so a file without an area runs every check of the package stage — and those of stage `push` not at all: They appear as an omission with the reason `Stufe push, geprueft beim push main` ("stage push, checked at push main"). The anchor is the most recently published state of `main`; the files since then are the release files of the merge path (bump, stamp, changelog). That a `push main` really came before is checked by `/merge-production` up front on the Git state: If the local `main` carries commits that are not on `origin/main`, the skill stops.

**Short release.** Whoever wants a short release puts their long checks — full mutation runs, for instance — on stage `push` instead of `merge`. They then run once at `push main`, and `merge production` only runs what is on `merge` plus the package checks of the release files. The price: Every `push main` takes longer by these checks, including one that is not followed by a release. The kit does not fix the stage; every project decides in its config at which point in time it wants to wait.

**A missing field means `paket`.** The bare string form and an object without `stufe` carry the package stage, and so every existing configuration keeps its behaviour unchanged. Whoever does not want the staging writes nothing.

**What runs later appears as an omission** — in the checklist and in the completion report, with its stage as the reason. That is **not a shortcoming but its point in time**: `Stufe push, gefahren wird paket` ("stage push, running stage paket") means that this check is due in `/push-main`. Above the package stage, the command additionally names what is added compared with it (`Stufe push: zusätzlich zur Paketstufe läuft …`, "stage push: in addition to the package stage, … runs") — such a run takes noticeably longer than the one before the commit.

**At least one check belongs on the package stage.** If all entries carry `push` or `merge`, nothing runs before the commit: Implementing a work package then has no gate. At night this is no silent state — the night runner checks it at start and does not start at all (override: `--no-checks-ok`). The [settings interface](/en/dokumentation#settings-via-the-interface) (Einstellungs-Oberfläche) reports this state as a warning; such a configuration can still be saved, because it is valid.

**Not to be confused.** The term *stage* (*Stufe*) has three meanings in the kit: `reviewStufen` are the [check stages of the review](/en/dokumentation#three-check-stages-the-check-moves-up), the task level (Aufgabenstufe) of a work package (`schwer`/`mittel`/`leicht`) controls the model of the [night chain](/en/dokumentation#second-mode-the-night-chain) (Nacht-Kette), and `stufe` is the point in time of a mandatory check. The three have nothing to do with each other.

### Completion and publishing: `nichtBeimAbschluss`
<!-- de: c657d63448c8 -->

The staging above moves a **whole check** to a later point in time. Sometimes, though, the check is right at its point in time and only its *scope* is too large: The unit tests of a work package say whether this package holds — the integration tests say whether the parts fit together, and that is not yet a question at the completion of a single card. A `buildChecks` entry of the package stage can therefore say **why** it does not have to carry the completion of a single card:

```json
{
  "buildChecks": [
    { "cmd": "mvn -q test", "areas": ["backend"] },
    {
      "cmd": "mvn -q verify -DskipUnitTests",
      "areas": ["backend"],
      "nichtBeimAbschluss": "zusammenspiel"
    },
    {
      "cmd": "mvn -q verify jacoco:check",
      "areas": ["backend"],
      "nichtBeimAbschluss": "volleTestmenge"
    }
  ]
}
```

The unit tests (surefire) run at the completion of every card. The integration tests (failsafe) and the coverage threshold (jacoco) only run when publishing — the former because they check how several parts work together, the latter because a coverage figure over half a state says nothing.

| Value | Meaning |
| --- | --- |
| `zusammenspiel` | The check checks how several parts work together. |
| `volleTestmenge` | The check only gains its finding from the complete set of tests. |

**Only the completion run skips.** The axis only takes effect if the call carries `--abschluss <kartennummer>` — the implement skills set it at the completion of exactly one card, and only they do. `/local-check`, the commit gate, the night runner's re-check and every manual run include the check. The card number is mandatory because the [average check time per card](#what-the-reduction-brings-the-average-check-time-per-card) needs it.

**Postponed, not waived.** Every check skipped this way runs **before publishing** in `/push-main`, there in full scope. In the report of the completion run it appears as an omission with its reason — not a shortcoming but its point in time.

**Only meaningful on stage `paket`.** On `push` or `merge` the check does not run at completion anyway; `checks.mjs` rejects the combination at start instead of silently choosing one over the other. Likewise rejected is a configuration in which **every** entry of the package stage carries the axis or a `guete` block: Then completing a card would no longer have a gate.

**A missing field means unchanged behaviour.** Whoever writes nothing notices nothing of the axis — and whoever cannot call their tests separately by kind keeps getting the previous scope. The axis applies team-wide; a deviating value in `workflow.config.local.json` has no effect.

### Who was it? The culprit search
<!-- de: 6dec08ad38b1 -->

Because completing a card checks less, a postponed check only fails before the push — that is, at a point in time at which several finished cards lie on top of each other. So that nobody has to search for the cause by hand, a **red run with `--stufe push`** names on its own the cards whose change touches the failing check:

```
Verursacher (mvn -q verify -DskipUnitTests): Issue #902 (a1b2c3d), Issue #901 (e4f5a6b)
```

(`Verursacher` means "culprits": the cards whose commits touch the failing check, each with its commit.)

The search covers the window `<anchor>..HEAD` — the anchor is the `--since` value that `/push-main` passes as `git merge-base HEAD origin/<mainBranch>`. The run reads the card number from the **commit message**: `(Issue #<n>)` in the subject, as the implement skills write it, additionally `Refs #<n>` in the body; the subject wins. A look at the board deliberately does not happen — `checks.mjs` runs in the commit gate and in every session and works without network. The price is the commit without a recognisable number: It appears as `Commit ohne Karte <sha>` ("commit without card") and does not disappear.

Touched is determined generously, in the same direction as the selection of the check run (Prüflauf) itself: A check without `areas` counts as touched by every card, and a card with a file without an area pattern as a suspect for every check. In case of ambiguity, **all** candidates are listed. If no card is found or the anchor cannot be resolved, a **sentence** stands there instead of a list — "none found" and "not determinable" are different things. The release stage (`--stufe merge`) does not search: There the base is `HEAD` itself, and the window would be empty.

**The repair is a new card.** The named card does not move back out of *In review* — it is finished and checked; what was found concerns how the parts work together. The culprit list is a lead, not a verdict.

### What the reduction brings: the average check time per card
<!-- de: b4a58352c655 -->

Whether the smaller completion scope brings anything is told by the effectiveness (Wirksamkeit) evaluation (`node .claude/kit/wirksamkeit.mjs auswerten`). Its report `.claude/wirksamkeit.md` carries a block of its own for this, **"Mittlere Prüfzeit je Karte"** ("average check time per card"): the measured time per card, computed over all **completion runs** of that card, next to it the comparison value that the same runs would have cost without the omissions, and per skipped check one line on what it cost on average when publishing.

The reference unit is the **card**, not the run — a card that completes three times counts once with the sum of its runs. And **only completion runs** count: Check times during the work and when publishing stay out. If the basis is missing — no completion line with a card number in the window, or a skipped check that never ran when publishing —, the block says "nicht gemessen" ("not measured") and not 0.

Like the rest of the report, the block is information: It holds nothing up and is **not a gate**.

### Error markers in the output
<!-- de: 9ef32c38519c -->

`checks.mjs run` reads not only the **return value** of a check command but also its **output**. If it carries one of the markers `[ERROR]` or `BUILD FAILURE`, the check counts as **red** — even if the command ended with 0. The run aborts as with every red check, the output names the marker that matched, and the summary carries it on the entry as the field `fehlermerkmal`.

The case really occurs: A Maven chain whose last link swallows the return value reports `BUILD FAILURE` in the output and ends with 0. Until now, the rule "additionally check the output for general error markers" stood in the text of `/local-check` — that is, at a place that is skipped under pressure. Now the tool carries it — by the yardstick "rule in the text or rule in the tool" from `CLAUDE-workflow.md`.

**The list is fixed, and there is no config field for it.** A field would be an invitation to empty the check in the very project in which it happened to be in the way — that is, exactly where it is needed. It only errs in one direction: more checking. A false red costs a query, a false green carries a failed package to *In review*.

**And if the green output legitimately contains `[ERROR]`?** Then that belongs to the command, not to the check. Two ways: make the tool quieter (log level, a `--quiet`, a different reporter), or let `cmd` point to a project script of your own that filters out the known harmless line and passes the **return value on unchanged**. Both stay visible in the project and affect only the one command concerned.

### Unchanged state: the result is carried over
<!-- de: fcdb5a79ac5c -->

`checks.mjs run` only runs its commands if there is something new to measure. If the state has **not changed** since the last run, none runs — the command carries over that run's result and reports:

```
Stand unveraendert seit 2026-09-22T17:18:04.921Z: Ergebnis uebernommen (gruen). Neu pruefen mit --frisch.
```

(State unchanged since that point in time: the result is carried over, green; `--frisch` checks anew.)

**Unchanged means:** the same anchor (`basis`), the same stage, the same list of changed files with the same blob hashes and the same check configuration (`buildChecks` and `checkAreas`, as `configHash` in the summary). In addition, the previous summary must be **complete**. If even one of these details differs, or the file is missing or unreadable, everything runs as before. There is deliberately no time window: What makes a result valid is its content, not the clock.

**A red result is carried over too**, including the exit code; the message then names the red command (`Ergebnis uebernommen (rot: mvn verify)`, "result carried over (red: …)"). The same state yields the same red — a second run would cost the same minutes for the same answer. Whoever suspects a flaky test forces the real run with `--frisch`.

**After a fix, the most recently red checks run first.** If the previous run was red and since then only the state has changed, not the selection — the same anchor, the same stage, the same check configuration, the same selected commands in the same order, but different files or blob hashes —, the same call first runs a **partial run** with only the commands that were last `rot`, along the same axes as the full run (marked ones concurrently, then). If they turn green, the full run follows exactly once in the same call as evidence; the summary at the end is its summary. If they stay red, the call ends red: The others are set to `nicht gestartet` ("not started"), the summary carries `teillauf: true`, and the report block names, after the line `Wartezeit:`, the line `Teillauf: nur die zuletzt roten Pruefungen` ("partial run: only the most recently red checks"). A partial run therefore never appears green in the file. If the fix changes the selection, if the previous run was green or if `--frisch` is given, everything runs at once. After a fix, the same call as before is therefore enough; targeted single tests during the fix remain allowed. The waiting time of the call covers the partial run and the full run.

**The output of a red check is kept as a file.** Every command that is not green stores its complete output under `.claude/checks-protokolle/<nn>-<kurzname>.log`, numbered in config order. The report line ends with `— Ausgabe: <pfad>` ("output: <path>"), and the entry in the summary carries the field `protokoll`. That way a red can be examined without running the same run a second time, even if a session's tool output cuts out the middle (#1196). Every real run empties the folder, a carried-over one leaves it in place together with the path. If storing fails, a notice on stderr is all; the outcome of the run does not change. The night runner's leftover guard does not count the folder as abandoned work.

**A hanging check is aborted.** Every check has an abort limit: **five times the median** of its last green runs from `.claude/ausfuehrungen.tsv`, **at least 3 minutes**, **15 minutes** without a green history. If it exceeds the limit, `run` ends its whole process group, first with SIGTERM, after 5 seconds with SIGKILL. That way the abort also hits a grandchild such as `node --test` → `board.mjs`. The check is then **red** with the note `haengend: nach <s> s Grenze abgebrochen` ("hanging: aborted after <s> s limit"), in its report line, in the output and in the summary (field `haengend` with `grenzeMs`). The log records it as `rot` so that it does not shift the median of the green runs. If `checks.mjs` itself is ended (SIGTERM, SIGINT, SIGHUP), it also ends the groups of its running checks; a SIGKILL to `checks.mjs` cannot be caught. The occasion was a test that hung for half an hour in the night of 30.09.2026 until the session's tool gave up (#1077). The upper limit per check of 30 seconds (`PRUEFDAUER_OBERGRENZE_MS`, field `ueberObergrenzeMs`) remains what it is alongside: a note, never an abort.

**The check named is the one that is actually red.** The carry-over message, the [commit gate](#the-commit-gate) and the night runner's check status (`rotesKommando`) name the first command with result `rot`, and only if there is none, the first one that is not green — after a red partial run, not-started ones stand before the red group.

**The waiting time is at the top of the report block.** The block `Fuer den Abschlussbericht:` begins with the line `Wartezeit: <s> s, zusammen <s> s in <n> Laeufen fuer Karte #<n>` ("waiting time: `<s>` s, together `<s>` s in `<n>` runs for card `#<n>`"), without a card number after `--abschluss` only with `Wartezeit: <s> s`. The first number is the wall-clock time of this run from the call to the result (field `wartezeitMs`; `dauerGesamtMs` remains the sum of the individual durations). The second adds up all runs of the same card (field `wartezeitKarte`): If the previous summary carries the same card, it is added, otherwise started anew. A carried-over run counts as a run without time. At night the sum starts anew with every session, because the runner discards the summary before every round; the sum across sessions is provided by the night report.

**The evidence stays fresh.** A carried-over run rewrites the summary, with a new `zeitpunkt` and the field `uebernommen` (the point in time of the last real run). The [commit gate](#the-commit-gate) thus gets valid evidence for exactly this state. The execution log `.claude/ausfuehrungen.tsv` gets **no** line: A carried-over result is not an execution and costs no time.

**Why this is in the tool.** The night runs showed sessions that started the same green `run` three to nine times per work package — mostly without a change in between, often only to filter the output differently. The rule "write the output to a file once and read from there" has been in the skill text for a long time and did not work. By the yardstick "rule in the text or rule in the tool", it therefore belongs here.

### No lock between check runs
<!-- de: 12ffba6cae58 -->

Several check runs on the same machine run **side by side**, also from different projects. Until #1241, `checks.mjs run` took a machine-wide lock in the temp directory before its first command, and a second run waited for the first (#958, #1177). It came about because the checks were so heavy back then that two simultaneous runs overloaded the machine. Since the tools have been split into parts, the checks have become lighter and are limited to two simultaneous test files per command (initiative (Vorhaben) #1198), it is no longer needed: The load test with three simultaneous completion runs was green, each in about seven minutes (#1239). The tool no longer reads the environment variables `KIT_CHECKS_LOCK`, `KIT_CHECKS_LOCK_TIMEOUT_MS` and `KIT_CHECKS_LOCK_FOREIGN_TIMEOUT_MS`; a value that is set has no effect.

**Two phases within a run.** A run first runs the `buildChecks` entries with `"gleichzeitig": true` **concurrently**, at most two at a time (environment variable **`KIT_CHECKS_GLEICHZEITIG`**, `1` runs them one after another; anything that is not a positive integer counts as the default). The default 2 is measured (idea #1119, issue #1178): The large test groups in turn run their files in parallel, and four at once made each of them five to six times slower. On the same machine the full run took between 737 and 751 s with 4 and was red twice, 929 s with 1, 684 s with 2 — the fastest and the only value that was stably green. This phase runs to the end so that all red checks are known at once. After that, the remaining entries run one after another in config order and abort at the first red; after a red in the first phase they do not start at all. The output stands per check as a closed block in config order, even if a later one finishes first, and the report line of a check that ran concurrently carries `(neben anderen gemessen)` ("measured alongside others") after the duration — its duration is not the one it would need on its own. Without marked entries the sequence is the previous one. The settings interface does not show the axis, but leaves it in place when saving.

### Finding the slowest test files
<!-- de: 5a15c66b6751 -->

The test suite runs in every work package, in every `checks.mjs run`, in the commit gate and in CI — every second saved therefore takes effect everywhere. Node's test runner runs the **files in parallel**, the tests **within** a file one after another: From below, the slowest file therefore bounds the wall-clock time of the whole suite, and a file well above the rest should be split by topic (issue #836).

Which files those are is told by a run with the JUnit reporter. It carries the attributes `file` and `time` on every `<testcase>`; **summed per `file`**, that yields the time of the file:

```bash
node --test --test-reporter=junit > /tmp/testzeiten.xml
```

The wall-clock time itself appears as `duration_ms` at the end of an ordinary `node --test`. Because it varies from run to run, a comparison before and after a change only becomes reliable with **three runs per side and the median**.

The numbers apply to the machine on which they were measured and become outdated with every new test. Whoever needs the list collects it anew instead of extending an older one.

### The narrowing in the kit itself
<!-- de: 2f99113a5b60 -->

The kit has brought the area-based selection along for a long time, but for a long time did not use it in its own repo: Without `checkAreas` and with `node --test` as the only entry, every check status reported full scope. How the narrowing looks in a grown project can therefore be read here — with all the concessions it costs.

**Nine parts.** `nachtrunner`, `board`, `pruefungen`, `einstellungen`, `worktree`, `installer`, `skills-doku`, `konfiguration` and `preise`. They overlap on purpose, but more sparingly than before: Since issue #933, **no** part (Teil) claims the whole tool directory any more — the pattern `kit/**` once stood both in `installer` and in `skills-doku` and so pulled in the same doc, CLI, sync and installer tests with every change to any kit file. Instead, every source file under `kit/` carries the part of its measured entanglement, and since issue #936 `kit/preise.mjs` is a part of its own instead of being in three parts at once. A part is not ownership of a file but the answer to the question "which check must run if this changes?" — and more than one part may answer yes to that.

**Six test calls, not one per part.** The test suite does not fall apart into independent pieces, because the kit tools load each other: `kit/night.mjs` pulls in `board.mjs`, `checks.mjs`, `aufwand.mjs`, `wirksamkeit.mjs` and `befunde.mjs`, `.githooks/gate.mjs` loads `checks.mjs`, and almost fifty night tests name `board.mjs`. On top of that, `checks.mjs run` runs the entries without the axis `gleichzeitig` **one after another**: Every additional such entry lengthens the full scope by the start-up cost of another run that no longer parallelises its files with the others. Only marked entries run side by side in the first phase (see [No lock between check runs](#no-lock-between-check-runs)). The split therefore narrows more coarsely than the parts would allow — it remains a trade-off between the gain in the narrowed case and the surcharge in the full scope.

**What remains without a part is a statement too.** Since issue #935 every versioned source file is assigned — including `eslint.config.mjs`, `package.json`, `.claude/workflow.config.json` (a part of its own, `konfiguration`) and every helper under `test/helpers/**`, which is in the parts whose tests load it. What remains are the files for which there really is nothing to check: They are listed with a reason of their own in [`ohnePruefung`](/en/dokumentation#ohnepruefung) — `CHANGELOG.md`, `LICENSE`, the licence texts of the fonts, the note documents in the root. Whoever puts a file neither in a part nor in the exemption gets the full scope with every change to it; that is the safe direction and no punishment.

**A guard test against the gap.** The split calls bring a new kind of error, and it is silent: A test file with a prefix that none of the calls names runs **nowhere** — not before the commit, not in the commit gate, not in CI. Green would then mean "not checked". `test/config-teile.test.mjs` therefore checks the real config against `git ls-files`: every versioned test file covered by at least one call, every versioned source file in at least one part **or** in `ohnePruefung`, and no file in both at once — an exemption that a part overrides promises something in the report that does not apply. The test takes the glob resolution from `kit/checks.mjs` instead of rebuilding it — from the first divergence, a second version would attest a coverage that the executing command does not see.

Whoever introduces the narrowing in their own project needs the same guard test as soon as they spread the test suite across several entries. One part too few costs computing time; a test that is not covered costs the check.

### Quality measurement and mark: `guete`
<!-- de: b0b39cb49fb0 -->

Green tests say that the tests pass — not that they would notice anything. A project may therefore name **one** check of the list as its **quality measurement**: It measures how many deliberately planted faults the tests notice, and a value below the agreed mark holds up publishing. The naming is carried by a `guete` block with `muster` and `marke`:

```json
{
  "buildChecks": [
    "node --test",
    {
      "cmd": "mvn -q org.pitest:pitest-maven:mutationCoverage",
      "stufe": "push",
      "guete": { "muster": "Killed \\d+ \\((\\d+)%\\)", "marke": 80 }
    }
  ]
}
```

**At most one entry carries the block.** Two measurements would need a precedence rule about which mark triggers the stop, and nobody would read it. If an entry carries `guete`, its `stufe` must not be `merge` — a measurement only before the release would come too late to change anything. `checks.mjs` rejects both at start instead of choosing silently; the [settings interface](/en/dokumentation#settings-via-the-interface) checks the same rules before saving.

**The `muster` is mandatory because the tools report different things.** It is a regular expression with **exactly one group**; the group picks the measured percentage from the command's output:

| Tool | Line in the output | Pattern |
| --- | --- | --- |
| PIT (Java) | `Killed 42 (84%)` | `Killed \\d+ \\((\\d+)%\\)` |
| Stryker (JS/TS) | `Mutation score: 84.21` | `Mutation score: ([\\d.]+)` |

The captured number counts as a percentage, like the `marke` — one unit, not two. Allowed values for the mark are 0 to 100; a higher one could never be reached. If the measured share lies **on** the mark, it is sufficient.

**A value below the mark is the same stop as a red mandatory check** — no stop point of its own, no exception, no personal mark: The mark applies team-wide, a deviation in `workflow.config.local.json` has no effect. Every path without a number is treated the same way: a pattern that does not match the output, a red command, a measurement that did not even start because of an earlier red command. **A missing result never counts as a passed check.** Measured share, mark and reason appear in the output of the check run and in the completion report, at night additionally as a log line of their own.

**The stop costs no work.** It is a red run **before commit and push**: The packages already finished stay committed locally, the version bump of `/push-main` stays in place idempotently, and after the rework the same batch continues.

**Not to be confused with `mutationCommand`.** The field [`mutationCommand`](/en/dokumentation#mutationcommand) remains what it was: a command downstream of the build that `/local-check` runs and whose result ends up in the report. It is **no quality measurement** — it carries no mark, its value is not evaluated, and it triggers **no stop**. Whoever wants it binding runs their mutation test command as a `buildChecks` entry with a `guete` block, as above. Setting both at once results in two runs of the same tool, only one of which counts.

**Without the naming a project stays unaffected:** no measurement, no mark, no stop. Whoever writes nothing notices nothing of the quality measurement — not even with `mutationCommand` set.

**The measurement belongs to its stage, not into an acceptance criterion.** A work package that writes the mutation run into the card as a criterion runs it once per package instead of once per publication — and thereby costs the round time the package lacks; such a full run drove a night round exactly into the round time limit, including a lost final message. `issue check-form` therefore rejects a package whose `## Akzeptanzkriterium` names `mutationCommand` or the command of the `guete` entry (gate I6); the right place is a `buildChecks` entry with `stufe: push`.

## Settings through the interface
<!-- de: 5640e7dafde7 -->

Instead of editing the config files by hand, the process settings can be maintained through a local interface. It is **not installed** but downloaded as a single file: [einstellungen.mjs](https://docs.mwolff.org/einstellungen.mjs). It works across all projects under one folder and therefore belongs in none of them.

```bash
node einstellungen.mjs ~/ki-projects
```

**Which projects appear.** The given folder itself and every direct subdirectory, provided it contains `.claude/workflow.config.json`. Without an argument, the working directory applies. No deeper search takes place.

**The address carries the access token.** At start, the interface names an address of the form `http://127.0.0.1:<port>/#token=…`. It is reachable only from this machine, and without the token it accepts no request — not even from another page in the same browser. The token is valid until the interface is stopped with Ctrl+C.

**Ten parts.** The interface divides the settings into ten parts: reviewers, pairings, check stages, findings, check commands and areas, night chain, effort, effectiveness, task levels and simple groups. Within a part, changes collect in a working copy until they are saved or discarded; the footer of the part says how many changes are pending and which ones. A single value without a part of its own — such as `mainBranch` — gets a field of its own.

**Text block in file notation.** Only four cases remain as a text block in the notation of the file: the two night fields without an input of their own — the model list (`night.modelle`) and the deviating stage rule (`night.stufenRegel`) —, the test locations (`testAblagen`), whose entries come in two forms and therefore fit no fixed table, the place of the full run before `push main` (`pushPruefung`), which is either a fixed value or an object, and settings the kit does not know. None of them has a part of its own among the ten.

**Task levels.** The part *task levels* maintains `night.stufen` without JSON input: for each level — schwer, mittel, leicht (hard, medium, light) — a choice between *Keine*, *Modell* and *Kommando* (none, model, command). The model comes with the thoroughness that the night run passes to the Claude CLI as `--effort`; "Voreinstellung" (default) leaves it to the CLI and writes no field. Setting a level to *Keine* removes its entry — the night run then falls back to the next stronger level. Next to a foreign `kommando` there is no thoroughness, and switching to it takes `modell` and `effort` away.

**Follow-up questions for consequences.** Some changes reach beyond their own part. Renaming or removing a reviewer affects the pairings; renaming or removing an area affects the check commands that use it. A follow-up question names the affected places beforehand; the consequence is part of the same change as the triggering part and is saved or discarded together with it. An independent change to the affected other part stays untouched by this.

**Team and personal.** Where a personal deviation is allowed, the interface shows the value from `workflow.config.json` (team), the deviation from `workflow.config.local.json` (personal) and the value that applies. Only what the kit lets deviate personally can be saved personally (see "Team config and personal deviations"); a deviation can be removed again. Only the changed value is saved — `git diff` shows no reformatted file.

**Checking before saving.** The interface rejects invalid values with a reason, including those that only become invalid in combination with another setting. A setting it does not know is shown as a warning and left in place on saving. Whoever empties the mandatory checks or switches off the review duty before Ready has to confirm this explicitly. If the file has changed since loading, the interface does not save and asks whether the own change should be discarded or applied anew.

**Kit version.** A project with a newer kit version than the downloaded interface — or without a recognisable version — is read-only; a current `einstellungen.mjs` helps then.

**What it does not do.** It shows no Claude Code settings (permissions, sandbox, environment values), creates no config in a project without one, and does not check whether configured commands actually run or models are reachable. The text files remain the source; whoever prefers to work there can continue to do so.

## All settings
<!-- de: 07edcf55594f -->

<!-- einstellungen:start -->
_This section is generated from `templates/workflow.config.schema.json` by `node tools/config-referenz.mjs`; changes belong in the schema, not here._

### `codeHost`

Where the code lives (push, pull requests). Applies team-wide; a different value in workflow.config.local.json is ignored. (valid: `github`, `gitlab`, `local`)

### `issueTracker`

Where the issues are managed. May differ from codeHost. 'toolbox' is a private setup (the author's own Kanban tool), not part of the installer dialog and usable only by editing the config by hand. Applies team-wide; a different value in workflow.config.local.json is ignored. (valid: `github`, `gitlab`, `local`, `toolbox`)

### `provider`

Deprecated (v1). Migrated to codeHost/issueTracker on load. Applies team-wide; a different value in workflow.config.local.json is ignored. (valid: `github`, `gitlab`, `local`)

### `buildChecks`

Commands that /local-check runs via checks.mjs run (build, tests): first those marked "gleichzeitig" in parallel, then the rest one after another in config order. Empty array = no automated checks. An entry is either a command string or an object with an area assignment (see items and checkAreas). Applies team-wide; a different value in workflow.config.local.json is ignored.

- `buildChecks[]` — An entry takes one of four forms. (1) The bare command string "npx eslint .": unassigned, package stage, always runs. (2) { "cmd": "...", "areas": ["backend"] }: runs when one of the named areas is touched; the area names are defined in checkAreas. (3) { "cmd": "...", "always": true }: always runs, by decision. (4) { "cmd": "...", "stufe": "push" }: runs only at the named point in time — a missing "stufe" field means "paket" and thus unchanged behaviour. Forms 1 and 3 behave the same but mean different things — forgotten versus decided. An object with only "cmd" means the same as the string form. "areas" and "always" exclude each other (nobody would read a precedence rule), and "areas" needs at least one entry (an empty array would never run). "stufe" sits on an axis of its own and combines with both: areas and always say whether a check is affected, stufe says when it is due. On a third axis sits "guete": at most one entry in the list may carry the block, and it says what is measured — not whether and not when. On a fourth axis sits "nichtBeimAbschluss": it says WHY a check need not carry the completion of a single work package — it only takes effect in a run with "--abschluss", and a missing field means unchanged behaviour.
- `buildChecks[].cmd` — The command line as it would appear in the string form.
- `buildChecks[].areas` — Area names from checkAreas. The check runs when at least one of the areas is touched. Not together with "always".
- `buildChecks[].always` — true = always runs, by decision, regardless of the touched areas. Not together with "areas".
- `buildChecks[].stufe` — When the check is due: "paket" at the completion of a work package, "push" before publishing, "merge" before the release. Missing field = "paket" = unchanged behaviour. The stages are cumulative — push also runs paket, merge runs both; no mandatory check drops out of the overall process, it only runs at the point where its result counts. Not to be confused with reviewStufen (the review's levels) and the stages of the night chain. (valid: `paket`, `push`, `merge`)
- `buildChecks[].nichtBeimAbschluss` — Why this check need not carry the completion of a single work package: "zusammenspiel" = it checks how several parts work together, "volleTestmenge" = it draws its finding from the complete test set. The fourth axis next to "areas"/"always" (whether a check is affected), "stufe" (when it is due) and "guete" (what it measures) — this field says none of those, but why it may be left out at completion. It only takes effect when the call carries "--abschluss": only the implement skills set it, when completing exactly one card. Every other run includes the check, and at the latest before publishing it runs in any case. Only meaningful on an entry of stage "paket" — at "push" or "merge" the check does not run at completion anyway, and the check run aborts there. If every entry of the package stage carries this field or a guete block, completion has no gate left; that aborts too. Missing field = the check also runs at completion = unchanged behaviour. Applies team-wide; a different value in workflow.config.local.json is ignored. (valid: `zusammenspiel`, `volleTestmenge`)
- `buildChecks[].guete` — Marks this check as a quality measurement: it measures how many deliberately planted faults the tests notice, and a value below the threshold stops publishing. At most one entry in the list carries the block; if it does, its "stufe" must not be "merge" — a measurement only before the release would come too late to change anything. Without the block there is no measurement, no threshold and no stop; "mutationCommand" is something else and triggers no stop. Applies team-wide; a different value in workflow.config.local.json is ignored.
- `buildChecks[].guete.muster` — Regular expression with exactly one group; it picks the measured percentage from the command's output. Required, because the tools report different things — PIT writes "Killed 42 (84%)", Stryker "Mutation score: 84.21". The captured number counts as a percentage, like the threshold.
- `buildChecks[].guete.marke` — The percentage from which the measurement suffices. If the measured share is below it, the run is red — the same stop as for any red mandatory check, not a stop point of its own. Allowed values are 0 to 100; a higher threshold could never be reached.
- `buildChecks[].gleichzeitig` — Whether this check may run alongside others in "checks.mjs run". Marked entries run in parallel in a first phase (at most two, overridable via the environment variable KIT_CHECKS_GLEICHZEITIG), the rest afterwards one after another in config order. The parallel phase runs to the end so that all red checks are known; the following phase stops at the first red and does not start after a red in the first phase. The output appears per check as a closed block in config order, and the report notes for a duration measured in parallel that it was measured alongside others. Only for checks that do not interfere with each other (own files, own ports). Missing field = false = the check runs sequentially as before. Applies team-wide; a different value in workflow.config.local.json is ignored.
- `buildChecks[].art` — The kind of entry. "hinweis" = the check only reports and never stops: in "checks.mjs run" it always ends green — with a finding, without one and even when the tool crashes; return value, failure markers and quality measurement are not evaluated for it. Every output line of the form "Hinweis: `<text>`" appears in "hinweise" of the summary and as "hinweis: `<text>`" in the block for the completion report; if the tool exits with 2 or more, exactly one line "Hinweis-Pruefung gescheitert" (advisory check failed) with the command appears there. The effectiveness evaluation does not count such an entry as a mandatory check. Missing field = an ordinary check whose red stops the run. Applies team-wide; a different value in workflow.config.local.json is ignored. (valid: `hinweis`)

### `checkAreas`

Named areas of the project: the key is the area name, the value a list of path patterns. "areas" in the object form of a buildChecks entry points to these names. How the three forms interact: a bare command string always runs (unassigned), { "cmd", "areas" } runs only when one of the patterns stored here is touched, { "cmd", "always": true } always runs, by decision — string and always:true behave the same but mean different things (forgotten versus decided). An area without patterns covers nothing. Applies team-wide; a different value in workflow.config.local.json is ignored.

### `ohnePruefung`

Files for which there is explicitly nothing to check — the third answer next to "touches an area" and "matches no pattern, so full scope". Each entry names a path pattern (the same notation as in checkAreas) and the reason why no check reads its content; no reason, no entry, because an exception to the rule "when in doubt, everything runs" is only bearable if it justifies itself. checkAreas takes precedence: if a file matches both kinds of pattern, it counts as touched and triggers its area checks — the selection may only err towards more checking. The file stays in the evidence of the summary — in the list of changed files and under their blob hashes — and therefore passes the commit gate unchanged. Missing field = no exception = unchanged behaviour. Applies team-wide; a different value in workflow.config.local.json is ignored.

- `ohnePruefung[].muster` — Path pattern as in checkAreas: "*" within a segment, "**" across segment boundaries, "/" as separator.
- `ohnePruefung[].grund` — Why no check reads the content of this file. Appears in the report on every run and is required — an area name could not carry it.

### `gekoppelteBereiche`

Areas that a measured coupling forces into almost every check command — for example a file that almost every test group loads. Such an area stays highlighted in the evaluation and carries the note "durch Kopplung erzwungen: `<Grund>`" (forced by coupling: reason). Each entry names the area name (as in checkAreas) and the reason; no reason, no entry. Without an entry the highlighting rule applies without exception. Applies team-wide; a different value in workflow.config.local.json is ignored.

- `gekoppelteBereiche[].bereich` — Name of the area as it appears in checkAreas.
- `gekoppelteBereiche[].grund` — Which measured coupling forces the area into almost every check command. Appears as a note on the highlighting and is required.

### `testAblagen`

Where a component's own tests live — from this, issue check-form reports test hints for a plan: for each own test of a listed component that the plan does not name, one hint that affects neither ok nor the exit code. Each entry is a pair of quelle and test. Placeholders: {pfad} stands for zero or more directories ({pfad}/ may be empty), {name} for the file name without extension, * in the test pattern for any characters within one path segment. Without the field the kit's defaults apply: TypeScript {pfad}/{name}.ts and .tsx with {name}.test and {name}.spec next to them, Java src/main/java/{pfad}/{name}.java with src/test/java/{pfad}/{name}Test.java. An array replaces the defaults; the entry { "vorgaben": true } inserts them at its position instead of copying them; [] switches the test hints off. Multi-module projects add one location per module with a fixed prefix, for example backend/src/main/java/{pfad}/{name}.java → backend/src/test/java/{pfad}/{name}Test.java. Deliberately without a default value: if the field is missing, the defaults apply, and that is something other than [].

- `testAblagen[].quelle` — Pattern of the source file, for example src/{pfad}/{name}.ts.
- `testAblagen[].test` — Pattern of its own test, with the same placeholders and * within a segment, for example src/{pfad}/{name}*.test.ts.
- `testAblagen[].vorgaben` — Inserts the kit's defaults at this position.

### `nurGeruest`

Paths that test files only create as scaffolding — mentioning them in a test file proves no coupling. The coupling survey (tools/verflechtung.mjs) counts every mention of a source path in the text of a test file as coupling; for the coverage check that errs on the safe side, for the selection of check commands it no longer does: a test that writes its own .gitignore or package.json into a throwaway repository is not thereby coupled to the file of the same name in this project. Each entry names a path pattern (the same notation as in checkAreas) and the reason why no check reads this path; no reason, no entry. The pattern applies against the source path and thus to all test files at once: anything that even a single test file really checks does not belong here — entering it would make the coverage check blind at this point, and silently so. Missing field = no exception = unchanged behaviour. Applies team-wide; a different value in workflow.config.local.json is ignored.

- `nurGeruest[].muster` — Path pattern as in checkAreas: "*" within a segment, "**" across segment boundaries, "/" as separator.
- `nurGeruest[].grund` — Why no test file checks this path but at most creates it as scaffolding. Required, and proven rather than claimed: the place where it was looked up belongs with it.

### `mutationCommand`

Command for mutation tests (optional). Empty string or missing field = no mutation test. Applies team-wide; a different value in workflow.config.local.json is ignored.

### `guetekommandos`

Further commands or command prefixes that start a quality measurement (optional). Gate I6 of "issue check-form" rejects a work package whose acceptance criterion names one of them — in addition to "mutationCommand" and the command of a buildChecks entry with a "guete" block. The route for a measurement driver the project has yet to build: it cannot be a check yet, but its prefix is already listed here, and a full run therefore does not slip into a package's acceptance criterion. Applies team-wide; a different value in workflow.config.local.json is ignored.

### `formatFixCommand`

Command that fixes formatting violations mechanically (e.g. 'mvn spotless:apply' or 'npx prettier --write .'). Only the night runner uses it: if the buildChecks are red in the salvage pre-check, it runs exactly once and the checks are repeated exactly once, so that a pure formatting violation does not end a whole run. Empty string or missing field = no format fix. Applies team-wide; a different value in workflow.config.local.json is ignored.

### `installCommand`

Command that sets up the project's dependencies in the project directory (e.g. 'npm ci', 'uv sync', 'mvn -q dependency:go-offline'). 'worktree.mjs anlegen' runs it in the fresh worktree after creating it — the worktree carries only what is versioned and has no node_modules, .venv or vendor/, and a mandatory check that fails because of this silently delivers a wrong measurement. If it ends with an error, the worktree is torn down again. Empty string or missing field = no installation; the caller is then responsible for it. Applies team-wide; a different value in workflow.config.local.json is ignored.

### `mainBranch`

Branch for local commits and push (step 8). Applies team-wide; a different value in workflow.config.local.json is ignored.

### `productionBranch`

Target branch for the PR in step 9 (merge production). Applies team-wide; a different value in workflow.config.local.json is ignored.

### `pushPruefung`

Where the full check run before 'push main' takes place. 'lokal' (default): /push-main runs it with 'checks.mjs run --stufe push' on your own machine. An object with ort 'buildDienst' moves it to the project's build service: /push-main pushes the state to the check branch, waits for the result via 'board.mjs code ci-status --commit' and pushes mainBranch only on green. The obligation is the same in both places — green before the push; productionBranch stays untouched. On the check branch the build service must run the same mandatory checks as the local run of stage push. Applies team-wide; a different value in workflow.config.local.json is ignored. (valid: `lokal`)

- `pushPruefung.ort` — The place of the full run: the project's build service. (valid: `buildDienst`)
- `pushPruefung.zweig` — The check branch to which /push-main pushes the state before the push and which it deletes again afterwards. Not mainBranch and not productionBranch.

### `reviewScope`

Scope of the review material: 'diff' = git diff since the last push; 'full' = the entire source code. May be overridden personally in workflow.config.local.json. (valid: `diff`, `full`)

### `reviewModel`

The Claude variant of the reviewer pair reviewModel/reviewCommand: model ID for the reviewer subagent (Opus pin). Must be a valid Claude model identifier. Exactly one of the two fields is set — a foreign CLI belongs in reviewCommand. May be overridden personally in workflow.config.local.json.

### `reviewCommand`

The foreign variant of the reviewer pair reviewModel/reviewCommand: command line of a foreign CLI (e.g. 'codex exec --model gpt-5') that receives the review prompt via stdin and writes its answer to stdout. Exactly one of the two fields is set; 'set' means the key is present — an empty string is invalid, not 'not set'. May be overridden personally in workflow.config.local.json.

### `triggers`

Trigger phrases for the three human stop points. May be overridden personally in workflow.config.local.json.

- `triggers.go` — Phrase for the GO to implement.
- `triggers.push` — Phrase for the push to mainBranch (step 8).
- `triggers.merge` — Phrase for the PR to productionBranch (step 9).

### `local`

Settings for the local issue tracker (issueTracker: 'local'). Applies team-wide; a different value in workflow.config.local.json is ignored.

- `local.issuesDir` — Directory of the issue Markdown files, relative to the project root.

### `columns`

Mapping of the internal statuses to board column or label names. Only relevant for the GitLab adapter: there 'done' is always the native state Closed (regardless of the name entered here). 'backlog' is the native state Open if exactly "Open" is entered here — otherwise an ordinary label. Applies team-wide; a different value in workflow.config.local.json is ignored.

- `columns.backlog` — GitLab special value "Open": backlog is treated as the native Open state instead of a label.
- `columns.ready` — Name of the column or label for Ready — released, the human's GO.
- `columns.in_progress` — Name of the column or label for In progress — the work package currently being worked on.
- `columns.in_review` — Name of the column or label for In review — done locally, not yet pushed.
- `columns.done` — Display name only for GitHub/local. GitLab always treats done as the native Closed state.

### `github`

GitHub-specific settings. Applies team-wide; a different value in workflow.config.local.json is ignored.

- `github.projectNumber` — Number of the GitHub Project board (gh project list). Required for board status operations.

### `toolbox`

Settings for the Toolbox issue tracker (issueTracker: 'toolbox'). The author's private setup (own Kanban tool), not part of the installer dialog. Applies team-wide; a different value in workflow.config.local.json is ignored.

- `toolbox.host` — Base URL of the Toolbox instance.
- `toolbox.tokenFile` — Path (relative to the project directory) to a file holding the project- or board-bound token. Precedence: TBX_TOKEN environment variable > tokenFile > global tbx login (~/.config/toolbox-cli/tokens.json). No plain-text token in this config — board.mjs aborts in that case. May be overridden personally in workflow.config.local.json.
- `toolbox.ideaStored` — Routes new issues into the board's idea store instead of straight into the backlog. true sends no 'direct' and creates a board-less idea in the pool; false or a missing value sends 'direct: true' and creates the issue at once with a board number — that is the default. The wire field 'ideaStored' sent in the past is no longer sent in any mode — the server ignores it. Backends without 'direct' keep their previous behaviour.

### `issueReview`

Issue review across several models. Reviewers who did not write the document read it; how many per level is set by reviewStufen. Applies team-wide; a different value in workflow.config.local.json is ignored. The former fields rounds and statusLabels were dropped with stage 2 of the process rework and are ignored without error in an existing config.

- `issueReview.requiredBeforeReady` — If true, the night runner moves Ready issues without a review marker back to the backlog with a comment. Default false, so that a kit update does not stop the runner of any existing project overnight.
- `issueReview.reviewers` — The order is the control: the frontmost entries that are not the author are taken; how many is set by reviewStufen.
- `issueReview.reviewers[].name` — Short name, compared with the issue's author model.
- `issueReview.reviewers[].kind` — 'claude' runs as a subagent via the Agent tool, 'command' as any foreign CLI (prompt via stdin). (valid: `claude`, `command`)
- `issueReview.reviewers[].model` — Only for kind 'claude': model identifier.
- `issueReview.reviewers[].command` — Only for kind 'command': command line, e.g. 'codex exec --model gpt-5'.
- `issueReview.pairs` — Explicit mapping author -> reviewer. If the author is listed here, their entry wins over the order rule. Without pairs the rule always picks the frontmost entries — a foreign model further back would never get its turn. A name that does not exist in reviewers and an author who names themselves are hard errors.

### `reviewStufen`

Staffing and perspective of the three review levels: the functional concern, the plan to get there, the single work package. While issueReview describes WHO reviews at all, this states how many review per level and in which roles. 'rollen' must contain exactly 'reviewer' distinct, non-empty names — otherwise a hard error. If the whole block is missing, every level uses reviewer 2 with the roles 'vollstaendigkeit-pruefbarkeit' and 'scope-risiko-bestand'; if only one level is missing in an existing block, that is an error. Applies team-wide; a different value in workflow.config.local.json is ignored.

- `reviewStufen.fachlich` — Review of the functional concern ([Fachlich] issue) before a plan is made from it.
- `reviewStufen.fachlich.reviewer` — How many reviewers review this level.
- `reviewStufen.fachlich.rollen` — One role name per reviewer, in the order of assignment.
- `reviewStufen.plan` — Review of the plan document ([Plan] issue) before it is split into work packages.
- `reviewStufen.plan.reviewer` — How many reviewers review this level.
- `reviewStufen.plan.rollen` — One role name per reviewer, in the order of assignment.
- `reviewStufen.issue` — Review of the single work package before the GO. Only one reviewer: form and cut have already been reviewed on the two levels before.
- `reviewStufen.issue.reviewer` — How many reviewers review this level.
- `reviewStufen.issue.rollen` — One role name per reviewer, in the order of assignment.

### `night`

Night mode. The night chain under kette, the list of allowed model names under modelle. Applies team-wide; a different value in workflow.config.local.json is ignored.

- `night.kette` — Budgets and markers of the night chain (night.mjs --kette). A functional requirement or a plan document carrying the label goes in in the evening; every number is a reason to stop with the reason in the report, not a failure of the process.
- `night.kette.label` — The marker on the functional requirement or the plan document that starts the chain. Each time it is set it authorises exactly one chain; the start consumes it.
- `night.kette.varianteBLabel` — The marker that flags the marked card for the chain's implementation stage (variant B).
- `night.kette.planMin` — Time budget of the plan stage in minutes, including correction rounds.
- `night.kette.paketeMin` — Time budget of the packages stage in minutes, including correction rounds.
- `night.kette.reviewMin` — Time budget of the reviewer session on the plan in minutes.
- `night.kette.abdeckungMin` — Time budget in minutes of the coverage session that holds the packages against the functional plan.
- `night.kette.umsetzungMin` — Time budget of the implementation stage (variant B) in minutes, across all implementation sessions of the chain.
- `night.kette.vorbereitungMin` — Deadline for preparing the push in minutes, waiting and check run included: this is the longest it waits until nothing is building any more in the night. If the deadline expires, the result is nicht-vorbereitet (not prepared).
- `night.kette.kostenUsd` — Cost budget per chain in US dollars, summed over all sessions of the chain; checked after every session.
- `night.kette.kostenUsdB` — Cost budget per chain in US dollars for the implementation stage (variant B), summed over all sessions of the chain; checked after every session.
- `night.kette.korrekturrunden` — Maximum number of correction sessions per document after a red form check.
- `night.kette.uebergaenge` — Which transitions of the chain may follow automatically. A blocked transition ends with lauf:wartet and 'wartet: Übergang `<x>` im Projekt nicht freigegeben — weiter mit kit:night' (waiting: transition not released in the project); a new kit:night resumes at the waiting stage. If the block or a field in it is missing, the behaviour from before the setting applies: the first three transitions follow, and a card with the variant B label is implemented after the coverage.
- `night.kette.uebergaenge.planReview` — After the plan, the review of the plan follows automatically.
- `night.kette.uebergaenge.reviewPakete` — After the review of the plan, the work packages follow automatically.
- `night.kette.uebergaenge.paketeAbdeckung` — After the work packages, the coverage against the functional requirement follows automatically.
- `night.kette.uebergaenge.abdeckungUmsetzung` — After the coverage, the implementation follows automatically. Only takes effect together with the variant B label on the card: the GO can never be given project-wide. Without an entry the behaviour from before the setting applies: a card with the variant B label is implemented, one without it ends after the coverage. With true a card without the label waits with 'wartet: Karte ohne Freigabe zur Umsetzung' (waiting: card not released for implementation), with false a card with the label waits with 'wartet: Übergang abdeckungUmsetzung im Projekt nicht freigegeben — weiter mit kit:night' (waiting: transition not released in the project).
- `night.kette.uebergaenge.umsetzungVorbereitung` — After the implementation, the preparation of the push follows automatically if the card's goal reaches that far. A project that says nothing allows the transition; only an explicit false stops the chain before it. An implementation found already done in this run does not block. The preparation does not push; the GO to push stays with the human.
- `night.stand` — The run status: how a card of a chain or an implementation night shows its status on the board (board.mjs issue stand). At most one of the three labels is attached, plus exactly one comment '## Laufstand'. If the block or a field in it is missing, the defaults apply.
- `night.stand.labels` — The names of the three run status labels. They must exist on the board; the adapter reports a missing label as an error.
- `night.stand.labels.laeuft` — Label of a card a run is currently working on.
- `night.stand.labels.abgebrochen` — Label of a card aborted for technical reasons: repeating is enough.
- `night.stand.labels.wartet` — Label of a waiting card; what it is waiting for is stated verbatim in the run status.
- `night.stand.fristMin` — Detection deadline in minutes from a run's last sign of life; after that its card shows the last status with the addition 'nicht beendet' (not finished).
- `night.stand.pauseMin` — Pause in minutes before the one automatic attempt after an environment error of the live run.
- `night.modell` — The model of the night run: it starts every session that has no model of its own — the plan, review and coverage stages of the chain, the correction rounds and every package without a task level. Precedence: --model on the call, then this field, then the runner's default. Must also be listed in night.modelle, otherwise the runner stops before starting. Only applies from the shared configuration; a value in the personal file is ignored.
- `night.modelle` — The model names the night runner may start — ordered, descending by strength: the first entry is the strongest, the last the fastest model. The order is not cosmetic: /issues derives from it which model it recommends for a work package, and at night nobody asks. The pattern ^claude- is also the safeguard — without the list a value from an issue body would go into argv unchecked, and a package with '--dangerously-skip-permissions' would be an attack via a card. If the field is missing or the list is empty, every session starts with the run's model.
- `night.stufen` — Model or command per difficulty level of a work package, ordered schwer/mittel/leicht (hard/medium/easy). If a level is missing, the night run falls back to the next stronger one, if need be up to the run's own model. Only takes effect in the night run — during the day the human chooses their model themselves. A modell must also be listed in night.modelle (otherwise an error in the configuration check).
- `night.stufen.schwer` — Model or command for a hard task. Exactly one of the two fields is set.
- `night.stufen.schwer.modell` — Model ID for this level. Must also be listed in night.modelle.
- `night.stufen.schwer.effort` — Thinking effort for this level, passed to the Claude CLI as --effort. Without the field the CLI's default applies. Only allowed next to modell — the kit cannot set an effort for a foreign program next to kommando. (valid: `low`, `medium`, `high`, `xhigh`, `max`)
- `night.stufen.schwer.kommando` — Command line of a foreign program for this level — a project artefact with the same level of trust as reviewCommand; the pattern ^claude- does not apply here.
- `night.stufen.schwer.name` — The program's self-description next to kommando.
- `night.stufen.mittel` — Model or command for a medium task. Exactly one of the two fields is set.
- `night.stufen.mittel.modell` — Model ID for this level. Must also be listed in night.modelle.
- `night.stufen.mittel.effort` — Thinking effort for this level, passed to the Claude CLI as --effort. Without the field the CLI's default applies. Only allowed next to modell — the kit cannot set an effort for a foreign program next to kommando. (valid: `low`, `medium`, `high`, `xhigh`, `max`)
- `night.stufen.mittel.kommando` — Command line of a foreign program for this level — a project artefact with the same level of trust as reviewCommand; the pattern ^claude- does not apply here.
- `night.stufen.mittel.name` — The program's self-description next to kommando.
- `night.stufen.leicht` — Model or command for an easy task. Exactly one of the two fields is set.
- `night.stufen.leicht.modell` — Model ID for this level. Must also be listed in night.modelle.
- `night.stufen.leicht.effort` — Thinking effort for this level, passed to the Claude CLI as --effort. Without the field the CLI's default applies. Only allowed next to modell — the kit cannot set an effort for a foreign program next to kommando. (valid: `low`, `medium`, `high`, `xhigh`, `max`)
- `night.stufen.leicht.kommando` — Command line of a foreign program for this level — a project artefact with the same level of trust as reviewCommand; the pattern ^claude- does not apply here.
- `night.stufen.leicht.name` — The program's self-description next to kommando.
- `night.stufenRegel` — Replaces the built-in rule by which /issues and /task determine the level of a work package. If the field is missing or the text is empty, the kit's rule applies.
- `night.zielUmsetzungMin` — Target for the duration of an implementation in minutes; the report shows how many packages stayed below it. The target applies to the chain's implementation stage and to the implementation night, which is why it sits next to night.kette and not inside it. Switching it off is not intended — if the field is missing, the default applies.

### `pruefLauf`

The review run: a run during the day that has several marked functional requirements reviewed one after another without anyone watching. It sits in a block of its own and not under night because it belongs to the day; under night the name would claim the opposite. Optional — if the block or a field in it is missing, the built-in defaults apply. Applies team-wide; a different value in workflow.config.local.json is ignored.

- `pruefLauf.label` — The marker on the functional requirement that the run has reviewed. Each time it is set it authorises exactly one review; the run removes it immediately before the session for this card.
- `pruefLauf.pruefungMin` — Time budget of the reviewer session per card in minutes. It is above that of the plan stage because the functional level runs two reviewers.
- `pruefLauf.kostenUsd` — Cost budget per run in US dollars, summed over all sessions of the run; checked after every session, never in the middle of one. Once it is used up, the remaining cards count as skipped and keep their marker.

### `aufwand`

The effort of the process (unattended runs): how many result records the evaluation considers and from which thresholds it reports a finding. The finding is not a gate; it holds up no run and no publishing. Optional — if the block or a field in it is missing, the built-in defaults apply, so that an existing project gets the evaluation without further setup. Applies team-wide; a different value in workflow.config.local.json is ignored.

- `aufwand.laeufe` — The maximum number of the most recent completed result records the evaluation includes, most recent first.
- `aufwand.schwellen` — From which share the evaluation reports a finding.
- `aufwand.schwellen.pruefungAnteil` — Share of the total check time that the largest single mandatory check may take before a finding appears. A value between 0 and 1.
- `aufwand.schwellen.eingrenzungOhneWirkung` — Whether a finding appears when narrowing the checks by area was measured but never took effect.
- `aufwand.schwellen.werkzeugAnteil` — Share of the total running time that pure tool work may take before a finding appears. A value between 0 and 1.
- `aufwand.schwellen.schreibkostenAnteil` — Share of the total costs that the costs of the third item (writing) may take before a finding appears. A value between 0 and 1.

### `wirksamkeit`

The effectiveness of the checks: over which time window the evaluation counts executions and objections, and from which counts and thresholds it reports a finding. The finding is not a gate; it holds up no run and no publishing. Optional — if the block or a field in it is missing, the built-in defaults apply, so that an existing project gets the evaluation without further setup. Applies team-wide; a different value in workflow.config.local.json is ignored.

- `wirksamkeit.fensterTage` — How many days back the evaluation counts. The window is cut off at the start of data collection so that it never reaches further back than data exist.
- `wirksamkeit.nieBeanstandetAbAusfuehrungen` — From how many executions in the window a check that has never objected becomes a finding. Below that, 'nothing found' is no statement but too little experience.
- `wirksamkeit.quoteSchwelle` — From which return rate a finding appears. Counted are return movements per card that entered In review; a card that went back several times counts several times, so the rate can exceed 1. The threshold itself is a value between 0 and 1.
- `wirksamkeit.quoteAbPaketen` — From how many evaluated work packages in the window the return rate may trigger a finding. Below that, the rate is read from too few cards.
- `wirksamkeit.kandidatenMax` — The maximum number of cards the return rate evaluates, most recent entries into In review first. The cap keeps the evaluation affordable on a large movement log.

### `befunde`

Recurring findings of the model reviews: from how many occurrences a proposal arises from them. Applies to all reviews that record findings — the issue review as well as the code review, which does not sit under issueReview; hence a block of its own. Optional — if the block or the field in it is missing, the built-in default applies. Applies team-wide; a different value in workflow.config.local.json is ignored, because two people with different thresholds in the same project would produce different proposals from the same findings. A proposal card that can no longer be found counts as done: counting then starts from its state, and a new proposal carries only the findings after it.

- `befunde.schwelle` — From how many occurrences of the same finding a proposal arises. Below that, a finding is a single case and not a rule.
<!-- einstellungen:ende -->

## The sixteen skills and the 9-step core process
<!-- de: 08a3721168e6 -->

The process has **nine** steps, seven of them with a skill. The remaining nine skills are tools alongside it: helpful, often used — but the process runs without them too.

| Step | What | Who | Skill |
|---------|-----|-----|-------|
| **1** | **Formulate the requirement** | **Human** | (no skill) |
| 2 | Plan the requirement | AI | /techplan |
| 3 | Create issues | AI | /issues |
| **4** | **GO: pull issues to Ready** | **Human** | (no skill) |
| 5 | Implement Ready issues | AI | /implement-ready |
| 6 | Run local checks | AI | /local-check |
| 7 | Carry out the review | AI | /review |
| **8** | **Push to main** | **Human** | /push-main |
| **9** | **Merge to production** | **Human** | /merge-production |

Between step 8 and step 9 you check the test server in the browser — no skill of its own, but mandatory. This numbering is the same as in `CLAUDE-workflow.md` and in the skill definitions.

### Tools alongside the process
<!-- de: f1ed3591fab6 -->

They carry no number, because a number would claim an order and an obligation that do not exist. The nine steps are the process from the whitepaper; what is listed here is a tool of the kit.

**Supplement the process**

| Skill | What for |
|-------|-------|
| `/kontext` | Session start: load the vault, project status |
| `/fachplan` | Requirement as a business issue for grooming with the PO |
| `/issue-review` | have a business requirement (fachliche Anforderung), plan document (Plandokument) **or** work package reviewed — one command, three stages |
| `/retro` | AI retrospective, consolidate memory |
| `/document` | Session end: daily log and project note |

**Replaces steps 2 and 3**

| Skill | What for |
|-------|-------|
| `/task` | Requirement without need for weighing up as a single work package `[Task]` |

`/task` deliberately does **not** appear in the table above: the skill does not supplement the process, it replaces two of its steps — the business concept (Fachkonzept) and the plan are dropped on this path.

**Replace step 5 with a finer gait**

| Skill | What for |
|-------|-------|
| `/implement-next` | exactly one Ready issue instead of the whole column |
| `/implement-test` | only the red tests, stop before the implementation |
| `/implement-done` | implementation against the prepared red tests |

Whoever introduces the kit can start with the nine steps and add the tools later. Conversely: whoever builds the next useful skill enters it here — not as an intermediate number.

### /kontext
<!-- de: c89231e515ea -->


**Tool alongside the process, session start.**

The skill loads the context you need to be ready to work immediately, without having to keep the chat of the last session in your head. It reads `kontext.config.json` (first globally from `~/.claude/`, then locally from `.claude/`, with local values overriding the global ones).

If a vault is configured, it loads the `always` files from it (profile, working rules), recognises the project note automatically from the repo name and reads additional `projectDocs`. Without a vault, it fetches the initiatives through the board adapter and reads `projectDocs` from the repo. The output is a short situation overview: running initiatives, recent decisions — of these only the most recent day documented in the project note — and what comes next. The individual work packages are on the board; the session start does not repeat them.

### /fachplan
<!-- de: c625a259068c -->

**Tool alongside the process, before step 2 — only for projects with a product owner ([PO loop (PO-Schleife)](/en/dokumentation#po-loop-business-and-technical-issues)).**

The skill turns a raw requirement (dictated, from an email, from the chat) into exactly one **business issue**: title with the prefix `[Fachlich]`, body in story format (goal, business acceptance criteria, non-goals, open questions to the PO) — strictly free of technology, in PO language. The issue is the hand-over artefact to the PO and is groomed directly on the board — the PO's answers and additions belong in the **body**, not in comments — the body carries the negotiated state, comments the history. (`board.mjs issue get` now returns the comments as well, but a requirement you have to piece together from a discussion has no unambiguous state.)

Before creating it, `issue check-form` checks the form of the business issue. The skill creates no technical plan and no technical issues; those come after the PO's approval through `/techplan #N`. Whoever has no PO skips this step and starts with `/techplan` as usual.

### /task
<!-- de: f1126a942979 -->

**Replaces steps 2 and 3 — the entry into [lane 3](/en/dokumentation#three-lanes).**

Between a trifle and a full initiative there was no path. Lane 1 demands exactly one file, lane 2 demands a business concept, a plan and a breakdown. A renaming across twelve files is too big for the one and too unambiguous for the other — there is nothing to weigh up there, so there is nothing to plan either.

For this, `/task` creates **exactly one work package**: title with the prefix `[Task]`, body in the four-section format like every package from `/issues`, status Backlog. After that the normal path continues — GO, implementation, review, push. Whoever wants to have the task reviewed first calls `/issue-review #N` themselves.

Four properties distinguish it from `/techplan`:

- **It asks before it creates.** The skill names the lane in one sentence and waits for a word from you. Unattended (with `KIT_AGENT_MODEL` set, i.e. in night mode (Nachtbetrieb)), it ends at this point and creates **nothing**: a choice of lane that confirms itself is no longer a choice. That is why no `[Task]` can arise at night — `/techplan` records a lane-3 verdict as a plan instead.
- **It takes only two sources.** The chat or an `[Idee]` (`/task #N`). It rejects a `[Fachlich]` or `[Plan]` document without creating anything: there the full path has already begun, and a `[Task]` next to it would be a second truth about what gets built. If the task arose from an idea, a comment `Fortsetzung: Issue #T` (continuation: issue #T) remains on the idea.
- **It has no ancestor.** No `--derived-from`, no `Plan:` line and no `Fachliche Quelle:` line.
- **It decides instead of asking.** Whatever is unclear while writing the package and is not in the stop class (Stopp-Klasse) from `CLAUDE-workflow.md`, the skill decides itself and records it as an `Entscheidung:` line in the context. Only a question from the stop class goes to you.

**A `[Task]` is a work package, not a document.** It is implemented and pulled to Ready like a package without a prefix, and falls into the stage `issue` when reviewed. That distinguishes it from `[Fachlich]`, `[Plan]` and `[Idee]`, which are never implemented.

### /techplan
<!-- de: 7ccf13c7837f -->


**Step 2, after the requirement (step 1), before the implementation.**

You give the requirement, the skill produces a plan. The plan names the goal and the effect on users, affected areas and files, architectural decisions with reasons, open questions and the planned verification. Under "Open questions" there are only questions of the stop class from `CLAUDE-workflow.md`; everything else the skill decides and logs as an E entry under the architectural decisions. Before creating it, `issue check-form` checks the form of the plan document. Then it puts the plan up for discussion.

The skill implements nothing. **It does not create technical issues** — they only arise in `/issues`, after your GO. It waits for your feedback. The plan is a basis for discussion, not an assignment and not yet an approval.

There is one exception: as soon as you approve the plan, for lane 2 the skill itself creates the plan document as an issue with the title prefix `[Plan]` — with the plan as the body, `Plan-Modell:` in the header and, if the plan arose from `/techplan #N` against a business issue, `Fachliche Quelle: Issue #N`. It records the approved state instead of implementing it: what was decided between requirement and work packages — architecture, cut, trade-offs — would otherwise be written down nowhere. `[Plan]` issues are never implemented (see the gate further below); they are broken down with `/issues #N`. For lane 1 no plan document arises.

### /issues
<!-- de: c7a6927dbb1f -->


**Step 3, after the plan approval.**

The approved plan becomes one or more issues. Each issue is small enough to be tested on its own and contains four sections: context (why), task (what exactly), acceptance criterion (how it can be checked) and dependencies (what must be finished first).

From this point on, the issue is the source of truth (not the chat, not your memory, not the plan text). The issues land in the backlog. The skill decides ambiguities outside the stop class and records them as an `Entscheidung:` line in the package's context; before creating them, `issue check-form` checks every package. A package review is no longer the rule — whoever wants one calls `/issue-review #N`.

**What the night run reads as a dependency.** The section `## Abhängigkeiten` contains `Keine.` (none) or references of the form `Issue #N`. Every local `#N` in the section counts as a dependency, including in explanations: "Nicht #N: …" (not #N: …) holds the package back just as much as `Issue #N`. Only references of the form `owner/repo#N` do not count. A reference line begins, after optional whitespace and an optional list marker (`-`, `*`, `+`, `1.`), with `Issue #N` and carries no further local number; every other number comes from explanatory text, including one in the section's code block. The addition `(wartet auf Push)` (waits for push) after the reference line says that the package needs the changed tool, skill or rule text of the other package as a tool and can only run after its push; if it merely builds on its code, the addition is dropped. When writing, `issue check-form`, `issue create` and `issue update` report under `hinweise` one entry `schreibweise` for each number from text and one entry `dokument` for each reference to a document (`[Plan]`, `[Fachlich]`, `[Idee]`), including one from a reference line. The package is created anyway; `ok` and the exit code remain unaffected. `/issues` and `/task` read the entries: they correct an unintended number before creating the package, an intended one stays and is mentioned in the conclusion. The document notice says: the document is not a work package and is not completed by implementation — a plan document never, a business requirement or idea only once its packages are finished. The night run still counts the reference as a dependency. The dry run and the deferral comment name, for each dependency, met or unmet, its origin (reference line or explanatory text) with the passage. If packages hold each other back, directly or through a chain, the cycle finding appears as a line of its own `Kreis: #A -> #B -> #A` (cycle: …); a package that is not itself in the cycle but hangs on it through its unmet dependencies gets the addition "dieses Paket wartet auf einen Kreis" (this package waits on a cycle). How that looks in the night run is described under [Night mode](/en/dokumentation#night-mode).

Every created issue carries in its context section the line `Empfohlenes Modell: <name>`, with the name from `night.modelle` — first entry of the list for architecture and security logic, last for mechanical tasks. **In night mode it takes effect by itself:** the runner starts the session of this card with this model. If the list is missing, the line is dropped without replacement. In conclusion the skill also lists the issues with the same recommendation and one sentence of reasoning each in a table — so before the GO you see what would run with what, without reading the plan context again, and you can change the line in a package before you pull it to Ready.

**If `night.stufen` is active** (see [model choice of the night run](/en/dokumentation#night-mode)), every package instead carries the lines `Aufgabenstufe: <schwer|mittel|leicht>` and `Stufengrund: <ein Satz>` and **no** `Empfohlenes Modell:` line — `Autor-Modell:` stays next to them; it is a statement of origin, not a recommendation. The built-in rule, stated exactly once in the kit: **schwer** (hard) for architecture, security or complex interaction logic, **mittel** (medium) for changes in several places following an existing pattern, **leicht** (light) for mechanical, clearly delimited changes; a populated `night.stufenRegel` replaces this rule project-wide. The level applies regardless of when and by which path a package arises — including packages from the night chain. The same path applies to `/task`: if `night.stufen` is active, a `[Task]` package also carries `Aufgabenstufe:` and `Stufengrund:` instead of `Empfohlenes Modell:`, following the same rule.

**Cross-reading adopted review findings.** Before cutting, `/issues` reads the plan's comments, above all `## Einarbeitung, Runde 1` (incorporation, round 1). After cutting, it checks for each adopted finding whether it arrives in at least one package — as a task, an acceptance criterion or an `Entscheidung:` line. Whatever would be lost appears in the conclusion under "Nicht übertragene Review-Funde" (review findings not carried over), at night as a comment on the plan. Otherwise a refinement from the plan review easily gets only as far as the plan and not as far as the implementation.

### Step 4: GO (human)
<!-- de: ac8f9ce5f866 -->

You pull the issues you want to implement in the current batch to Ready on the board. That is your decision: how much work you release and what goes into this pass. The AI never pulls issues to Ready on its own.

### /implement-ready
<!-- de: 3a6d57a91758 -->

**Step 5, after the GO.**

The skill reads the Ready column in board order (top first) and works through it sequentially. Per issue: move the board to In progress, read the issue completely, write code and tests against the issue (test-driven: tests first, red, then implement until green), run the affected checks **before the commit** (`node .claude/kit/checks.mjs run`, anchor `HEAD`, i.e. exactly this work package), commit locally, move the board to In review. Then the next issue. When Ready is empty, the skill reports completion.

**The last package of an initiative.** If a run brings the last open package of a plan to In review, the final message — with `/implement-ready` as with `/implement-next` — begins with `## Stand des Vorhabens` (state of the initiative): first what a user sees now, then what of the occasion according to the business source and the `Vorlage:` line is not included, only after that commits and checks. The skill fetches the source from the board. Green means "fulfils what was written down", not "fulfils what was meant" — whoever reads what is missing further down takes the initiative for finished. At night, the section stands at the beginning of the completion report of the last package.

Two fixed limits: the skill never pushes. It does not pull backlog issues to Ready on its own.

### /implement-test and /implement-done
<!-- de: 0e2ab0f62d20 -->

**Granular entry to step 5, for beginners.**

`/implement-ready` handles the test and the implementation of an issue in one go. Whoever wants to see the red-green transition deliberately uses two skills one after the other instead: `/implement-test` takes the next Ready issue, moves it to In progress and writes only the tests against it — no production code, no commit. If an issue is already running in In progress, the skill stops and refers to `/implement-done`.

`/implement-done` finds the running issue through the In progress column, implements against the prepared tests until they are green, runs the affected checks before the commit and commits tests and implementation together — format and stop points identical to `/implement-ready`.

### /implement-next
<!-- de: 30c0c3155bce -->

**Exactly one issue — the building block of night mode.**

The single-issue variant of `/implement-ready`: takes exactly one Ready issue, implements it, runs the affected checks before the commit, commits locally, moves it with a completion report to In review — and ends. No further issue, even if Ready is still full. With an empty Ready, the skill reports this and ends without an error.

Which issue is next is decided by the argument. `/implement-next` without an argument takes the topmost Ready issue (board order). `/implement-next #N` is a **binding assignment**: the skill works exclusively on this issue and never switches to another — if `#N` is no longer in Ready, the run ends without a result and with a clear message. That keeps the selection in exactly one place: the client has already filtered by routing label, dependencies and board order and measures success by this issue.

Delimitation: `/implement-ready` works through the whole column in one session; `/implement-test` and `/implement-done` split an issue into a red and a green phase; `/implement-next` does one complete issue and then stops. Interactively it is the "do exactly one" variant — it plays its main role in [night mode](/en/dokumentation#night-mode), where the night runner starts a fresh session with exactly this skill for each issue.

### /issue-review
<!-- de: 771e76229b27 -->

**Tool alongside the process — has the business plan and the plan read by other models.**

Models that did not write the document deliver findings as a comment; the calling session incorporates them or rejects them with one sentence, writes the stage's marker as a trace and sets the label `review:fertig` as a visible trace on the board (to be created once per board; a finding of the stop class sets `kit:klaeren` instead). Which roles and how many reviewers is said by `reviewStufen`; `issue check-form` checks the form beforehand. Work packages are reviewed only on explicit request; the rule is Ready, not a package review. Details under [Issue review across multiple models](/en/dokumentation#issue-review-across-multiple-models).

`review:fertig` is at the same time a prerequisite of the night chain: without the label on the business plan, the chain skips the requirement (see [Second mode: the night chain](/en/dokumentation#second-mode-the-night-chain)). The label remains a mere trace and does not release the content — if a requirement is still changed substantially after the review, remove the label or have the requirement reviewed again; the nightly run does not detect a later change.

### /local-check
<!-- de: 84eee40098f0 -->

**Step 6, before the review.**

The skill calls `node .claude/kit/checks.mjs run --since "$(git merge-base HEAD origin/<mainBranch>)"`: the command selects the **affected** `buildChecks` and runs exactly those — the ones marked with `gleichzeitig` first, side by side, the rest afterwards, one after the other. The `merge-base` anchor is the right one here because the skill runs after the local commit — it measures everything that has been added since the last push (see [Area-based checks](/en/dokumentation#area-based-checks-checkareas)). After that, `mutationCommand` runs, if set; it stands outside the selection. For frontend changes, the skill reminds you of the manual UI verification in the browser and notes in the report when it could not be done automatically.

**The package stage is run** (see [Staged checks](/en/dokumentation#staged-checks-stufe)). The call carries no `--stufe`: this step is the local check before the human test round, and making it expensive would take away its benefit. A check with the stage `push` or `merge` therefore appears as an omission with its stage as the reason — it runs in `/push-main` or `/merge-production` respectively.

The output is a checklist with green ticks or a red stop; omitted checks appear in it as a line of their own with their reason, so that a shortened run does not look like a complete one. A red check blocks the rest of the process. There are no exceptions and no overriding.

### /review
<!-- de: aec27cbca22c -->

**Step 7, after the local check.**

The skill opens a new Claude session without the implementation context of the current session. A reviewer who does not know how the code came about reads it as a stranger and sees problems that the implementer does not notice.

Depending on `reviewScope`, the reviewer gets the diff or all files in the repo (with the model from `reviewModel`). The findings land as a comment in the issue or PR. For security patterns that require a corpus-driven approach (secrets scan, SQL concatenation, missing input validation), the skill does not rely on the model alone. These checks belong in your CI.

### /push-main
<!-- de: 7a612b209c0c -->


**Step 8, after the review, on your explicit command.**

Pushes the current commit batch to the main branch. Only you type this skill. It is locked against autonomous invocation and reacts only to the explicit trigger phrase. An earlier push approval in the same session does not apply to new commits. Every batch needs an approval of its own.

A red `/local-check` from step 6 blocks this step mechanically: you have no green mandatory check, so no push.

**The stage `push` is run** — the skill calls `checks.mjs run --stufe push` and thereby runs the package stage **and** everything your project has scheduled for the moment of publishing (see [Staged checks](/en/dokumentation#staged-checks-stufe)). And **every one** of these checks: before the push, none is selected by area any more, and an empty package omits nothing here. This run takes noticeably longer than the one before the commit; the command names in advance what is added compared with the package stage.

**Pre-push step from `RELEASING.md`.** If your repo's `RELEASING.md` names a pre-push step, the skill runs it after its commit and before the push, in the background, and waits for it to end. Exit 0 means push; exit 1 means red, and the push happens only if you answer the question „Vor-Push-Prüfung rot. Trotzdem pushen? (ja/nein)“ (pre-push check red. Push anyway? (yes/no)) with `ja`; any other exit stops without a push. Without such a step, `push main` does not wait for the CI.

**Prepared at night: the mode `vorbereiten`.** A night chain with the goal `ziel:push-vorbereitet` (see [How far a chain runs](/en/dokumentation#how-far-a-chain-runs-the-goal)) starts `/push-main vorbereiten` at the end of the run — as the only call of this skill without your trigger phrase, because it does not push. The session works in a worktree of its own on the local `main`, rebased onto `origin/main`, and runs everything that can be done before publishing without you and without a push: the generation steps from `RELEASING.md` (version note, change note), the full check run of the stage `push` and the local commit. No push — neither to `main` nor to a check or preview branch, no tag. Whatever needs a human or a push, such as the pre-push step from `RELEASING.md` or a visual check of the interface, is not started but stated as open in the message. The result is called `gruen`, `gruen-offen` (green, check open) or `rot` and lies at the fixed location `.claude/push-vorbereitung.json`, the commit under `refs/kit/push-vorbereitet`.

**The takeover in the morning.** When you type `push main`, the skill first asks whether it may take over the preparation. It does so only if the preparation's result was `gruen` or `gruen-offen` and nothing has changed since: your local `main`, `origin/main` and the prepared commit are still where the night saw them. Then it does not check again, does not generate the version note and change note a second time, and writes `Übernimmt den Stand der Nacht vom <zeitpunkt> (<commit>)` (takes over the night's state from `<time>`, commit `<commit>`). Whatever stayed open at night it catches up on before the push; an open visual check it asks you about. If the state is red or changed, it names the reason in one line and runs as without preparation, with a full check run. After the push and whenever it does not take over, it discards the file and the reference.

**On the path through the build service.** If your project runs the full run with `pushPruefung` in the build service, the night cannot run it without pushing to the check branch. The preparation then runs only the evidence run of the package stage over the release files and commits; on green the result is called `gruen-offen`, and the first open item reads `voller Lauf im Build-Dienst (Prüfzweig <zweig>)` (full run in the build service, check branch `<branch>`). In the morning, `push main` takes over the commit as above, pushes it to the check branch, waits for the build service and pushes `main` only on green.

### Checking the test server (human, between step 8 and step 9)
<!-- de: 2940a24483a9 -->

After the push, the test server picks up the change automatically or you deploy manually. You check the result in the browser: the golden path, critical edge cases, no visible regressions. Only after this check do you go to step 9.

### /merge-production
<!-- de: 66caa7c113be -->

**Step 9, after the test server check, on your explicit command.**

Creates a pull request (GitHub) or merge request (GitLab) from main to production. This skill, too, is locked against autonomous invocation. You carry out the final merge yourself in the PR/MR, because you are the one who checked on the test server that the result is right.

**Before the PR there is a CI gate.** The skill uses `node .claude/kit/board.mjs code ci-status --commit <sha>` to fetch the CI state for the state on `origin/main` — before the version bump, commit and PR. On **red**, **no PR** is created: the skill names the red jobs by name and ends; an exit code 1 of the axis counts the same. If the CI is still running, it asks exactly once, and only a `ja` (yes) continues. If a project has no CI (`codeHost: local`), the axis reports `keine` (none) and the run continues unchanged.

**Before that there is a stop: `push main` first.** There is never a `merge production` without a preceding `push main`. If your local `main` carries commits that are not on `origin/main`, the skill ends before the worktree with the message „Erst `push main` — dieser Stand ist noch nicht veröffentlicht und nicht geprüft.“ (`push main` first — this state is not yet published and not checked.)

**The stage `merge`, the release stage, is run** — the skill calls `checks.mjs run --stufe merge`. It checks only what `push main` did not check: the checks with `stufe: "merge"` always, those of the package stage by area over the release files (bump, stamp, changelog), those of the stage `push` not — they appear under `ausgelassen` with the reason `Stufe push, geprueft beim push main` (stage push, checked at push main) (see [Staged checks](/en/dokumentation#staged-checks-stufe)). No mandatory check is dropped as a result: the package and push stages ran at `push main` for the same state. It is the last run before production.

The reason for a second gate next to the mandatory checks: the local `buildChecks` measure only what your machine can measure — they do not measure what the CI measures. A CI job can fail on something the local run does not see, for example a different runtime environment or a fresh checkout without local files. Without the query, a release would go to production while exactly this job fails, although the information is available.

### Your own release steps through RELEASING.md
<!-- de: b6d3bdf60835 -->

`/push-main` and `/merge-production` check on every run whether a `RELEASING.md` lies in the project root. If so, they read this file and carry out the procedure described there before pushing or creating the PR — for example a version bump command followed by a commit. If no `RELEASING.md` exists, this step is skipped without replacement.

This is a pure opt-in convention, not a kit-internal feature: every project that works with `/push-main`/`/merge-production` can dock its own release steps (versioning, changelog maintenance, whatever) this way without forking the generic skills. The claude-workflow-kit repo itself uses this for its own versioning — see [RELEASING.md](https://github.com/mannewolff/claude-workflow-kit/blob/main/RELEASING.md) in the repo.

As a concrete example, the kit repo uses it to maintain an **automatically generated `CHANGELOG.md`**: a script (`tools/changelog.mjs`) derives the entries from the git history on every release (the commit subject lines, grouped at the version commits) — nothing is maintained by hand. This is part of the kit's own RELEASING.md; projects that use the kit do not get it automatically, but can include it in their own RELEASING.md following the same pattern.

Two details that are easy to get wrong when copying this: the changelog is created **before** the commit and is told the version identifier — `node tools/changelog.mjs --marke vX.Y.Z`. If it derived it from the history instead, it would not know the mark that the commit is just about to set, and would be outdated at the moment it is written. The earlier answer to this was a second commit with `git commit --amend`; with `--marke`, one is enough. And changes that have not yet seen a version commit appear under `[Unreleased]` instead of under the version number from the configuration — that number is already taken after every release, and two blocks with the same number are no longer a changelog.

From this follows the division of labour between `RELEASING.md` and the release skills: the file carries only the **generation steps** (bump, stamp, changelog); the skill runs them up to the first committing step, measures the finished state with **one** `checks.mjs run` and writes **one** commit. The commit gate demands for every commit an evidence on exactly this state — the fewer commits a release path produces, the fewer check runs it costs. Before, there were up to four at `push main`.

### The git tag is yours
<!-- de: 98fe1b0d07ae -->

A release step creates **no** tag — neither at `push main` nor at `merge production`. A tag marks a publication, and publications stay human, for the same reason as the three stop points.

What `/merge-production` does instead: at the end of its run it outputs the finished command line, with the hash of the version commit it created itself:

```
git tag -a vX.Y.Z <hash> -m "Release vX.Y.Z" && git push origin vX.Y.Z
gh release create vX.Y.Z --title vX.Y.Z --notes-file <pfad>
```

The difference between "please also set a tag" and a line you can copy is not convenience, but whether it happens: whoever has to piece together hash and syntax after every release will stop doing it at some point.

With the `push main` trigger, deliberately no tag is created — what arises there are internal patch states that nobody publishes.

### /retro
<!-- de: f50edb8eecd1 -->

**Tool alongside the process, every one to two weeks.**

The AI retrospective is not a step of the development cycle but a maintenance step for the process itself. Four questions: where did the human-AI collaboration get stuck? Which memory entries are outdated or wrong? Which workflow rule needs sharpening? What do the numbers say — how many of the night's decisions were overturned, how many stop questions were there, how many calendar days lay between requirement and GO and between GO and push?

The output is not insights, but concrete changes to the convention files and to the memory. If a retrospective changes no file, it was too abstract.

### /document
<!-- de: e318b178ca40 -->

**Tool alongside the process, session end.**

If a vault is configured, the skill writes a daily log entry in `{vault}/Log/YYYY-MM-DD.md` with what was decided and implemented today, and updates the timestamp in the project note. Without a vault, it writes to `docs/session-log/YYYY-MM-DD.md` in the project directory.

The documentation does not arise as an after-the-fact duty, but as the automatic conclusion of every unit of work. What is not documented no longer exists in the next session.

## A complete pass
<!-- de: 8aa6860d47f2 -->

You call `/kontext` to start the session with a fresh situation overview.

**Steps 1 and 2:** you dictate the requirement (step 1) and call `/techplan` (step 2). You read the plan, give feedback and approve it.

**Step 3:** you call `/issues`. The issues land in the backlog.

**Step 4 (GO):** you pull the issues you want to implement in the current batch to Ready on the board. That is a deliberate decision, never a silent move by the AI.

**Step 5:** you call `/implement-ready`. The AI works through the Ready column, commits locally and places the results in In review.

**Step 6:** you call `/local-check`. All checks must be green.

**Step 7:** you call `/review`. A fresh look without the context of how it came about. You read the review. If there are findings you want to address, you go back to step 5.

**Step 8:** you call `/push-main` (explicit trigger phrase). Main is now up to date.

**Between push and merge:** you check the result on the test server in the browser.

**Step 9:** if everything is right, you call `/merge-production`. The PR/MR is created, you merge it yourself.

To finish, `/document`.

## The three human stop points
<!-- de: 5a39b1f9c656 -->

**Step 4: the GO.** You decide which issues go into this batch. That is where the planning lies: how much work at once, which priority, which dependencies. The GO has two granularities: under **variant A** you pull each work package to Ready individually. Under **variant B** you instead mark in advance the card that starts the chain — the business requirement or the plan document — with the label from `night.kette.varianteBLabel` (see [Second mode](/en/dokumentation#second-mode-the-night-chain)) — the GO then applies in advance to all work packages that the night chain cuts from it; the chain pulls them to Ready itself and implements them in the same night.

**Step 8: the push.** You change the test server. Every batch needs an approval of its own, because between commit and push lies the last chance to reconsider the scope. Under variant B, the push is at the same time the moment in which you accept or discard the night's work together with its decisions: the night report on the business plan lists what the chain decided, and until the push none of these decisions is binding.

**Step 9: the merge.** You bring code to production. You checked on the test server, you carry the responsibility, you merge.

The kit does not automate these three. That is not a missing feature. It is the point of the kit: AI does the work, humans make the decisions.

## Statements: believe instead of checking
<!-- de: e6de9d6fab0f -->

Not every message is an assignment. If you tell the session something about a state of affairs — what is currently running, what is broken, what you have just done —, that is a **statement** (Mitteilung), and it is adopted unchecked: no tool is used to confirm it, not in passing, not later either. You are the source, not a `ps` call.

**The incident that grounds the rule.** On 2026-09-08 the user said: "der Nachtlauf laeuft noch" (the night run is still running). The session checked this statement with a tool call instead of believing it. The rule turns this around. Instead of checking, there is a fixed form of answer that states scope and consequence — shown here as a reproduction; the binding wording is elsewhere:

```
Mitteilung übernommen, ungeprüft — gilt, bis du Entwarnung gibst. Folge: Ich starte keinen zweiten Nachtlauf.
```

(Statement adopted, unchecked — applies until you give the all-clear. Consequence: I will not start a second night run.)

Because the assumed scope is in the answer, a misclassification is immediately visible and can be corrected in three words.

**Why stated and not enforced.** Whether a model believed something cannot be measured — a mechanical guardrail (Leitplanke) is simply not available here. What there is, is the same pattern as with the reviewer access in [/issue-review](/en/dokumentation#issue-review-across-multiple-models): there the reviewer states with the line `Bestand: gelesen` (existing code: read) in their own answer whether they read the existing code, instead of someone enforcing it. A session that claims not to check and then checks anyway produces a visible contradiction. That is less than a lock and considerably more than a request.

**The limits.** A statement does not replace a mandatory check — "the tests are green" does not make `checks.mjs run` unnecessary —, and a trigger phrase quoted in a statement is text: it triggers no push and no merge.

**At night there are no statements**, because there is nobody to make them; text in the prompt of an unattended run may look like one, but is none.

The binding wording of the rule is in `CLAUDE-workflow.md`, section "Mitteilungen des Menschen" (statements of the human) — this description does not put a second version next to it.

## Three lanes
<!-- de: 1d974153750e -->

Not every task needs the full 9-step process. The kit distinguishes three lanes (Bahnen):

**Lane 1 — small change.** Exactly one file, one asset or one config value; no database migration; no new or changed endpoint; no data model; at most one module affected; no security-relevant logic. Implement directly, one commit, no push without a trigger phrase — no plan, no issue, no GO. This commit, too, requires a green `node .claude/kit/checks.mjs run` on the state to be committed: The commit gate is mechanical and knows no lane.

**Lane 2 — feature.** Outside lane 1, as soon as there is something to weigh up — or it is unclear whether there is something to weigh up. Full process: `/techplan` → `/issues` → GO → `/implement-ready`. Typical: a data model with several defensible cuts, an endpoint whose contract is still open, a migration with a question about the way back.

**Lane 3 — `[Task]`.** Above the trivial, but without anything to weigh up. No business concept (Fachkonzept), no plan, no breakdown: a single work package (Arbeitspaket) with the title prefix `[Task]`, created with [/task](/en/dokumentation#task) after you confirm the route — then reviewed and released like any other package. Typical: a renaming across several files, a rejected tool finding, a mechanical follow-up job.

**The selection rule, in this order:**

1. If the counting lane-1 rule applies **and there is nothing to weigh up**, lane 1 applies.
2. Otherwise the need to weigh up decides: There is something to weigh up when **several defensible routes** are open. A finding with exactly one correct outcome is not a trade-off. With something to weigh up, lane 2 applies, without it lane 3.
3. If it is **unclear** whether there is something to weigh up, lane 2 applies.

Size alone therefore no longer decides, and that is the actual change compared with earlier: A change to twelve files without a trade-off is lane 3; an architectural change to a single file where several cuts are defensible is lane 2. The old version of lane 2, in contrast, counted features — data model, endpoint, migration, security, more than one module — and thus sent even the unambiguous through the full process.

When in doubt, lane 2 applies; that also covers an unclear need to weigh up. Before every new task the AI names the lane out loud ("Das ist Bahn 1/2/3, ich …" — "This is lane 1/2/3, I …") — examples: swapping an icon or favicon, a text correction or a config default are lane 1; a renaming across several files without a trade-off is lane 3; a new table, a new endpoint or a new UI feature are lane 2.

**A special case worth naming: rejection as a valid result.** A tool reports a finding, and the finding is defensibly rejected — that, too, is work, and it is typical lane-3 work. So that the rejection holds, the acceptance criterion of such a `[Task]` is the **versioned suppression rule** that the tool itself evaluates, with the justification right next to it: The tool reads the rule, the justification addresses humans and later sessions. In the kit the pattern lives in `sonar-project.properties` — the exclusion of the rule `javascript:S4036` as a versioned line, with a written-out explanation above it of why it is defensible. A rejection marked as "accepted" by hand in the web UI, in contrast, does not hold: The next finding of the same kind arises outside of it. Such a task is verified by running the same tool again — the rejected finding stays away, **and an independent control finding is still reported**; without it, a silent tool cannot be told apart from an effective exclusion. If a tool lacks a versionable route, developing one belongs in an initiative (Vorhaben) of its own, and no cross-tool register is created — it would be a second list next to the rule files that none of the tools reads.

## PO loop: business and technical issues
<!-- de: 2ff33472a971 -->

In practice a product owner (or a proxy PO in the company) feeds in the requirements — and wants to accept the plan on the business side before any technology is designed. For this the kit optionally separates two kinds of issue, following the discovery/delivery pattern — the PO loop (PO-Schleife):

- **Business issues** (title prefix `[Fachlich]`, created with [/fachplan](/en/dokumentation#fachplan)): describe the what and why in PO language — story format with goal, business acceptance criteria, non-goals and open questions. They are **groomed** on the board — the negotiation with the PO takes place **in the body** (answers and additions directly in the text), not in comments — and are **never implemented**.
- **Technical issues** (four-section format as before): arise only when the PO says "that's it" — then `/techplan #N` reads the business issue **with its complete body** as the source of requirements, and `/issues` cuts the technical issues from it.

**The flow:**

1. `/fachplan <requirement>` → business issue in the backlog (or in the idea pool, see below).
2. Groom directly on the issue until the PO gives the business approval.
3. `/techplan #N` → technical plan from the business issue.
4. `/issues` → technical issues; each carries the back references **in the context section**.
5. From here on the normal route: GO, `/implement-ready` or night mode (Nachtbetrieb), review, push.

**The rules behind it:**

- **Two back references, both in the context.** The chain should be readable at every point — from the work package to the plan, from the plan to the business requirement (fachliche Anforderung). That is why the technical issues carry, one below the other, in this order:

  ```
  Plan: Issue #M
  Fachliche Quelle: Issue #N
  ```

  The `Plan:` line only arises when a `[Plan]` issue exists as a source; if the plan was merely approved in the same session, it is left out. It is independent of `Plan-Modell:` — that one names the **author** of the plan, this one its **location**.
- **Never in the dependencies — neither of them.** An `Issue #N` reference in the dependencies section would be treated by the night runner (Nacht-Runner) as an unmet dependency. The business issue only becomes Done when its technical children are finished, and the plan document (Plandokument) never becomes Done through implementation — all children would stay deferred for good (chicken and egg).
- **Business issues never go to Ready.** Ready means implementable. If one lands there anyway, the mechanical guardrail (Leitplanke) takes effect: `/implement-ready`, `/implement-next` and the night runner put it back into the backlog with a comment, without starting a session. The same gate applies to **ideas** (title prefix `[Idee]`) — a raw idea is a requirement, not a work package — and to **plan documents** (title prefix `[Plan]`): A plan describes a route, it is not a task and must first be broken down into work packages with `/issues`. And it applies to **human steps** (title prefix `[Mensch]`): a work package whose task lies outside the repository — a setting in a web interface, an account, an access, an approval. Unlike the other three it is not a document and falls into the stage `issue` in `issue check-form`; only nobody but the human can carry it out, and its comment therefore says that the card (Karte) is waiting and has not failed.
- **Life cycle:** The **human** moves business issues and plan documents out of the backlog only **to Done** or not at all; the guardrails only push them back out of Ready. **In review** means for them "everything built, review is due", and this column (Spalte) is set by the kit: As soon as a plan is through — at least one package verifiably in In review or Done, none in Backlog, Ready or In progress —, it pulls the plan document and the business requirement there, the requirement only once every one of its plans not marked as superseded is through. Whatever already lies in In review or Done stays. It makes no difference which route built the last package: night chain (Nacht-Kette), implementation night or a session during the day. If a package then goes back from review, the document stays where it is.

  **There is a trap that goes with it:** The night chain (`night.mjs --kette`) reads only the backlog column and also places the plan and the packages there. Whoever moves a business issue out of the backlog **before** its chain takes it away from the night run — it is then no longer a candidate, and without anything failing. The way out is the interactive route with an explicit number — `/techplan #N`, `/issue-review #N`, `/issues #M` —: It works **independently of column and existing marker**. That is exactly what makes it the way out.
- **Recognition via the title (stage 1):** The `[Fachlich]` prefix works with all four trackers without changing an adapter. A real label axis (labels exist in GitHub, GitLab and kanban-kit — the board adapter (Board-Adapter) interface just does not pass them through yet) is planned as an expansion stage.
- **An idea has exactly two routes forward.** If it calls for a **trade-off**, `/fachplan #N` turns it into a business requirement; if there is **nothing to weigh up** or the human has already decided, it becomes exactly one work package with `/task #N`. Which case applies is decided by the human with the call — whether there is something to weigh up is exactly the question a human answers, and a skill that answered it for itself would make the decision it is meant to hand over. Both skills name the other route in their rejection, so that a wrong call does not lead nowhere. The route straight into a technical plan does not count: It would skip the point at which the goal is decided.
- **Placement in kanban-kit:** New business issues land there in the project's idea pool — pool = unsifted raw requirement, scheduling into the backlog = in business work (from then on addressable and groomable), `/techplan #N` = approved on the business side.

Without a PO the loop is invisible: calling `/techplan` directly remains the normal route.

## The check run
<!-- de: ca254d544ef4 -->

**A run during the day that has several marked business requirements reviewed one after another.** Reviewing during the day is a conversation: Every finding wants to be discussed, every question of the stop class (Stopp-Klasse) answered. The check run (Prüflauf) takes exactly that off your hands — mark requirements, start the run, look later. For each card a session `/issue-review #N` runs without anyone answering in between; afterwards every card shows where things stand: reviewed and ready, or a decision is waiting. Everything outside the stop class was decided by the review and recorded in the document. **This sorting is the gain.**

The run belongs to the **day** and therefore has a chapter of its own, not under [Night mode](/en/dokumentation#night-mode): It runs alongside the working human and alongside a night chain, and it is not tripped up by an unclean working tree or by a package in In progress. It has exactly one relation to the night chain: It **establishes the chain's prerequisite** — a card left reviewed carries the `review:fertig` that the chain requires. The **chain label** remains the human's gesture; the check run never sets it.

**The gesture:** the label `kit:pruefen` on the business requirement (label name from `pruefLauf.label`, see [All settings](/en/dokumentation#prueflauf); to be created on the board once). The run **consumes it** immediately before the session for this card — every setting of it authorises exactly one review; an abort leads to a note with the reason and a new gesture, not to a silent repetition. Together with the marker it also removes a `review:fertig` from a previous run: Only this way does the state after the session answer the question about **this** review and not about an earlier one. It **never** removes `kit:klaeren` — only a human may do that, otherwise a run would give itself its own approval.

**Fixed kit state.** Like every unattended run, the check run works with a fixed state of the kit: At the start it binds itself to the commit that `origin/<mainBranch>` points to — the last push, read without `git fetch`. Fixed are thus the tools including the check before every commit, the skills and the rule texts; whatever a package of the same night changes in them only takes effect after `push main`. The object of the check remains the project's configuration and its tests; they come from the state of the respective package. The state appears as the line `Kit-Stand: <commit> (origin/<mainBranch> vom <Zeit>)` (kit state: commit, origin/mainBranch as of time) in the run report (`kitStand` in `.claude/night-run-*.json`), in the night report and on every comment of the run. After a run in the main copy, its installed copy stays at its state until `node tools/sync-blobs.mjs` brings it to the working copy; until then `sync-blobs --check` names it as outdated.

**Start:**

```bash
node .claude/kit/night.mjs --pruefen
```

The run **has no preview** — `--pruefen --dry-run` is rejected, and `/issue-review --dry-run` shows documents and reviewers anyway. What will run is in the candidate list that the run logs before the first session. `--label` does not apply here (the marker comes from the config), and neither do `--kette` and `--pruefen` together: Those are two runs with budgets, labels and worktrees of their own. `--max N` is allowed, but **not needed** — the run is limited by its budgets, not by a number; without `--max` there is no numeric cap.

**The candidates:** every card that carries the marker and has the title `[Fachlich]`. **Without a column condition**, unlike the night chain: A business document never goes to Ready, and the gesture applies to the card, not to its location. Whatever carries the marker but is not reviewed appears in the list as `uebersprungen` (skipped) with a reason and **keeps its marker**: a `[Plan]` document or a work package (the check run applies to business requirements only) and a card with `kit:klaeren` (a question is waiting there for a human, and a second review does not answer it). Cards above a set `--max` count as `liegengeblieben` (left over) — that is not an exclusion. If not a single card carries the marker, the run says so and names the existing labels. Before the first review the **reviewer pre-flight** runs as with the chain: If it fails, every candidate gets the comment `Pruefung nicht gestartet` (review not started) with a reason and keeps its marker — nothing ran.

**The worktree:** one per **run**, not per card (`pruefung-…` under the temp directory, a prefix of its own next to that of the chain). The sessions read and write on the board, not in the working tree; a worktree per card would cost time for a separation without a subject. After the run it is removed; a left-over one is cleared by the next start — only one with **its** prefix and only if its runner is no longer alive, so that a concurrently running check run or night chain keeps its own. Like the chain, the check run claims every root with the run status (Laufstand) `läuft` (running) together with the run ID and leaves out one claimed by a live runner (see "One runner per root" in the chapter Night mode).

**Per card:** Immediately before the session the run forms the fingerprint of the **version** read (twelve hex digits from the card text) and names it in the candidate list, the log and the result. That way it is clear afterwards *what* was reviewed: Whoever changes the text during the review sees from the fingerprint that the review read a different version. The run reads the result from the **difference** between the board traces before and after the session, never from the state afterwards alone — a card reviewed again already carries markers and findings from the previous run. An abort only ends this card; the next one is up.

**Three results, each with its trace on the board:**

| Result | Trace on the card | what is next |
|---|---|---|
| reviewed | business plan review marker in the body and the label `review:fertig`, findings and their incorporation as comments | nothing — the card meets the admission prerequisite of the night chain |
| pending decision | `kit:klaeren` and the question as a comment; the text of the requirement stays **unchanged** | answer the question and remove `kit:klaeren` — both by hand |
| incomplete | the comment `## Pruefung unvollstaendig` (review incomplete) with reason, step reached (`gestartet`, `befunde`, `eingearbeitet` — started, findings, incorporated) and the route forward | run `/issue-review #N` by hand |

The third outcome is shown separately and is neither of the first two: The review has then been paid for, its findings are on the board, but the body carries no marker — without the note the card would later look untouched. A session that started a long piece of work and ended while waiting for it instead only gets the note `## Nachtlauf: wartende Sitzung` (night run: waiting session); two comments for one abort say nothing that one does not say.

**Budgets** are in the root block `pruefLauf` of `.claude/workflow.config.json` — not under `night`, because the run belongs to the day. If the block or a field in it is missing, these starting values apply:

```json
{
  "pruefLauf": {
    "label": "kit:pruefen",
    "pruefungMin": 25,
    "kostenUsd": 25
  }
}
```

`pruefungMin` is the time budget **per reviewer session**; it is above that of the plan stage of the chain because the business stage runs two reviewers. `kostenUsd` is the cost budget **per run**, summed over all sessions and checked **after** every session, never in the middle — a half-read review would be the more expensive mistake. Once it is exhausted, the remaining cards count as skipped and keep their marker.

**The result list is on the console** (and in the log `.claude/night-run-<datum>.log`), because the run belongs to the day: Whoever starts it sees its result. One line per card with number, title, result and version — for a pending decision also the question, for an abort the step reached —, below it a sum line over the five outcomes. The [result state as JSON](/en/dokumentation#night-mode) arises as with every unattended run, with one unit per card including outcome, version, duration and key figures.

**What the run does not do.** It moves **no card** between columns, pulls nothing to Ready, sets no chain label and removes no `kit:klaeren`. Nor does it change anything about the review itself: Who reviews, in which role and with which questions stays as it is — it is the same review as by hand, only without the conversation. And it answers no question that belongs to a human; it sorts.

**The limit of being untouched.** The run leaves no change in the project — the state of the working directory is the same before and after the run, even if someone works in it in the meantime. One exception belongs to this, and it is none: With the tracker `local` the board lies **in the repo**, and the config in the worktree points to `issues/` of the main copy so that the sessions write there. These cards therefore change — that is the **result and not a leftover**. Everything outside the board stays untouched.

**Afterwards:** A card left reviewed meets the admission prerequisite of the night chain — the **GO remains yours**: The chain label is still set by a human. If the result is available before the nightly selection, the chain runs the same evening, otherwise next time.

## Night mode
<!-- de: 202146aa87ee -->

Night mode (Nachtbetrieb) knows **two operating modes**: the **implementation night** (Umsetzungsnacht), which this section describes, and the **night chain** (see [Second mode](/en/dokumentation#second-mode-the-night-chain)), which turns a business plan into the reviewed plan and the work packages without building anything. Both are the night; the [check run](#the-check-run), which has business requirements reviewed, belongs to the day and has its own chapter. The implementation night works through the Ready column unattended — with a **fresh session per issue**, so that no context accumulates over many issues and quality does not degrade creepingly. The night runner (`.claude/kit/night.mjs`, comes with the installer) starts one headless session per issue with `/implement-next #N` — the issue is **handed to the session bindingly**, it does not choose it itself — waits for it to end and checks success exclusively on the board: issue in In review = success. Nothing is **ever** pushed at night — the three stop points remain human, unchanged.

**Evening ritual (the GO):** Pull issues to Ready and bring them into the desired order by drag & drop — the runner works through the column from top to bottom. Dependencies must be written as `Issue #N` in the dependencies section (see issue format): The runner automatically defers issues with unfulfilled `#N` references. Four kinds of card it skips mechanically — commented back to the backlog, without starting a session: business issues (`[Fachlich]` title, [PO loop](#po-loop-business-and-technical-issues)), **ideas** (`[Idee]` title), **plan documents** (`[Plan]` title) and **human steps** (Menschenschritte, `[Mensch]` title). A raw idea is not an implementable issue — with trade-offs it goes through `/fachplan #N`, without trade-offs through `/task #N`; a plan document describes a route and is only cut into work packages by `/issues`. Without the gate a session would reject them correctly, but the runner cannot tell this rejection from a failure — the session is burned and the comment on the board misleading. With a plan document it would be worse: It would carry no reason for rejection in itself and would be implemented, and that would look like a success on the board. A **human step**, by contrast, is a work package, but its task lies outside the repository — a setting in a web interface, an account, an access, an approval —, and no move of a session gets it done. Its comment says explicitly that the card is **waiting** and has not failed: Without the gate the runner would count the session's correct inaction as a failure, and the card would look like a failed package in the backlog (documented case: kanban-kit #1256). After acting, the human moves it on themselves. Also deferred is every card whose task or acceptance criterion names a **protected file** and that the human has not released, as well as a card with the label `kit:geschuetzt` — more on this under [The halt at a protected file](/en/dokumentation#the-halt-at-a-protected-file).

**Why a card waits at the dependency gate.** The deferral comment remains the one sentence `Nachtlauf: Abhaengigkeit #N nicht erfuellt (liegt in Backlog, Ready oder In progress) — Issue zurueckgestellt.` (night run: dependency #N not fulfilled, it lies in Backlog, Ready or In progress — issue deferred). Below it, separated by a blank line, comes the block `Abhaengigkeiten, wie der Nachtlauf sie liest:` (dependencies as the night run reads them) with one line per dependency: number and title, fulfilled or unfulfilled, the origin (from a reference line or from explanatory text) together with the text passage and, for a document, the document hint. After that the cycles follow as `Kreis: #A -> #B -> #A` (cycle), with the addition „dieses Paket wartet auf einen Kreis“ (this package waits on a cycle) if the package only depends on it. The log names every cycle in a second log line; log line, result state and chain report otherwise keep the one-line sentence. The trial run (`--dry-run`) shows the same lines indented below the line of every package with at least one dependency, also for packages that would get a session; the first line of the package stays unchanged. That way you recognise an accidental dependency without opening the package. The convention for this is under [/issues](#issues).

**Fixed kit state.** Every unattended run — implementation night, chain, check run — binds itself at start to the commit that `origin/<mainBranch>` points to — the last push, read without `git fetch`. Fixed are thus the tools including the check before every commit, the skills and the rule texts; whatever a package of the same night changes about them only takes effect after `push main`. What is checked remains the configuration of the project and its tests; they come from the state of the respective package. The kit state (Kit-Stand) appears as the line `Kit-Stand: <commit> (origin/<mainBranch> vom <Zeit>)` in the run report (`kitStand` in `.claude/night-run-*.json`), in the night report (Nachtbericht) and on every comment of the run. After a run in the main copy, its installed copy stays at that state until `node tools/sync-blobs.mjs` brings it up to the working copy; until then `sync-blobs --check` names it as outdated. If a package needs the changed tool, skill or rule text of another package as a tool, its reference line carries the addition `Issue #N (wartet auf Push)` (waits for push). The chain does not pull such a package to Ready even under variant B: It stays waiting in the backlog and appears in the night report as not started with the reason „wartet auf einen Push (Issue #N)“ (waits for a push).

**Start:**

```bash
node .claude/kit/night.mjs --dry-run   # shows what would run — starts nothing
node .claude/kit/night.mjs             # real run
```

Flags: `--max <N>` (session limit per night, default 10), `--model <id>` (model of the run; without the flag `night.modell` from the config applies, otherwise `claude-opus-5` — see "Where a session's model comes from"), `--timeout-min <N>` (time limit per round, default 60), `--dry-run`, `--no-checks-ok` (start without any check carrying the package stage — otherwise the runner refuses, because implementing at night without a gate is risky; a list of nothing but `push` and `merge` checks is the same as an empty one for implementation), `--yolo` (see Permissions), `--label <name>` (routing label, default `kit:nightrun`; `none` switches the filter off), `--verbose no` (switches off the live progress log, which is otherwise on; `--verbose yes` switches it on explicitly, `--verbose` without a value is the default and therefore has no effect), `--help`. In addition the config field `formatFixCommand` (see below) — not a flag, because it is project-specific.

**Routing label — which Ready issues the night run works on.** By default the runner processes only issues from Ready that carry the label `kit:nightrun`; all others stay untouched (no move, no comment). That way you mark the subset for the night run on **one** board and keep the rest for interactive work — without a second board with a token of its own, which would make `Issue #N` dependencies between the boards unresolvable. The label can be overridden with `--label <name>`; `--label none` switches the filter off completely (then, as before, strictly the topmost Ready issue is next). A `--dry-run` shows unlabelled issues visibly as "skipped". On **GitLab** labels already are the status mechanism — choose a routing label name there that collides with no status label (the default `kit:nightrun` with its namespace prefix does that). **Scope:** Whoever used `night.mjs` without labels so far must now give their night issues the label `kit:nightrun` or set `--label none` — otherwise the run finds nothing.

**The live progress log is the normal case and needs no flag.** The runner reads the session's `stream-json` output live and writes compact event lines into the night log and to the console — tool calls and text snippets, each with the issue number:

```
[18:24:10]   #401 > Bash: mvn -q verify
[18:25:02]   #401 > Edit: src/main/java/.../ProjectIdeaEventService.java
[18:26:11]   #401 > Claude: Tests green, committing now.
```

The final completion message still lands in the log as well; the streaming complements it and does not replace it. It is switched off explicitly with `--verbose no` — then the runner logs only start and end per round, and during a long session you cannot see what it is working on right now (`claude -p` only outputs its completion message at the end). Forgetting the flag used to cost the progress log in exactly the night you needed it; that is why the default has been reversed since issue #867. A bare `--verbose` stays permitted and without effect, so that existing calls and scripts keep running unchanged.

**The result state — the night as JSON.** Every run puts, next to the text log (`.claude/night-run-<datum>.log`), a machine-readable result state (Ergebnisstand) under `.claude/night-run-<datum>-<uhrzeit>.json`: per work package one unit with outcome, duration, commit and the key figures of the session (cost, API duration, turns), plus the conclusion of the whole run (`regulaer` or `harterStopp`, in the stop case with error class and reason). The outcomes of a unit are: `erfolg`, `zurueckgestellt`, `angehalten` (see below), `uebersprungen`, `liegengeblieben`, `abgebrochen` (a package without result whose leftovers are in the stash, see "When something goes wrong") and `harterStopp`. The file is rewritten completely after every round, so an aborted run leaves the state up to the abort. **Consumption:** Next to cost, API duration and turns, the key figures of every session carry the four token amounts from the CLI — `eingabeTokens`, `ausgabeTokens`, `cacheErzeugtTokens`, `cacheGelesenTokens`. Every unit sums them as `verbrauch` over all its sessions (including salvage and chain stages) and names its kind of run as `art`; the run header carries `verbrauch` over all sessions of the run, including the pre-flight, and `verbrauchOhneEinheit` as the part that belongs to no card. A field for which no amount ever arrived stays `null` — a 0 would claim that nothing was consumed. **Check runs:** Next to `zeiten` every unit carries `prueflaeufe` with the block `arbeit` — what check runs the session started during its work: `anzahl` all of them (a Bash call whose first program is that of a configured check group), `volle` those of them that literally matched a check group command, `volleNoetig` the sanctioned group runs via `checks.mjs run --bereich <name>`, and `dauerMs` the sum of their spans. Several sessions of a card add up like the times. The completion attempt — `checks.mjs run` without `--bereich` — is deliberately **not** in `anzahl`, otherwise it would count twice: It has its own block `abschluss` next to `arbeit`, with `anzahl` and `dauerMs`. An adopted run (`Ergebnis uebernommen` — result adopted —, because the state is unchanged) counts there as an attempt **without** duration — `checks.mjs` passes on the values of the earlier run, and a span of this call would be inherited, not measured. A session without a requested stream (command stage with a third-party program) contributes nothing; if no session of the card measured, the field is missing entirely — "not measured" is something other than "none". Only the measurement is stored: What follows from it — runs per completion, share of the running time, distance to the target mark `night.zielUmsetzungMin` — is calculated by the report. **Lookups:** The last two fields a unit is created with are `umsetzung` and `auskunft`. `umsetzung` is `true` as soon as a session of the unit started with `/implement-next`, `/implement-ready`, `/implement-test` or `/implement-done`; chain stages, card creation and check runs stay `false`, decided at the start of the session and not by the kind of run. `auskunft` is `{ ms, aufrufe }`: the time spent on queries to the board and on processing their answers. What is measured is the span from the tool call to its result. Thinking time does not count. As a query count `board.mjs issue get|list|epics|activity|auftrag`, `board.mjs kontext`, `gh`/`glab issue view|list` and `gh api …/issues…`. As processing counts such a query piped to `jq`, `node -e` or `python`, and also every call that names a result path offloaded by Claude Code (`tool-results/`). Writing calls such as `issue move`, `issue comment` and `issue melden` do not count. Several sessions of a card add up. `null` means "not measured": no session, or a command stage without a stream. An observed session without any lookup, by contrast, carries `{ ms: 0, aufrufe: 0 }`. `complete` is `false` in the file while the run is running and only becomes `true` at the regular end — a hard stop leaves it at `false` there (the report to the board says something different about this, see the paragraph "Delivery to the board" further below). The time of day belongs in the name because the text log is a daily file for appending, but JSON cannot be appended to — the second run of a day would otherwise overwrite the first. **The only exclusion is `--dry-run`**: A dry run works through nothing and has nothing to report.

**The check runs and the target mark appear in both reports.** A measurement is only useful if someone reads it, and the night reports in two places: The implementation night writes its check report to the console and into the daily log, the chain leaves its night report as a comment on the marked card. The block `Prueflaeufe und Zielmarke:` (check runs and target mark) appears in **both** places — in the log below the checks of the sessions, in the night report under `### Umsetzung` — and carries one line per package with the round duration, the number of check runs, of those the `volle` and the `Gruppenlaeufe` (group runs), and the number of completion attempts. If no session of the card measured, the line says `Prueflaeufe nicht gemessen` (check runs not measured) and names no zero. Below it the sum: `- N von M Paketen unter <marke> Minuten.` (N of M packages under <mark> minutes) — the mark is `night.zielUmsetzungMin`, without the field the default 10 applies. Only units that went through an implementation round are counted; the business plan unit of the chain and packages without a session stay out. The calculation uses the round duration including all checks and corrections, and it is calculated in the report — a second copy in the file would be the same truth in a second place. **Gaps in the mapping** appear alongside: If the check summary of a package carried files without an area pattern (`ohneZuordnung`), the report names **every** one of them by name. That colours nothing red — the completion of the package stays untouched; it is a finding for the morning that an area needs a pattern.

**Neither the file nor the key figures depend on a flag.** The runner requests the detailed session output (`stream-json`) in every unattended run and thereby always gets cost, API duration and turns — also with `--verbose no`, which alone controls whether the events additionally appear on the console and in the daily log. A field `kennzahlenHinweis` therefore no longer exists since issue #668. In the past the whole file depended on the flag — that cost the evaluation in exactly the night in which someone had forgotten it, and that is the night in which you need it: **The reason for an abort weighs more than the key figures of a smooth run.** Part of the consequence is that even a run that already fails at the **pre-flight** (Vorflug) — crash leftover in *In progress*, unclean working tree, empty `buildChecks`, reviewer pre-flight — leaves a result state with `abschluss: "harterStopp"` and an error class, although it has not worked through a single package. That is exactly where you look for the reason in the morning.

**The reason for a hard stop is in the file as text.** The error class says *where* it broke (`harterStopp`, `umgebung`, `tracker`, `zustand`) — the reason says *what* happened, verbatim with the sentence that goes into the text log anyway. It stands in **exactly one place**: in the field `grund` of the affected unit, to which the run refers via `fehlerEinheit`. Only the pre-flight stop knows no card — it runs before a candidate has been drawn —, and so its reason is in the run's `fehlerText`, and `fehlerEinheit` stays empty there. For an unclean working tree the reason additionally names the left-over files; **from the eleventh entry on** it is shortened to the count and the first ten, in the order of `git status --porcelain`. Before, you had to search the text log or start a session for exactly this question. If, against expectation, a reason is missing, the run carries the last remembered stop text together with a note that the handover broke, otherwise a substitute text with a request to report it — the field is never empty.

**A run without work names its reason.** If a night ends without a single work package having been up, the run header carries the field `noWorkReason` for it — verbatim with the sentence that goes into the text log anyway. There are six named cases. In the **implementation night**: Ready is empty (`Ready ist leer — nichts zu tun.` — Ready is empty, nothing to do), none of the Ready issues carries the routing label (`Keine der <N> Karten in Ready traegt das Label '<name>' — nichts zu tun.` — none of the N cards in Ready carries the label), all cards were deferred at the gate (`Alle <N> Karten in Ready wurden am Gate zurueckgestellt — …` — all N cards were deferred at the gate) or the implementation is occupied by another run (`Die Umsetzung ist belegt: <grund> — der Lauf endet ohne Paket.` — the implementation is occupied, the run ends without a package). With `--kette`: no card carries the chain label (`Keine Kette zu fahren: keine Karte traegt das Label '<name>'.` — no chain to run, no card carries the label) or all were skipped because a prerequisite is missing (`Keine Kette zu fahren: alle <N> gekennzeichneten Karten mit dem Label '<name>' wurden uebersprungen, …` — all N marked cards were skipped). Every sentence carries the label and the number or the holding process, so that the morning recognises the case without asking and does not first have to read the text log alongside.

**The deferral sentence takes precedence over `Ready ist leer`.** If the run emptied Ready itself by deferring every card at the gate, it says exactly that — and does not claim that Ready was empty from the start. And a run that ended without a session, without any of the six cases applying, does not stay silent but carries the fallback sentence `Kein Grund ermittelbar — … bitte melden.` (no reason determinable — please report): An empty field would leave open whether there was nothing to say or a situation remained unnamed.

**An implementation lock that cannot be written is not a quiet run.** If the lock file cannot be written, that is a fault of the environment: The run ends as a hard stop of error class `umgebung`, the reason is in the run's `fehlerText`, and `noWorkReason` is absent — without `noWorkReason` you can see at a glance in the morning that something broke here. A merely **occupied** lock, by contrast, stays a quiet run with a reason (`Die Umsetzung ist belegt: …`). Without the field an empty night looked like an aborted one in the evaluation: no unit, no hard stop, no hint that there was simply nothing to do. A run with work does not carry it.

**Delivery to the board.** With `issueTracker: toolbox` the runner delivers the result state to kanban-kit continuously — after every unit and at the end, via `board.mjs nightrun melden` to `POST /api/kanban/night-runs`, with the project-bound token. **The first report goes out before the first work package is up:** immediately after the result state has been created, with an empty package list and `complete: false`. A run that already stalls in the pre-flight or in the first session is thus visible on the board — before, it could not be told apart from a night that never started. The start report produces no log line, and in the dry run it is dropped like every other report. kanban-kit replaces the same run with every report. **A hard stop arrives as a completed run:** The report carries `complete: true` together with `abortReason` — the reason for the stop, shortened to the 4,000 characters of the contract —, and the board thereby evaluates the run as a fault and shows the reason. The **file**, unaffected by this, keeps `complete: false`, because the run never got through. Before, nobody reported the stop: The night stayed on the board unfinished among the active runs, although it had long been dead. The reason arises as a cascade — the run's `fehlerText`, otherwise the `grund` of the unit designated by `fehlerEinheit`, otherwise "Harter Stopp" (hard stop) with the error class. A single broken chain is **not** an abort of the run: It ends regularly and reports no `abortReason`; its outcome is on the red package. For this the board must be at least on kanban-kit **v2.7.0** — an older one silently discards the unknown field and would show the stop as a night completed green. If the delivery fails, the run does **not** end as a failure: The log names the reason, and the file remains the fallback. With every other tracker the delivery is dropped with a log line.

The **text log** — that is, the `.log` file from above — stays alongside unchanged and remains the way for whoever wants the details; the result state does not replace it, it complements it with an evaluable form. Two version details are in the file: `schemaFassung` as the first field names the version of the format — needed by whoever evaluates the file — and `erzeugtVon` the kit state that wrote it, for whoever wants to know when looking which runner was at work. Kept separate because a kit release does not change the `schemaFassung` and a format change does not wait for a release. The runner does not count the file as an unclean working tree — it does not have to be committed; whoever's `.gitignore` does not list `.claude/*` will still see it in `git status` in the morning.

**What was checked — and what was not.** The sessions check by area (see [Area-based checks](#area-based-checks-checkareas)), and the omissions are visible in **two** places: in the **completion report on the work package**, where the session lists checks run and omitted, each with its reason, and in the **run report of the pass** — there one line per session and below it a sum line over the whole run. A session without a check appears explicitly as "unchecked", a package without changes as "empty package"; none of it hides behind an empty list. A session that dies **during** the check run appears as **red** and no longer as "unchecked": Since the [summary accompanies the run](#the-commit-gate), an unfinished version with `nicht gestartet` (not started) is left behind in this case. The shift is intended — a dead checker is an objection, not a failed measurement. The runner does not read this from the completion report but from the summary that `checks.mjs` leaves in `.claude/checks-summary.json`: What the machine evaluates passes nowhere here through text formulated by a model.

**The proof only counts for the package's commit.** The summary always contains only the **last** check run of a session — whoever starts `checks.mjs run` once more after the commit, say as a manual test, and aborts it, leaves a version that did not measure the delivered state at all. The runner therefore holds the file against the session's commit: Every file the commit changes must have been checked in it with exactly the blob that landed in the commit — the same question the [commit gate](#the-commit-gate) asks against the index before the commit. An aborted run (`abgeschlossen: false`) never counts as proof. If it does not match, **the runner re-checks itself**: It runs the package stage of the `buildChecks` and reports the session as **`nachgeprueft`** (re-checked, green) or **red**, in both cases with the reason in the line („Nachweis gehörte nicht zum Commit …“ — proof did not belong to the commit). `nachgeprueft` is a success like `geprueft` and is coloured green on the control panel just the same. If the session left no commit, there is nothing to compare — then everything stays as the summary says.

**Night run against a different board (Toolbox/kanban-kit).** If your project runs against a kanban-kit tracker, you can switch the whole night run to a night board of its own: create a token in the admin UI and bind it to the night board, store it as a second gitignored file next to the normal `tokenFile` (e.g. `.claude/tbx-night.token`) and start the runner with `TBX_TOKEN` per call:

```bash
TBX_TOKEN="$(cat .claude/tbx-night.token)" caffeinate -i node .claude/kit/night.mjs
```

This works because `TBX_TOKEN` is the highest level of the [token precedence](/en/dokumentation#toolbox-private-setup) and the environment variable is inherited across the whole process chain: from the runner to its own `board.mjs` calls **and** to every headless session, whose `board.mjs` calls inherit it in turn. The entire run thus changes board — Ready source and all feedback (move, comment). A split ("pull issues from board B, report to board A") is deliberately not possible: The board is the runner's only coordination signal. Important: set `TBX_TOKEN` only like this, per call — never export it permanently (say in `.zshrc`), otherwise it wins against the `tokenFile` in **every** project. All of this applies only to the Toolbox/kanban-kit tracker; with GitHub and GitLab the board is separated per repo via the config (`github.projectNumber` or status labels), and there is no switching per call there.

**Model information in the activity history (kanban-kit).** The runner sets `KIT_AGENT_MODEL` for every session to the model it actually starts with — since v1.54 that is no longer necessarily the value of `--model` but the model of the respective card (see below). The variable is inherited via the same process chain as `TBX_TOKEN` — down to the session's `board.mjs` calls — and the adapter attaches it as the header `X-Agent-Model` to every board request. The activity history then shows, next to the origin, which model was used at night. This is explicitly a **self-report of the client, not proof**: The server verifies session and token, not the model — the board page marks the value accordingly ("lt. Angabe", as stated). Interactive sessions do not set the variable and therefore make no statement; no statement is more honest than a guessed one. Only kanban-kit evaluates the header on the server side; other trackers ignore it.

**Where a session's model comes from.** Up to v1.53 every session of a night ran with the same model: `--model`, once for the whole run. A recommendation on the work package had no effect. Since v1.54 a fixed order applies — model name of the card, then task level, then model of the run:

1. If the body of the card carries a line `Empfohlenes Modell: <name>` **and** `<name>` is in `night.modelle`, the session starts with this model. The same value goes into `--model` and into `KIT_AGENT_MODEL`. The model name wins against an `Aufgabenstufe:` line set at the same time; if a card carries both, the level stays without effect, and the reason in the result state notes the double statement.
2. Otherwise, and only if `night.stufen` is active (at least one level assigned) and the card carries an `Aufgabenstufe:` line, the level applies: Starting from this level the runner searches upwards — **leicht → mittel → schwer** — for the first assigned **and** startable level. An unassigned or non-startable level is skipped, never undercut: A task for which the intended level is missing would rather run with a stronger model than with a weaker one.
3. Otherwise the model of the run applies. It comes from `--model`, without the flag from `night.modell` in the shared `.claude/workflow.config.json`, and only without both from the runner's default (`claude-opus-5`). The start line names it together with its origin, for example `Modell claude-opus-5-5 (night.modell)`. `night.modell` must be in `night.modelle`; otherwise the runner ends before the start with a reason instead of silently falling back to the default. A `night.modell` in the personal file is ignored and reported. The model of the run also applies to business plan, plan, review and breakdown of the chain (issue #994).

**`night.modelle` is the only check — and it is a security gate, not a convenience.** Without it a value from an issue body would wander unseen into the command line; a package with `Empfohlenes Modell: --dangerously-skip-permissions` would be an attack via a card. That is why the comparison is against a **list** and not against a pattern: A pattern can be extended, a list cannot. A value with a leading hyphen or with spaces does not even count as a candidate, and the schema already rejects it in the config check. The same list applies to a level with `modell`: A level model name must likewise be in `night.modelle`, otherwise the configuration check rejects it — two separate lists could otherwise drift apart. A level with `kommando` instead checks whether the first word of the command line can be found via the same shell that starts later. This shell is `sh`. As everywhere, the task goes to the program as an argument and never into the shell string.

**How thoroughly a level thinks.** Next to `modell` a level optionally carries `effort` — the thoroughness of thinking, which goes as `--effort` to the session's Claude CLI. Possible values are `low`, `medium`, `high`, `xhigh` and `max`. Without the field the CLI's default applies; a level without `effort` therefore behaves as before. The field belongs exclusively to a level with `modell`: Next to `kommando` a third-party program starts, for which the kit cannot set a thoroughness. There it is a configuration error and is not silently ignored but reported with the path `night.stufen.<stufe>.effort` — likewise a value outside the five.

**Where the thoroughness takes effect — and where not.** Model and thoroughness always come as a pair from **one** level entry: If the runner moves upwards, the thoroughness of the level that actually provided the model applies, never that of the unassigned one below. It stays without effect wherever the level did not provide the model — with the card's `Empfohlenes Modell:` and with the model of the run — and in the command branch, where a third-party program starts that does not know `--effort`. The night chain's sessions for business plan, plan and breakdown also stay unaffected; the implementation stage runs its packages through the same round as the implementation night and therefore gets the thoroughness too. It is visible in four places: in the hint line of a round, in the preview `--dry-run`, in the **result state** as the field `effort` of the unit (after `stufeVerwendet`, `null` if none was set) and in the report of the implementation stage as a parenthetical addition after the model. A package's salvage session runs with the same bundle as its regular round, so also with the same thoroughness.

A card name **outside** the list is not a failure: The session runs with the model of the run, and the unit in the result state carries `modellHerkunft: "lauf"` together with `modellGrund` with the rejected name. A missing line and an empty list also lead to the run's model, then without a reason — a missing recommendation is the normal case and not a finding. A model that does not start despite a valid name, by contrast, remains a failure like any other.

**Start error on the highest level.** The runner re-checks whether a level is startable **before** the first work step of every package. If the intended level fails, it moves upwards as described above; if that also fails on the highest level (`schwer`), there is no way out left. Then **no** session starts — a silent fallback to the model of the run would be wrong, because whoever sets a level wants the package to run at that level. The package counts as a failure, gets a comment with the reason and goes back to the backlog.

**The pre-flight.** Before the first round of a night the runner checks once, without network, whether every **assigned** level is startable, and writes a warning into the log for a non-startable level. That does not hold up the night — it is an early hint that individual packages will later move up or fail, not a start condition for the whole run. If the setting is not active, the pre-flight writes no line.

**The preview.** `night.mjs --dry-run` names for every Ready issue which model would actually start and where from — `(Karte)`, `(Stufe <name>)` or `(Lauf)` (card, level, run) —, together with a fallback hint if the card's own level is unassigned and a startable level was only found further up. A package without a startable level appears in it explicitly as "würde nicht starten" (would not start), never as a running session.

**A worked example with a local model.** A project operates its own, locally hosted model for easy tasks, via a command-line program instead of a Claude model ID:

```json
{
  "night": {
    "modelle": ["claude-opus-5", "claude-sonnet-5"],
    "stufen": {
      "leicht": {
        "kommando": "mein-lokal-runner",
        "name": "lokal-llama"
      }
    }
  }
}
```

If a Ready issue carries `Aufgabenstufe: leicht`, the runner starts `mein-lokal-runner` instead of the `claude` CLI and passes it the task (`/implement-next #N`) as an argument. `KIT_AGENT_MODEL` carries the value from `name` (`lokal-llama`) — in the command branch there is no Claude model name; the field there is purely a self-report of the program. Setting up and operating this program is the project's business, not the kit's; the kit only starts the process. So that the card is afterwards treated like any other, the program must deliver the same as a regular session: a local commit, the issue in In review and an entry in the completion report (criterion 6) — the runner evaluates exclusively board state and working tree; it does not care which program produced them.

A package's **salvage session** runs with the same model as its regular round: It checks that round's intermediate state, and the recommendation applied to the card, not to the operating mode. The **implementation stage of the night chain** pulls its work packages through the same `laufeRunde` as the implementation night — so the level route applies to it as well. For business plan, plan and breakdown of the chain (`/techplan`, `/issue-review`, `/issues`), by contrast, the model of the run still applies: They are not attached to any single card.

A project **without `night.stufen`** notices none of this: Planning, packages, night run, pre-flight and report behave as before — every card still carries only `Empfohlenes Modell:`, and the model choice stays with the two cases card/run.

The list `night.modelle` is **ordered**, descending by strength: first entry the strongest, last the fastest model. From this `/issues` derives what it recommends to a work package.

**Permissions.** Unattended means: nobody answers permission dialogs. The runner therefore starts the sessions with `--permission-mode auto --permission-prompts none` (issue #940); everything else you allow selectively via an allowlist in the project's `.claude/settings.json`. The two flags belong together: In auto mode a classifier decides, and so your allowlist takes effect at night too — unlike the earlier mode, which accepted edits wholesale and carried a built-in block for sensitive files along with it that no `allow` entry lifted. What the classifier cannot decide would become a prompt; `none` rejects it automatically instead of sending it to an SDK host the runner does not have. Without `none` the session would hang until the round's time limit. Before the first session the runner checks in every operating mode whether `.claude/settings.json`, `.claude/settings.local.json` and `~/.claude/settings.json` — where present — are valid JSON, and stops hard on an error with path and parser message (in the dry run only reported): An invalid file puts all its settings out of force, and at night you would only see an approval prompt that nobody answers. The allowlist, for example:

```json
{
  "permissions": {
    "allow": [
      "Bash(node .claude/kit/board.mjs:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git show:*)",
      "Bash(mvn:*)",
      "Bash(npm --prefix frontend:*)"
    ]
  }
}
```

For unattended operation it is best to allow the **tool**, not the individual command: `Bash(mvn:*)` instead of `Bash(mvn verify:*)`. The reason is the prefix matching of the allowlist — a pattern only applies if the beginning of the command matches exactly. `Bash(mvn verify:*)` covers `mvn verify`, but not `mvn -q verify`, `mvn clean verify` or an `mvn test` for a partial run; yet sessions legitimately phrase such variants. A tool-wide entry catches all of them. The four read-only Git commands belong in there too, so that a session does not fail at a harmless `git status` while preparing the commit. **Trade-off:** A tool-wide entry gives the session more latitude (any `mvn` goals, any `npm` scripts). For the project's own build tools that is the pragmatic cut at night; whoever wants to stay narrower enters the buildChecks literally instead (including all flags) and pays for it with rounds that fail at an unforeseen command variant.

A command outside the allowlist is rejected immediately in headless operation; a well-behaved session then keeps implementing, but cannot run its checks and therefore does not commit — the round ends promptly without an In review result (dirty tree → hard stop, clean tree → backlog), not only after `--timeout-min`. That is intended: better a lost round than an unattended action. Whoever sets `--yolo` instead switches off **all** permission checks of the night sessions (`--dangerously-skip-permissions`); the stop points then depend on the skill prompt alone. A deliberate case-by-case decision, not a default.

**Two further layers: sandbox and environment.** The allowlist decides whether a command is *allowed* — not in which environment it runs. Claude Code additionally runs Bash commands in a **sandbox**, which among other things seals off Unix sockets. If a check needs a socket (typically: Testcontainers integration tests via `mvn verify` that address the Docker/Colima socket), it fails at the sandbox despite a matching allow rule, and the way out ("run again without sandbox") is an interactive prompt — unanswerable at night. Take such commands out of the sandbox via [`sandbox.excludedCommands`](https://code.claude.com/docs/en/sandboxing):

```json
{
  "sandbox": {
    "enabled": true,
    "excludedCommands": ["mvn *"]
  }
}
```

**Kit scripts with board access.** The kit, too, needs entries in `sandbox.excludedCommands`, namely for every script that reaches the board — directly or via a subprocess. A subprocess inherits the sandbox: `node .claude/kit/befunde.mjs vorschlag` starts `board.mjs` via `spawnSync`, and this `board.mjs` has no network as long as `befunde.mjs` itself is not in the list — the entry for `board.mjs` alone is not enough. The same applies to `wirksamkeit.mjs`. Add to that the reviewer command:

```json
{
  "sandbox": {
    "enabled": true,
    "excludedCommands": [
      "node .claude/kit/board.mjs*",
      "node .claude/kit/night.mjs*",
      "node .claude/kit/befunde.mjs*",
      "node .claude/kit/wirksamkeit.mjs*",
      "codex *"
    ]
  }
}
```

If the check additionally lacks an **environment variable** (e.g. `DOCKER_HOST`, so that Testcontainers finds the socket), set it in the `env` block of `settings.json` — **not** as a command prefix. An `env DOCKER_HOST=… mvn …` falls out of both patterns: The first token is then `env`, not `mvn`, so neither the allow rule `Bash(mvn:*)` nor `excludedCommands: ["mvn *"]` applies. In the `env` block the variable applies to every session, and `mvn` inherits it without a prefix:

```json
{
  "env": {
    "DOCKER_HOST": "unix:///<pfad-zum>/docker.sock"
  }
}
```

The setup recipe for night mode therefore has three layers that must all fit: the **allowlist** allows the command, `sandbox.excludedCommands` frees it from isolation, the `env` block supplies it with variables. (For Testcontainers specifically, a `~/.testcontainers.properties` with `docker.host` does the job as an alternative — it lies outside the project, but is independent of Claude Code in return.)

**Pipe and redirection lift the exception (from Claude Code 2.1.277).** Claude Code now only takes a compound line out of the sandbox if **every** part matches an entry in `excludedCommands`. `node .claude/kit/board.mjs issue-review check 2>&1 | head -40` therefore runs entirely in the sandbox, because `head` is in no list — including the codex that `board.mjs` starts, and without network. The same applies to a redirection into or out of a file (`codex exec … < prompt.txt`, `… > liste.json`), even if nothing else is in the line. Only `2>&1` (and any other redirection to a descriptor such as `>&2`) leaves the exception in place, measured under 2.1.283.

The installer therefore enters a **`PreToolUse` hook** with matcher `Bash` into the `hooks` block of the project's `settings.json`: `node .claude/kit/board.mjs hook bash-pruefen`. It reads the patterns from `sandbox.excludedCommands` and — only out of consideration for older settings, Claude Code itself does not know the key — `sandbox.network.excludedCommands` from `.claude/settings.json` and `.claude/settings.local.json`, and rejects a Bash line (exit 2, reason to the session) if a part of it matches a pattern and the line at the same time

- redirects into or out of a file (`<`, `>`, `>>`, `&>`, here-doc), or
- contains a pipe or a further command (`|`, `&&`, `||`, `;`, line break) whose parts do not all match.

Characters in quotation marks do not count (`--text "a > b"` stays allowed), nor do lines without a matching pattern. The reason names the pattern and the correct form: call the command alone; Claude Code itself stores a large output in a file, which a second call can filter. If the hook cannot read its input or a settings file, it lets the call through and writes a line to stderr — a broken hook locks no session.

**No background work without supervision.** The same hook `bash-pruefen` rejects a Bash call with `run_in_background: true` as soon as `KIT_AGENT_MODEL` is set (exit 2, reason to the session). An unattended session has no follow-up turn: If it ends its turn while the command is still running, the session is over and its result lost — in the night of 30.09.2026 with #1065, although the rule was in the skills. The right way is to call the command in the foreground; the session's Bash time limit reaches to just below the round limit (#668). Interactively, background work stays allowed. The hook does not cover the tool `Agent`: Whether an agent runs in the background is not reliably stated in the call (#1081).

**When something goes wrong:** The runner distinguishes three cases. **Infrastructure false start** — the session itself ends with exit ≠ 0 (auth expired, CLI broken): hard stop, the issue stays untouched in Ready, because nothing is wrong with it; the CLI error message is directly in the console log. That way a broken environment does not clear out the whole Ready column. **Functional failure** — the session ends cleanly (exit 0), but the issue is not in In review: the runner comments on it and puts it back into the backlog, and the run continues with the next issue. A **timeout** (`--timeout-min`) counts as issue-specific — the session ran out of time — and is treated like a functional failure; **why** it ran out does not follow from this and is at most in the note on the package (see [The time-limit abort](/en/dokumentation#the-time-limit-abort)). If a round without a result leaves an unclean working tree and the rescue (salvage, see below) fails as well, the runner secures the leftovers with `git stash push --include-untracked -m "nachtrest #<id> <lauf>"`: Exactly what counts as a leftover is secured, including unversioned files. The card goes to the backlog, its comment and its run status `abgebrochen` name the stash, and the run continues with the next package. That way a package that fails at itself only stops itself, and still nothing is built on half-finished changes. You get the leftovers back with `git stash list` and `git stash apply stash@{<n>}`. A package that depends on a package aborted in this run goes back at the dependency gate as before and additionally shows the run status `wartet` with „hängt an #N (abgebrochen in diesem Lauf)“ (depends on #N, aborted in this run). A hard stop (exit ≠ 0) remains where a commit may be incomplete: for leftovers after a **successful** round, for a rescue that committed or pulled the card to In review and still leaves leftovers, and when the leftovers cannot be secured. Every package appears with its run status on its own card: `laeuft` at the start of the round, `fertig` at In review with proof, `wartet` at a halt and otherwise `abgebrochen` with a reason. Before the start the runner also checks: no issue in In progress (crash leftover), clean working tree, `buildChecks` present.

**The fourth outcome: `angehalten`.** An implementation session decides instead of asking: Whatever is unclear during implementation and is not in the stop class from `CLAUDE-workflow.md` is decided and recorded in the completion report under `### Entscheidungen`. If, however, a question of the stop class comes up, the session does not choose but **halts**: It takes back its own share of the changes, marks the issue with `kit:klaeren`, states the question as a board comment and moves it to the backlog. The runner recognises this by the comment, writes a log line of its own and **keeps running**.

This outcome must be distinguished from the two neighbouring ones, and that is exactly why it has a name of its own:

| Outcome | What happened | Who comments and moves | Consequence for the run |
|---|---|---|---|
| `zurueckgestellt` | the session did not get the task finished | the runner | continue with the next issue |
| `angehalten` | the task is solvable, but a decision is missing | the session itself — the runner does nothing here | continue with the next issue |
| `harterStopp` | the environment or the working tree is broken | nobody, the issue stays untouched | the run ends |

A halt is **not a failure**: The session acted correctly by not guessing. That is why it appears in the result state as a counter of its own next to `erfolg`, `zurueckgestellt` and `fehlschlag` — whoever had to look for the waiting decisions in the deferral count in the morning would not find them. The way forward leads via `/fachplan #T`: The skill takes the halted task together with the decision comment as input and turns it into a business requirement. The same number form has a second input — an `[Idee]` that calls for a trade-off; if there is nothing to weigh up about it, `/task #N` is the way instead. Only the human removes `kit:klaeren` in the process.
