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

**At least one check belongs on the package stage.** If all entries carry `push` or `merge`, nothing runs before the commit: Implementing a work package then has no gate. At night this is no silent state — the night runner checks it at start and does not start at all (override: `--no-checks-ok`). The [settings interface](/en/dokumentation#settings-through-the-interface) (Einstellungs-Oberfläche) reports this state as a warning; such a configuration can still be saved, because it is valid.

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

**The output of a red check is kept as a file.** Every command that is not green stores its complete output under `.claude/checks-protokolle/<nn>-<kurzname>.log`, numbered in config order. The report line ends with `— Ausgabe: <pfad>` ("output: `<path>`"), and the entry in the summary carries the field `protokoll`. That way a red can be examined without running the same run a second time, even if a session's tool output cuts out the middle (#1196). Every real run empties the folder, a carried-over one leaves it in place together with the path. If storing fails, a notice on stderr is all; the outcome of the run does not change. The night runner's leftover guard does not count the folder as abandoned work.

**A hanging check is aborted.** Every check has an abort limit: **five times the median** of its last green runs from `.claude/ausfuehrungen.tsv`, **at least 3 minutes**, **15 minutes** without a green history. If it exceeds the limit, `run` ends its whole process group, first with SIGTERM, after 5 seconds with SIGKILL. That way the abort also hits a grandchild such as `node --test` → `board.mjs`. The check is then **red** with the note `haengend: nach <s> s Grenze abgebrochen` ("hanging: aborted after `<s>` s limit"), in its report line, in the output and in the summary (field `haengend` with `grenzeMs`). The log records it as `rot` so that it does not shift the median of the green runs. If `checks.mjs` itself is ended (SIGTERM, SIGINT, SIGHUP), it also ends the groups of its running checks; a SIGKILL to `checks.mjs` cannot be caught. The occasion was a test that hung for half an hour in the night of 30.09.2026 until the session's tool gave up (#1077). The upper limit per check of 30 seconds (`PRUEFDAUER_OBERGRENZE_MS`, field `ueberObergrenzeMs`) remains what it is alongside: a note, never an abort.

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

**At most one entry carries the block.** Two measurements would need a precedence rule about which mark triggers the stop, and nobody would read it. If an entry carries `guete`, its `stufe` must not be `merge` — a measurement only before the release would come too late to change anything. `checks.mjs` rejects both at start instead of choosing silently; the [settings interface](/en/dokumentation#settings-through-the-interface) checks the same rules before saving.

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

Staffing and perspective of the three review levels: the functional concern, the plan to get there, the single work package. While issueReview describes WHO reviews at all, this states how many review per level and in which roles. 'rollen' must contain exactly 'reviewer' distinct, non-empty names — otherwise a hard error. If the whole block is missing, each level uses the roles of the role catalogue with one reviewer per role: fachlich 'form-beobachtbarkeit' and 'abgrenzung', plan 'architektur-bestand' and 'schnitt-abhaengigkeiten', issue 'pruefbarkeit'; if only one level is missing in an existing block, that is an error. Applies team-wide; a different value in workflow.config.local.json is ignored.

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
<!-- de: e4f61530d772 -->

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

**The check runs and the target mark appear in both reports.** A measurement is only useful if someone reads it, and the night reports in two places: The implementation night writes its check report to the console and into the daily log, the chain leaves its night report as a comment on the marked card. The block `Prueflaeufe und Zielmarke:` (check runs and target mark) appears in **both** places — in the log below the checks of the sessions, in the night report under `### Umsetzung` — and carries one line per package with the round duration, the number of check runs, of those the `volle` and the `Gruppenlaeufe` (group runs), and the number of completion attempts. If no session of the card measured, the line says `Prueflaeufe nicht gemessen` (check runs not measured) and names no zero. Below it the sum: `- N von M Paketen unter <marke> Minuten.` (N of M packages under `<mark>` minutes) — the mark is `night.zielUmsetzungMin`, without the field the default 10 applies. Only units that went through an implementation round are counted; the business plan unit of the chain and packages without a session stay out. The calculation uses the round duration including all checks and corrections, and it is calculated in the report — a second copy in the file would be the same truth in a second place. **Gaps in the mapping** appear alongside: If the check summary of a package carried files without an area pattern (`ohneZuordnung`), the report names **every** one of them by name. That colours nothing red — the completion of the package stays untouched; it is a finding for the morning that an area needs a pattern.

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

**No `cd` into the release worktree (Issue #1372).** `/push-main` and `/merge-production` create their worktree under the temp directory. Claude Code resets the working directory away from there after every call, and `cd <pfad> && node .claude/kit/checks.mjs …` would drop out of `excludedCommands` under the rule above. The skills therefore name the worktree in every call themselves: `git -C <pfad> …`, `node .claude/kit/checks.mjs run --in <pfad> …` and, for any other command, `node .claude/kit/worktree.mjs im <pfad> -- <kommando>`. `worktree.mjs anlegen` returns the path as a realpath, because `npm ci --prefix` fails through the macOS symlink of the temp directory. Anyone who still wants to work with `cd` in the worktree adds the temp directory and its realpath under `permissions.additionalDirectories`.

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

#### The halt at a protected file
<!-- de: 942f31be7081 -->

**A protected file (geschützte Datei) is not a question but an action.** Some files may only be written by a human — in the kit, the settings under `.claude/` (`settings.json`, `settings.local.json`, `.claude/hooks/`). If a package has to change one of them, it halts, and it does so with the label `kit:geschuetzt` instead of `kit:klaeren`: With `kit:klaeren` a decision is waiting, with `kit:geschuetzt` an action. Like `review:fertig`, the label has to be created once per board; the machine sets it, only the human may remove it. The halt comment begins with `## Geschuetzte Datei` (protected file), names every file with the quoted line from the package and records as its last line `Label kit:geschuetzt gesetzt` (label set) or, if the label is missing on the board, `Label kit:geschuetzt nicht gesetzt` (label not set). The run does not abort because of the missing label; the card is only released, however, after a halt with the label set.

**Before the start.** The night runner checks every Ready package against the protected paths before a session begins: If the task or the acceptance criterion names a protected file and the package is not released, it goes to the backlog, gets the label and the halt comment, and the run continues. In the **implementation stage of the chain** (variant B) the package is already in the backlog; there the runner sets label and comment without a move, and every package that depends on it gets the dependency comment and stays put as well. The same check is delivered by `issue auftrag` during the day with the consequence `geschuetzt`.

**When only the writing fails.** If the package does not name the file and Claude Code rejects the write access, the session halts by itself: take back its own share by name, backlog, label, halt comment via `issue check-geschuetzt <id> --pfad <pfad>`. If it does not follow this and leaves an unclean tree without a halt, the runner catches the case: If its stream carries a rejected `Write` or `Edit` on a protected path in `permission_denials`, it secures the intermediate state in the stash `nachtrest #<id> <lauf>`, moves the card to the backlog, records the halt together with the location of the intermediate state and continues with the next package.

**In the report** the halt appears with the kind `geschuetzt`, separate from the stop questions: as a key figure of its own „Geschuetzte Dateien“ (protected files) and under „Wartende Handlung an geschuetzter Datei“ (pending action at a protected file), not under „Offene Stopp-Frage“ (open stop question).

**The way back:** make the change to the file yourself, remove the label `kit:geschuetzt`, move the card to Ready. On the next attempt the package counts as released and runs through normally.

**An old initiative note is not a leftover.** Until Spec-Driven Development was dismantled, `/techplan` stored waiting notes as `.claude/vorhaben-wartend-<k>.md`. Today none are created any more; where one still lies around, the leftover guard does not count it as a leftover — also in a project whose `.gitignore` does not cover `.claude/`. The file can be deleted.

**Salvage — when the work is finished but the board does not know it.** A headless session has no follow-up turn. If it starts a long check in the background and ends its turn before the result is there, the result is lost — the board shows a failure although the work was complete. Before the runner stops hard on "not in In review AND dirty", it therefore checks for itself — with **`node .claude/kit/checks.mjs run --abschluss <id> --frisch`** in the project, that is exactly the run that the completion of a card also performs. The route via `checks.mjs` is the core of the matter: This run leaves the summary `.claude/checks-summary.json`, and **it is exactly what the commit gate reads**. When the runner used to run the `buildChecks` itself, it measured green at a place the gate does not know — the summary still held the session's red result, and the salvage session could not commit: In this situation the rescue could never succeed. Now there is one truth about "green" instead of two. `--frisch` belongs to it, otherwise the command would, on an unchanged state, adopt exactly the red result the runner doubts; `--abschluss <id>` keeps the scope of a card completion (package stage, without integration checks (Zusammenspiel-Prüfungen) and without quality measurement) and assigns the run to the card. With the route comes its **area-based selection**: The checks of the touched areas run — a separate, further selection would again be the second truth that the incident cost. Checks with `stufe` `push` or `merge` stay out as before, they are only due at publishing. If the checks are green, **exactly one** salvage session per issue gets the chance to check the intermediate state against the issue, commit it and move the board (time limit 10 minutes; it no longer runs any builds). Red checks and a failed attempt each have a log line of their own. Without a commit the leftovers go into the stash and the run continues (see "When something goes wrong"). The pre-check merges the `env` block from `.claude/settings.json` and `.claude/settings.local.json` into its environment — otherwise it lacks project-specific variables (for Testcontainers, for example) that otherwise only Claude Code's own Bash calls get, and it reports a false red.

**If the salvage does not carry, there are three end states — not one.** They call for three different moves in the morning. The first secures the leftovers in the stash, and the night continues. The other two end in a hard stop, because a commit may be incomplete there. Log line, board comment and the `grund` of the result state therefore name them:

| End state | What the runner found | What to do about it |
|---|---|---|
| `SALVAGE-VERSUCH gescheitert` (salvage attempt failed) | no new commit, card not moved | the session left nothing behind; the leftovers are in the stash `nachtrest #<id> <lauf>`, reason and run status name it |
| `SALVAGE UNVOLLSTAENDIG` (salvage incomplete) | new commit, card not moved | the work is local — the commit hash and the paths left behind are given with it, only the board move is missing |
| `SALVAGE WIDERSPRUECHLICH` (salvage contradictory) | card in In review, working tree unclean | the card claims more than is committed; the affected paths are given with it |

Whether a commit was made is told by comparing the commit hash before and after the salvage session: Before the regular round the working tree is clean, so a new commit is the only trace it reliably leaves. **The salvage only moves the board with a clean working tree** — its instruction prescribes the order: commit, see `git status --porcelain` empty, only then move. Without that, the third case would be the rule instead of the exception.

**So that it does not come to a salvage in the first place.** The rescue move treats the damage, not the cause — and three times it did not carry, because the checks were red afterwards. Since v1.54 the runner therefore puts two things in front of it:

- **The `Monitor` tool is blocked for implementation sessions** (`--disallowedTools Monitor`), and their Bash time limit is set to the round time limit (`BASH_MAX_TIMEOUT_MS`, `BASH_DEFAULT_TIMEOUT_MS`). `Monitor` is the tool with which a session waits for a background run of its own — and that is exactly how it ends its turn. Without the tool it is left with the foreground call, whose result it can still use; without the raised time limit it would die after ten minutes on the clock instead of on the code. This is a guardrail, not a request: The instruction to actively wait for a background check has been in the `local-check` skill for a long time and was in the context of exactly the sessions that nevertheless ended waiting.
- **The runner only measures once no process of the session is running any more.** After a session ends it waits for its process group, at most until the rest of the round time limit. Otherwise the salvage pre-check would start its own build next to one still running — two simultaneous Testcontainers runs snatch the resources from each other, and the red says nothing about the code. If something is still running after the deadline, a note appears in the log and the run continues.

**The waiting session (wartende Sitzung).** Since v2.0.3 the rule applies to every unattended session: **No session ends with its own work still running.** It waits for the result of the long work it started, or aborts that work and reports the abort as a failure. Background work explicitly stays allowed; the only thing not allowed is to stop while it is still running. If a session does so anyway, this used to look like a regular end without a commit — that is, like giving up, although the work may have been almost finished.

**It is recognised by the closing text**, not by the tool and not by the time: phrases such as „warte auf" (waiting for), „läuft noch" (still running), „im Hintergrund" (in the background) or „sobald … fertig ist" (as soon as … is finished). **Waiting for a human does not count** — if the closing text speaks of an answer, feedback, an approval, a GO, a clarification or a review, the session has lost nothing: Its question is on the board, and the halt route above has already recorded it. Only the closing text is read; a waiting message in the middle of the run has no consequence, because whoever finishes later says something different at the end.

**What the runner then does.** The round gets its own reason — the same line in log, board comment and `grund` of the result state, see the table below. The work package gets a comment under the anchor `## Nachtlauf: wartende Sitzung` (night run: waiting session): the case, the last known state (the closing text, shortened from 2,000 characters) and, if there are any, the leftovers in the working directory. The unit in the result state carries `wartendBeendet: true`. Nothing changes in the flow: With a clean working tree the package goes back to the backlog like on any failure and the run continues. The next session that picks up the package names the note instead of silently continuing halfway.

**With an unclean working tree the salvage comes first.** If it rescues the round, that is the end of it — then nothing was lost, and a second verdict on the same event would be a second truth. If it is not possible (red checks) or has failed, reason, note and `wartendBeendet` are added; with a failed salvage the reason of the waiting session comes **before** its end state from the table above, because these are two events: why the regular round left nothing behind, and what the salvage found.

**In the night chain** a stage session with a waiting closing text ends as `abgebrochen`, with the same reason, and its note is attached to the document of the stage — to the plan, to the package. The only exception is the stage `abdeckung`: Its information *is* a text about running work, and a detection there would discard the finding precisely when it has something to say.

**It is counted.** `aufwand.mjs` keeps the sessions that ended waiting as a figure of their own and names them in the finding in a line of their own — also at zero, and then explicitly as zero: The case is rare, and silence would leave open whether it did not occur or was not counted.

**The hard stop names the reason, not only the state.** Up to v1.53 the log said „nicht in In review UND Working Tree dirty" (not in In review AND working tree dirty) — that is the consequence. Whoever reviews in the morning now distinguishes five cases with five different next steps:

| Prefix in the log | What happened |
|---|---|
| `Grund: Session regulaer beendet ohne Commit (end_turn)` | The session ended normally without finishing (reason: session ended regularly without commit) |
| `Grund: Sitzung hat auf eine selbst angestossene Arbeit gewartet und ist ohne Ergebnis beendet worden` | The session started a long piece of work and waited for it — headless there is no follow-up turn, see above (reason: session waited for work it started itself and was ended without result) |
| `Grund: Session am Zeitlimit beendet` | The session ran out of time; what it ran out on is said by the note on the package — not by this line (reason: session ended at the time limit) |
| `Grund: Session mit is_error beendet` | Abort (reason: session ended with is_error) |
| `Grund: Pflichtcheck rot — <Kommando> (Session)` or `(Vorpruefung des Runners)` | Work on the code; the red command and the last 15 lines of its output are given with it (reason: mandatory check red, in the session or in the runner's pre-check) |

The reason appears in the log, in the board comment and in the `grund` of the result state — the same line in all three places. So that `stop_reason` is available at all, the implementation run has **always** requested the stream output since v1.54, even with the history log switched off (`--verbose no`); the former field `kennzahlenHinweis` in the result state has thereby been dropped.

**Platform shell for `buildChecks` and `formatFixCommand`.** Both values are freely configured command lines and therefore necessarily need a shell — unlike the fixed commands of the board adapter, which has managed entirely without a shell since v1.27. The runner starts them in `/bin/sh`. **Consequence:** The same command line applies on macOS, Linux and WSL2. You write chaining with `&&`, pipes, redirections such as `2>/dev/null` and variables such as `X=1 npm test` in POSIX syntax, once for all platforms. The variables the night runner sets for its sessions (`LAUF_VARIABLEN` in `kit/night/laufvariablen.mjs`, for example `NIGHT_ISSUE_ID`, `NIGHT_KETTE_STUFE`, `KIT_NIGHT_RUN`, `KIT_AGENT_MODEL`) are not inherited by the check commands; whatever is in the command line or in the `env` block of the `settings.json` still applies.

**`formatFixCommand` — a format violation must not topple a run.** If you set a command in the `workflow.config.json` that repairs formatting mechanically (`"formatFixCommand": "mvn spotless:apply"`, for frontends for example `"npx prettier --write ."`), it runs **exactly once** on red checks in the salvage pre-check, and the checks are repeated **exactly once**. If they turn green as a result, the run continues and the log shows the intervention with `FORMAT-FIX angewendet` (format fix applied) — no silent intervention. If they stay red, the format was not the cause, and the package aborts, its leftovers go into the stash. Background: A single wrongly wrapped Javadoc comment once ended a complete night run although the work was correct. A format violation can be fixed deterministically and says nothing about the functional quality — a failed test, by contrast, does, and with it the package aborts. Without the field nothing changes.

### The time-limit abort
<!-- de: 31984bf58642 -->

**A session that ends on the clock leaves a note.** Up to v3.3 all that remained of the time limit was the reason `Grund: Session am Zeitlimit beendet` (session ended at the time limit) — in the morning the card said *that* time ran out, but nothing about how far the session had got. Since then the runner attaches a comment under the anchor `## Nachtlauf: Zeitgrenze erreicht` (night run: time limit reached) to the work package in this case. It carries four things: the limit this round reckoned with (if it is missing, it says „Grenze nicht bekannt" — limit not known — and no invented number); the **state according to the session's own account**, that is the lines `FORTSCHRITT: AK<n> — …` it reported along the way; a **recommendation** to the human to cut the package into parts, expressly as a suggestion and **not a requirement**; and the leftovers in the working directory, if there are any.

Three states of the progress are distinguished and appear differently in the text: „nicht beobachtet" (not observed — the round ran without a stream), „keine Auskunft" (no information — the session did not report a progress line up to the abort) and the reported state itself. Merging the first two would be the same lie as a 0 for a missing measurement. Structurally there is no closing text: At the time limit the session is killed together with its process group, a `result` event never arrives.

**Nothing follows from the abort about its cause.** That time ran out does not say whether the package was cut too large, whether the session lost its way or whether a single run took unusually long. The note says this itself — and that is why no other place says anything different either: neither the reason table above nor the timeout paragraph in "When something goes wrong".

**The case is counted twice.** The unit in the result state carries `zeitlimitBeendet: true` — the field is missing where the case did not occur, instead of carrying `false`: A `false` would claim a measurement that did not exist. The run header of the same state carries `zielUmsetzungMin`, the target mark this run reckoned with; the evaluation measures every state against its own mark instead of against today's configuration, because that may have been different between two nights. What becomes of it is described under [Effort of the process](/en/dokumentation#effort-of-the-process).

**Visible beforehand already: the estimate on the package.** Since `/issues`, every work package carries the line `Sitzungsumfang: passt | reisst — <ein Satz>` (session scope: fits | breaks — one sentence) in its `## Kontext`. The stage block of the chain's night report summarises them and ends with the line `- Voraussichtlich über der Sitzungszeitgrenze: #N, #M` (expected to exceed the session time limit); if there is no such case, it says „keine" (none), and a package without the line appears as „#N nicht eingeschätzt" (#N not estimated) — a missing verdict is not a good one. Without this line you would have to open every card in the morning to find the large packages.

**The yardstick of the estimate is the time limit of *one session*** — `--timeout-min`, default 60 minutes, also in the night chain, where every session starts with the same limit. Expressly **not** meant is `night.kette.umsetzungMin`: That is the budget of the whole implementation stage, is only checked between two sessions and says nothing about a single package. Nor is the target mark `night.zielUmsetzungMin` meant — it is a benchmark for the evaluation, not an abort limit.

### Second mode: the night chain
<!-- de: 7917d98cdeac -->

**Since the process rework (September 2026) there have been two operating modes: the implementation night above and the night chain.** The former modes review and generation were dropped from the runner with stage 2 of the rework; the check chain behind them — marker as gate, finding classes, synthesis, routing label per stage — already went with stage 1 (implementation plan in `docs/prozess-umbau-stufe-1.md`). The chain replaces both: A business requirement goes in in the evening, and in the morning a reviewed plan, the work packages and a report are attached to it — or a finished plan goes in and comes back out as work packages (see [A finished plan as an order](/en/dokumentation#a-finished-plan-as-an-order)). What happens to the packages afterwards is decided by the **variant** (Variante) of the marked card: Under **variant A** the chain implements **nothing** — the packages stay in the backlog, the GO to Ready is still yours, and the implementation is the night after. Under **variant B** the chain moves the packages to Ready itself and implements them in the same night — your GO then already lies in the marking of the card, no longer in the individual move to Ready.

**The gesture:** the label `kit:night` on the groomed `[Fachlich]` issue in the backlog — or on a finished `[Plan]` document, see [A finished plan as an order](/en/dokumentation#a-finished-plan-as-an-order). The runner **consumes it at the start** of the chain — every setting authorises exactly one chain; an abort leads to a report with a reason and a new gesture, not to a silent repetition. The label name comes from `night.kette.label` and has to be created once on the board (GitHub `gh label create`, kanban-kit `POST /api/boards/{boardId}/labels`).

**The review as a prerequisite.** The chain label alone is no longer enough: At the start of the run the marked card must additionally carry the label `review:fertig` — the business requirement just as much as the plan document of a plan order (Plan-Auftrag). The way there is `/issue-review <Nummer>`, which reviews the card and sets `review:fertig`. If it is missing, the card is skipped: It keeps its chain label, the gesture is not consumed, and it gets once the comment with the anchor `## Kette nicht gestartet: Pruefung fehlt` (chain not started: review missing), which names the reason and the way via `/issue-review`. This is a different case from the run status `Kette nicht gestartet` (chain not started) after a failed reviewer pre-flight: There the reviewers were not reachable, here the review of the requirement itself is missing — both begin with the same text, but the hint is a comment of its own with an anchor, while the pre-flight finding is in the run status. Like `kit:night` and `kit:durchziehen`, `review:fertig` has to be created once on the board; if not a single card carries it, the runner reports this in the log.

**The variant:** a second, independent label on the same card, `kit:durchziehen` (`night.kette.varianteBLabel`), marks it for variant B. It is read where `kit:night` is as well — for a plan order, that is, on the plan, not on the business requirement behind it. Unlike `kit:night` it is **not consumed** — it stays on the card, because it marks the card itself and not just the one run; a later chain for it (for example after `angehalten`) reads it again. If it is missing, variant A applies. Like `kit:night` it has to be created once on the board.

**Start:**

```bash
node .claude/kit/night.mjs --kette --dry-run   # candidates, reviewer state, budgets — starts nothing
node .claude/kit/night.mjs --kette             # real run
```

Flags: `--max <N>` counts **chains** here (default 3); `--model <id>` and `--verbose` as above — so the live history log also runs here without a flag, `--verbose no` switches it off. `--label` does not apply here — the chain reads its label from the config, and `--kette --label` is rejected. The runner rejects the switches of the dropped modes with a hint at `--kette`; an old routing label that is still set gets a log line, no effect. The `buildChecks` requirement does not apply to the chain: It builds nothing and commits nothing.

**Conditions:** A candidate carries the label, has the title `[Fachlich]` (or `[Plan]`, see [A finished plan as an order](/en/dokumentation#a-finished-plan-as-an-order)), is in the **backlog** and carries no `kit:klaeren` — there an answer is waiting that has to be in the plan beforehand. A card without either prefix is skipped with the reason that the marker applies to the business requirement or to the plan document. Whatever carries the label but may not run appears with a reason as `uebersprungen` in the result state, and the label stays. Before the first chain the **reviewer pre-flight** runs as before: a pre-flight session of its own checks the reviewers and the tracker in the environment of the sessions, not in the runner (see the allowlist below). Even before that, every candidate is set in the [run status](/en/dokumentation#the-run-status) to `lauf:laeuft` with „Lauf angenommen um …, Vorabprüfung läuft“ (run accepted at …, pre-check running) — if the run dies in the pre-check, the card is thus not left without a trace. If the pre-flight fails, this becomes `lauf:abgebrochen` with `Kette nicht gestartet um <Zeit>: <Grund>` (chain not started at a time, with reason) in the run status, every candidate keeps its label, and the run ends hard — the gesture is not consumed, because nothing ran. A comment of its own is no longer created for this. A dry run sets no status. Unlike the implementation night, the chain requires **neither a clean working tree nor an empty In progress column**: It works in a worktree of its own and runs alongside an implementation night.

**The worktree.** Every chain gets a `git worktree` under the temp directory (`kette-<repo>-<F>-<stempel>`), into which the runner mirrors the main copy's `.claude/` — kit copy, skills, settings, tokens —, without the logs. With the local tracker, the config in the worktree points to the `issues` directory of the main copy, so that the cards are created there. After the chain the worktree is removed, and worktrees left behind are cleaned up by the next start.

**The flow per stage**, each with its own session in the worktree and `KIT_AGENT_MODEL` set:

| Stage | Session | Result | when the chain ends here |
|---|---|---|---|
| plan | `/techplan #F` | a `[Plan]` document with `Fachliche Quelle: Issue #F` — if there are several, the most recent | no plan: `abgebrochen`; stop question in `## Offene Fragen`: `angehalten` |
| form check | `issue check-form` in the chain's worktree, on red a correction session with exactly the violations; if test hints remain on the plan, the runner writes them as a comment `## Testhinweise der Formpruefung` (test hints of the form check) on the plan | green form, up to `korrekturrunden` rounds per document; test hints stop nothing | still red: `abgebrochen` |
| review | `/issue-review #M` — the reviewer of the stage `plan` | marker `Plan-Review:`, findings and incorporation as comments on the plan | `kit:klaeren` on the plan: `angehalten` with the question from the last comment |
| pakete | `/issues #M` | only cards with `Plan: Issue #M` count; each goes through the form check | no package and the comment `Kein Eingang für /issues` (no input for /issues) on the plan: `angehalten`; no package without it: `abgebrochen` |
| abdeckung | a reading session holds the packages against the business plan | its text — mapping, without package, growth — in the result state and in the report | never: The coverage is information, not a gate; if it is missing, the reason is in the report |
| umsetzung (variant B only) | `/implement-next #P` per work package, word for word as in the implementation night | package moved to Ready, implemented (In review) or deferred; the session learns nothing about the chain, it sees a regular Ready package | lock `night-umsetzung.lock` already held **or** main copy unclean before the first package: stage skipped, fallback to variant A, `unvollstaendig`; hard stop: `abgebrochen`; at least one package halts on a stop question: `angehalten` (the package already carries `kit:klaeren` itself, the business plan gets no second halt) |

Other new cards without the origin line appear as „nicht zuordenbar" (not assignable) in the report; if the coverage session writes to the board contrary to its instructions, the report records that too.

**A chain without an executed implementation is not called successful.** If the stage `umsetzung` skips its work — because another implementation holds the lock or the main copy is unclean before the first package —, the chain ends on the outcome `unvollstaendig`, not on `fertig`. It lies between the two: The chain ran through and did not do something that was ordered; it holds nobody up (unlike `angehalten`, no question is waiting for you) and nothing broke (unlike `abgebrochen`). On the board the event appears **yellow without an error class**, the reason is in its excerpt. The night report names under `### Umsetzung` as its first line `- ausgelassen: <grund> — die Pakete bleiben in Backlog.` (skipped, with reason — the packages stay in Backlog), and the reason with the prefix `Umsetzung ausgelassen:` (implementation skipped) is already up top under `### Ausgang`. That way you can see in the morning without looking into the log that the order "push the packages straight through" was not carried out, what prevented it and where the packages are now. Before, this case could not be told apart from a successful night. **The lock itself stays:** Two implementations in one working directory do not work, the chain does not wait for it to become free and falls back to variant A immediately as before. The only thing that has changed is what you see afterwards. You move the packages to Ready yourself in the morning.

**Without review approval, variant B falls back to variant A.** If the project carries `issueReview.requiredBeforeReady: true`, the stage `umsetzung` checks every package with the same gate as the implementation night — and packages freshly cut by `/issues` do not carry a review marker yet. Every package thereby drops out of the stage and stays commented in the backlog; for this night the chain ends as under variant A, with a reviewed plan and packages in the backlog, without implementation. The report names the reason per package.

**If the review stage aborts after the findings are already on the plan**, the chain leaves the comment `## Review unvollstaendig` (review incomplete) there with the reason for the abort and the way forward (`/issue-review #M` by hand). This gap is exactly what an abort hits most often — the incorporation comes at the end of the stage —, and without a note the document later looks like an unreviewed one: The review has been paid for, the findings are on the board, the body carries no `Plan-Review:` marker. The note does not change the outcome, it stays `abgebrochen` with its reason.

**Three outcomes**, exactly one per chain: `fertig` (plan reviewed, packages are in the backlog), `angehalten` (a question of the stop class is waiting for you) and `abgebrochen` (failed technically or on the budget, with a reason). Abort reasons are: no plan or no package created; form still violated after the correction rounds; time budget of a stage exhausted; cost budget exceeded — checked **after** the session, never in the middle, because a half-written document would be the more expensive mistake; false start of a session; a stage session that stopped with its own work still running ([The waiting session](/en/dokumentation#night-mode), the exception is the stage `abdeckung`) — it leaves its note on the document of its stage. An abort only ends this chain, the next candidate gets its turn.

**Budgets** are in `night.kette` of the `workflow.config.json`, all optional, with these starting values:

```json
{
  "night": {
    "kette": {
      "label": "kit:night",
      "varianteBLabel": "kit:durchziehen",
      "planMin": 20,
      "reviewMin": 15,
      "paketeMin": 15,
      "abdeckungMin": 10,
      "umsetzungMin": 120,
      "vorbereitungMin": 120,
      "kostenUsd": 50,
      "kostenUsdB": 150,
      "korrekturrunden": 2
    }
  }
}
```

`varianteBLabel` marks the marked card for the implementation stage (variant B); `umsetzungMin` is its time budget, `kostenUsdB` its own cost cap.

The minutes apply per stage (correction rounds count against their stage), `kostenUsd` per chain across all sessions, `korrekturrunden` per document. The chain always requests the session stream: Cost and key figures are in the result state per stage (`art: "kette"`, the budgets in the run header); a session without a key figure counts 0 and increases `kostenUnbekannt`. If the block or individual fields in it are missing, the starting values apply — and that is visible: Before the first chain a log line names the affected fields with their value, and the run header of the result state carries them as `budgetAusDefault`.

**The report on the marked card.** With every outcome the chain leaves a comment with the anchor `## Nachtbericht, Kette <stempel>` (night report, chain) — on the card on which you set the label, for a plan order that is on the plan: the outcome with reason; the stages (first the order — `Plan #M (fachliche Quelle #F)` or `fachliche Anforderung #F` —, then the variant, then the plan with duration, cost, correction rounds, reviewer and marker, for an adopted plan instead `als Auftrag uebernommen, nicht neu geschrieben` (adopted as an order, not rewritten); packages with titles; cards that cannot be assigned); **all decisions of the night**, numbered consecutively — the bullet points from `## Architektonische Entscheidungen` of the plan verbatim and the `Entscheidung:` lines from the context of the packages; the rejected findings from the comment `## Einarbeitung, Runde 1`; the coverage; key figures (packages reached, duration since chain start, number of decisions and stop questions, cost out of budget, `kostenUnbekannt`); with `angehalten` the open stop question; superseded plans; under variant B the section `### Ursprungsdokumente` — which origin documents (Ursprungsdokumente) have moved to In review or, if the plan is not through, why not and which packages are missing. It ends with the sentence `Dieser Bericht ist Verlauf. Verbindlich fuer die naechste Kette wird eine Entscheidung erst als Satz im Fachplan.` (This report is history. A decision only becomes binding for the next chain as a sentence in the business plan.) — and that is exactly the morning ritual: read the report, review plan and packages, write what is to apply as a sentence into the business plan, move packages to Ready.

**Waiting reports.** If the tracker does not accept the comment, the report lies as `.claude/night-bericht-<F>-<stempel>.md` in the main copy — not a leftover in the working tree, like `night-run-*` —, and the field `bericht` of the unit names the path. At the next start of any operating mode (not in a dry run) the runner delivers waiting reports and deletes the file; if the tracker stays dead, the file stays and the run continues.

**The way back after `angehalten`.** The chain writes the one question as a comment `## Kette angehalten` (chain halted) on the **marked card** — the one on which you set the label in the evening — and sets `kit:klaeren` there; plan and the packages cut up to then stay as a draft. The way forward leads via the **plan**, and the comment lists its steps: the answer as an entry under `## Architektonische Entscheidungen` of the plan, `## Offene Fragen` back to `- Keine.` (an addition after it is allowed), `/issue-review #M`, remove `kit:klaeren` from the plan and from the business requirement, finally `kit:night` on the plan. The next chain then takes it as a **plan order** and continues from the stage `pakete` on. The answer does **not** belong under `## Offene Fragen`: There the chain reads it as a further open question and skips the plan with your own answer text as the exclusion reason. If instead a new plan is created (because you start again from the business plan), it is the valid one; older plans for the same business plan get the comment `Ueberholt durch Plan #M2` (superseded by plan #M2; no label, no move) and appear in the report under „Ueberholt" (superseded). The chain reads each of these comments back once; if it does not find it on the card again, it continues, but lists the plan not as superseded but with a reason under „Ueberholt, nicht bestaetigt" (superseded, not confirmed) — a report that claims an action nobody sees on the board is worse than none. `kit:klaeren` is removed exclusively by the human — a run that was allowed to clear its own `kit:klaeren` could release itself.

**Chain and implementation side by side.** The two operating modes mean different cards and columns: `kit:night` on the business plan in the backlog, `kit:nightrun` on the work package in Ready. A run is always exactly one operating mode (`--kette` or not), but two runs may drive at the same time — the chain in the worktree, the implementation in the main copy. One restriction applies under **variant B**: Its stage `umsetzung` builds in the main copy like the implementation night, not in the worktree, and both take the same lock `.claude/night-umsetzung.lock` for it — whoever holds it first builds. The implementation night skips its implementation when the lock is taken; the chain waits and tries again every 60 seconds, at most until its implementation budget (`night.kette.umsetzungMin`) is used up — the waiting time counts towards it, the run status stays `läuft` with the text „wartet auf die Umsetzung seit …“ (waiting for the implementation since …). If the implementation does not become free, the chain skips it and ends as `unvollstaendig`. Under variant A the restriction does not apply: The chain never builds, and the lock stays free. **The state of the main copy does not hold up the chain:** Uncommitted leftovers — for example from an implementation night running in parallel — it checks neither beforehand nor after the pre-flight session, because it does not touch the main copy at all. Only under variant B does it measure it once before the first package: If the main copy is not clean then, it skips the implementation **regularly** as with the held lock — the packages stay in the backlog, the reason with the file names is in the report, and the run ends without an error. Cleaning up and moving the packages to Ready yourself is then left to the human.

**One runner per root.** Several chains and check runs may run side by side, also on two computers on the same board. A business root — the requirement together with the plans for it — is processed by exactly one runner. It claims the root during selection: It reads the run status of the card, writes its own run status `läuft` with the lines `Lauf-ID: <host>/<pid>/<stempel>`, `Stand: <Zeit>` and `Position: <k> von <n>`, waits for a confirmation period and reads again. If the most recent run status then belongs to it, the root is its own; otherwise it leaves it out, names it in the log with the reason „bereits von einem laufenden Runner beansprucht (`<Lauf-ID>`)“ (already claimed by a running runner) and enters it in the journal as `abgegeben`, without touching the card further. So you recognise a claimed card by the run status `läuft` with a run ID. **Takeover after a crash:** A run ID counts as dead if on the same computer its process is no longer running, or, from another computer, if `Stand:` is older than position times the total budget of the kind of run plus 15 minutes. Then a later start takes over the root and names the takeover in the log; the marking stays, nobody has to mark again. **Only what belongs to a dead process is cleaned up:** Every worktree and every kit state carries a holder file `<ordner>.halter` with computer and process; a start only removes folders without a holder or with a finished process and names the removed leftovers in the log.

#### How far a chain runs: the goal
<!-- de: 5371e62f2ce1 -->

**The goal (Ziel) says where the chain ends.** Without a further label a chain runs as far as variant and project allow. With a goal label you decide per card how far it should run this time: This business plan you only let be planned and reviewed, that one up to the packages, a third up to the implementation and a fourth up to the prepared publication. The stages are in a fixed order; a goal only determines where the chain ends, nothing can be skipped or rearranged. The goal is attached to the same card as `kit:night` — to the business requirement or to the plan document — and only works together with it: A goal without `kit:night` starts nothing and stays in place.

| Goal | last stage | what is yours in the morning |
|---|---|---|
| `ziel:plan` | `review` | Read the plan, then `kit:night` on the plan. The plan is reviewed, there are no packages yet; the next chain breaks it down as a plan order. |
| `ziel:pakete` | `abdeckung` | Move packages to Ready. Plan, packages and their coverage against the requirement are there, nothing is built. |
| `ziel:umsetzung` | `umsetzung` | Test the packages in In review, then `push main`. The chain moved the packages to Ready itself and implemented them, as under variant B. |
| `ziel:push-vorbereitet` | `vorbereitung` | Read the preparation's message, then `push main`. In addition, version note and change note are ready as a checked commit, see [/push-main](/en/dokumentation#push-main). |

After the end at the goal, the last column appears verbatim in the [run status](/en/dokumentation#the-run-status), in the line `Als Nächstes:` (next) under the header `fertig bis <Ziel>` (finished up to the goal). If a human step (Menschenschritt) is waiting among the packages not yet started (`[Mensch]` card), it says instead `Menschenschritt #<N> erledigen, dann kit:night an #<Karte> — <K> Paket(e) hängen daran.` (complete the human step, then kit:night on the card — so many packages depend on it), and the night report lists under `### Ausgang` under `fertig` per human step the line `wartet auf Menschenschritt #<N> <Titel> — daran hängen #A, #B, …` (waits for the human step with its title — #A, #B, … depend on it) (also the packages that depend on it only indirectly via others).

**The GO is in the goal.** A goal from `umsetzung` onwards is at the same time the GO for the packages of this card, just like `kit:durchziehen`. That stays valid and counts as `ziel:umsetzung`; if both are on one card, the one reaching further applies. Without either of them the night moves no package to Ready. Not even `ziel:push-vorbereitet` releases the push: It remains your trigger phrase `push main`.

**How many models review the plan.** On a business requirement, `planreview:1` or `planreview:2` determines whether one model or two different ones review the plan; there is no more than that. Without a label the project's setting applies. You choose two when a plan seems delicate enough to you. The review stage passes the number to its session as `KIT_PLAN_REVIEWER`.

**Consumed like `kit:night`.** At the start the runner removes `kit:night`, the goal and `planreview:*` together — every setting applies to exactly one run. What was set you read afterwards in the run status in the lines `Ziel:` (goal) and `Prüfer:` (reviewers). If you restart a chain after a halt or after it stopped at the project limit, only a newly set goal applies; without one it behaves like a chain without a goal. `kit:durchziehen`, by contrast, is still not consumed.

**Create the labels once per board.** `ziel:plan`, `ziel:pakete`, `ziel:umsetzung`, `ziel:push-vorbereitet`, `planreview:1` and `planreview:2` have to be created once per board like `kit:night` (GitHub `gh label create`, kanban-kit `POST /api/boards/{boardId}/labels`). Their names are fixed and not configurable.

**What does not fit is rejected before anything is created.** The selection rejects a card with the reason `unpassende Einstellung: …` (unsuitable setting) if it

- carries more than one `ziel:*` or both `planreview:*`,
- carries `ziel:plan` as a plan document (the plan already exists) — meant is `ziel:plan` on a plan document,
- carries a `planreview:*` as a plan document — the number of reviewers only applies on the business requirement, `planreview:*` on a plan document is therefore rejected,
- carries `planreview:*` as a business requirement, but its plan already has a `Plan-Review:` marker.

The card then keeps all its labels and gets once the comment `## Kette nicht gestartet: unpassende Einstellung` (chain not started: unsuitable setting) with the reason and the step that makes it startable again. The gesture is not consumed.

**The project remains the upper limit.** If `night.kette.uebergaenge` blocks a transition before the goal, the chain ends there: The run status shows `lauf:wartet` with `wartet: Übergang <x> im Projekt nicht freigegeben — weiter mit kit:night` (waits: transition not released in the project — continue with kit:night) and names in the line `Grenze:` (limit) the last reachable stage, and the night report additionally writes under `### Ausgang` the line `an der Projektgrenze stehen geblieben, nicht am Ziel <z>` (stopped at the project limit, not at the goal). For the transition into the preparation there is the fifth switch `umsetzungVorbereitung`; without an entry it is `true`, only an explicit `false` stops the chain before the preparation.

**The preparation belongs to the whole state.** If at least one chain reaches the goal `push-vorbereitet`, the stage `vorbereitung` follows once after all chains of the run. It waits until nothing is building any more — until the implementation lock is free and no other run of this project is building —, at most `night.kette.vorbereitungMin` minutes (default 120, waiting and check run together). Then it starts `/push-main vorbereiten` in a worktree of its own; what happens there and how `push main` takes over the state in the morning is described under [/push-main](/en/dokumentation#push-main). Nothing is pushed at night. The message appears as a night report of its own `## Nachtbericht, Kette <stempel> — Vorbereitung` (night report, chain — preparation) on every card that triggered the preparation — with result, checked state, the packages in the state, open checks and, if applicable, the red check together with the cards it touches —, and at the fixed place `.claude/push-vorbereitung.json`. If the deadline expires, the result is called „nicht vorbereitet“ (not prepared) with the reason.

#### A finished plan as an order
<!-- de: 765aa661c420 -->

**The gesture on the plan.** The chain accepts not only a business requirement but also a finished plan document: `kit:night` on a `[Plan]` issue in the backlog starts a **plan order**. That is the way back from a halt (see below) and at the same time the way to have a plan written by hand during the day broken down overnight.

**The four conditions** are the same as for the business requirement, only measured on the other card: The plan is in the **backlog**, carries `review:fertig`, carries **no** `kit:klaeren` and has a recognisable business origin — the line `Fachliche Quelle: Issue #N` in its context. If one of them is missing, the plan is skipped with a reason and keeps its chain label; the gesture is not consumed. This also includes an open question in the document itself: Under `## Offene Fragen` it must say `- Keine.` (an addition after it is allowed).

**What is dropped.** A plan order does **not** run the stages `plan` and `review` — the plan is written and reviewed. The run starts at the stage `pakete` (`/issues #M`) and continues as usual: coverage against the business requirement `#N`, under variant B the implementation. The plan stays untouched: **No** second `[Plan]` document is created, its number moves unchanged into the origin line of the packages and into the report, and **no** older plan gets an `Ueberholt durch Plan` comment. In the report the plan stage therefore appears as `als Auftrag uebernommen, nicht neu geschrieben` instead of with duration and cost.

**The variant on the plan.** The chain reads `kit:durchziehen` on the same card as `kit:night` — for a plan order, that is, on the plan. A `kit:durchziehen` on the business requirement behind it has no effect: **Variant B** only applies if the plan itself is marked.

**Two collision rules** resolve cases where more is marked than necessary:

- **The requirement gives way to the plan.** If a business requirement `#N` carries the chain label and so does a plan created from it, the **plan** runs; the requirement goes to `uebersprungen` with a reason and keeps its label. This also applies if the plan itself is skipped — otherwise the night would plan the requirement anew while the finished plan lies next to it.
- **Of two plans of the same root, the more recent one runs.** If several marked plans carry the same business source, the one with the higher number runs; the older one goes to `uebersprungen` with a reason. Both reasons name the number of the card that runs instead.

A business plan order for one requirement and a plan order for another, by contrast, both run in the same night — the rules only apply within the same root. A card that gives way uses up no `--max` slot.

#### Allowlist for third-party reviewers
<!-- de: 1e6f0f235388 -->

Reviewers with `kind: "claude"` run as subagents and need no permission. A reviewer with **`kind: "command"`**, by contrast, runs via Bash — and if it is not in the allowlist, a permission prompt appears at night that nobody answers. That is not an error with a log line: **The session hangs until the timeout.** So enter the tool before the first review run starts:

```json
{
  "permissions": {
    "allow": [
      "Bash(node .claude/kit/board.mjs:*)",
      "Bash(codex:*)"
    ]
  }
}
```

The entry names the **tool**, not the full command line — for the same reason as with the buildChecks above (prefix matching). Whoever has configured several foreign CLIs enters each one individually. A setup with exclusively `kind: "claude"` reviewers needs none of this.

### The run status
<!-- de: 4bcd7299093a -->

**The state of a run is on the board, not in the process.** Until then it lived in the running runner: If the process died, the knowledge died with it, because the night report is only written at the exit, and a crash is not an exit. That is why every card of a chain or implementation night carries its own state, visible without a look into the log.

**Three labels and a comment.** The card carries at most one of the three labels `lauf:laeuft`, `lauf:abgebrochen` and `lauf:wartet`, plus exactly one comment `## Laufstand` (run status), which is replaced at every change. It names the last step begun and the last step completed, each with a point in time. The comment is a board, not a history; the night report remains the history. Whoever wants to know *what* happened in a night reads the report; whoever wants to know *where* a card stands now reads the run status.

**Abort and halt can be told apart.** `lauf:abgebrochen` means: technically aborted, repeating is enough. `lauf:wartet` says verbatim in the run status what the card is waiting for, in one of three forms:

- `wartet: Übergang <x> im Projekt nicht freigegeben — weiter mit kit:night` (waits: transition not released in the project — continue with kit:night) — the project has not released the transition (see below);
- `wartet: Karte ohne Freigabe zur Umsetzung` (waits: card without release for implementation) — the transition into the implementation is released, but the card carries no `kit:durchziehen`;
- „Halt: Frage wartet auf den Menschen — siehe `## Kette angehalten`“ (halt: question waits for the human — see `## Kette angehalten`) — a halt on the content. The path for it via `kit:klaeren` and the comment `## Kette angehalten` stays as it is.

**Goal, number of reviewers and limit.** If the card carried a goal or a `planreview:*` at the start, their values are in every version below the header, because the labels themselves are used up by then: `Ziel: <plan|pakete|umsetzung|push-vorbereitet>` (goal), `Prüfer: <1|2>` (reviewers) and, if the project blocks a transition before the goal, `Grenze: <letzte erreichbare Stufe>` (limit: last reachable stage). If the chain ends at its goal, the header reads `fertig bis <Ziel>` (finished up to goal), and below it is the line `Als Nächstes:` (next) with the step that now belongs to you (see [How far a chain runs](/en/dokumentation#how-far-a-chain-runs-the-goal)). Without a goal and without `planreview:*` the run status looks as it did before.

**One log per step.** Every step of a card — a stage of the chain, an implementation round, a check of the check run — additionally writes its runner lines and the output of its session to `.claude/protokolle/<lauf>/<karte>-<stufe>.log`, a second attempt to `<karte>-<stufe>-v2.log`. The run status names the path in the line `Protokoll:` (log). That way the log of a step stands apart from other runs running at the same time. The daily log `.claude/night-run-<datum>.log` remains and carries the run ID in every line in the brackets of the timestamp: `[<Zeitpunkt> <lauf>]`.

**Repeat with the same gesture.** There is no command of its own for a single step. `kit:night` on the card starts the chain at the first stage without a result: What is already there — plan, review note, packages, coverage, implemented packages in In review — counts as done and is not created twice, even if the previous run then failed at the clock or at the board. An existing plan counts as a result as long as it is not in Done; a fresh plan is only created once the old one is in Done. Whoever wants a new plan closes the old plan.

**Release transitions individually.** Which transitions of the chain may follow automatically is set by the project in `night.kette.uebergaenge`, with the four switches `planReview`, `reviewPakete`, `paketeAbdeckung` and `abdeckungUmsetzung`. The kit's default releases the first three. For `abdeckungUmsetzung` there is no default: Without an entry the behaviour from before the setting applies, a chain with `kit:durchziehen` implements after the coverage, one without ends there `fertig` (finished). `abdeckungUmsetzung` only works together with `kit:durchziehen` on the card: The GO can never be given project-wide, it stays on the individual card. An explicit `false` stops a chain with `kit:durchziehen` before the implementation, a `true` lets a chain without the label end with `wartet: Karte ohne Freigabe zur Umsetzung`. A blocked transition ends with `lauf:wartet` in the first form above.

**One attempt, only for the living run.** An automatic attempt only exists for environment errors, as long as the run is alive: The board was not reachable, or a session did not come about. Then the run tries the step again exactly once after a pause, and the run status notes „2. Versuch“ (2nd attempt). If that fails too, the run halts visibly. A session that came about and ended without a result, at the time limit or without proof is a package error and gets no attempt. A dead run is not repeated: It cannot repeat itself, and a restart from outside would be a run without a gesture. After the deadline its cards show „nicht beendet“ (not finished), and it continues with `kit:night`.

#### The watchdog
<!-- de: a582e9f94c54 -->

Who notices a run that died without saying goodbye, and when it counts as silent.

At the start of the run the runner starts a detached watchdog (Wächter), which checks every minute. For this the run writes a sign of life to its pulse file `.claude/lauf/<lauf>.puls` every minute. It only counts as silent once this sign of life is older than the deadline `night.stand.fristMin` (default 10 minutes) **and** the runner process no longer exists. A run that is alive therefore never counts as silent, even if a step writes no pulse for a long time. If the run is silent, the watchdog sets every card still on `laeuft` to `lauf:abgebrochen` with `nicht beendet, letztes Lebenszeichen <zeit>, Frist <n> min` (not finished, last sign of life, deadline) and ends. There is no restart. If the watchdog died with the computer, the next run makes up for it at its start.

#### The journal
<!-- de: 9284a7775bf3 -->

What a run records along the way so that its state survives the process.

Every run writes every state, before it hands it to the board, as a line into its journal `.claude/lauf/<lauf>.jsonl`. If the board does not accept a state, the line stays open, and on the board the last visible state applies. Open lines are filled in as soon as the board answers again: in the same run at the next state, otherwise at the start of the next run. The log names every catch-up with „Laufstand nachgetragen“ (run status filled in). The journal is the memory of the run; you only have to read it if the board remained owing a state.

**Partial cut.** If the stage `pakete` dies in the middle of the cut, the card carries „pakete begonnen für #M“ (packages begun for #M) without „pakete fertig für #M“ (packages finished for #M). The next run then does not repeat the stage, but shows `lauf:abgebrochen` with „Teilschnitt vorhanden (#a, #b) — eine Wiederholung legte doppelt an; Teilschnitt am Board aufräumen, dann erneut kit:night“ (partial cut present — a repetition would create duplicates; clean up the partial cut on the board, then kit:night again). Cleaning up means: close or delete the named packages on the board, then put `kit:night` on the card again. Packages without any run status entry, for example created by hand, are not a partial cut.

**Leftovers in the stash.** If a failed package leaves changes in the working tree and the salvage does not succeed, they lie in the stash `nachtrest #<id> <lauf>`, and the run status of the package names it. You get them back with `git stash list` and `git stash apply stash@{<n>}`; once the package is done, `git stash drop stash@{<n>}` clears the entry.

#### The evidence cases
<!-- de: 5db5fb255472 -->

For every evidence case (Belegfall) of the business requirement: what state the card shows on the board afterwards and with which gesture it continues.

| Case | Card state afterwards | Way forward |
|---|---|---|
| Without a trace: the run dies in the pre-check | first `lauf:laeuft` with „Lauf angenommen um …, Vorabprüfung läuft“ (run accepted at …, pre-check running), after the deadline `lauf:abgebrochen` with `nicht beendet, letztes Lebenszeichen <zeit>, Frist <n> min` | read the log, fix the cause, then put `kit:night` on the card again |
| Aborted although finished: the review stage exceeds the time budget, the review note is already in the plan | `lauf:abgebrochen` with the reason; the run status names the last completed step | put `kit:night` on the card again: The stage counts as found, the chain starts at the first stage without a result |
| Outcome unknown: the board is briefly unreachable | if the attempt after the pause succeeds, the state of the card with „2. Versuch“; if it fails, `lauf:abgebrochen` with `abgebrochen, Umgebungsfehler um <zeit>: …` (aborted, environment error at), the remaining cards of the run `lauf:wartet` with `nicht begonnen: der Lauf hielt um <zeit> an — …` (not begun: the run halted at) | after a successful attempt nothing; otherwise, once the board answers again, start the run again or put `kit:night` on the chain again |
| A package halts the night: session without commit, time limit or waiting session | only this package `lauf:abgebrochen` with reason, it goes to the backlog; dependent packages `lauf:wartet` with „hängt an #N (abgebrochen in diesem Lauf)“ (depends on #N, aborted in this run); leftovers in the stash `nachtrest #<id> <lauf>`; the remaining packages keep running | read the reason, fetch leftovers from the stash if needed, improve the package and pull it back to Ready |
| Interleaved logs: chain and check run run at the same time | every run status names in the line `Protokoll:` the file `.claude/protokolle/<lauf>/<karte>-<stufe>.log` of its step | open the named file; in the daily log the run ID in `[<Zeitpunkt> <lauf>]` separates the runs |

### Running with a local model
<!-- de: 832819589c2e -->

> **Untested.** This section describes a path that follows from the architecture of the runner and should work without any change to the kit — but it has **not been tried in practice** here. Neither was LiteLLM set up nor was a run made against a local model. Take it as a reasoned proposal, not as a report of experience.

The idea: have simple issues built at night by a local model, while review and demanding issues keep running via Anthropic.

**Why a proxy is needed.** Claude Code speaks exclusively the Anthropic Messages API; local runners such as Ollama speak the OpenAI format. A translator belongs in between — [LiteLLM](https://docs.litellm.ai/) is the usual choice. Two things are differently reliable here: That Claude Code can point to an endpoint of its own via `ANTHROPIC_BASE_URL` is [officially documented](https://code.claude.com/docs/en/llm-gateway) (gateway pattern), as is `--model` per call. Operating a local model behind this endpoint, by contrast, is community terrain and not supported by Anthropic.

A minimal LiteLLM configuration:

```yaml
model_list:
  - model_name: lokal-qwen
    litellm_params:
      model: ollama/qwen2.5-coder:14b
      api_base: http://localhost:11434
```

**Mixed operation: put the variable in front of the command, do not export it.**

```bash
ANTHROPIC_BASE_URL=http://localhost:4000 \
  node .claude/kit/night.mjs --model lokal-qwen --label kit:lokal --max 3
```

`ANTHROPIC_BASE_URL` acts globally for a process, `--model`, by contrast, per call — that sounds like an obstacle to mixed operation, but here it is not one. The runner starts every session as a child process of its own and passes `process.env` through. If you put the variable **in front of the night run command**, it applies exclusively to its sessions; an interactive Claude Code session running in parallel stays untouched. An `export` in the `.zshrc` would break exactly that — then your interactive work would also run via the proxy.

**Split via labels.** The [routing label](/en/dokumentation#night-mode) is enough for the separation, no new flag is needed: Give the simple issues a label of their own (say `kit:lokal`) and run two runs one after the other — one with the local model and this label, a regular one with `kit:nightrun`.

**The review stays untouched.** `/review` uses the `reviewModel` from the `workflow.config.json` and is completely decoupled from the night run model. What a local model built at night is still examined by the strong model in the morning.

**Where the limits are — unvarnished.** A night session must be able to do more than write code: It must call tools reliably (board operations via `board.mjs`, file edits, Git), sustain a multi-stage chain and commit cleanly at the end. In our experience small models break exactly at that, not at the programming itself. Projects with sharp gates — mutation tests, coverage ratchets, multi-stage build chains — are realistically out of reach for a small local model. The sensible area of use is changes without a test obligation: documentation, text corrections, configuration values, small mechanical adjustments.

**What protects you when it goes wrong.** Nothing broken gets into the repo: The [salvage pre-check](/en/dokumentation#night-mode) runs the mandatory checks itself before anything is committed at all, after red checks the leftovers of a package go into the stash instead of into the next commit, and the leftover guard ends the run as soon as a successful round leaves uncommitted leftovers. A failed local run costs you electricity and time, not the code base.

**Getting started.** Begin with a single documentation issue:

```bash
ANTHROPIC_BASE_URL=http://localhost:4000 \
  node .claude/kit/night.mjs --model lokal-qwen --label kit:lokal --max 1
```

The progress log shows you every tool call of the session without further ado. From it you see within minutes whether the model handles the board operations cleanly — that is the quickest feasibility test, and it decides the question before you invest a whole night.

**Morning ritual:** Read the log (`.claude/night-run-<datum>.log`: issue, duration, result, commit per round) — the same state is additionally available for evaluation as `.claude/night-run-<datum>-<uhrzeit>.json` next to it —, then as always `/review` → your own test → `push main`. Deferred issues are in the backlog with a comment.

## Effort of the process
<!-- de: 4c66b3f30b69 -->

Since issue #748/#749 every result state of a night session (`.claude/night-run-<datum>-<uhrzeit>.json`) already carries duration, cost, quantity, model and check status. `node .claude/kit/aufwand.mjs auswerten` reads the most recent of them, aggregates time, checks, scope, cost and the effort per task level and writes from this `.claude/aufwand.md` (for humans) and `.claude/aufwand.json` (for the two output places below). The tool only says what stands out — never what to do, and it stays silent when nothing stands out.

**Where the finding appears.** In exactly two places, and both together: as a closing block in the run log `.claude/night-run-<datum>.log`, which every unattended run writes itself at the end, and in the skill `/push-main`, which runs `node .claude/kit/aufwand.mjs befund` before the first step and shows the output. Both are necessary: If night mode starts without any human involvement in future, perhaps nobody reads the run report any more; publishing, by contrast, remains a step that a human triggers themselves.

**By task level.** The report carries a section of its own that shows one line per pair of task level and thoroughness (`effort`): units, duration, cost, red check states and rework, every number with the number of runs that carry it. That way a level can be compared before and after a change of its thoroughness, without running a comparison run of its own for it. The same block is in `.claude/aufwand.json` as `jeStufe`.

**What counts as rework there.** A unit whose final status is not `in_review` **or** whose check status was red. Counted are exclusively work packages with a started session — recognisable by `art: "implementierung"` and a field `endStatus`. Units without a session (skipped, left lying, deferred) and the units of the night chain carry neither final status nor check status; counted as rework, they would all be one, and the rate would only measure how often a gate held. The costs of this table are the amounts reported per unit, not the calculated division from the section "Kosten" (cost). A line "ohne Stufe" (without level) is at the end: It collects states before issue #711 and cards whose model did not come via a level.

**Distribution.** The sums say how much time passed in total, not how it is distributed across the packages. The section "Verteilung" (distribution) therefore shows per kind of run (`implementierung`, `kette`, `pruefung`) a table with one line per task level ("ohne Stufe" at the end): for duration, thinking, tool work, rest and check runs per package the median and the 90th percentile, each with the number of values and of runs behind it. The calculation is nearest-rank, so every value output is one that was actually measured. The dominant kind of time is the largest of the three medians thinking, tool and rest; if one of them is missing, "nicht bestimmbar" (not determinable) stands there together with the kind of time that is not measured. Check runs per package add up `prueflaeufe.arbeit.anzahl` and `prueflaeufe.abschluss.anzahl`; a unit without this information does not count as 0. Added to that is the share of time-limit aborts, counted as for the target mark. The **chain stage** (plan, review, packages, coverage, implementation) is not recorded on the unit and therefore cannot be shown separately; the chain units are together under the kind of run `kette`. The same block is in `.claude/aufwand.json` as `verteilung`.

**The target mark of the implementation.** A report block of its own, "Zielmarke der Umsetzung" (target mark of the implementation), shows how many implementations exceed the target mark: of how many measured implementations how many lie above it, by how much on average and at the maximum. The average is taken over the **exceedances** and not over all attempts — whoever averaged in the ones that were kept would get a number that falls with every further good package without a single bad one having got better. Counting is per **attempt**, not per package: A package in two attempts counts twice, and it is precisely the second attempt that is expensive. The mark comes from the **run header** of the respective state (`zielUmsetzungMin`) and not from today's configuration; states without this information — every one before v3.3 — stand separately and go into none of these numbers. The same block is in `.claude/aufwand.json` as `zielmarke`. It says what was counted and nothing about why: No cause follows from an exceeded mark.

**Time-limit aborts stand separately and go into no average.** An implementation whose unit carries `zeitlimitBeendet` (see [The time-limit abort](/en/dokumentation#the-time-limit-abort)) counts solely as a time-limit abort — in no attempt, in no series, in no average. Its completion time is unknown: The session was aborted at the clock, and how long it would still have needed nobody knows. Kept as an exceedance it would shift the average by a value that no measurement carries — reporting an estimate as a measurement would be wrong. The report therefore names their number in a sentence of its own. If there is no basis at all, "nicht gemessen" (not measured) stands there and no 0.

**Lookups.** A report block of its own, "Auskünfte" (lookups), shows per implementation unit the time spent on fetching and taking apart board lookups, in minutes and with the number of calls — measured by the night runner as the span from the tool call to its result for every query to the board and every processing of its answer; thinking time does not count. Below it is the average over the implementation units together with the number of units that carry it. An implementation unit is one whose session started with `/implement-next`, `/implement-ready`, `/implement-test` or `/implement-done`; all others (chain, creating cards, check runs) stand in a line of their own "keine Umsetzung" (no implementation) and do not go into the average. A unit without measurement (`auskunft: null`) and one from a state before issue #1026 without the field stand as "nicht gemessen" and never go into the average as 0. The same block is in `.claude/aufwand.json` as `auskuenfte`.

**Measuring transcripts afterwards.** `node .claude/kit/aufwand.mjs auskunft <transkript…>` measures Claude Code transcripts (`*.jsonl` under `~/.claude/projects/<projekt>/`) with **the same** rule as the night runner — that way a reference value can be determined from a run that lay before the measurement. The output names minutes and calls per file and in total, with several files also the average per file. A file that cannot be read or one without timestamps is reported explicitly and not counted as 0; the command then ends with exit 1.

**No gate.** The finding holds up neither a run nor `/push-main`. A failure of the evaluation is a log line, not an abort.

**Changing the number of runs and the thresholds.** Both are in the optional block `aufwand` of the `.claude/workflow.config.json` (see [All settings](/en/dokumentation#all-settings)) — if the block or a field in it is missing, the built-in defaults apply, so an existing project gets the evaluation without further setup. `aufwand.laeufe` determines how many of the most recent result states are included; `aufwand.schwellen` carries the four limit values (`pruefungAnteil`, `eingrenzungOhneWirkung`, `werkzeugAnteil`, `schreibkostenAnteil`) from which a finding appears. In the settings interface the block is under the topic "Nachtbetrieb" (night mode).

## Consumption of interactive sessions
<!-- de: abc7e20ecb06 -->

The night run reports its consumption itself (see above). For the sessions in which you sit at the computer yourself, the **session reporter** (Sitzungs-Melder) does that: `board.mjs sitzung melden` reads the session transcript of Claude Code, sums input, output and cache tokens and delivers them via the same route as the runner — `POST /api/kanban/night-runs`, only with `kind`/`mode` **INTERACTIVE** and the start time of the session as the key. It takes the path of the transcript from `--protokoll` or as `transcript_path` from the body that a Claude Code hook passes in on stdin.

**Who calls it.** Nobody by hand. With a project-local installation the installer enters two entries into the `hooks` block of `.claude/settings.json`, and Claude Code calls the reporter by itself:

| Event | Call | Effect |
|---|---|---|
| `Stop` | `node .claude/kit/board.mjs sitzung melden` | ongoing, `complete: false`, throttled to one report per five minutes |
| `SessionEnd` | `node .claude/kit/board.mjs sitzung melden --complete` | final, `complete: true` — afterwards the waypoint file is empty |

The entries are in the **project** file and not in the user settings under `~/.claude`: The target project comes from the binding of the token in the working directory, and a user-wide setting would report from every directory — including every foreign one.

The installer **supplements** the file, it does not replace it: `env`, `sandbox`, `permissions` and foreign hook entries stay in place, and a second run changes nothing more. If `settings.json` is not a readable JSON object, it does not touch it and names the two entries to add by hand — what it cannot read, it cannot preserve either.

**If the reporter stays silent** although token and tracker are right, a look at the sandbox is worthwhile: If it runs in the project, the call needs a network release — `node .claude/kit/board.mjs*` in `sandbox.excludedCommands` of the same file (see "Kit-Skripte mit Board-Zugriff", kit scripts with board access). Without it the reporter gets as far as the delivery and fails there with `nicht-eingeliefert` (not delivered); that does not disturb the session, only the consumption is missing. `sandbox.network.excludedCommands` is not a key of Claude Code and is silently ignored.

**Switching off.** Delete the respective entry from the `hooks` block in `.claude/settings.json`: both for completely, only the one under `Stop` for "only at the end of the session". The file is not versioned, so the decision applies to your machine. A later installer run enters the deleted entry again — whoever wants to silence the reporter permanently takes away its precondition instead of the hook: Without a project-bound token in the working directory and with every `issueTracker` except `toolbox` it stays silent by itself and says so too (`kein-token`, `kein-board` — no token, no board).

**The known gap: worktrees.** An interactive session in a `git worktree` does **not** report. A freshly created worktree carries only the versioned files, and `.claude/*` is excluded via `.gitignore`: Missing there are `settings.json` — that is, the hook — and `.claude/kit/` — that is, the reporter. For the worktrees of the night chain this has no consequences, because `KIT_AGENT_MODEL` is set there and the reporter would stay silent anyway; the runner reports these sessions itself. Whoever, by contrast, creates a worktree by hand and works in it will not find this consumption in the control centre (Leitstand). Remedy by hand: copy `.claude/settings.json` and `.claude/kit/` over from the main working tree.

**Assignment to cards.** `issue move` notes every move to *In progress* and *In review* with a timestamp in `.claude/wegmarken.tsv` (waypoints). The reporter divides the session sum among the cards by these timestamps. What lies between no two waypoints it reports as a rest without a card number — it is in the session sum, but in no card. The same applies to periods in which **two cards were open at the same time**: If two sessions run in the same directory, their waypoints mix in one file, and an assignment would be guessed. It is omitted.

**When it reports.** At the end of the session with `complete: true` — afterwards the waypoint file is empty. In between ongoing with `complete: false`, throttled to at most one report per five minutes: Reporting only at the end would lose every crashed session, unthrottled every move would create an HTTP call.

**When it does not report.** With `KIT_AGENT_MODEL` set the reporter stays completely silent — this session was started by the night runner and it already reports it itself; a second path would count it twice. Without a project-bound access token in the working directory it reports nothing either; the target project comes from the binding of the token and not from the call. Both end without an error: The reporter is bookkeeping, not a condition, and must never disturb a session. For the same reason a failed delivery has no consequences — the waypoints stay in place, the next attempt still sees the same stretch.

**The price table needs maintenance.** The session transcript carries no dollar amount, only token quantities. The amount is therefore calculated, with the rates from **`kit/preise.mjs`** (in the installed project: `.claude/kit/preise.mjs`). The file carries in its header the date of its state and the source the numbers come from. **It goes out of date by itself:** A new model is missing from it, and then the reporter reports **no** amount for the affected sum — never a 0 and never an estimated one. The token quantities are there anyway. Whoever sees a missing amount in the control centre adds the model to `MODELL_STUFEN` and sets `PREISE_STAND` anew; the levels themselves only change when Anthropic changes the prices. If the file is missing entirely — for example next to an individually copied `board.mjs` —, the reporter keeps running, just without an amount.

## Guardrails instead of prompts
<!-- de: 84c0cd0fc383 -->

A language model reproduces the most frequent pattern of its training corpus, not the most current one. An API deprecated months ago still stands in millions of lines of old code as the normal way; the deprecation notice is an edge case against this mass. The result is an error in thinking, materialised many times over: the same outdated or deprecated idiom, rolled out across all call sites — and often only visible late in an external analysis.

For such recurring, class-wide errors the same principle applies as with the coverage gate: a **hard guardrail that fails in the mandatory gate**, instead of a prompt or a document that asks. A prompt to discipline is skipped under time pressure; a lint or compiler rule in the `buildChecks`, which agent and CI run through anyway, cannot commit green in the first place. Concretely:

- **The guardrail derives from existing annotations** instead of keeping a hand-maintained blacklist that itself goes out of date: `@typescript-eslint/no-deprecated` reads JSDoc `@deprecated`, Java reports every deprecated API as a build error with `-Xlint:deprecation` and `-Werror`. The analyzer scales with the ecosystem, the list only with the discipline of its upkeep.
- **The gate is the main catch, SonarQube or similar the safety net.** The round trip via main catches reliably, but late — the error is then already on main. The check belongs at the front, in `/local-check` and `/implement-ready`, where the agent runs it before completion.
- **The concrete rule catalogue lives in the respective project** (`buildChecks` in the config, lint setup in the repo), not in the kit. The kit only anchors the transferable principle.

**The yardstick behind it: "rule in the text or rule in the tool".** It is in `CLAUDE-workflow.md` and applies to every instruction supplied: An **operating instruction** (Bedienvorgabe) — whether it is followed can be read from output or result, a tool could carry it out in the reader's place — belongs in the tool; a **judgement rule** (Urteilsregel), which demands a decision in the individual case, stays in the text. Mixed rules are taken apart, not rounded. Which rule of `/local-check` has moved where according to this yardstick is listed in [Rules in the tool](/en/regeln-im-werkzeug) — line by line, with kind, degree of transfer (Überführungsgrad) and new place.

**The borderline case: when no guardrail can be had.** Some things cannot be measured — whether a model believed a statement instead of looking it up, for instance. There the declared self-report takes the place of the gate: The fixed answer form „Mitteilung übernommen, ungeprüft — …“ (statement adopted, unchecked) from [Statements: believe instead of checking](/en/dokumentation#statements-believe-instead-of-checking) forces nothing, but makes every violation a visible contradiction. Visible contradiction instead of a gate — the same principle, only with the weaker means, because the stronger one does not exist here.

## Issue review across multiple models
<!-- de: fe45e30104da -->

A document is the source of truth for the next step. An error in it propagates, and the author does not see it, because they have in their head the context from which the document arose. `/issue-review` has models read it that did **not** write it: They deliver findings, and the session that called the skill works them in or rejects them with one sentence. Findings are support, not a gate — whether a stage is finished is said by a command or a human, never by a model marker.

### Three check stages — the check moves up
<!-- de: 2a37d6748cb5 -->

Which stage applies is decided by the title prefix, and every stage leaves its own trace:

| Stage | Checks | Proof |
|---|---|---|
| `fachlich` | a `[Fachlich]` issue — the business requirement from [/fachplan](/en/dokumentation#fachplan) | `Fachplan-Review: …` |
| `plan` | a `[Plan]` issue — the plan document from [/techplan](/en/dokumentation#techplan) | `Plan-Review: …` |
| `issue` | a technical work package from [/issues](/en/dokumentation#issues) | `Issue-Review: …` |
| `issue` | a `[Task]` work package from [/task](/en/dokumentation#task) — `[Task]` is **not a document prefix** | `Issue-Review: …` |

**Where the proof is:** for the work package in the section `## Kontext`, for the business requirement in the section `## Ziel` next to `Autor-Modell:`, for the plan document before `## Ziel` next to `Plan-Modell:`. The marker is a trace, not a release: No skill reads it as a condition for the next step.

**The call is always the same: `/issue-review #N`.** There is deliberately no command of its own per stage — which one applies, the skill reads from the title prefix. That applies interactively just as in night mode; the difference is only whether it asks before writing. Without a number the skill takes all `[Fachlich]` and `[Plan]` documents from the backlog that do not yet carry a marker of their stage. It only checks work packages with an explicit number: The normal case is Ready without a package review, and what a package does wrong is caught by the build gates and the code review. `[Idee]` is always excluded.

**Why upwards.** The reach of an error grows downwards: An error in the business requirement propagates into the plan, from there into every work package and into all code. Errors found earlier are cheaper to fix and prevent the most.

**Why the work package no longer needs a reviewer of its own.** Scope, dependencies and collateral damage in the existing code are decided in the plan, not in the individual package; the former scope role has therefore moved as `schnitt-abhaengigkeiten` to the plan stage, where it has the whole cut in front of it.

**Form before content.** The yardstick of every stage is its format: the four story sections, the six plan headings, the four sections of the work package. The form is not checked by a model but by `issue check-form` (see [Board adapter](/en/dokumentation#board-adapter)); the session fixes violations before a reviewer starts. The plan document carries exactly these headings in this order:

```markdown
## Ziel
## Betroffene Bereiche
## Architektonische Entscheidungen
## Geplante Änderungen
## Offene Fragen
## Verifizierung
```

### Procedure
<!-- de: c0d48a188f00 -->

Pre-flight with `issue-review check`, then `issue check-form <id>`, then `issue-review roles --stufe <stufe> --author <modell>` for roles and staffing. Every reviewer gets the same body and its role: `form-beobachtbarkeit` and `abgrenzung` for the business requirement, `architektur-bestand` (the senior who knows the existing code) for the plan, `pruefbarkeit` for the work package; every role carries the cut question "What can go?". The plan reviewer additionally gets the body of the card named in `Fachliche Quelle:` — from the board, never from the conversation — and the path of a `Vorlage:` line; with it, it also checks whether the plan delivers every goal, every acceptance criterion and every answered question of the source. Without a source this input is dropped. The findings go as a comment `## <Stufe>-Review, Runde 1` (review, round 1) to the document. Then the calling session works in every finding or rejects it with one sentence, according to the rule "decide instead of asking" (Entscheiden statt fragen) from `CLAUDE-workflow.md`: interactively after a word of approval, unattended directly; only a finding of the stop class halts and marks the document with `kit:klaeren`. The new body goes via `issue update`, together with the marker line of the stage — unattended with the addition `, Nachtlauf` (night run) — and a comment `## Einarbeitung, Runde 1` (incorporation, round 1) with the list adopted / rejected and reason. One round, no second: Further rounds, in our experience, find matters of taste.

### Configuration
<!-- de: a8086c36c4ed -->

The installer puts `.claude/workflow.config.example.json` next to the real config; take the `issueReview` block from it. **The installer does not write it itself** — `reviewers` depends on which CLIs are on the machine, and `pairs` is a decision. A reviewer is an adapter: `kind: claude` runs as a subagent with the configured `model`, `kind: command` as any CLI with the prompt via stdin and the answer on stdout — Codex, Gemini, a script of your own. Who reviews whom is in `pairs`; otherwise the rule "the foremost reviewers that are not the author" applies. The assignment is shown by `issue-review matrix`.

```json
"reviewStufen": {
  "fachlich": { "reviewer": 2, "rollen": ["form-beobachtbarkeit", "abgrenzung"] },
  "plan":     { "reviewer": 1, "rollen": ["architektur-bestand"] },
  "issue":    { "reviewer": 1, "rollen": ["pruefbarkeit"] }
}
```

Existing installations **without** a `reviewStufen` block review each stage with the roles of the role catalogue, one reviewer per role: functional `form-beobachtbarkeit` and `abgrenzung`, plan `architektur-bestand` and `schnitt-abhaengigkeiten`, work package `pruefbarkeit`. Each of these roles has its wording under `kit/rollen/`, so no reviewer drops out without the block. Anyone who wants a different staffing writes the block explicitly.

## Spec-Driven Development
<!-- de: 17654a71f796 -->

Spec-Driven Development has been dropped since kit version **v3.0.0** (plan #825). The kit no longer keeps a specification under `specs/`: no `## Spec-Wirkung` (spec effect) on work packages, no statement IDs in test names, no updating and no gate at the push, no initiative notes. `/push-main` therefore has seven steps instead of nine.

**A project that still carries a `spec` block keeps running unchanged.** No tool evaluates the block any more. The installer takes it over during an update and says once that it can be removed; the settings interface reports it as an unknown field and allows saving. Block, directory `specs/` and a leftover `.claude/vorhaben-wartend-*.md` can be deleted. `[ID]` prefixes in test names do no harm and may stay.

## Team config and personal deviations
<!-- de: fcc1f83b14ca -->

The same question as above, one level deeper: What belongs in the repository, and what may everyone have differently for themselves?

`.claude/workflow.config.json` used to lie outside the repository — the installer entered `.claude/` into the `.gitignore`. That gave every team member their own version of the fields that must be the same for everyone. `buildChecks` decides what counts as green; `columns` decides where issues land. And a deviating `columns` version does not lead to an error but to an empty issue list — that is the unpleasant part.

The config therefore consists of two files:

| File | Place | Content |
|---|---|---|
| `.claude/workflow.config.json` | **in the repository** | everything that applies to the team |
| `.claude/workflow.config.local.json` | local, gitignored | personal deviations |

From the local file only these fields win:

| Field | Why personal |
|---|---|
| `reviewModel` | the choice of model for the review is a matter of taste and budget |
| `reviewCommand` | the alternative to `reviewModel`: whoever reviews with a foreign CLI has installed it locally |
| `reviewScope` | some prefer to read the full source text |
| `triggers` | typing habit for the three stop phrases |
| `toolbox.tokenFile` | points to a token in one's own file system |

Everything else is ignored and reported on stderr.

**The reviewer pair deviates as a pair.** `reviewModel` and `reviewCommand` are an either-or decision — exactly one of them applies. If the personal file sets one of the two, the other disappears from the result, even if it comes from the shared config. Without this exception to field-by-field merging the normal case — the team runs the Claude default, one person reviews with `codex` — would have a config with both fields and would violate the rule that the schema enforces.

**Why the strictness?** If `buildChecks` could be overridden locally, everyone could configure their gate away, and the separation would be cosmetics instead of a guardrail. The obvious objection — you can still edit the shared file locally — is true, but misses the point: Then it shows up in `git status`. A visible deviation is something different from one that is invisible by design.

The `.gitignore` block the installer writes:

```
.claude/*
!.claude/workflow.config.json
.claude/workflow.config.local.json
.claude/board-meta-cache.json
```

The first line must read `.claude/*`, **not** `.claude/`. Git does not evaluate a `!` negation pattern if the directory itself is excluded — it does not even enter it. With `.claude/` the exception would remain ineffective, and the error feels like "forgot to commit". Whoever writes the block by hand builds it wrong exactly once and searches for a long time.

**Existing projects:** The next `install.mjs` run automatically replaces an existing `.claude/` line with the block; your own `.claude` rules stay untouched and the installer only outputs a recommendation. After that a human must commit `.claude/workflow.config.json` once — the installer cannot do that for you.

## One file, one writer
<!-- de: 8398ae580471 -->

The same principle, applied to memory instead of code: **Every file in the memory vault that a skill writes to automatically belongs to exactly one repo.** What is shared is read — or only written after explicit consent.

The occasion is a setup with several repos on a shared vault, say five microservices. The knowledge is to be shared, not the authority to write. As long as all sessions of a day write into the same log file, conflict copies arise in a synchronised vault, and with parallel sessions the second overwrites the section of the first. Both are noticed late, because nobody reads their daily log again.

Two consequences run through the kit from this:

- **The daily log becomes project-specific.** The field `logPath` makes the file name configurable (`Log/{date}-{project}.md`), so that every repo gets its own file. That applies not only to microservices: **As soon as any two projects use the same vault, `logPath` should be set** — the default `Log/{date}.md` is one file per day, not per project. Details in the [`kontext.config.json` reference](/en/kontext-config-reference).
- **`/document` never writes the shared umbrella note by itself.** It is the only shared place of writing and therefore deliberately not automated: Only in the case of a cross-service effect does the skill ask once, with the concrete entry text, and only writes after consent. Otherwise the conflict surface would only be moved from the log into the note.

The difference from the guardrail principle above is the kind of stop: There a gate fails mechanically, here a skill asks a human. The reason is the same — the decision whether a system-wide insight belongs in the shared note cannot be made by a rule.

## What is deliberately not in the kit
<!-- de: aca615ac0b04 -->

**Security gates belong in the CI, not in a skill.** gitleaks finds secrets, Semgrep or SpotBugs find SQL concatenation and missing input validation. A deterministic tool shares no blind spot with any language model. A red build blocks the push mechanically, more reliably than any model. The review skill complements these tools, it does not replace them.

**No multi-tool adapter.** The concept is transferable, the format is not. Codex reads `AGENTS.md`, Cursor `.cursor/rules`. If you want to use several engines, you need the skill library in several formats in parallel in the repo. That is feasible, but not part of this kit.

## Issue tracker and code host
<!-- de: 45d9d940f602 -->

The kit supports GitHub, GitLab and a fully local mode. The choice is made along two independent axes: `codeHost` (for pull requests and repo detection) and `issueTracker` (for issues and board movements). Both can point to different platforms.

### Tracker switch of this repository: kanban-kit and GitHub archive
<!-- de: f9fd3da7ca47 -->

Since 11 August 2026 this repository keeps its issues in **kanban-kit**, no longer in GitHub. The adapter and config value for it is `issueTracker: "toolbox"`; `kanban-kit` is the product name and not a valid value. The code host remains `codeHost: "github"`.

**GitHub Issues remain enabled.** They are no longer used for new work, but they are the archive: The 218 issues already closed at the time of the move stayed there, and existing commit messages with `#N` thereby keep a reachable historical target. Whoever switches off the issue system there takes away the commit history's point of reference.

**Gaps in the kanban-kit numbering are intended.** Only the issues open on the cut-off date were migrated, with their original numbers. The gaps in between have two causes: closed issues that did not move along, and pull request numbers that share the same number space with the issues. Between `#164` and `#247`, for instance, lie 70 closed issues and 12 PRs, but not a single open issue.

**Migrated cards are recognisable.** They carry `externalKey: github#N` and in the body a two-line origin header naming the source and the original column:

```
> Quelle: https://github.com/<owner>/<repo>/issues/<N>
> Ursprüngliche Spalte: <Spaltenname oder keine>
```

The header is written by the migration tool exactly like this: `Quelle` is the source, `Ursprüngliche Spalte` the original column (column name or none). It names the column even if kanban-kit does not know it. The GitHub board had a sixth column `Zurückgestellt` (deferred), which was mapped to `BACKLOG`; without the header these cards would look like normal work in the backlog.

**The number counter starts above the old number space.** At the time of the move the highest GitHub number ever assigned was 296, and `next_card_number` was set to 298. The counter must never be reset below this start value: Otherwise a new card would get a number already taken on GitHub, and `#150` would denote two different things.

**`tools/migrate-issues.mjs`** was the tool of the move and remains useful for stragglers. It has three runs: `export` (reads GitHub), `import` (writes kanban-kit, idempotent via `externalKey`) and `verify` (compares both sides as a gate). It is not part of the ongoing workflow — for new work, `/issues` creates directly in kanban-kit.

### Transferring a single GitHub issue afterwards
<!-- de: 31d107666717 -->

The normal case after a move: Someone from outside reports a bug on GitHub, because the repository is public there. The issue is to go into kanban-kit without losing the reporter.

```bash
node tools/migrate-issues.mjs export
```

```bash
node tools/migrate-issues.mjs import --file <exportdatei> --from 302 --to 302 --yes
```

`--from N --to N` with the same number fetches exactly one issue. What is preserved in the process, which copy-paste does not achieve:

- The **source reference** is in the body as a header (`> Quelle: …`), so the GitHub discussion remains reachable.
- The **comments** move along, each with author and date. For an outside report, that is exactly the value — the reporter's wording remains readable.
- The import is **idempotent** via `externalKey`: A second run creates nothing twice.
- The **original number** stays. References from commit messages still point to the same ticket.

Two restrictions. `export` reads **all** open issues, not just the desired one — there is no filter on the export side. And before the very first `--yes` run of a project, the tool demands a complete `--dry-run`; in a repo that has the move behind it, this condition is met.

If number and comments do not matter, it also works without the tool: read `gh issue view <N> --json title,body` and create the body via `board.mjs issue create --body -`. Then, however, the source reference is missing, and whoever later wants to know who reported it will no longer find out — for an outside report that is the wrong way.

### Prerequisites per configuration
<!-- de: 6bcc83f06a70 -->

| Value | CLI | Authentication |
|------|-----|-------------------|
| `github` | `gh` (GitHub CLI) | `gh auth login` |
| `gitlab` | `glab` (GitLab CLI) | `glab auth login` |
| `local` | none | none |

### Board adapter
<!-- de: 5c8ef124fe98 -->

All board operations run through `.claude/kit/board.mjs`. The adapter has two main areas:

- **Issue tracker interface:** `issue create`, `issue list`, `issue get`, `issue activity`, `issue move`, `issue comment`, `issue melden`, `issue auftrag`, `issue ursprung`, `issue epics`
- **Code host interface:** `code repo-name`, `code pr`

**`issue list` returns work packages, `issue epics` returns initiatives.** The separation is strict: Initiatives never appear in `issue list`, not even without a status filter. They are brackets over several cards, not work — whoever counts them in a list of open issues takes them for work packages with a thin description. `issue epics` returns them with their short code and progress (`#360 [HER] … 8/8`), that is with the information an initiative actually carries.

**An initiative has no status.** `issue get` returns `status: null` for it, not `backlog`. The reason lies in the server: It does not let an initiative be positioned on the board via `move` at all („Epics werden nicht auf dem Board positioniert“ — epics are not positioned on the board). A status that no `move` can ever change would be a claim about something that does not exist; `null` means "has none".

**Comments carry their ID.** Every entry in `comments` of `issue get` has the fields `author`, `body`, `createdAt` and `id`. `id` is the identifier under which the comment can be replaced on the platform: for GitHub the numeric REST ID from the anchor `#issuecomment-<n>` (not the GraphQL node ID `IC_…`), for GitLab the note ID, for toolbox the comment ID of the API, for the local tracker the running number of the appended `**Kommentar**` block. If the platform provides none, it says `id: null`. `issue get` remains lenient here: If the comment route is not reachable, the card comes with `comments: []` and a hint on stderr.

**`issue melden` files the completion report and moves to In review — in one call.** `node .claude/kit/board.mjs issue melden <id> --text '<bericht>'` replaces the sequence of `issue move … in_review`, intermediate file and `issue comment --text-file`. The output is `{ "ok": true, "id", "bericht": "angelegt" | "ersetzt" | "unveraendert", "status": "in_review" }` (created, replaced, unchanged). A `'` in the report is written in the shell as `'\''`; the command files the text unchanged. `--text-file <pfad>` remains for manual calls.

- **Idempotent per run.** The filed report carries as its last line `Bericht-Lauf: <stempel>`. The stamp is the time of the card's most recent move to `in_progress` from `.claude/bewegungen.tsv` — not from `.claude/wegmarken.tsv`, which `sitzung melden --complete` empties. If the command already finds one with the same line among the comments, it writes nothing if the content is the same (`unveraendert`) and replaces it otherwise (`ersetzt`); otherwise it creates one (`angelegt`). Reports with a different `Bericht-Lauf` line, that is from earlier runs, remain untouched. If there is no `in_progress` move of the card at all, the call ends with exit 1 without writing anything.
- **First the filing, then the move.** The comments are read strictly: If that is not possible, the call ends with exit 1, writes no report and leaves the card where it is — a state read as empty would otherwise lead to a duplicate report. If the filing fails, the card stays in In progress. Only after the filing does the command move to In review and record the move like `issue move` in `.claude/wegmarken.tsv` and `.claude/bewegungen.tsv`.
- **Splitting.** For reports over 6,000 characters, `issue melden <id> --teil <n> --text '…'` writes only piece `n` to `.claude/berichte/<id>.<n>.md`, without board access; a repetition overwrites the piece. `issue melden <id>` without `--text` assembles the pieces in numerical order, each on a new line, files, moves and only then clears the pieces. If the completion fails, they stay in place, and the repetition is the same completion call. The command rejects `--text` alongside existing pieces of the same card. `.claude/berichte/` is in the installer's `.gitignore` block and is exempt from the night runner's leftover guard.
- **toolbox without PATCH route.** An older Toolbox instance does not know `PATCH /api/kanban/items/<item>/comments/<kommentar>`. If a changed report has to be replaced there, the call ends with exit 1, the message names the missing route, and no second report is created. The card stays in In progress. An unchanged report does not need the route.

**`issue ursprung` evaluates whether a plan is through.** `node .claude/kit/board.mjs issue ursprung <plan-nr>` returns as JSON whether the plan is through, which packages are missing and where the plan document and business requirement belong. The command is purely reading: It moves no card and writes no comment.

**`issue auftrag` returns what an implementation needs before the start — in one call.** `node .claude/kit/board.mjs issue auftrag <id>` replaces the follow-up queries about column, prefix, label, protected files and dependencies. The command is purely reading: It moves no card and writes no comment.

- **Verdict and consequence.** The check runs in this order: If the card is not in Ready, the verdict is „darf nicht beginnen“ (must not begin) with consequence `bleibt` and the reason „liegt nicht (mehr) in Ready“ (is not (or no longer) in Ready). If the title carries `[Fachlich]`, `[Idee]`, `[Plan]` or `[Mensch]` or the card the label `kit:klaeren`, the consequence is `backlog`, and the output contains verbatim the comment the session attaches to the card before moving it to the backlog. The same text is in the night runner with the prefix `Nachtlauf: `. Next come the protected files, in the same order as in the night runner. If the card carries the label `kit:geschuetzt`, the consequence is `backlog` with a comment of its own: A human action is waiting, and the label stays, because only the human may remove it. If the package names a protected file in its task or acceptance criterion and the human has not released it, the consequence is `geschuetzt`. The comment is then verbatim the halt text that `issue check-geschuetzt` returns as `kommentar`, still without the label line. The reason names the steps: card to backlog, `issue label add <id> kit:geschuetzt`, in case of a failure report it and carry on, then the comment with the last line `Label kit:geschuetzt gesetzt` or `Label kit:geschuetzt nicht gesetzt` (label set, label not set). A released card goes on to the prerequisites. If a prerequisite is unfulfilled or cannot be determined, the consequence is `bleibt` again. Otherwise the verdict is „darf beginnen“ (may begin) with consequence `beginnen`.
- **`--spalte in_progress`** expects the card in In progress instead of Ready — for `/implement-done` and the continuation after `/implement-test`.
- **Task.** Title, complete body, labels, column and the card's comments. A returned card thus shows its review findings.
- **Plan decisions.** The command finds the plan via the whole line `Plan: Issue #M` in the package. The context line `Plan-Entscheidungen: E1, E3` selects. Output is the wording of each named entry from `## Architektonische Entscheidungen` of the plan: the line `- E<n>:` together with its indented continuation lines. `Plan-Entscheidungen: Keine.` means the package invokes no decision. If the line is missing (legacy stock), all E entries of the plan come with the explicit sentence that the package names no selection. Only this one line is searched, not the free text of the package.
- **Business occasion.** The source is the line `Fachliche Quelle: Issue #N` in the package, otherwise the same line in the plan. Output are `## Ziel` and `## Fachliche Akzeptanzkriterien` of the source verbatim (code blocks in them remain content) and the sentence „Voller Text: `node .claude/kit/board.mjs issue get <N>`“ (full text: …). An implementation does not have to read the rest of the text.
- **Siblings.** All other cards with the whole line `Plan: Issue #M` of the same plan, across all five columns, each with number, title and column. The line rule is the night runner's: A mention in running text does not count, and `#30` is not `#300`. The column comes from the board's column lists. For GitHub these provide no body; the command therefore reads the bodies via `gh issue list --state all`. Without a plan it says „kein Vorhaben“ (no initiative).
- **Prerequisites.** Every `#N` in the section `## Abhängigkeiten`, read as in the night runner, with number, title, column and finding: `unerfuellt` (unfulfilled) in Backlog, Ready or In progress, otherwise `erfuellt` (fulfilled) — also in In review and Done, archived or no longer on the board at all. A number the tracker does not know appears with `Spalte: keine` as fulfilled; a typo is therefore only noticed when writing, as the hint `unbekannt` from `issue check-form`. `nicht feststellbar` (cannot be determined) means: The board does not answer — fetching the card or its column fails for another reason. Then the card stays where it is. For GitHub the command looks for the column in the same column lists as for the siblings; a card that is in no column counts as fulfilled.
- **Gaps.** Every piece of information that cannot be determined appears explicitly under gaps. That concerns a package without a plan („kein Vorhaben“), an unreadable plan and a named `E<n>` that is missing in the plan. Likewise a missing business source, a missing section `## Ziel` or `## Fachliche Akzeptanzkriterien`, and a sibling that is in no column (column „nicht feststellbar“). Added to that are a column of the package that cannot be determined and every prerequisite that cannot be determined. A gap is never silent; without a gap it says „Keine.“ (none).
- **Output.** The default is Markdown with seven `##` parts in fixed order: Urteil, Aufgabe, Plan-Entscheidungen, Fachlicher Anlass, Geschwister, Voraussetzungen, Lücken (verdict, task, plan decisions, business occasion, siblings, prerequisites, gaps). Body, comments, goal and criteria are fenced in code blocks. `--json` returns the same parts as fields (`urteil`, `aufgabe`, `planEntscheidungen` with `plan`, `auswahl`, `hinweis`, `eintraege`; `fachlicherAnlass` with `quelle`, `herkunft`, `ziel`, `kriterien`, `vollerText`; `geschwister` with `plan`, `hinweis`, `karten`; `voraussetzungen`, `luecken`). This is the only exception to "output: JSON on stdout".
- **Exit code.** 0 also for „darf nicht beginnen“, because that is information and not an error. 1 only if the package itself cannot be read.

Only the trackers **local** and **toolbox** know initiatives. With **github** and **gitlab**, `issue epics` rejects with a message naming both capable trackers — there the failure is the normal case, and callers like `/kontext` skip it silently.

**Form check: `issue check-form`.** The mechanical gates from the registers `CLAUDE-Fachplan.md` and `CLAUDE-Plan.md` are checked by a command, not a model: `node .claude/kit/board.mjs issue check-form <id>` against a card, or `issue check-form --body-file <pfad> --title "<titel>"` against a file before it is created. The stage comes from the title prefix. Checked are, for `[Fachlich]`, F1, F2, F6, F7, F9 and F11, for `[Plan]` P1, P2, P3, P6 and P12, for the work package (with or without `[Task]`, likewise for `[Mensch]`) I1 to I5: the four sections in order with `## Abhängigkeiten` last, `Autor-Modell:` in the context, dependencies as `Keine.` or `#N`, no origin line in the dependencies section, and, with a line `Vorlage: <Pfad> — verbindlich` in the context, an acceptance via screenshot in the acceptance criterion. Added to these are I7 to I9: `## Aufgabe` names at least one file as a backtick path (I7), no named file is protected (I8, against the locks from the settings of the project root; a path immediately followed by `(nur genannt)` (only mentioned) is a mere mention and counts in this line neither for I8 nor for I7 — for instance ``die Liste `AUSNAHMEN` um `.claude/settings.json` (nur genannt) ergänzen``; the same exception applies in the night runner's gate and in `issue auftrag`), and `## Aufgabe` does not name the installed copy under `.claude/kit/` instead of the source (I9). A `[Mensch]` package passes all three — its task lies outside the repository. In the form stage of the chain, I8 is not a correction case: The violation is logged, and the card runs into the gate for protected files in the implementation stage; I7 and I9 are corrected by the chain. Which protected files a package names, whether it is released and what the halt comment says is returned by `issue check-geschuetzt <id>`; `--pfad <pfad>` (also several times) adds a path that was rejected when writing. Reading is done without code blocks and with umlauts in both spellings. The output is always JSON with `ok`, `stufe` and `verstoesse`; in case of violations the command ends with exit 1, a rejected call carries `fehler`. The `[Urteil]` gates remain the reviewer's business, and the command never writes to the board. For `[Plan]` the test hints are added: If the plan lists in `## Betroffene Bereiche` or `## Geplante Änderungen` a building block that has a test of its own, and it names this test nowhere, there is one entry `{ baustein, test, meldung }` under `hinweise` per unnamed test. Which tests belong to a building block is said by the locations of the setting `testAblagen` (without it the defaults for TypeScript and Java, `[]` switches off); the stock is the versioned files (`git ls-files`). For the work package, `hinweise` holds the dependency hints `{ art, nummer, stelle, meldung }` with `art` `schreibweise` or `dokument`; `issue create` and `issue update` return them after writing as well (see [/issues](#issues)). The `hinweise` are not part of `ok` and never lead to exit 1, and without a hit the key is missing entirely.

**Templates through the chain.** If the human brings a design draft, a mockup or a sketch, `/fachplan`, `/techplan` and `/issues` carry it on as the line `Vorlage: <Pfad> — verbindlich | Anregung` (template: binding | suggestion): in the goal of the business plan, in the head of the plan, in the context of every package that touches a view. "Binding" means: The plan decides no design question against the template, every affected package names the place in the template and is accepted via a screenshot next to it, and `/fachplan` asks whether the project's design source should be switched over first. Without this trace a template evaporates between the stages — all checks green, and the view looks as before.

The skills call only the adapter — they know nothing about `gh` or `glab`. You can change `issueTracker` and `codeHost` in the config at any time; all skills adapt on their next call.

**Processing order = board order.** `issue list --status <spalte>` returns the issues in the order of the board column (top first), not numerically — so you control the processing of `/implement-ready` by drag and drop in the Ready column. Implemented per tracker: GitHub via the manual project order of `gh project item-list` (applies to the standard board view; a view with its own sorting displays differently from what the API returns), GitLab via `--order relative_position`, the own Kanban via the column position of the API. Two deliberate exceptions: the local file tracker knows no positions and stays numerical, and `issue list` without a status filter stays stably numerical everywhere (there is no board order across columns). Consequence: The processing order depends on the board state and is no longer deterministically numerical — that is intended.

#### Origin on the board: `--derived-from`
<!-- de: 1ac69762b21f -->

`issue create` optionally accepts `--derived-from <nummer>` and sends the **project-wide card number** of the **nearest ancestor** along as the field `derivedFrom`. That way the board knows the chain business plan → plan → work package as data and does not have to piece it together from description texts.

Only **one** reference is ever set, the one to the next higher stage — the rest follows from walking along the chain. Who sets it:

| Skill | Reference |
|---|---|
| `/fachplan` | **never** — the business requirement is the root and has no ancestor |
| `/task` | **never** — a `[Task]` has no ancestor; it stands in no chain at all, not even as a root |
| `/techplan` | to the `[Fachlich]` issue if the plan came from `/techplan #N`; for a plan from the chat none at all |
| `/issues` | to the `[Plan]` issue, failing that to the business issue, otherwise none at all |

The adapter checks the form before every network call: Whatever is not a positive integer ends with exit 1 — explicitly also the **bare flag** without a value, which would otherwise pass as `1`. Whether the number exists, points to the card itself or closes a cycle is checked by the server; the upper limit is its business as well and is deliberately not rebuilt here.

**Only `kanbancompat` evaluates the field.** GitHub, GitLab and local accept the option without an error and do not transmit it — no abort, no changed output. A skill can therefore set it regardless of the configured tracker.

**The option only takes effect on creation.** There is no adding it later: A board-less pool idea is unreachable for the adapter (no `get`, no `comment`, no `update`), and a repeated ingest onto the same card discards the value.

#### The gap: a tracker without the field stays silent
<!-- de: 81168c70b3b4 -->

If the call runs against an instance that does not yet know `derivedFrom`, the unknown key is **silently** ignored: The call ends with **exit 0**, the card is created, and the origin is missing — without an error, without a warning, without a difference in the output.

**This is known and deliberately not safeguarded.** The obvious safeguard would be an echo: read back after creation and check whether the value arrived. Exactly that fails in the most important case — a board-less **pool idea** is not readable, its response carries no echo. A safeguard that does not take effect there would be worse than a named gap: It would create trust that does not hold in the decisive case.

In practice this means: **A successful `issue create` is no proof that the origin was set.** Whoever wants to know for sure reads the card on the board — provided it has a number.

#### Why the body lines stay alongside
<!-- de: 2eac7f7521a4 -->

The origin is there twice: as a field on the board and as a line in the body (`Plan: Issue #M`, `Fachliche Quelle: Issue #N`, both in the context section). That is no duplication, but two forms with different durability.

The field is the **queryable** form — the board groups by it without taking bodies apart. The lines are the **lasting** one: A **project change deletes the origin** on the board, and in both directions — that of the moved card and that of all cards **pointing to it**. The reason is the uniqueness of the numbers: They are assigned project-wide, a carried-over reference would point to a foreign card after the move. The body lines survive that, because they are text.

On top of that, `github`, `gitlab` and `local` do not know such a field at all. Whoever later deletes the lines as redundant loses the origin at the first move — and in three of four trackers immediately.

#### Evaluating the origin: derived-from-report
<!-- de: 4ef1488b860d -->

`tools/derived-from-report.mjs` reads the body lines back and shows for every card which reference it would get — as preparation for a possible backfill of the stock. The cards come via stdin, the tool does not fetch them itself:

```bash
node .claude/kit/board.mjs issue list | node tools/derived-from-report.mjs
node .claude/kit/board.mjs issue list | node tools/derived-from-report.mjs --json
node tools/derived-from-report.mjs --help
```

Without a flag, a readable summary is produced with a counter per state and a list of the cards that need attention. `--json` outputs the same data raw so that a later migration can process it. That the cards are handed over instead of fetched has three reasons: It is testable without a mock server, it works for **every** tracker instead of only for kanbancompat, and the same snapshot can be evaluated twice.

**The tool writes nothing** — neither to the board nor to the file system. It is a dry run and remains one as long as there is no **write path** for `derivedFrom`: The field is set on creation and never changed afterwards. Whether and how the stock is backfilled depends on a decision in the kanban-kit project and is filed as idea **#355**.

**Where to look depends on the document type** — otherwise the state `fehlplatziert` seems arbitrary:

| Document | Valid location |
|---|---|
| Work package | section `## Kontext` |
| `[Plan]` document | head area before `## Ziel`, i.e. before the first `##` heading |

Plan documents have no context section at all; a reader who only knows that one would overlook every intermediate stage of the chain. In both cases only lines **outside code fences** count — an issue that shows the convention as an example must not invent a reference.

Exactly one state results per card:

| State | Meaning |
|---|---|
| `vorfahr` | exactly one unambiguous reference, the target card exists |
| `keiner` | no reference line — the card would stay empty. **No error**, but the normal case for everything created before the convention |
| `unbekannt` | the reference names a number that does not exist in the handed-over set of cards |
| `selbstverweis` | the reference points to the card itself |
| `mehrdeutig` | several lines of the same type with different numbers — no guessing here |
| `fehlplatziert` | a reference line is outside the valid location while there is none there |

With `unbekannt` and `selbstverweis` the result additionally carries the field `gelesen` with the number that was pointed to.

**What this is good for was shown by the first run:** Of 47 cards with a reference, zero were misplaced and zero ambiguous — but **14 pointed to two ancestors that no longer existed on the board**. A migration would have failed on this, because the server rejects unknown numbers on creation. That is exactly what the dry run is for.

### Local mode
<!-- de: 83c4bcb53de7 -->

With `issueTracker: local` the adapter creates issues as Markdown files in `issues/`:

```
issues/
  0001.md
  0002.md
```

Every file has YAML frontmatter:

```markdown
---
id: 1
status: backlog
title: Example issue
created: 2026-07-01
---

## Kontext
…

## Aufgabe
…

## Akzeptanzkriterium
…

## Abhängigkeiten
Keine.
```

The section headings in the body are those of the four-section format and stay German, because the tools read them. The status (`backlog | ready | in_progress | in_review | done`) is in the frontmatter. No board API, no label setup.

### What differs with GitLab
<!-- de: 7f952698b9fa -->

**Pull request is called merge request.** `/merge-production` creates a merge request instead of a pull request on GitLab.

**Board status via label.** GitLab maps the five columns via labels: `~Backlog`, `~Ready`, `~In progress`, `~In review`, `~Done`. The installer creates the labels automatically if you confirm with "j" during setup. You have to create the board view itself (Issues → Boards → "Add list") once manually in the GitLab UI.

### Setting the configuration
<!-- de: 92c13380938a -->

```json
{
  "codeHost": "github",
  "issueTracker": "local",
  ...
  "local": { "issuesDir": "issues" },
  "github": { "projectNumber": 11 }
}
```

You can change both fields manually at any time. All skills read them on their next call.

### Toolbox (private setup)
<!-- de: ac419091bb37 -->

Not a publicly promoted kit feature: Toolbox is a personal Kanban tool of the author (own backend, own frontend), used by the author as an issue tracker. The installer does not ask about it, and this section serves primarily for the author's own reference — not as a general recommendation.

`codeHost` stays independent of it (usually `github` or `gitlab`): Toolbox is only an issue tracker, not a code host; pull requests still run via the platform configured there.

```json
{
  "codeHost": "github",
  "issueTracker": "toolbox",
  "toolbox": { "host": "https://toolbox.mwolff.org" }
}
```

**Authentication** runs via a personal Kanban access token (PAT), not via the Keycloak login of the Toolbox web interface. Every call carries the token in the header `X-Kanban-Token`; it acts exclusively on `/api/kanban/**`. Setting up the `tbx` CLI and token management are part of the Toolbox project itself, not of this kit.

`board.mjs` resolves the token in three ways — the first hit wins:

1. **`TBX_TOKEN`** (environment variable): highest priority. Handy for passing a token per terminal session or per call without writing anything into the project — that way you switch, for example, an entire night run to a night board of its own (see [Night mode](#night-mode)).
2. **`toolbox.tokenFile`** in `workflow.config.json`: path (relative to the project directory) to a file that contains only the token. That way every app gets its own project/board-bound token. The token file belongs in `.gitignore` — only the path is checked in, never the secret.
3. **Global `tbx` login** (fallback, previous behaviour): create a token in the Toolbox web UI, run `tbx auth login`. The token is then under `~/.config/toolbox-cli/tokens.json` (can be overridden via `TBX_CONFIG_DIR`) and applies to all projects on the machine that use neither of the other two ways.

**No plain-text token in `workflow.config.json`.** The config is checked in and shared. If a `toolbox.token` is in it in plain text, `board.mjs` aborts with a clear message instead of silently using the secret — use `TBX_TOKEN` or `toolbox.tokenFile`.

**Behind a proxy** — for instance in the Claude Code sandbox, which routes network traffic via `HTTPS_PROXY` — Node's built-in `fetch` only uses the proxy if `NODE_USE_ENV_PROXY=1` is set at start; otherwise every board call ends with "fetch failed" (Node's message when the request could not be sent). If `HTTPS_PROXY` (or `https_proxy`) is set and the switch is not, `board.mjs` therefore restarts itself once with `NODE_USE_ENV_PROXY=1` (help and `--version` excepted), and the night runner sets the variable for every session. Your own Node calls with network access need the variable just the same. If a call behind a proxy still fails at name resolution or connection, the error message names this remedy — the way is the variable, not leaving the sandbox (Issue #998).

**Example: a second app with its own token on the same kanban-kit.** The server supports project/board-bound tokens: create a second token in the admin UI and bind it to project 2/board 2. In the second project, then either set `TBX_TOKEN` or point in the config to a gitignored token file:

```json
{
  "codeHost": "github",
  "issueTracker": "toolbox",
  "toolbox": {
    "host": "https://toolbox.mwolff.org",
    "tokenFile": ".claude/tbx.token"
  }
}
```

```bash
echo "<token-from-the-admin-ui>" > .claude/tbx.token
echo ".claude/tbx.token" >> .gitignore
```

The global `tbx` login of app 1 stays untouched — app 1 keeps falling back to `tokens.json`, app 2 uses its own token from the file. Host resolution is independent of this (`toolbox.host` in the config, otherwise the host from the `tbx` login).

**Column names are fixed.** Unlike GitHub and GitLab, the five statuses (`backlog`, `ready`, `in_progress`, `in_review`, `done`) cannot be renamed here via `columns` in the config — internally they are mapped 1:1 to Toolbox's Kanban columns `BACKLOG`, `READY`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`.

**New issues land directly in the backlog.** Against a kanban-kit ≥ 1.5, `issue create` creates the card immediately with its board number — it is right away in the Backlog column and addressable via `#N` from then on. That is the default; a project does not have to configure anything for it.

**`ideaStored: true` steers into the project idea pool instead.** Then a board-less idea is created: It appears in no column, and the board number only exists once you schedule it. The adapter reports this back honestly (`ideaId` + `pending: true` instead of a number, with a hint text); a response without a usable identifier aborts hard. Scheduling is deliberately reserved for you — it is the same human review as the former pulling up from the idea store.

The switch is called `ideaStored` in the config, but the field on the wire is `direct`: A missing `ideaStored` or one set to `false` sends `direct: true`, an `ideaStored: true` sends nothing at all. The formerly sent wire field `ideaStored` goes over the wire in **no** case any more — the server ignores it anyway.

Four cases, so that it is clear what happens when:

| Config | Sent | Result |
|---|---|---|
| not set | `direct: true` | card in the backlog, with number |
| `ideaStored: false` | `direct: true` | card in the backlog, with number |
| `ideaStored: true` | no `direct` | idea in the pool, `ideaId` + `pending` |
| legacy backend without `direct` | irrelevant | as before: number returned |

If creation is direct — that is, in the regular case — but only an `ideaId` comes back, `issue create` **aborts** instead of reporting `pending`: Otherwise the call would look successful while the card has no number. The message names `ideaStored: true` as the way into pool mode. Older backends (original Toolbox, kanban-kit before 1.5) behave unchanged; GitHub and GitLab trackers are not affected by any of this.

#### Retries, idempotency keys and the three outcomes
<!-- de: 7f7b14ee2668 -->

A night run sends hundreds of board commands in a row. Since kanban-kit 2.5 the board limits them per person and rejects with `429`, `Retry-After` (seconds) and the problem detail `type: urn:manban:overload`. Without a counterpart in the adapter, the run aborts at some point and leaves a half-processed chain behind.

That is why every Toolbox call has a **time limit per attempt** (10 seconds), a **retry loop** with growing waiting time and jitter, and an **overall budget**: 30 seconds interactively, 120 seconds with `KIT_AGENT_MODEL` set — the same signal as for the header `X-Agent-Model`. At night nobody sits next to it who would be bothered by two minutes; interactively, half a minute is the limit of what is bearable. `Retry-After` beats the own schedule: The server knows better when its window is open again.

**`KIT_TOOLBOX_BUDGET_MS`** sets the overall budget explicitly in milliseconds and beats both regular values; only a positive integer value counts, everything else falls back to the rule. The variable is meant for tests that start `board.mjs` as a process of its own against a server answering persistently with errors — there the waiting is real, and without a short budget every call costs the full two minutes. It deliberately takes effect everywhere and not only under test: An unnamed back door that changes behaviour would be worse than a documented adjusting screw.

**Retries happen only where it is safe:**

| Case | Retry | Why |
|---|---|---|
| `429` with `type: urn:manban:overload` | yes, for every method | A rejection has executed nothing |
| `429` without this `type` | no | Says nothing about the outcome |
| `5xx` for `GET`, `PUT`, `DELETE` | yes | Without consequence, or the same result on repetition |
| `5xx` for `POST` **with** `Idempotency-Key` | yes | The same key executes the effect at most once |
| `5xx` for `POST` **without** key | no | Otherwise a night-run message would be duplicated after a `502` of the proxy |
| timeout, connection drop | yes | The likely failure mode under full load |
| connection refused (`ECONNREFUSED`, `ENOTFOUND`) | no | Demonstrably no call went out |
| `401` | never | A revoked token does not become valid by waiting |
| any other status (`403`, `404`, `409` …) | no | Reported immediately |

Every retry attempt writes a line to stderr (`board: POST /api/kanban/items — Versuch 2 endete mit HTTP 503, erneut in 1000 ms (Frist 120 s)` — attempt 2 ended with HTTP 503, again in 1000 ms, deadline 120 s). Whoever watches a night run can thus tell waiting from hanging. The successful call reports nothing — one line per board command would drown exactly this signal.

**The three outcomes.** Every aborted call says what became of its effect:

- **ausgeführt** (executed) — the server answered with `2xx`.
- **nicht ausgeführt** (not executed) — an answered rejection (`4xx`) or demonstrably no call that went out. Repeating is safe.
- **Ausgang unklar** (outcome unclear) — a writing call went out and got no usable answer (timeout, connection drop or `5xx`), and the budget is exhausted. The effect may have occurred.

The third value is deliberately not a special case of the second: A timeout reported as „nicht ausgeführt“ invites exactly the repetition that attaches a completion report to the board a second time.

**The key comes back from outside.** `POST /api/kanban/items` and `POST /api/kanban/items/{id}/comments` — the two endpoints that evaluate it on the server side — carry an `Idempotency-Key`. It is created per job and stays the same across all attempts. The message for „Ausgang unklar“ names it together with the complete command for the repetition:

```
Toolbox-API-Fehler: HTTP 502
Ausgang unklar: POST /api/kanban/items/700/comments ging hinaus, blieb aber ohne
verwertbare Antwort — die Wirkung kann eingetreten sein. Schluessel: 5f2c-…-91ab.
Mit genau diesem Schluessel wiederholen — derselbe Schluessel fuehrt die Wirkung
hoechstens einmal aus:
  node .claude/kit/board.mjs issue comment 7 --text-file /tmp/7-bericht.md --idempotency-key 5f2c-…-91ab
```

The message says: Toolbox API error; outcome unclear — the call went out but got no usable answer, the effect may have occurred; repeat with exactly this key, because the same key executes the effect at most once.

A key internal to the process only would turn every manual repetition into a new job. That is why `issue create` and `issue comment` accept it again via **`--idempotency-key <wert>`**. Without the switch the behaviour stays unchanged. A call without a key — `/labels`, `/night-runs` — says so explicitly in the message and refers to checking on the board.

**Other backends.** For servers without the overload `type`, nothing changes: `429` without `urn:manban:overload` is not retried, and the header `Idempotency-Key` is ignored there. With the trackers `github`, `gitlab` and `local`, the call accepts `--idempotency-key` without consequence.

## Updating and multiple projects
<!-- de: be26643cf235 -->

Because the skills are project-independent and only the config is project-local, you update the kit by running the installer again. Your config is preserved (the installer asks you before overwriting it).

In a new project you only need to run the installer or copy `workflow.config.json` from an existing project and adjust the branch names. All skills are ready to use immediately.

If several projects work against the same Toolbox/kanban-kit tracker, each project gets its own project/board-bound token: via the `TBX_TOKEN` environment variable or via `toolbox.tokenFile` in the config (gitignored file, no plain-text token in the shared `workflow.config.json`). Precedence and an example are in the section [Toolbox (private setup)](#toolbox-private-setup).

## Troubleshooting
<!-- de: e73e098a89dd -->

**The skills do not show up in `/help`.**
Did you restart Claude Code after the installation? The skills are loaded at start. Also check whether the files are in the right directory: `~/.claude/skills/` for a global installation, `.claude/skills/` for a project-local one.

**`/implement-ready` does nothing or reports "Ready ist leer".**
("Ready is empty".) At least one issue must be in the Ready column (GitHub) or marked with the label `~Ready` (GitLab). The skill processes only Ready, it does not pull any issues forward from the backlog.

**`/review` produces thin or overly general findings.**
Check `reviewScope` in the config. With `diff` the reviewer sees only the changed lines. For larger refactorings, switch to `full`. In very large repos `full` can overload the context window; then better use `diff` and add manually selected file paths in the review prompt.

**`/push-main` does not happen, or the AI does not ask for it.**
The skill is locked against autonomous invocation. You have to type the exact trigger phrase (by default `push main`). An earlier approval in the same session does not apply to new commits.

**`/kontext` or `/document` reports an error.**
Check whether `kontext.config.json` exists (globally in `~/.claude/` or locally in `.claude/`). Both skills also run without a vault in degraded mode. If you use `codeHost: github` or `issueTracker: github`, `gh` must be authenticated. If you use `gitlab`, `glab` needs `auth login`. In local mode there is no external CLI dependency.

## kontext.config.json: reference
<!-- de: aa2a976ed958 -->

Configures the `/kontext` skill (session start) and the `/document` skill (session end). Both read the same file, so you specify the vault path and always files only once.

### Why two config files?
<!-- de: dff531742346 -->

`workflow.config.json` is repo-specific: build commands, branch names, review model. It belongs in the repo and is shared with the team. Everyone who clones the repo has the same process basis.

`kontext.config.json` is personal: your memory vault, your always files. It points to your local infrastructure and does not belong in the repo. Two developers in the same repo have different vaults and different profile files.

### Storage locations
<!-- de: 2f74f211b749 -->

| Path | Purpose |
|------|-------|
| `~/.claude/kontext.config.json` | Global, applies to all projects on this machine |
| `.claude/kontext.config.json` | Project-local, overrides individual fields of the global config |

The files are **merged field by field, local fields win**. Fields not in the local config are inherited from the global one. If no config is found, `/kontext` and `/document` run in degraded mode.

### Fields
<!-- de: 3e7a8e755ff9 -->

| Field | Type | Required | Description |
|------|-----|---------|--------------|
| `vault` | `string` | optional | Absolute path to the memory vault. Without this field the skill runs in degraded mode. |
| `always` | `string[]` | optional | Files relative to the `vault` root that are always read (e.g. profile, working rules) |
| `projectDocs` | `string[]` | optional | Files or glob patterns relative to the project directory. Fallback: `["CLAUDE-*", ".claude/CLAUDE-*"]` |
| `project` | `string` | optional | Override for the vault project name, only needed if the repo name and the vault folder name differ |
| `logPath` | `string` | optional | Template for the daily log file, relative to the `vault` root. Placeholders `{date}` and `{project}`. Default: `"Log/{date}.md"` |
| `parentProject` | `string` | optional | Umbrella project over several service repos (multi-repo setup) |

**You need `logPath` as soon as more than one project uses the same vault** — regardless of whether the projects have anything to do with each other. The default `Log/{date}.md` is one file per **day**, not per project: Without `{project}` in the template, all sessions of a day end up in the same file, and `kontext last-log` may return the entry of a foreign project as the predecessor at the next `/document`. Two independent repos on one vault are already enough for that.

`parentProject` is independent of this and only meant for **multi-repo systems** in which several service repos belong to one whole (see below). Whoever runs a dozen independent projects on one vault sets `logPath` and leaves out `parentProject`.

The complete setup with vault structure and example config is in the [`kontext.config.json` reference](/en/kontext-config-reference); the principle behind it under [One file, one writer](#one-file-one-writer).

### What happens without a vault?
<!-- de: c0319328d3e4 -->

If `vault` is not set or no config file is found, both skills continue in degraded mode:

`/kontext` loads the initiatives via the board adapter and reads `projectDocs` from the repo. At the end a hint appears: "Kein Vault konfiguriert, arbeite ohne persistentes Memory." (no vault configured, working without persistent memory).

`/document` writes the daily log to `docs/session-log/YYYY-MM-DD.md` in the project directory. At the end: "Kein Vault konfiguriert. Log ins Projektverzeichnis geschrieben." (no vault configured, log written to the project directory).

Degraded mode is the right entry point if you want to try out the kit without first setting up a vault infrastructure. For lasting cross-project memory you enter the `vault` path in `~/.claude/kontext.config.json`.

### Glob patterns in projectDocs
<!-- de: 31f8a80c6229 -->

`projectDocs` supports glob patterns. The skill expands them via `find` in the project directory:

```bash
find . -maxdepth 1 -name "CLAUDE-*" -type f
find .claude -maxdepth 1 -name "CLAUDE-*" -type f
```

Patterns without hits are silently skipped (no error, no abort).

### Checking paths without starting a skill
<!-- de: f04a33734ee7 -->

The target paths are computed by the board adapter, not by the skill prompt:

```bash
node .claude/kit/board.mjs kontext paths
```

The output names the daily log, the project note and — in a multi-repo setup — the umbrella note, each as an absolute path. If they are correct here, they are correct in the skill as well. The project name is determined in the order `--project` → `project` from the config → repo name → directory name; if the repo name differs from the vault folder name, you enter the correct name as the `project` field in the local config.

`node .claude/kit/board.mjs kontext last-log` additionally returns the most recent existing log entry of the same project — `/document` thereby picks up from the previous entry instead of starting from zero.

### Examples
<!-- de: bbc9c7de8965 -->

Global config (create once, applies to all projects on this machine):

```json
{
  "vault": "/path/to/your/memory-vault",
  "always": ["Index.md", "Profil.md"],
  "projectDocs": ["CLAUDE-*", ".claude/CLAUDE-*"]
}
```

Local config (only create if the repo name and the vault project name differ):

```json
{
  "project": "MyProject"
}
```

## License
<!-- de: 574befe785b2 -->

MIT. The kit is free to use, modify and redistribute.
