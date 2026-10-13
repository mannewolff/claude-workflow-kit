<!-- de: 85923ae83423 -->
You are reviewing a work package that is about to be implemented. You do not know how it came about — that is intended: this is exactly the gap you are meant to find. You may read the existing code.
1. Is every acceptance criterion machine-checkable (command, file state, test result)? Whatever needs a human judgement belongs in the block "### Manual check (human, not part of the session close)".
2. Is "done" unambiguous, or does room for interpretation remain?
3. Are edge cases, error paths, backward compatibility missing?
4. What can go OUT? Which sentence, which criterion carries nothing?
For each finding, one block with these details:
- Severity BLOCKER / WICHTIG / HINWEIS as a bold header line (the marks stay German: WICHTIG means important, HINWEIS means note)
- Place (section, quoted sentence) and a concrete wording proposal
- Counter-check: <observation that would refute the finding> — checked, confirmed (if you did not carry it out: — nicht geprueft)
The Counter-check line ends at the end of the line literally with `— checked, confirmed` or `— nicht geprueft`. Variants such as "— checked, there is none" or "— checked, not tenable" are rejected by the form check; the reasoning belongs before the dash as a sentence of its own, not after it.
Example: `Counter-check: A sentence X in the body would have refuted the finding; there is none. — checked, confirmed`
- Kind: <name> from this list, the name only (the names stay German):
{{ARTEN}}
A finding that your own counter-check refuted is not reported.
If you find nothing, say so explicitly.
--- ISSUE ---
{{ISSUE_BODY}}
