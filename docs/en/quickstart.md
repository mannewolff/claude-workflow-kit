# 5-minute guide
<!-- de: 0a296c3cd2dc -->

You have a process for AI-assisted development, and you want to make it executable in Claude Code without giving up your stop points (Stop-Punkte). The kit gives you sixteen skills, a config and an installer. In five minutes it is running.

## Prerequisites
<!-- de: dd6489dcf11f -->

- macOS, Linux or Windows via WSL2
- Node.js version 18 or later
- git
- Claude Code installed
- Depending on the issue tracker: `gh` (GitHub CLI) or `glab` (GitLab CLI), authenticated — or nothing at all if you choose local mode
- On Windows: WSL2, see [Windows via WSL2](/en/wsl2)

## Installing
<!-- de: 82a0e58ef195 -->

Download the installer and start it in the project folder:

```bash
curl -O https://docs.mwolff.org/install.mjs
node install.mjs
```

Or in one step:

```bash
node <(curl -s https://docs.mwolff.org/install.mjs)
```

The installer asks seven things:

1. Global or only for this project
2. Code host: `github`, `gitlab` or `local`
3. Issue tracker: `github`, `gitlab` or `local` (default = code host)
4. Name of the main branch
5. Name of the production branch
6. Review scope: `diff` or `full`
7. Review model

With a global installation, an eighth question follows about the vault path for `/kontext` and `/document` (leaving it empty skips it).

Afterwards the sixteen skills are in `.claude/skills/` (or globally in `~/.claude/skills/`), and a `.claude/workflow.config.json` with your answers as well as the board adapter (Board-Adapter) (`.claude/kit/board.mjs`) are in the repo. Restart Claude Code, and the skills show up in `/help`.

## The sixteen skills
<!-- de: 2c527f9cea82 -->

| Command | What for |
|--------|-------|
| `/kontext` | Load context, overview of the situation at session start |
| `/fachplan` | Optional: requirement as a business issue for the PO loop (PO-Schleife) (see [documentation](./dokumentation.md#po-loop-business-and-technical-issues)) |
| `/techplan` | Plan from the requirement, implements nothing |
| `/issues` | Plan into small issues (GitHub, GitLab or local) |
| `/task` | Requirement without trade-offs as a single work package (Arbeitspaket) `[Task]`, only after your confirmation |
| `/issue-review` | Have a document checked by other models before the GO |
| `/implement-ready` | Work through the Ready issues, commit locally |
| `/implement-test` | Granular entry: only the tests for a Ready issue (red) |
| `/implement-done` | Granular entry: implement against the red tests (green) |
| `/implement-next` | Exactly one Ready issue (`#N` binding, otherwise the top one), then stop — building block of night mode (Nachtbetrieb) |
| `/local-check` | Mandatory checks plus UI verification |
| `/review` | Review by Opus in a fresh session |
| `/retro` | AI retrospective, consolidate memory |
| `/push-main` | Push to main, only you |
| `/merge-production` | PR to production, only you |
| `/document` | Document the session, update the project note |

## A first run
<!-- de: c6f1e3ad36b9 -->

```
/techplan build a login form with email and password
```

You read the plan. If it fits, you approve it:

```
/issues
```

You move the issues to Ready on the board. That is your GO. Then:

```
/implement-ready
/local-check
/review
```

You check the review. Only then:

```
/push-main
```

On the test server you check the result. If it is right:

```
/merge-production
```

## The smaller path
<!-- de: 98d0ca4e7097 -->

Not every requirement needs a plan. If it is more than a trifle but there is nothing to weigh up, it becomes a single work package instead of a business concept (Fachkonzept), plan and breakdown:

```
/task rename the configuration keys uniformly in all skill files
```

The skill names the lane (Bahn) in one sentence and waits for your word. Without your answer it creates nothing. After that the usual path continues: You can have the `[Task]` checked with `/issue-review` like any other work package, and you move it to Ready yourself.

Which path applies when is set out in the [selection rule of the three lanes](./dokumentation.md#three-lanes).

## The three steps you take yourself
<!-- de: 2bdf1d654ffd -->

Moving to Ready, the push, the merge. These three the kit deliberately does not automate. They are the point at which you carry the responsibility. The AI takes everything else off your hands.

## Letting it work at night
<!-- de: b9ea665f3dc5 -->

In the evening, move issues to Ready and sort them, then `node .claude/kit/night.mjs` — the night runner (Nacht-Runner) works through the column (Spalte) with a fresh session per issue, commits only locally and never pushes. Details in the section "Night mode" of the [documentation](./dokumentation.md#night-mode).

More details in the full documentation.
