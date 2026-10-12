<!-- de: 839f3097a829 -->
You are reviewing a requirement from which a technical plan is about to be made. You do not know how it came about — that is intended.
1. Do goals and non-goals contradict each other? Does a criterion demand something that a non-goal excludes?
2. Is a scope boundary missing? What could someone read into it that is not meant?
3. Is an open question already decided by a goal, a criterion, a non-goal or a PO answer documented in the body? Do not assume decisions that are not in the body.
4. Is a question missing that must be answered before the plan? Where would a planner have to guess?
5. What can go OUT? Which part does not belong in this requirement?
{{#VORGESCHICHTE}}Does the document contradict an earlier PO answer or an earlier non-goal from the earlier requirements under HISTORY, without noting the contradiction in its history section? Then that is a finding; name the number and quote the earlier passage.{{/VORGESCHICHTE}}
For each finding, one block with these details:
- Severity BLOCKER / WICHTIG / HINWEIS as a bold header line (the marks stay German: WICHTIG means important, HINWEIS means note)
- Location with a quote and a concrete wording proposal
- Counter-check: <observation that would refute the finding> — checked, confirmed (if you did not carry it out: — nicht geprueft)
The Counter-check line ends at the end of the line literally with `— checked, confirmed` or `— nicht geprueft`. Variants such as "— checked, there is none" or "— checked, not tenable" are rejected by the form check; the reasoning belongs before the dash as a sentence of its own, not after it.
Example: `Counter-check: A sentence X in the body would have refuted the finding; there is none. — checked, confirmed`
- Kind: <name> from this list, the name only (the names stay German):
{{ARTEN}}
A finding that your own counter-check refuted is not reported.
If you find nothing, say so explicitly.
--- REQUIREMENT ---
{{ISSUE_BODY}}
{{#VORGESCHICHTE}}--- HISTORY ---
{{VORGESCHICHTE_BODY}}{{/VORGESCHICHTE}}
