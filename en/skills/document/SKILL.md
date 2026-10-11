---
name: document
description: After the session, writes a daily log entry into the vault and updates the project note. Use this skill when the user calls /document or wants to document the session.
user-invocable: true
---
<!-- de: 24acf2826535 -->

# Document
<!-- de: 3265dd021f89 -->

A tool next to the process, at the end of the session: write what was built, decided and learned in this session into the memory vault.

## Guiding principle: one file, one writer
<!-- de: fecb67d2fd14 -->

Every vault file this skill writes into automatically belongs to exactly one repo. If several service repos share a vault, a file written by all of them is the point of collision: parallel sessions overwrite sections, and in a synchronised vault a sync conflict arises. Shared files are therefore read, or written only with explicit consent — the umbrella note is the only shared place of writing and is deliberately not automated.

## Procedure
<!-- de: 785d89faa261 -->

### 1. Fetch the target paths
<!-- de: fea43e1178e2 -->

The skill does not assemble vault paths itself. One call delivers everything:

```bash
node .claude/kit/board.mjs context paths
```

The JSON contains:
- `mode`: `"full"` (vault configured) or `"degraded"` (no vault)
- `log`: absolute target file for the daily log
- `projectNote`: absolute target file for the project note
- `parentNote`: absolute file of the umbrella note — only set if `parentProject` is configured, otherwise `null`
- `project`, `parentProject`, `vault`: for the confirmation message

**The fallback applies to exactly one case: unknown axis `context`** — a project with an older `board.mjs`. Then fall back to the previous behaviour instead of aborting: call the axis under its old name `kontext` (`node .claude/kit/board.mjs kontext paths`); if that is unknown as well, read `kontext.config.json` yourself (local `.claude/kontext.config.json` before global `~/.claude/kontext.config.json`), project name via `node .claude/kit/board.mjs code repo-name` (last segment; in local mode without a git remote the adapter delivers the directory name — expected behaviour, no error), log to `{vault}/Log/YYYY-MM-DD.md`, project note to `{vault}/Projekte/{name}/{name}.md`, no umbrella note. Say explicitly in the confirmation that the fallback took effect and that `board.mjs` is outdated. A missing command must not make `/document` fail.

**Every other error aborts visibly**, in particular an ambiguous note (two files that differ only in upper/lower case) and a note folder that cannot be read. Output the command's message unchanged and write nothing. If the fallback took effect here, it would catch exactly the new error and in the end create the second note after all (Issue #286).

### 1b. Read the predecessor entry (mode `full` only)
<!-- de: 554168c47cbc -->

```bash
node .claude/kit/board.mjs context last-log
```

Delivers `{"path": "...", "date": "YYYY-MM-DD"}` — the most recent existing log entry **of the same project** — or `{"path": null}` if there is none (first entry of a project, normal case, no error). Today's entry is excluded: a second session on the same day should not read itself as its predecessor.

If there is a path, read the file and use it for three things:

1. **Back reference instead of duplication.** Refer to the predecessor (`see log YYYY-MM-DD`) and do not spread out again what is described there.
2. **Pick up open points.** What the last entry listed under "Open points" is answered in the new entry or explicitly carried forward as still open. An open point that disappears without comment is the actual damage — it looks done.
3. **Adopt tone and structure** instead of inventing a new format every time.

Explicitly not: change the predecessor, quote it in full, or load more than one entry. This is about connecting, not about history.

If the command fails (older `board.mjs`), skip this step quietly — it improves the entry, it is not a condition for it.

### 2. Write the daily log
<!-- de: 5f21c47573b8 -->

**Mode `full`:** The target file is `log` from the JSON.

**Mode `degraded`:** Target file `docs/session-log/YYYY-MM-DD.md` in the project directory. Create the directory if it does not exist.

In both modes:
- If the file does not exist yet: create it.
- If it already exists (second session on the same day): append a new section, do not overwrite.

**Format:**

```markdown
# YYYY-MM-DD — {project name} session

{Short opening sentence: what was the focus of this session?}

## Start

- {Which files/resources were loaded at the beginning?}

## {Section per implemented issue or topic}

{Free text: what was built, why this way, important decisions}

Committed {HASH} / Commits: {list}

## Open points

- {What remains open, which manual steps are pending?}
```

Synthesise the content from the session context: issues, commits, decisions, what comes next. No template fill-in, but a readable summary.

### 3. Update the project note (mode `full` only)
<!-- de: a1af6e1cb618 -->

The target file is `projectNote` from the JSON. It belongs to this repo and is updated without asking back.

Update the section `## Last updated` with a new entry at the top (newest entries first); if the note already carries the German section `## Zuletzt aktualisiert`, that one:

```
- YYYY-MM-DD: {Short summary: what was implemented, what is still pending}
```

Existing entries are kept.

### 4. Umbrella note only after asking (only if `parentNote` is set)
<!-- de: 7df249a75d8e -->

`parentNote` is **never written automatically** — it belongs to all services together.

Check whether the session had a cross-service effect:
- shared data model or schema changed
- API contract between services changed
- shared infrastructure touched
- system-wide architecture decision made

**Without a cross-service effect: do not ask, write nothing.**

**With a cross-service effect:** ask once, with the concretely proposed entry text, and write only after explicit consent:

```
The session has a cross-service effect ({short reason}).
Entry in the umbrella note Projekte/{parent}/{parent}.md:

- YYYY-MM-DD ({project}): {proposed entry text}

Add it? (yes/no)
```

This question is the only stop point in `/document`. Asking it when in doubt is cheaper than a sync conflict in the file that carries the system knowledge.

### 5. Confirmation
<!-- de: 63965e6abcfd -->

Report the targets actually written with their vault-relative path.

**Mode `full`, without `parentProject`:**
```
Documented:
- Log/YYYY-MM-DD.md (new / extended)
- Projekte/{name}/{name}.md (Last updated)
```

**Mode `full`, with `parentProject`:** additionally say explicitly whether the umbrella note was touched:
```
Documented:
- {log path relative to the vault} (new / extended)
- Projekte/{parent}/{project}.md (Last updated)
- Umbrella note Projekte/{parent}/{parent}.md: not touched (no cross-service effect)
```
or `... : extended (after consent)` if it was written.

**Mode `degraded`:**
```
Documented:
- docs/session-log/YYYY-MM-DD.md (new / extended)

No vault configured. Log written into the project directory.
For full mode: create ~/.claude/kontext.config.json with the vault path.
```

## What this skill does not do
<!-- de: 9b4dc08e70eb -->

- No reading of vault files into the context (that is /context)
- No automatic writing into the umbrella note — only after asking
- No assembling of vault paths itself (that is done by `board.mjs context paths`)
- No code changes
- No commit, no push
- No overwriting of existing log sections — only appending
