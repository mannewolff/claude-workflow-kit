# CLAUDE-Fachplan.md — Gates for the requirement
<!-- de: 1b36309c30af -->

**As of 2026-08-28.** Review by fable incorporated, open decisions made.

This file is a **gate register**, not a guide. Every line here is a rule a document *can*
violate — checkable and nameable. Whoever says "F5 violated" in a review points to a place,
not to a taste.

**What for:** `/issue-review` classifies a finding as `gate` (from stage 5 of plan #368 on —
today the skill does not classify yet). Then nothing is applied automatically; instead
`kit:clarify` is set and a human is called (plan #368, A9).

**A finding is `gate` if one of the two applies:**

1. It shows that the **document** violates one of these rules — then it names the
   number ("F5 violated").
2. What it **proposes** would violate one of these rules if adopted. That is the
   direction from plan #368, A9.

Both directions count (decision of 2026-08-28). The reason for both: in the one case the
rule is already violated, in the other the automatic application would violate it — the
damage is the same, so the treatment is the same.

Everything that does **not** stand here is no *gate*. Whether such a finding still calls a
human is decided solely by trigger 2 from A9 (several sensible alternatives) — that is a
property of the finding, not of this register.

**What does not stand here:** the process-wide gates (three stop points, Git workflow,
mandatory checks, priorities in conflicting goals). They stand in `CLAUDE-workflow.md` and
apply alongside.

`[maschinell]` (machine) means: checkable without human judgement. `[Urteil]` (judgement)
means: a human or a model has to read and weigh — that is a gate as well, but it is no use
as a test case.

`[maschinell + Urteil]` means: the two directions of the gate lie differently — one is
testable, the other is not. Which is which stands with the gate.

## How the machine gates are read
<!-- de: 59e3886e823f -->

Applies to every `[maschinell]` gate and thus to every test that later comes from it:

- **Fence rule (issue #308).** The body is read without code blocks. A line inside a fence
  does not exist for the check — not even as a violation. Without this rule every document
  that shows the issue format by an example counts its headings twice.
- **Umlauts count in both spellings.** `Änderungen` and `Aenderungen`,
  `Fachliche Akzeptanzkriterien` with and without transliterated umlauts are each the same
  heading. The repo mostly writes transliterated; a test for only one form would be red on
  its own stock. The English headings (`## Business acceptance criteria` and the like) count
  just like the German ones.

---

## F1 — The four sections, exactly once and in this order `[maschinell]`
<!-- de: d46addb7aa93 -->

`## Goal`, `## Business acceptance criteria`, `## Non-goals`, `## Open questions for the PO`
(in a German project `## Ziel`, `## Fachliche Akzeptanzkriterien`, `## Nicht-Ziele`,
`## Offene Fragen an den PO`).

Further `##` headings are allowed; the four must be present and stand in this order among
each other. (Unlike in the plan register, where P2 forbids additional `##` levels — the
`/requirement` skill knows no such prohibition.)

*Why gate:* `/techplan` and `/issue-review` hang on these headings. Reworded in spirit, they
do not take effect.

## F2 — `Author-Model:` stands in the section `## Goal` and is never empty `[maschinell]`
<!-- de: b527e7a2f781 -->

*Why gate:* Without it, it cannot be determined which model may check without reading its
own document. A checker who reads their own text is none.

## F3 — Prescribe no solution `[Urteil]`
<!-- de: 6ef2071b88bc -->

The requirement says **what is to apply**, not **how it is built**. Forbidden are
specifications for the implementation: which file is changed, which function is
introduced, which structure is chosen.

**Naming the tool it is about is allowed.** In a repo whose business domain is itself
technology, everything else would be theatre: "`board.mjs` should be able to send the
origin along" is a legitimate requirement. "Introduce a function `sendeHerkunft()` in
`board.mjs`" is not.

**This also applies to the goal:** "The user sees X" instead of "we build Y". A goal
phrased as a solution excludes alternatives before anyone has considered them.

**Measure:** After reading, does more than one way to build it remain open? Then it is a
requirement. If the way is already fixed, it is a plan in the wrong document.

*Why gate:* If the solution already stands in the requirement, the plan no longer checks
it — it copies it. The business stage exists precisely to separate the two.

## F4 — struck on 2026-08-28
<!-- de: 1987687032a3 -->

Was "The goal describes an effect for the user, not a solution" — the special case of F3
applied to one section, decided by the same measure. The sentence now stands in F3. **The
number stays free**, so that older findings ("F4 violated") stay unambiguous.

## F5 — Every business acceptance criterion is observable from the user's point of view `[Urteil]`
<!-- de: f002bff32619 -->

Not technically checkable — that is a later stage. The question is: **How would a human who
uses the software notice that it is fulfilled?**

*Why gate:* A criterion that cannot be observed cannot be accepted either.

## F6 — `## Goal`, `## Business acceptance criteria` and `## Non-goals` are not empty `[maschinell]`
<!-- de: 7513ca68c7df -->

What is checked is emptiness, not quality. Whether an existing entry is only a placeholder
(`- TBD`, `- see above`) is checked by the role `form-beobachtbarkeit` — that is judgement
and no test case.

*Why gate:* The three sections carry the content of the requirement. An empty
`## Non-goals` does not mean "everything allowed" but "nobody has thought about it"; an
empty `## Goal` leaves the plan guessing.

## F7 — The section `## Open questions for the PO` is present `[maschinell]`
<!-- de: eda6b25280f3 -->

What stands in it is free: concrete questions, documented answers of the PO, a note that
none are open — or nothing.

**For the night runner only the first non-empty line of the section counts.** Only a note
there that begins with "Keine" (none) releases the requirement — the word is a machine
value and stays German in an English project as well; if a question stands there, it holds
the card back — even if every question below it is answered. So once all questions are
answered, this note belongs at the beginning, and the questions with their answers stay
below it. That is no test subject of this gate, but the rule the section is written
against.

*Why gate:* The section is the place where the PO loop takes place. If it is missing
altogether, there is none.

*Why only this far:* An empty section is unsightly and cannot be told apart from "not yet
groomed" — but that is worth a hint, not a blockade. Whoever makes a gate of it holds
requirements up on a phrasing.

## F8 — What applies stands in the body; comments are history `[Urteil]`
<!-- de: cc5bf73046ab -->

Answers of the PO belong behind the respective question **in the body**, not in a
comment. If every question is answered by that, the "Keine" note from F7 additionally
belongs in the first line of the section — otherwise the requirement still counts as
unclarified for the night runner.

**Only checkable with the comments.** `board.mjs issue get` delivers them along; whoever
has not read them cannot assess F8. The role prompts that only hand over the body cannot
check this gate.

*Why gate:* Whoever only comments on a decision forces every later session to reconstruct
it from a discussion — and the requirement then has no unambiguous state.

## F9 — The root carries no origin line `[maschinell]`
<!-- de: 3791bd8453d3 -->

Neither `Requirement: Issue #N` nor `Plan: Issue #M` (in a German project
`Fachliche Quelle: Issue #N`).

The prohibition to set `--derived-from` when creating stands in the `/requirement` skill
and is **no** test subject here: `board.mjs issue get` does not return the field
`derivedFrom`, so it cannot be read off the finished document.

*Why gate:* The business issue **is** the root of the chain. A reference from here points
into nothing or to a foreign card. The origin reader evaluates both line patterns, so the
gate forbids both as well.

## F10 — Goal, criteria and non-goals do not contradict each other `[Urteil]`
<!-- de: 8a593d6a826b -->

No acceptance criterion demands something that a non-goal excludes.

*Why gate:* Otherwise the contradiction is resolved in the plan — that is, by someone who
may not decide what the product is to do.

## F11 — The document carries no `Issue-Review:` line `[maschinell]`
<!-- de: 294db929c14c -->

The marker of this stage is called `Requirement-Review:` (in a German project
`Fachplan-Review:`).

*Why gate:* The gate `requiredBeforeReady` hangs on `Issue-Review:` in `kit/night.mjs`
(`REVIEW_MARKER_ZEILE`, `/^Issue-Review:[^\S\n]*\S/i`, checked per line by
`hasReviewMarker` after `trimStart()`). If a requirement carries this marker, the night
runner takes it for a work package ready for release and pulls it into the
implementation.

## F12 — The section `## Scenarios` holds at least one complete scenario `[maschinell]`
<!-- de: 86027bc3d264 -->

The section `## Scenarios` (in a German project `## Szenarien`) is present, stands between
`## Business acceptance criteria` and `## Non-goals` and contains at least one complete
scenario: a heading `### Scenario: <title>` and below it at least one list line each
`Given`, `When`, `Then` in this order; `And` may stand in between. The keywords follow
the project language — in a German project `### Szenario: <Titel>` with `Angenommen`,
`Wenn`, `Dann`, `Und`.

```markdown
## Scenarios

### Scenario: Requirement without scenarios is rejected
- Given a project on the kit version with the duty
- When the human creates a requirement without a Scenarios section through the kit
- Then the kit creates nothing
- And the message shows the form of a scenario
```

**Scope:** When checking a file (`issue check-form --body-file`) and when creating
(`issue create` with `--art requirement` or the requirement prefix in the title) always —
a violation creates nothing and ends with exit 1. When checking a card on the board
(`issue check-form <id>`) only if its number is at least `scenariosFrom` from the
`workflow.config.json`. Without the field F12 applies to no card on the board, and the
check names the missing cut-off as a hint. F1 stays at four sections.

*Why gate:* A scenario separates starting point, action and observable result while
writing; a missing cut-off date or an unobservable result shows up there and not only in
the review. The cut-off protects the requirements that already lie on the board at the
update to this duty: they stay valid.

---

## Expressly no gate
<!-- de: fb6c6ba4554d -->

So that the reviewer does not declare everything a gate:

- **Length, tone, depth of structure.** A terse text is not worse.
- **Number of acceptance criteria.** Three can be enough, twelve can be necessary.
- **Whether a business acceptance criterion is technically or mechanically checkable.**
  That is the question of the later stage, not of this one. F5 asks for observability from
  the user's point of view — nothing more.
- **Whether an open question is "important enough".** Whoever asks it decides that.
- **An empty section `## Open questions for the PO`** (see F7).
- **Technical terms as such.** Only a prescribed solution violates F3.
- **Spelling and terminology**, as long as F3 is preserved.
- **Further incomplete scenarios** next to a complete one (see F12). They are a finding
  of the review, not a form violation.
- **The number of scenarios above one.** Not every business acceptance criterion needs a
  scenario.

A finding on these points is still a finding — it is applied or discarded. Whether it calls
a human is decided by trigger 2 from A9, not by this register.

---

## Burnt numbers
<!-- de: d16358174171 -->

Numbers are never reassigned, so that an older finding stays unambiguous.

- **F4** — struck on 2026-08-28, merged into F3.
