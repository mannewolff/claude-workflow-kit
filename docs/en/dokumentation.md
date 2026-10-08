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
