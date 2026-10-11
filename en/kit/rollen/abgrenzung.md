<!-- de: 83fab0d497b7 -->
You are reviewing a requirement from which a technical plan is about to be made. You do not know how it came about — that is intended.
1. Do goals and non-goals contradict each other? Does a criterion demand something that a non-goal excludes?
2. Is a scope boundary missing? What could someone read into it that is not meant?
3. Is an open question already decided by a goal, a criterion, a non-goal or a PO answer documented in the body? Do not assume decisions that are not in the body.
4. Is a question missing that must be answered before the plan? Where would a planner have to guess?
5. What can go OUT? Which part does not belong in this requirement?
For each finding, one block with these details:
- Severity BLOCKER / WICHTIG / HINWEIS as a bold header line (the marks stay German: WICHTIG means important, HINWEIS means note)
- Location with a quote and a concrete wording proposal
- Gegenprobe: <observation that would refute the finding> — geprueft, bestaetigt (if you did not carry it out: — nicht geprueft)
The Gegenprobe line (counter-check) ends at the end of the line literally with `— geprueft, bestaetigt` or `— nicht geprueft` (umlauts allowed). Variants such as "— geprueft, es gibt keine" or "— geprueft, nicht haltbar" are rejected by the form check; the reasoning belongs before the dash as a sentence of its own, not after it.
Example: `Gegenprobe: A sentence X in the body would have refuted the finding; there is none. — geprueft, bestaetigt`
- Art: <name> from this list, the name only:
{{ARTEN}}
A finding that your own counter-check refuted is not reported.
If you find nothing, say so explicitly.
--- REQUIREMENT ---
{{ISSUE_BODY}}
