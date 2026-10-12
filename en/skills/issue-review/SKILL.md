---
name: issue-review
description: Has requirement and plan read by foreign models before something comes of them; work packages on request. Use this skill when the user calls /issue-review or wants to sharpen a document before the next step.
user-invocable: true
---
<!-- de: 3f003956e0e3 -->

# Issue Review
<!-- de: 4513de51dd8c -->

A tool beside the process. A document is read by models that did not write it and do not know how it came about: they read what stands there and stumble where the plan or the implementation will stumble later. They may read the existing code while doing so. Findings are a contribution to the author of the stage, not a gate: the session that called the skill incorporates them or rejects them with one sentence. Whether a stage is finished is said by a command or a human, never by a model marker.

Precondition: `.claude/workflow.config.json` carries the block `issueReview` with `reviewers` (optionally `pairs`) and the block `reviewStufen` with roles and number of reviewers per stage. If one is missing, say so and end — without reviewers there is nothing to do.

## Call
<!-- de: c54d5a41b720 -->

```
/issue-review #N [#M …]     # exactly these documents, regardless of column and marker
/issue-review                # all [Requirement] and [Plan] documents in Backlog without the marker of their stage
/issue-review --dry-run      # preflight only, start nothing
```

Work packages — with and without `[Task]` — are only checked with an explicit number; the normal case is Ready without a package review. `[Idea]` is always skipped and named in the summary.

## Procedure
<!-- de: d8278c44e20b -->

### 0. Preflight
<!-- de: ec2bc1a14b58 -->

`node .claude/kit/board.mjs issue-review check` reports per reviewer whether it can run. If one is missing, ask the human before anything starts. **Unattended** (set `KIT_AGENT_MODEL`) nobody is asked: the run proceeds with the available reviewers, and line 2 of the findings comment names the outage. With `--dry-run` the skill ends here and lists documents and reviewers per document.

### 1b. Determine the stage
<!-- de: 9b12c0bd2509 -->

| Prefix | Stage | Document |
|---|---|---|
| `[Requirement]` | `fachlich` | requirement from `/requirement` |
| `[Plan]` | `plan` | plan document from `/techplan` |
| no prefix | `issue` | work package from `/issues` |
| `[Task]` | `issue` | work package from `/task` (lane 3) |
| `[Idea]` | — | excluded |

The stage values are machine values and stay German. The detection is that of `stufeAusTitel` in `kit/board.mjs`: case does not matter, leading white space is allowed, a prefix in the middle of the title does not count. The German prefixes (`[Fachlich]`, `[Idee]`) count the same.

### 2. Form before content
<!-- de: 6773ca74d20b -->

```bash
node .claude/kit/board.mjs issue check-form <id>
```

Violations — order of the sections, missing identification line, line of origin in the wrong place — are fixed by the calling session itself in the body before a reviewer starts, with `issue update` following the transport rule below. A reviewer checks no form.

### 3. Choose reviewers
<!-- de: b91145abaf43 -->

Read `Author-Model:` (work package: `## Context`; requirement: `## Goal`) or `Plan-Model:` in the head of the plan document. If the value is missing or reads `unbekannt`, ask once and propose a reviewer; unattended the rule proposal applies, and the findings comment notes that.
```bash
node .claude/kit/board.mjs issue-review roles --stage <fachlich|plan|issue> --author <model>
```

The number of reviewers of the stage `plan` can be set by a run via `KIT_PLAN_REVIEWER`; the session takes over the output of the command and does not count itself. `gewaehlt[i]` is paired with `rollen[i]`; only what stands in `gewaehlt` is started. `unterbesetzt: true` runs anyway and stands in line 2 of the comment; `quelle` (`pairs` | `regel`) and an `autorAufgeloest: false` belong there as well.

### 4. Start reviewers
<!-- de: e6f982708378 -->

Directly before the start the session takes off an existing label: `node .claude/kit/board.mjs issue label remove <id> review:done`. If it does not hang on the card, that is no error. If the run ends prematurely afterwards, the label stays off — the marker in the body keeps saying what was checked; the summary names the label as taken off and not set again.

Every reviewer `<n>` from `gewaehlt` gets its review brief as a file. The kit assembles it from the role under `kit/rollen/<rolle>.md`, the list of kinds and the unchanged body, for the plan including `Requirement:` and `Template:`, with the switch `history` set including the requirements found in full, as the lines `Suchbegriffe:` and `Dateien:` of the document find them; the session copies no role text and fills in nothing itself:
```bash
node .claude/kit/board.mjs issue-review review-brief --role <role> --id <id> --file <tmpdir>/<id>-auftrag-<n>.md
```

With `kind: claude` the session starts the Agent tool with `subagent_type: kit-pruefer` and the model from `reviewers[].model`; the assignment reads only `Read <tmpdir>/<id>-auftrag-<n>.md`, with a literal path. The agent may only read, its closing message is the finding. With `kind: command` the kit starts the foreign tool at its reading boundary, the answer then stands in the output file:
```bash
node .claude/kit/board.mjs issue-review start --reviewer <name> --brief <tmpdir>/<id>-auftrag-<n>.md --output <tmpdir>/<id>-antwort-<n>.md
```

If `review-brief` or `start` fails (exit 1, for instance `rolle-fehlt` or `keine-lesegrenze`), that is an outage of this reviewer in line 2 of the findings comment, with the error from the output; the check continues without it. There is no substitute route — no self-written prompt, no start bypassing the kit.

### 5. Findings to the board
<!-- de: 0fd2a5aa2b47 -->

One comment per run. First line literally `## <stage>-Review, Round 1` with `Issue`, `Requirement` or `Plan`; line 2 names outage, understaffing or the rule proposal for the author model, otherwise it stays empty; below it per reviewer the head literally `### Reviewer <n>: <role>, <model>`, for instance `### Reviewer 1: form-beobachtbarkeit, fable`, and below it its findings. From this head `record` books the role; in another form it falls back to "unbekannt". The findings themselves keep the form words that `kit/findings.mjs` reads (`KRITISCH|BLOCKER|WICHTIG|HINWEIS`, `Fundstelle:`, `Vorschlag:`, `Gegenprobe:`, `Art:`); they stay German in every language. File `<tmpdir>/<id>-befunde.md`, then check the form of the findings:
```bash
node .claude/kit/findings.mjs check --file <tmpdir>/<id>-befunde.md
```

If the command reports missing details, the session requests them from the delivering reviewer exactly **once** and writes the file anew. The missing `reviewer-kopf` the session sets itself, without a request — the head comes from it, not from the reviewer; it never writes a head without a reviewer that ran. If a detail is still missing afterwards, the affected finding block carries the line `Angaben: unvollstaendig` (a form word, stays German). **No gate:** neither a missing detail nor a delivery that did not come holds up the run; if the command itself fails, that stands as one line in line 2 of the comment. The comment goes to the board in each of these cases:
```bash
node .claude/kit/board.mjs issue comment <id> --text-file <tmpdir>/<id>-befunde.md
```

If this comment does not arrive, the skill ends without further mutation.

### 6. Incorporate
<!-- de: 5e6027ea46d5 -->

The calling session goes through every finding and decides according to `CLAUDE-workflow.md`, section "Decide instead of asking": take over or reject with one sentence. If a finding hits the stop class, it is asked interactively; unattended the session marks the document, writes no body and ends after the incorporation comment:
```bash
node .claude/kit/board.mjs issue label add <id> kit:clarify
```

Interactively it shows the list (taken over / rejected with reason) and waits for a word before writing; unattended it writes directly. What is written is the complete new body — existing identification lines (`Author-Model:`, `Plan-Model:`, `Requirement:`, `Plan:`) are kept — via `<tmpdir>/<id>-body.md`:
```bash
node .claude/kit/board.mjs issue update <id> --body-file <tmpdir>/<id>-body.md
```

In addition the marker line as a trace at the place of the stage: for the work package in `## Context`, for the requirement in `## Goal` next to `Author-Model:`, for the plan document in the head next to `Plan-Model:`. Unattended `, night run` stands in the brackets:
```
Issue-Review: codex (2026-09-13)
Plan-Review: fable (2026-09-13, night run)
```

For the requirement the marker reads `Requirement-Review:`. No finding is a result too: write the marker, comment with "no findings". Then the second comment with the first line `## Incorporation, Round 1` and the list taken over / rejected with reason per finding, via `<tmpdir>/<id>-einarbeitung.md`:
```bash
node .claude/kit/board.mjs issue comment <id> --text-file <tmpdir>/<id>-einarbeitung.md
```

Then the recording: per finding block the session adds to the findings text the line `Uebernahme: uebernommen` or `Uebernahme: abgelehnt` (form words, they stay German) — the same decision the comment carries in prose —, writes the text following the transport rule as `<tmpdir>/<id>-buchung.md` and records it with the stage of the run from step 1b; for **every** kind that `record` reports under `arten` as `erreicht` and with `vorschlag: true`, a proposal follows — a judgement kind (`vorschlag: false`) produces none. **No gate:** a failure of `record` or `suggest` stands in **one line** and holds up neither run nor label — the log is bookkeeping, not a condition. If the run is parked with `kit:clarify`, **nothing is recorded**: nobody has decided on the findings there, and a finding without a note of take-over does not belong in the log. In a runner's worktree `suggest` creates nothing and reports that with a reason: that is no failure, the summary names it as "proposal follows on teardown".
```bash
node .claude/kit/findings.mjs record --file <tmpdir>/<id>-buchung.md --stage <fachlich|plan|issue> --card <id>
node .claude/kit/findings.mjs suggest --kind <a>
```

Then the label as a visible trace on the board: `node .claude/kit/board.mjs issue label add <id> review:done`. It is a trace, not a release, and means the state of the marker date. If a finding hits the stop class and `kit:clarify` is set, `review:done` is dropped. If `findings.mjs check` reports the entry `keine-pruefer`, `review:done` is not set: without a single reviewer that ran the stage is not checked, and the summary names that. If the label is not defined on the board, the skill reports the adapter's error message and carries on; body, marker and comments then stand anyway, and the summary names the missing label. The night chain requires this label as a precondition before it takes up a requirement or a plan document; the trace still stays only a trace, not a release. The label testifies solely to the check by the models — **not** that the PO has answered the questions under `## Open questions for the PO`; the reviewers are explicitly not allowed to answer them. The chain requires both: a requirement with `review:done` and open questions is skipped with a reason until the **first** line of the section carries a note that begins with `Keine` — answered questions alone are not enough, the chain reads only this one line. The word is a machine value and stays German. If a requirement is changed substantially after the check, take the label off or have it checked again — the nightly run does not recognise a later change.

### 7. Close
<!-- de: f97702a502a8 -->

Summary per document: stage, number of findings, taken over / rejected, number of **recorded** findings and the **proposals** that came about or were extended in the process (with a failure of the recording its one line), marker and `review:done` set, label taken off and not set again, or `kit:clarify`, skipped documents with reason. Then: Ready is the human's GO — the marker releases nothing.

If `kit:clarify` is on a `[Fachlich]`, the summary names `/groom #N` as the route to the answer.

## Long texts to the board
<!-- de: 630900c19283 -->

Findings, body and incorporation come about following the transport rule from `CLAUDE-workflow.md`, section "Long texts to the board": never as a command line argument, but piece by piece into a file outside the project directory (`printenv TMPDIR`; if the output stays empty (Linux and WSL2 without sandbox), `/tmp` applies; then `cat >` and `cat >>` with at most 6,000 characters each), every piece an **own** tool call with a literal path, then one call with `--text-file` or `--body-file` respectively. If a file step fails, the incomplete file is not transferred; if a board call fails, the skill reports the error with the path and ends without further mutation.

## Stop points
<!-- de: 4298f7613aa5 -->

- No move to Ready — that is the human's GO. Exception, exclusively in the implementation stage of the night chain under variant B: there the night runner moves the resulting work packages to Ready itself. The exception applies to the runner, not to this skill — no move to Ready by this skill.
- Interactively no writing into the body without a word of consent.
- No marker releases a step; it is a trace. `review:done` too is a trace, not a release.
- No substitute reviewer on one's own initiative — the staffing comes from `roles`.
- No review of `[Idea]`.
