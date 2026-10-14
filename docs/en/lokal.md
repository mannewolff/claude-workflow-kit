# Working locally — without a remote repo, without a board
<!-- de: a4959651366c -->

In local mode you only need git and Node.js: no remote repo, no board, no CLI of a hosting provider. A local git repository is required; `git init` is enough.

## When this mode fits
<!-- de: 2f22aedb5f14 -->

- Private project without a remote repo
- Early phase, no board set up yet
- Trying out the kit before you choose a platform
- A single person without a pull request process

## Installation
<!-- de: aa594f07eda2 -->

In the installer, choose `local` for code host and issue tracker. The config then contains:

```json
{
  "codeHost": "local",
  "issueTracker": "local",
  "local": { "issuesDir": "issues" }
}
```

`local.issuesDir` names the directory of the cards (Karten), default `issues`.

## How cards are stored
<!-- de: 9262c612f1bd -->

Every card is a Markdown file with a four-digit number:

```
issues/
  0001.md
  0002.md
```

```markdown
---
id: "0001"
type: task
status: backlog
title: Login-Formular bauen
created: 2026-07-01
---

## Kontext
Nutzer können sich noch nicht anmelden.

## Aufgabe
E-Mail- und Passwort-Feld, Submit-Button, Validierung.

## Akzeptanzkriterium
- Leeres Feld zeigt eine Fehlermeldung

## Abhaengigkeiten
Keine.
```

The board adapter (Board-Adapter) sets `status` (`backlog`, `ready`, `in_progress`, `in_review`, `done`) directly in the file; comments are in the same file.

## Sharing the board via Git
<!-- de: a2622830a073 -->

The installer does not add `issues/` to `.gitignore`. The cards therefore belong to the repo and travel to every machine with `push` and `pull`; every status change is a change in git:

```bash
node .claude/kit/board.mjs issue move 0001 ready
git add issues/ && git commit -m "Board: 0001 nach ready"
```

If the board is to stay on one machine, add `issues/` to `.gitignore`. If a second machine already has its own, unversioned cards in `issues/`, the first `git pull` aborts; back them up or remove them beforehand.

## The process in local mode
<!-- de: 61f4f50f28d2 -->

The steps run as with GitHub or GitLab.

- **GO:** `node .claude/kit/board.mjs issue move <id> ready` moves a card to Ready; you can just as well change `status:` in the file.
- **Push:** `/push-main` pushes to the remote. Without a remote, the state stays on the local main branch.
- **Merge:** Without a code host there is no pull request; `/merge-production` names the git commands for the local merge.
