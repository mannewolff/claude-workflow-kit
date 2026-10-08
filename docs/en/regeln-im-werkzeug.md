# Rules in the tool
<!-- de: 7adbeccacaed -->

This page is the inventory for the conversion of `/local-check`: It lists **every** rule of the instruction `skills/local-check/SKILL.md` and states for each rule what kind it is, how far it has been moved into the tool and where it stands today.

The yardstick behind it is called "rule in the text or rule in the tool" (Regel im Text oder Regel im Werkzeug) and is set out in `CLAUDE-workflow.md`, the process template that every project receives. In short:

- **Operating instruction** (Bedienvorgabe) — says how a tool is to be operated. Whether it is followed can be read from the output or the result, and a tool could carry it out in place of the reader. It belongs in the tool.
- **Judgement rule** (Urteilsregel) — demands a decision or stance in the individual case. It stays in the text, because a tool could only guess it.
- **mixed** (gemischt) — carries both. The transferable part moves, the rest stays in the text, named.

The **degree of transfer** (Überführungsgrad) says what has actually happened: `vollständig` (complete: the rule now lives only in the tool), `teilweise` (partial: one part moves, the rest stays, named) or `nicht` (not: it stays where it was — with a reason).

A row with the kind *operating instruction* and the degree *not* is no contradiction: The kind says nothing about transferability. It only says that there would still be something to gain here if someone took on the spot.

## The rules of `/local-check`
<!-- de: 526f667ea8d0 -->

| Rule | Location | Kind | Degree | New place or reason for staying |
| --- | --- | --- | --- | --- |
| Real exit code of the check command | Section 1, build checks | Operating instruction | complete | `kit/checks.mjs` (`kommandoAusfuehren`) calls every command itself and reads its own exit code. The instruction to write it to a file first has disappeared from the text. |
| General failure markers in the output | Section 1, build checks | Operating instruction | complete | `kit/checks.mjs` (`fehlermerkmal`) checks the output of every command; a match turns the check (Prüfung) red, even with exit code 0. A replica of the marker check in `kit/night.mjs` for the salvage pre-check. |
| Time frame for long-running checks | `Leitplanke: Lang laufende Checks brauchen einen großzügigen Zeitrahmen.` (guardrail: long-running checks need a generous time frame) | mixed | partial | Being cut off by the clock has become visible: `kit/checks.mjs` writes the summary as it goes; a run that dies leaves it unfinished and not green. The request for a generous time frame stays in the text — a tool cannot give itself more time than its caller grants it. |
| Collecting a background run | `Leitplanke: Keine Session endet mit laufender eigener Arbeit.` (guardrail: no session ends with its own work still running) | mixed | partial | `kit/checks.mjs` takes over the unfinished summary: A run that got away is recognisable as such from the outside. The stance — wait, or abort and report the abort as a failure — stays in the text, because only the session knows whether it still has a move left. The second part (Issue #983) also stays in the text: that a waiting loop also checks whether the run still exists, and reports a dead run as a failure rather than as a timeout — the session builds its waiting loop in varying forms, and a tool would have to know each of them. |
| Timeout reached: do not restart with the same value | same guardrail, last clause | Judgement rule | not | Stays in the text: Whether the value is raised and that is stated, or the check goes back as a failure, is a trade-off in the individual case. |
| Report the coverage gate as a floor | `Leitplanke: Ein Coverage-/Qualitäts-Gate ist ein Floor, kein Beweis voller Abdeckung.` (guardrail: a coverage/quality gate is a floor, not proof of full coverage) | Judgement rule | not | Stays in the text: Whether a gap is genuinely untested logic or noise is decided by looking at the report. A tool could only hold the number against the threshold — the quality measurement already does that with its mark. |
| Class-wide model errors into the gate | `Leitplanke: Wiederkehrende, klassenweite Modell-Fehler gehören ins Gate, nicht in Prompts.` (guardrail: recurring, class-wide model errors belong in the gate, not in prompts) | Judgement rule | not | Stays in the text: Which lint or compiler rule covers an error class depends on the project and its ecosystem. The kit anchors the principle; the project keeps the catalogue in its `buildChecks`. |
| Failure analysis on a red check | Section 1, "Bei Fehler" (on failure) | Judgement rule | not | Stays in the text: Show the output, analyse the cause, propose a fix — that is the work itself, not a handle on the tool. |
| Manual UI verification | Section 3 | Judgement rule | not | Stays in the text: A human clicks through the golden path and the edge cases. A tool can take nothing over here, it can only remind. |
| Check anchor from `git merge-base` | Section 1, "Warum dieser Anker" (why this anchor) | Operating instruction | not | Stays in the text: The right anchor depends on the caller's point in time — `/local-check` checks after the commit against the last push, the `implement-*` skills before it against the default `HEAD`. The tool does not know its caller. |
| Run the package stage, pass no `--stufe` | Section 1, "Gefahren wird die Paketstufe" (the package stage is run) | Operating instruction | not | Stays in the text as a justification: `kit/checks.mjs` already carries the default (without `--stufe` the package stage (Paketstufe) runs); the text only says why the skill passes nothing. |
| Run the format fix exactly once more | Section 1b | Operating instruction | not | Stays in the text: `formatFixCommand` is called today by the night runner (Nacht-Runner) and by the reader of this instruction, not by `checks.mjs run`. The limit "no loop, no second round" therefore depends on both callers. |
| Duty to report after the fix | Section 1b, "Berichtspflicht" (duty to report) | Judgement rule | not | Stays in the text: That the working tree is changed after the fix belongs in the message to the human. What they make of it — commit or inspect — is their decision. |
| Report format of the checklist | Section "Ergebnis" (result) | Operating instruction | not | Stays in the text: `checks.mjs run` delivers the checks that ran and those that were skipped, each with its reason; the form of the message to the human (the checklist with its symbols) remains the instruction's business. |
| A red check stops the process | Section "Ergebnis" (result) | Operating instruction | not | Stays in the text: `checks.mjs run` ends not green and says why. Whether the process then stops is decided by the surrounding flow — in night mode (Nachtbetrieb) the runner, interactively the human. |
| Stop point before `/review` and before the push | Section "Stop-Punkt" (stop point) | Judgement rule | not | Stays in the text: The push waits for the trigger phrase `push main`. That is a process rule about responsibilities, not a handle that a check tool could carry out. |
| Mutation test runs unfiltered | Section 2 | Operating instruction | not | Stays in the text: `mutationCommand` is not in `buildChecks` and is therefore not part of the area-based selection. Anyone who wants it binding enters their command as a `buildChecks` entry with a `guete` block — then the tool checks. |
| Run the check command in the foreground | Section 1, last paragraph | Judgement rule | not | Stays in the text: A tool does not determine how its caller starts it. The guardrail (Leitplanke) on background runs covers the rest. |
| Report missing or empty `buildChecks` | Precondition and section "Ergebnis" (result) | Operating instruction | not | Stays in the text: The note is addressed to the human who puts the config into the repository. The hard part sits elsewhere — the night runner does not start at all if there is no check on the package stage. |

## What the inventory is not
<!-- de: be51c04d52d6 -->

It is not a change list. What moved on which day is recorded in `CHANGELOG.md` and in the commits. This page describes the **state**: where a rule takes effect today and why there. Anyone who converts a rule of `/local-check` changes the row here as well.

Nor is it a list of all of the kit's rules. It takes on the one instruction to which the yardstick was applied first. The same yardstick applies to every further one — the inventory for it is written when it is converted.
