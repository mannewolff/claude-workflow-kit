# CLAUDE-Plan.md — Gates for the plan document
<!-- de: 45d5474a680e -->

**As of 2026-08-28.** Review by fable incorporated, open decisions made.

Gate register for the stage `plan`. Structure and purpose as in `CLAUDE-Fachplan.md`: what
stands here is a rule a plan can violate — and a violation sets `kit:clarify` instead of
being applied automatically (plan #368, A9; classification comes from stage 5 of #368 on,
not yet today).

**When a finding is `gate`** — both directions, violation by the document and violation by
the proposal — stands in `CLAUDE-Fachplan.md` and applies to this register just the same.

Everything that does **not** stand here is no *gate*. Whether such a finding still calls a
human is decided solely by trigger 2 from A9 (several sensible alternatives) — that is a
property of the finding, not of this register.

The process-wide gates stand in `CLAUDE-workflow.md` and apply alongside.

## How the machine gates are read
<!-- de: bff691dffef5 -->

Applies to every `[maschinell]` (machine) gate and thus to every test that later comes from
it:

- **Fence rule (issue #308).** The body is read without code blocks. A line inside a fence
  does not exist for the check — not even as a violation. Plan documents regularly quote
  the mandatory sections as an example; without this rule the test counts them twice.
- **Umlauts count in both spellings.** `## Geplante Änderungen` and
  `## Geplante Aenderungen` are the same heading. The repo mostly writes transliterated —
  plan #368 itself writes `Aenderungen` —, a test for only one form would be red on its own
  stock. The English headings (`## Planned changes` and the like) count just like the German
  ones.

---

## P1 — The six sections, exactly once and in this order `[maschinell]`
<!-- de: 773df58b750c -->

`## Goal`, `## Affected areas`, `## Architectural decisions`, `## Planned changes`,
`## Open questions`, `## Verification` (in a German project `## Ziel`,
`## Betroffene Bereiche`, `## Architektonische Entscheidungen`, `## Geplante Änderungen`,
`## Offene Fragen`, `## Verifizierung`).

*Why gate:* They are the anchor the plan check and `/issues` work on. Renamed, merged or
reordered, they do not take effect.

## P2 — No further `##` headings in between `[maschinell]`
<!-- de: 6618d118076a -->

Subheadings from `###` on are allowed.

*Why gate:* An additional `##` level cuts the sections apart for every reader that
separates them mechanically.

## P3 — `Plan-Model:` stands in the head, before `## Goal` `[maschinell]`
<!-- de: c468a0324ff6 -->

*Why gate:* Without the line it cannot be determined who drafted the plan — and the issues
from it carry their own `Author-Model`. Without it the chain breaks off exactly in between.

## P4 — `Requirement: Issue #N` stands exactly when the plan came from it `[maschinell + Urteil]`
<!-- de: f166fba66471 -->

If the plan came from `/techplan #N` against a `[Requirement]` issue: the line stands
(in a German project `Fachliche Quelle: Issue #N`). Otherwise: the line is missing, no
placeholder either.

**Only the present line is `[maschinell]`:** #N must exist or demonstrably have existed and
carry `[Requirement]` (an older card also its German predecessor). **A source deleted later is no violation** — the
body line is precisely the surviving trail when the card is gone (idea #367; #300 refers to
the deleted #285).

**The missing direction is `[Urteil]` (judgement):** whether a missing line *may* be
missing depends on how the plan came about (`/techplan #N` or a free conversation) and
stands in no queryable field.

*Why gate:* An invented source claims a negotiation that never took place.

## P5 — Every architectural decision carries a reason `[Urteil]`
<!-- de: 478e801a87a3 -->

A decision without a reason is a finding, not a style hint.

*Why gate:* Without a reason the decision cannot be challenged in the review — one can only
believe it or not. That is precisely what the stage exists for.

## P6 — No mandatory section is empty; `- Keine.` only where allowed `[maschinell]`
<!-- de: eeb62a692d64 -->

None of the six sections is empty. In `## Architectural decisions` and `## Open questions`
— and only there — `- Keine.` (none) may stand instead; the word is a machine value and
stays German in an English project as well.

**`- Keine.` stands as the first line.** An explanatory addition behind it is allowed (such
as the reference to where it was decided: `- Keine. The direction decision stands in A8.`),
further entries are not. A pure equality test would be red on the stock — #325, #326 and
#368 all three write an addition.

*Why gate:* An empty section cannot be told apart from a forgotten one. `- Keine.` is a
statement, emptiness is none.

## P7 — Under `## Open questions` only stop questions stand `[Urteil]`
<!-- de: f8420cfb6a13 -->

Stop question means: **a question from the stop class** in `CLAUDE-workflow.md`, section
"Decide instead of asking". Everything else is decided and stands as an E entry under
`## Architectural decisions`; questions that can be decided later do not belong there.

*Why gate:* The section blocks the way to `/issues`. Whoever fills it with details blocks
the plan on something that is no blockade.

*Why this lies differently from the struck decomposability (P11):* A **blocking effect**
hangs on P7 — a question standing there wrongly blocks the plan. Decomposability never had
this effect; it was a quality question that could be applied almost arbitrarily. That is
why P7 is a gate and P11 is not. (P7 does not cover the *missing* stop question — that is
the business of the role `schnitt-abhaengigkeiten`.)

## P8 — struck on 2026-08-28
<!-- de: fe48d503e2cc -->

Was "A plan with at least one open stop question does not go into `/issues`". That is a
**process rule, not a document gate**: a document cannot violate it, only a run — and at
review time, before `/issues`, a violation is not even possible. The error path stands in
the `/techplan` skill; P6 covers the checkable form. **The number stays free**, so that
older findings stay unambiguous.

## P9 — `## Verification` describes checks, not their result `[Urteil]`
<!-- de: 9da05dcf889a -->

"`node --test` runs" is a check. "All tests are green" is an anticipated result.

*Why gate:* A plan that claims the result can no longer fail — and a proof that cannot fail
is none.

## P10 — Every claim about the existing stock is true `[Urteil]`
<!-- de: 3e5649a9efa9 -->

Named files, functions, commands and config fields exist and are called that.

*Why gate:* A wrong reference to the stock wanders unnoticed into every work package. On
2026-08-08 a reviewer showed that a command referenced in the plan did not exist in the
adapter at all — it would have wandered into thirteen packages.

## P12 — The document carries no `Issue-Review:` line `[maschinell]`
<!-- de: 931fc26dc4f8 -->

The marker of this stage is called `Plan-Review:`.

*Why gate:* The gate `requiredBeforeReady` hangs on `Issue-Review:` in `kit/night.mjs`
(`REVIEW_MARKER_ZEILE`, `/^Issue-Review:[^\S\n]*\S/i`, checked per line by
`hasReviewMarker` after `trimStart()`). If a plan document carries this marker, the night
runner takes it for a work package ready for release and pulls it into the
implementation.

## P13 — New names and copied structures are checked for their consequences `[Urteil]`
<!-- de: dbf013e8f03e -->

If the plan introduces names a human types — skills, commands, options, labels, title
prefixes —, it states that they collide with no built-in command of Claude Code. If it
creates identically built copies in several files, such as a text table per module, it
states their effect on the project's duplication measurement (with SonarCloud
`sonar.cpd.exclusions`) and how it absorbs it.

*Why gate:* Both consequences lie open in the plan, and on the code neither shows up in a
single package review. The switch to English (plan #1420) named the skill of stage 4
like the built-in command `context` of Claude Code. Its bilingual text tables
(stage 3) put structurally identical copies into about 25 modules, and the SonarCloud
quality gate failed from v4.2.2 on at duplicated lines (6.1 % instead of at most 3 %);
repaired only in #1524 to #1526. Neither the plan review nor the package reviews had found
it.

## P14 — A contract with the other repo is matched or asked `[maschinell]`
<!-- de: aaa4e101a5fc -->

If the config names a partner repo in `vertragsRepos`, the subsection `### Contracts` stands
at the end of `## Architectural decisions`. It holds one entry per definition the other repo
reads or writes — a name, a marker, a format —; if the plan defines none, the line
`- No contract.`:

```markdown
### Contracts
- V1: The run ID is called `Run-ID:` — kanban-kit, reads
  Built state: kanban-kit@0123456789ab, src/lauf.ts:12
  Match: differs
```

- The head ends in `— <repo>, reads` or `— <repo>, writes`; the repo stands in
  `vertragsRepos`.
- `Built state:` names the location on the main branch of the other repo, or
  `missing, checked …` or `not checkable: …`. What counts is the built state, not the other
  repo's plan and not the kit version installed in the project; if that one differs, a line
  `Installed:` names it as a note.
- `Match:` is `matches`, `differs`, `missing`, `not checkable` or
  `proposed by the project`. A contract carries the last value only with
  `Built state: missing, checked …` and the lines `Wording:` (what the other repo has to
  adopt) and `Proposed per requirement:` (the place in the requirement).
- An open contract — `differs`, `missing` or `not checkable` without a line `Decided:` —
  stands in a question under `## Open questions` that lists all open V numbers; the first
  line there is then not `- Keine.`. This makes the night chain stop after the review of the
  plan, before `/issues` cuts packages. `Decided:` with `plan adjusted`, `other repo follows` or
  `deviation accepted` is written only by someone who has the human's answer — never by the
  session that fixes the violation.

`issue check-form` checks the form. Whether the location is right and whether a human
decided is judgement (P10). Without `vertragsRepos`, P14 checks nothing.

*Why gate:* A definition both repos have to understand looks like an internal choice of
name in the plan. In kanban-kit, plan #1423 chose a name for the run ID while the kit had
long built a different one. The night chain could not see that, put a human step in front
of all packages, and the implementation stood still until the human decided the match;
four packages had to be rewritten. Where the contract was named openly (kanban-kit plan
#1447), the chain stopped correctly. With the contract in fixed form in the plan, the match
against the built state becomes mandatory and the question to the human becomes a stop
before the packages.

---

## Expressly no gate
<!-- de: 894249843745 -->

- **How many decisions a plan has.** Three can suffice.
- **How finely `## Planned changes` is structured.**
- **Whether a decision is the *best* one** — only whether it is reasoned (P5). A reasoned
  decision that a reviewer considers wrong is a finding with alternatives (A9, trigger 2),
  no gate violation.
- **Whether the verification is complete.** Only its form is a gate (P9). Whether it
  checks enough is a role judgement.
- **Whether a stop question is missing.** P7 only covers questions contained wrongly; the
  missing one is checked by the role `schnitt-abhaengigkeiten` (question 5).
- **Length and tone.**
- **Test hints of the form check.** `issue check-form` reports for the plan under
  `hinweise` each own test of a tracked building block that the plan names nowhere (stores
  from `testLocations`). They touch neither `ok` nor the exit code and carry no P number.
  At night the night runner writes what remains as the comment
  `## Testhinweise der Formpruefung` on the plan.
- **Whether the plan can be cut well.** The role `schnitt-abhaengigkeiten` checks that in
  the plan review, and it belongs there: a plan that is hard to cut is a finding with
  alternatives, not a rule violation.

A finding on these points is still a finding — it is applied or discarded. Whether it calls
a human is decided by trigger 2 from A9, not by this register.

---

## Burnt numbers
<!-- de: 15205a3018c8 -->

Numbers are never reassigned, so that an older finding stays unambiguous.

- **P8** — struck on 2026-08-28, process rule instead of document gate.
- **P11** — "decomposable", never in force on Manne's decision of 2026-08-27, because it
  could be applied almost arbitrarily. Responsible is the role `schnitt-abhaengigkeiten`.
