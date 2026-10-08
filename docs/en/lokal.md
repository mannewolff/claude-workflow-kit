# Working locally — without a remote repo, without a board
<!-- de: 34f3f45f6dee -->

**git itself is always required.** The kit assumes that you are in a local git repository (`git init` is enough). What is optional: a remote repo (e.g. on GitHub or GitLab) and a board. You need neither in local mode.

So you need: git (local), Node.js — and nothing else.

## When this mode fits
<!-- de: 7e1f81ef490c -->

- Private project without a remote repo
- Early phase, no board set up yet
- You want to try the kit before choosing a platform
- Single person, no team, no PR process

## Installation
<!-- de: d485f673a0b3 -->

Start the installer and choose `local` for the platform questions:

```
Global oder projektlokal? [global/projekt]: projekt
Code-Host (github/gitlab/local): local
Issue-Tracker (github/gitlab/local) [local]: local
Name des main-Branch [main]: main
Name des production-Branch [production]: production
Review-Umfang (diff/full) [diff]: diff
Review-Modell [claude-opus-4-8]:
```

The installer asks in German: global or project-local install, code host, issue tracker, the names of the main and production branches, the review scope and the review model.

The result in `.claude/workflow.config.json`:

```json
{
  "codeHost": "local",
  "issueTracker": "local",
  "mainBranch": "main",
  "productionBranch": "production",
  "reviewScope": "diff",
  "reviewModel": "claude-opus-4-8",
  "local": { "issuesDir": "issues" },
  "columns": {
    "backlog":     "Backlog",
    "ready":       "Ready",
    "in_progress": "In progress",
    "in_review":   "In review",
    "done":        "Done"
  }
}
```

The `columns` field controls the column (Spalte) names on the board. The keys (`backlog`, `ready`, `in_progress`, `in_review`, `done`) are fixed — they appear in the frontmatter of the issue files. The values are the displayed labels and can be changed freely:

```json
"columns": {
  "backlog":     "Ideas",
  "ready":       "Let's go",
  "in_progress": "Working on it",
  "in_review":   "To check",
  "done":        "Finished"
}
```

On GitHub the values correspond to the column names in the Project Board. On GitLab they are the label names the installer creates.

## How issues are stored
<!-- de: b0bbea51c30a -->

Each issue is a file in `issues/`:

```
issues/
  0001.md
  0002.md
  0003.md
```

Format of an issue file:

```markdown
---
id: "0001"
status: backlog
title: Build login form
created: 2026-07-01
---

## Kontext
Users cannot sign in yet.

## Aufgabe
E-mail and password fields, submit button, validation.

## Akzeptanzkriterium
- Form renders without errors
- Validation shows an error message for an empty field
- Submit does not raise a JS error

## Abhängigkeiten
Keine.
```

The section headings `Kontext`, `Aufgabe`, `Akzeptanzkriterium` and `Abhängigkeiten` (context, task, acceptance criterion, dependencies) are the four-section format the kit's skills read, so they stay in German; `Keine.` means "None."

The status (`backlog | ready | in_progress | in_review | done`) is set by the board adapter (Board-Adapter) directly in the file — no API, no label, no board.

## Sharing the board via Git (several machines)
<!-- de: 8f69afb421fe -->

Because issues are ordinary files in the repo, their portability hinges on a single question: Is `issues/` versioned?

By default it is — the installer does **not** add `issues/` to `.gitignore`. The local board is therefore part of the repo and travels with `commit` / `push` / `pull`. If you work on a project from two machines, you see the same board state on both:

```bash
# Machine A
node .claude/kit/board.mjs issue move 0001 ready
git add issues/ && git commit -m "Board: #0001 to ready" && git push

# Machine B
git pull   # pulls the new board state
```

But it also means: **Every status change produces a commit/diff** in the issue file. The board history becomes part of the Git history — intended, but the history gets chattier.

**Keeping the board private on purpose:** If you want to keep the board local per machine (not shared), add `issues/` to `.gitignore`. Then the files stay local to the machine.

**Heads-up on the first pull on a second machine:** If your own untracked issue files already sit in `issues/` there, `git pull` aborts with *"untracked working tree files would be overwritten"*. Back them up or remove them first:

```bash
mv issues issues.backup   # or delete, if identical
git pull
```

## The process in local mode
<!-- de: bd7e0ccc20ca -->

The nine steps run exactly as with GitHub or GitLab. The only difference: Instead of moving board cards (Karten), the adapter writes the status into the frontmatter.

**GO (step 3):** You open the issue file and change `status: backlog` to `status: ready` — or you use the adapter directly:

```bash
node .claude/kit/board.mjs issue move 0001 ready
```

**Push (step 7):** `/push-main` pushes to `origin/main`. If you have no remote, this fails. Instead: you work only on `main` locally and use the step as a checkpoint — or you skip it deliberately.

**Merge (step 9):** `/merge-production` recognises `codeHost: local` and prints the manual merge command instead:

```
Lokaler Modus: kein Pull Request.
Führe einen lokalen Merge durch:
  git checkout production
  git merge main
  git push
```

The message says: local mode, no pull request — perform a local merge with these commands.

## Board
<!-- de: feb3d50b16d3 -->

The former local Kanban GUI (`board-ui.mjs`) has been discontinued.
