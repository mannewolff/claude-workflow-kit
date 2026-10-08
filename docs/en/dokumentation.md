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
