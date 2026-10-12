---
name: context
description: Loads the memory vault and gives a short session-start overview. Use this skill when the user calls /context (old name /kontext) or wants to start the session with the state of the project.
user-invocable: true
---
<!-- de: 4d42f76ff19e -->

# Context
<!-- de: 6cfee574f3a7 -->

Session start: load the vault, fetch the state of the project, give a short overview. A tool next to the process — useful at the start of every session, but the process also runs without it.

## Precondition: determine the config mode
<!-- de: 7c9900681bf8 -->

Both configs are read and **merged field by field**, local fields win:
1. `~/.claude/kontext.config.json` (global) — the base
2. `.claude/kontext.config.json` in the current project directory — overrides individual fields

No "first one found wins": a local config that only sets `project`/`parentProject` inherits `vault` and `always` from the global one. With "first wins" the vault path would be lost.

This yields one of two modes:

**Mode A (full mode):** After the merge, `vault` is set. Normal procedure with vault, project notes, always files.

**Mode B (degraded mode):** After the merge there is no `vault` (no field set or no config found at all). Skip the vault steps. Load only initiatives and projectDocs. At the end output the note: "No vault configured, working without persistent memory."

No hard abort. Both modes deliver meaningful output.

## Procedure
<!-- de: 785d89faa261 -->

### 1. Read the config
<!-- de: 7e5446ed567b -->

Fields from `kontext.config.json` (all optional):
- `vault`: absolute path to the memory vault
- `always`: array of file paths relative to the `vault` root (always read)
- `projectDocs`: array of paths or glob patterns relative to the project directory. Fallback if not set: `["CLAUDE-*", ".claude/CLAUDE-*"]`
- `project`: override for the vault project name (only needed if repo name ≠ vault folder name)
- `parentProject`: umbrella project in a multi-repo setup. Set when this repo is a service of a larger system — then the service notes lie in the folder of the umbrella project and the umbrella note is added
- `logPath`: pattern for the daily log file relative to the `vault` root, default `Log/{date}.md`. Only `/document` writes there

### 2. Read vault files (mode A only)
<!-- de: 28657e0b17d4 -->

Read all files from `always` relative to the `vault` path. Typically: `Index.md` (structure + active projects) and `Profil.md` (user profile).

### 3. Read project notes (mode A only)
<!-- de: d64113d3cdd5 -->

The skill does not assemble vault paths itself. One call delivers them:

```bash
node .claude/kit/board.mjs context paths
```

Relevant fields in the JSON:
- `parentNote`: absolute file of the umbrella note — only set if `parentProject` is configured, otherwise `null`
- `projectNote`: absolute file of this repo's note
- `project`, `parentProject`: for the header line in step 6

Reading order: **`parentNote` first** (unless `null`), **`projectNote` after it**. The shared bracket forms the frame into which the service context belongs — read the other way round, the service view stands there without the system context.

If one of the two files is missing in the vault: skip quietly, no error. Showing only the `always` files is enough.

**The fallback applies to exactly one case: unknown axis `context`** — a project with an older `board.mjs`. Then fall back to the previous behaviour instead of aborting: call the axis under its old name `kontext` (`node .claude/kit/board.mjs context paths`); if that is unknown as well, determine the project name via `node .claude/kit/board.mjs code repo-name` (last segment without `.git`, the `project` field from the config wins), project note `{vault}/Projekte/{name}/{name}.md`, no umbrella note. A session start must not fail because of this.

**Every other error is reported visibly**, in particular an ambiguous note (two files that differ only in upper/lower case) and a note folder that cannot be read. Output the command's message unchanged and construct no path yourself. Whoever falls back here hides exactly the finding the command has just reported (Issue #286).

### 4. Read project-specific docs (both modes)
<!-- de: 976481e5e8ad -->

Read all files from `projectDocs` relative to the project directory. Entries can be concrete file names or glob patterns:

```bash
find . -maxdepth 1 -name "CLAUDE-*" -type f
```

Skip missing files and patterns without matches quietly (no error).

### 5. Fetch initiatives (both modes)
<!-- de: 8014f0205a30 -->

Initiatives and repo name via the board adapter:

```bash
node .claude/kit/board.mjs issue epics
node .claude/kit/board.mjs code repo-name
```

**Which initiatives appear.** An initiative appears if at least one of
its work packages is not done yet (`done` less than `total`).
This hides both: what has finished all its work packages and
what has none at all (`0/0`) — an initiative without work packages has not been
started and does not carry the entry. If no initiative meets the rule,
the section `### Initiatives` is dropped entirely.

**A failure of `issue epics` is skipped quietly**, not reported:
GitHub and GitLab know no initiatives, the adapter rejects the command there.
An error is the normal case with these trackers and not a finding — whoever
outputs it produces a warning at every session start in a GitHub project
about a capability that will never exist there.

If the adapter returns an error for the remaining calls: skip the
step, no hard abort.

### 6. Output the summary
<!-- de: b3ab806b9b3b -->

Compact session-start overview.

**Without `parentProject`** (single-repo case, one project level):

```
## Session start — {project name}

### Initiatives
- #N [CODE] Title — done/total
- ...
(from `issue epics`; omit the section if the tracker knows none)

### Recent decisions / Last updated
(from the project note — mode A only; only the most recent documented day)

### What comes next
(from the project note)
```

**With `parentProject`** (multi-repo setup): The header names both levels, so that it is immediately visible which service you are in and which system it belongs to. If both notes were read, the system-wide state and the state of this service stay separate — a list stirred together would be worthless at the start, because it is no longer recognisable what applies to all services:

```
## Session start — {parentProject} / {project}

### Initiatives
- #N [CODE] Title — done/total
- ...
(from `issue epics`; omit the section if the tracker knows none)

### System-wide state ({parentProject})
(from the umbrella note — omit the section if it is missing)

### State of {project}
(from the project note — recent decisions / last updated; only the most recent documented day)

### What comes next
(from the project note)
```

**Only the most recent documented day.** Under the recent decisions stands what was recorded on the most recent day documented in the note — even if that day contains no decision.
- Only dates of the form `YYYY-MM-DD` that introduce an entry count, searched in the whole note and not only in the first `## Last updated` section (in a German note `## Zuletzt aktualisiert`). A note can carry several such sections.
- A date introduces an entry if it stands at the start of the line, at most after a list bullet, and is followed by a `:` or a parenthetical addition — the form in which `/document` writes: `- YYYY-MM-DD: …` or `- YYYY-MM-DD (evening): …`.
- Dates mentioned in the running text of an entry do not count, nor does a date in another form such as `**As of YYYY-MM-DD**`.
- If several entries belong to the most recent day, they all belong to it; an addition such as "(evening)" is a time of day, not another day.
- If the note carries no date that introduces an entry, its most recently written section appears as it stands — the condensing rule does not apply to this fallback.
- If two notes are read, the day is determined separately for each note.

**The initiatives stand at the top**, because they are the structure under which the work
hangs: whoever sees them first has the frame into which everything else belongs. The
individual work packages are on the board and are not repeated here —
what the session start outputs then stands in the context window of the whole session
and is missing there for the actual work.

In degraded mode, append at the end:
> "No vault configured, working without persistent memory. For full mode: create `~/.claude/kontext.config.json` with the vault path."

No complete reproduction of the vault contents — only what is relevant for getting started right away.

## What this skill does not do
<!-- de: afc0ce3a713a -->

- No writing into the vault (that is /document)
- No code changes
- No starting other skills on its own initiative
