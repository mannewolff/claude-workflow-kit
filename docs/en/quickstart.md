# 5-minute guide
<!-- de: efc4d61738d5 -->

The kit makes a process for AI-assisted development executable in Claude Code without you giving up your stop points (Stop-Punkte): seventeen skills, a config and an installer.

## Prerequisites
<!-- de: 7c01c764f7d5 -->

- macOS, Linux or Windows via WSL2, set up following [Windows via WSL2](/en/wsl2)
- Node.js version 18 or later and git
- Claude Code
- Depending on the issue tracker `gh` or `glab`, logged in; in local mode neither

## Installing
<!-- de: 9f3eb8798900 -->

In the project folder:

```bash
curl -O https://docs.mwolff.org/install.mjs
node install.mjs
```

In a new project, the installer first asks for the language (`de` or `en`), then whether it installs globally or only for this project, for code host and issue tracker (`github`, `gitlab` or `local`), for main and production branch, review scope and reviewer. Installed per project, the commit gate and the check areas (Prüfbereiche) follow; installed globally, the vault path for `/session-start` and `/document`.

Afterwards skills, config and tools are under `.claude/`. Restart Claude Code; the skills appear in `/help`.

## The seventeen skills
<!-- de: 9c436bf7c728 -->

| Command | What for |
|--------|-------|
| `/session-start` | Overview of the situation at the start of a session |
| `/triage` | Talk an idea through and bring it onto its lane (Bahn) |
| `/requirement` | Business concept (Fachkonzept) without technology for the PO loop (PO-Schleife) |
| `/groom` | Decide the open questions of a reviewed business concept one by one |
| `/techplan` | Plan from the requirement, without implementation |
| `/issues` | Break the plan down into small work packages (Arbeitspakete) |
| `/task` | Requirement with nothing to weigh up as one work package `[Task]` |
| `/issue-review` | Have a document reviewed by foreign models |
| `/implement-ready` | Implement all Ready cards (Karten), commit locally |
| `/implement-next` | Implement exactly one Ready card |
| `/implement-test` | Only the red tests for the next Ready card |
| `/implement-done` | Implement against the red tests |
| `/kit-review` | Review by a second model in a fresh session |
| `/push-main` | Push to the main branch, only on your word |
| `/merge-production` | Release to production, only on your word |
| `/retro` | AI retrospective with key figures |
| `/document` | Document the session in the vault |

## A first run
<!-- de: 41ea72b7e187 -->

```
/techplan baue ein Login-Formular mit E-Mail und Passwort
```

If the plan fits, `/issues` breaks it down into work packages. You move them to Ready on the board; that is your GO. Then:

```
/implement-ready
/kit-review
```

After your review you push with `push main`, after your test on the test server you release with `merge production`. Then you move the cards to Done.

## The smaller path
<!-- de: b77a86cb387a -->

If a requirement is more than a trifle but there is nothing to weigh up, `/task` creates a single work package instead of business concept, plan and breakdown. The skill names the lane and creates nothing until you confirm. Which path applies when is described under [Three lanes](./dokumentation.md#three-lanes).

## The three steps you do yourself
<!-- de: 3919c151a4e0 -->

Moving to Ready, the push, the merge. The kit does not automate these three.

## Letting the runner work
<!-- de: d1b79a16df74 -->

You sort cards in Ready and start `node .claude/kit/night.mjs`. The runner (Runner) implements each card in a fresh session, commits locally and never pushes. More under [Runner](./runner.md).
