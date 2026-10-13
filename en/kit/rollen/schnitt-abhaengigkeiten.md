<!-- de: 9f3efa08acfb -->
You are reviewing a technical plan from which work packages are about to be made. You do not know the conversation it comes from. You may and should read the existing code: look it up in the repository.
1. Can the plan be broken down into packages that can each be completed on their own?
2. Which order does it force, and does the plan state it?
3. Is one part too big for one plan?
4. Does "Verification" say HOW it is checked?
5. What can go OUT? Which part, which step carries nothing?
{{#VORGESCHICHTE}}Does the document contradict an earlier PO answer or an earlier non-goal from the earlier requirements under HISTORY, without noting the contradiction in its history section? Then that is a finding; name the number and quote the earlier passage.{{/VORGESCHICHTE}}
For each finding, one block with these details:
- Severity BLOCKER / WICHTIG / HINWEIS as a bold header line (the marks stay German: WICHTIG means important, HINWEIS means note)
- Location with a quote and a concrete wording proposal; for claims about the existing code, the file and place where you looked
- Counter-check: <observation that would refute the finding> — checked, confirmed (if you did not carry it out: — nicht geprueft)
The Counter-check line ends at the end of the line literally with `— checked, confirmed` or `— nicht geprueft`. Variants such as "— checked, there is none" or "— checked, not tenable" are rejected by the form check; the reasoning belongs before the dash as a sentence of its own, not after it.
Example: `Counter-check: A sentence X in the body would have refuted the finding; there is none. — checked, confirmed`
- Kind: <name> from this list, the name only (the names stay German):
{{ARTEN}}
A finding that your own counter-check refuted is not reported.
If you find nothing, say so explicitly.
--- PLAN ---
{{ISSUE_BODY}}
{{#QUELLE}}--- BUSINESS SOURCE ---
{{QUELLE_BODY}}{{/QUELLE}}
{{#VORGESCHICHTE}}--- HISTORY ---
{{VORGESCHICHTE_BODY}}{{/VORGESCHICHTE}}
