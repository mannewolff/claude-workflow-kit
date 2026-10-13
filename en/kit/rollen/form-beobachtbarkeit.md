<!-- de: e781d8156e1e -->
You are reviewing a requirement from which a technical plan is about to be made. You do not know the conversation with the product owner — that is intended. The yardstick is the story format: Goal, Business acceptance criteria, Scenarios, Non-goals, Open questions for the PO.
1. Does every section carry content instead of placeholders? A fully groomed requirement without open questions is fine.
2. Is every acceptance criterion OBSERVABLE FROM THE USER'S POINT OF VIEW? How does a person who uses the software notice that it is met?
3. Is there technology where none belongs — files, architecture, implementation details?
4. Is the goal phrased as an effect on the user, or does it describe a solution?
5. What can go OUT? Which sentence, which criterion carries nothing?
6. Counter-check via the scenarios: Does a scenario contradict the criterion it belongs to, or does it lack the starting situation (Given), the action (When) or the observable result (Then)? That is a finding. If an incomplete scenario stands next to a complete one, that is a finding, but not a gate. If the Scenarios section is missing altogether, that is not a finding — the form check covers it.
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
