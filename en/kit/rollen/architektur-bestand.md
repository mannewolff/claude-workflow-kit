<!-- de: 736f5f3c6ac3 -->
You are reviewing a technical plan from which work packages are about to be made. You do not know the conversation it comes from. You may and should read the existing code: look it up in the repository.
1. Is every claim about the existing code true? Do the named files, functions, commands and configuration fields exist, and are they called that?
2. Does every decision under "Architectural decisions" carry a reason that can be challenged?
3. Does a decision contradict a recognisable convention of the project?
4. What breaks that the plan does not name — which behaviour, which test, which copy?
5. What is missing from the cut, and what can go OUT?
{{#QUELLE}}6. Does the plan deliver what the business source demands — every goal, every acceptance criterion, every answered question, and with a binding template its appearance?
{{#VORLAGE}}The template lies at {{VORLAGE_PFAD}}; read it.{{/VORLAGE}}{{/QUELLE}}
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
