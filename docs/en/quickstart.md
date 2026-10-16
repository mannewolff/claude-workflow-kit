# The first hour
<!-- de: 795baf7748fa -->

At the end of this hour a card (Karte) is in Done: made from an idea, released by you, implemented on its own by the runner (Runner), reviewed by a second Claude model in a fresh session and looked through by you. The hour counts from a computer with macOS, Linux or WSL2 ready to use. On Windows you first set up WSL2 following [Windows via WSL2](/en/wsl2); including the restart this takes about 30 minutes.

## Prerequisites
<!-- de: e8c8839510ea -->

- macOS, Linux or Windows with WSL2
- git, Node.js version 18 or later and curl
- Claude Code
- a Claude account you log in with
- your git identity

The local board needs no further account.

## The steps
<!-- de: 69159a2a4fdd -->

### 1. Check the tools
<!-- de: ac15f2b32bd2 -->

Time: about 5 minutes.

```bash
git --version
node --version
claude --version
```

Done when every command prints a version number, `node` at least `v18`.

Otherwise: If Node.js is missing or older, install it via [nvm](https://github.com/nvm-sh/nvm) with `nvm install --lts`. If Claude Code is missing, install it with `npm install -g @anthropic-ai/claude-code`. git comes from your system's package manager.

### 2. Log in to Claude
<!-- de: 958dc2797053 -->

Time: about 3 minutes.

Run `claude`, log in and end the session again. Then:

```bash
claude -p "Reply only with OK"
```

Done when the output is `OK`; this is also how the runner starts its sessions.

Otherwise: Run `claude` once more and complete the login.

### 3. Set your git identity
<!-- de: 71e16b850840 -->

Time: about 1 minute.

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.org"
```

Done when `git config user.email` prints your address.

Otherwise: If the command prints nothing, repeat the second line.

### 4. Create the project
<!-- de: 7b7e39084f2c -->

Time: about 1 minute.

```bash
mkdir ~/first-hour && cd ~/first-hour && git init -b main
```

Done when `git status` names the branch `main`.

Otherwise: If git does not know the option `-b`, it is older than 2.28. Update git and run `git init -b main` in the folder.

### 5. Install the kit
<!-- de: c79b0cf79269 -->

Time: about 3 minutes.

```bash
curl -O https://docs.mwolff.org/install.mjs
node install.mjs
```

The installer asks one question after another; for the first hour you answer like this:

| Question | Answer |
|---|---|
| Language | `en` |
| Skills globally or for this project only | `project` |
| Code host | `local` |
| Issue tracker | `local` |
| all others, including the commit gate | Enter |

What each question means is described under [Installation](/en/einrichtung#installation). At the end the installer reports `WARNING: There are uncommitted files in the workspace`; step 8 cleans that up.

Done when `ls .claude/kit` shows `board.mjs` among others.

Otherwise: Check the network connection and repeat the step.

### 6. Check the board
<!-- de: 73d285c526ea -->

Time: about 1 minute.

The answer `local` for the issue tracker creates the local board with five columns (Spalten) from Backlog to Done; you create neither columns nor labels. Each card is a file under `issues/`.

```bash
node .claude/kit/board.mjs issue list
```

Done when the output is `[]`, an empty board.

Otherwise: If `.claude/workflow.config.json` does not contain `"issueTracker": "local"`, repeat step 5 and answer `local` for the issue tracker.

### 7. Enter the check command
<!-- de: 410792052611 -->

Time: about 2 minutes.

The runner implements a card only if it can check it afterwards. In `.claude/workflow.config.json` replace the line `"buildChecks": [],` with:

```json
"buildChecks": ["node --test"],
```

Then:

```bash
node .claude/kit/checks.mjs run --stage push
```

Done when the output contains the line `ran: node --test → gruen`.

Otherwise: If the command reports an error in the config, compare the line character by character with the one above. Without this entry the runner would stop in step 12 with `Error: buildChecks in workflow.config.json has no check`.

### 8. Clean the workspace
<!-- de: d4b3f1de0394 -->

Time: about 1 minute.

```bash
git add -A
git commit -m "Kit set up"
git status --short
```

Done when `git status --short` prints nothing.

Otherwise: If git rejects the commit because name or email are missing, repeat step 3 and then this step.

### 9. Create the idea
<!-- de: 6dacf725a6a6 -->

Time: about 1 minute.

```bash
node .claude/kit/board.mjs issue create --kind idea --author-model human --title "Greeting as a function" --body 'A file gruss.mjs with export function begruesse(name) that returns Hallo, <name>!, plus a test with node:test under test/.'
```

Done when the output names an `id`, a four-digit number; it stands for `<id>` in the following commands.

Otherwise: If the command reports `No author model given`, `--author-model human` is missing, the note that a human wrote the idea.

### 10. Talk the idea through
<!-- de: ce2da62169ad -->

Time: about 10 minutes.

Start `claude` in the project and run in the session:

```
/triage <id>
```

`/triage` clarifies open points with you and proposes lane (Bahn) 3, a single work package (Arbeitspaket). Confirm; `/task` creates the package after your confirmation. End the session.

Done when `node .claude/kit/board.mjs issue list` shows a card with `[Task]` in the title and `"status": "backlog"`. From here on `<id>` stands for its number.

Otherwise: If `/triage` proposes another lane, answer that there is nothing to weigh up and choose lane 3. If the card is still missing, run `/task <id>` with the number of the idea.

### 11. Release the card
<!-- de: 1b81ea4139cd -->

Time: about 1 minute.

```bash
node .claude/kit/board.mjs issue move <id> ready
node .claude/kit/board.mjs issue label add <id> kit:nightrun
```

Moving to Ready is your GO; the label tells the runner that it may take the card.

Done when `issue list` shows the card with `"status": "ready"` and the label `kit:nightrun`.

Otherwise: If the card does not exist, you took the number of the idea; take that of the `[Task]` card.

### 12. Start the runner
<!-- de: 37ee52a3a0da -->

Time: about 15 minutes, most of it waiting.

```bash
git status --short
node .claude/kit/night.mjs --dry-run
node .claude/kit/night.mjs
```

`git status --short` is empty or shows only `issues/`; cards do not count as a change for the runner. If the dry run reports `-> session 1`, start the runner: it implements the card in a fresh session, checks with `node --test` and commits locally.

Done when `issue list` shows the card with `"status": "in_review"` and `git log --oneline` has a new commit on top.

Otherwise:
- `Working tree is not clean`: commit as in step 8 and start again.
- `buildChecks in workflow.config.json has no check`: back to step 7.
- `skipped (no label 'kit:nightrun')`: second command from step 11.

### 13. Have the result reviewed
<!-- de: eafcc0beeb2d -->

Time: about 5 minutes.

Start a fresh session with `claude` and write in one message:

```
/kit-review card <id>
```

A second Claude model reads the change without knowing the implementation and writes its findings to the card. In a team, a reviewer from another model family takes this place.

Done when `node .claude/kit/board.mjs issue get <id>` shows a comment with `## Code review (step 6)`.

Otherwise: If the findings are only in the chat, name the card number once more in the same session.

### 14. Look through and move to Done
<!-- de: e9769e402ca7 -->

Time: about 5 minutes.

```bash
git show --stat HEAD
node --test
node .claude/kit/board.mjs issue move <id> done
```

Read the findings and look at the commit. Moving to Done is your acceptance.

Done when `git show --stat HEAD` names `gruss.mjs` and a file under `test/`, `node --test` ends with `fail 0` and `issue list` shows the card with `"status": "done"`.

Otherwise: Do not move to Done. Write the defect to the card with `issue comment <id> --text "…"`, move it to `ready` and start step 12 again.

## What comes next
<!-- de: 1c1b467d233d -->

- Switch to GitHub or GitLab: [Issue tracker and code host](/en/einrichtung#issue-tracker-and-code-host).
- Publish with `push main` and `merge production`: [Push](/en/prozess#push-main) and [Merge](/en/prozess#merge-production).
- Reviewer from another model family, team settings: [Team config](/en/einrichtung#team-config-and-personal-deviations), [Settings](/en/einstellungen).
- Bind every commit to a green check run: [The commit gate](/en/einrichtung#the-commit-gate).
- The kit in your own project: [Installation](/en/einrichtung#installation), without a remote [Working locally](/en/lokal).
- Undertakings with something to weigh up on lane 2: [Three lanes](./dokumentation.md#three-lanes).
- The runner with chain, several cards and without supervision: [The chain](/en/runner#the-chain).
- The runner on Windows: [Windows via WSL2](/en/wsl2).
- All seventeen skills: [The skills](/en/prozess#the-skills).
