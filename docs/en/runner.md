# Runner
<!-- de: e5bde7cd5431 -->

The runner runs on its own and has two modes of operation: the **run** (Lauf), which works off the Ready column, and the **chain** (Kette), which turns a business requirement (fachliche Anforderung) or a finished plan into the reviewed plan and the work packages (Arbeitspakete). The [check run](/en/prozess#the-check-run) (Prüflauf) is described on the process page. The runner never pushes.

## The run
<!-- de: 62c1fc128efe -->

The runner `.claude/kit/night.mjs` starts a fresh headless session with `/implement-next #N` for each Ready card. Success means: card in In review.

```bash
node .claude/kit/night.mjs --dry-run   # shows what would run, starts nothing
node .claude/kit/night.mjs             # real run
```

Flags: `--max <N>` (sessions per run, default 10), `--model <id>`, `--timeout-min <N>` (time limit per round, default 60), `--label <name>`, `--verbose no` (without the live progress log), `--no-checks-ok`, `--yolo` (all permission checks off) and `--help`.

**Sorting is the GO.** The runner works off Ready from top to bottom, but only cards with the routing label (Routing-Label) `kit:nightrun`; `--label none` switches the filter off. If no card carries the label, the warning names the board read: `Board of: <repo> (<host>)`. Cards with the title prefixes `[Requirement]`, `[Idea]`, `[Plan]` and `[Human]` go back to the backlog with a comment and without a session.

**Dependencies.** The runner sets back a card with an open dependency; below it stands the block `Abhaengigkeiten, wie der Nachtlauf sie liest:` with one line per dependency and any cycles found. The dry run shows the same lines indented under the line of each package. The convention is described under [/issues](/en/prozess#issues).

**Fixed kit state.** Every unattended run binds tools, skills and rule texts at start to the commit of `origin/<mainBranch>`; whatever a package changes in them takes effect only after `push main`.

**The model of a session.** First the card's `Empfohlenes Modell:` applies if `night.models` lists the name, then the `Aufgabenstufe:` according to `night.tiers`, otherwise `--model` or `night.model`; the fields are described under [Settings](/en/einstellungen#fine-tuning). Every session gets `KIT_AGENT_MODEL` with its model.

**Permissions, sandbox, environment.** The sessions run with `--permission-mode auto --permission-prompts none`: whatever the allowlist in `.claude/settings.json` does not allow is refused. Commands that need a socket or the board belong in `sandbox.excludedCommands`, variables in the `env` block:

```json
{
  "permissions": { "allow": ["Bash(node .claude/kit/board.mjs:*)", "Bash(git commit:*)", "Bash(mvn:*)"] },
  "sandbox": { "enabled": true, "excludedCommands": ["node .claude/kit/board.mjs*", "node .claude/kit/night.mjs*", "mvn *"] },
  "env": { "DOCKER_HOST": "unix:///<path-to>/docker.sock" }
}
```

The hook `bash-check` refuses lines in which a pipe or redirection cancels the exception, and, unattended, every Bash call in the background: a headless session has no follow-up turn.

### What is on the board afterwards
<!-- de: cc05ff1047b6 -->

Every card has one outcome:

| Outcome | What happened | Who comments and moves | Consequence for the run |
|---|---|---|---|
| `erfolg` | card in In review, commit lies locally | the session | continue |
| `zurueckgestellt` | the session did not finish the task | the runner, to Backlog | continue |
| `angehalten` | a question of the stop class is waiting, label `kit:clarify` | the session itself | continue |
| `harterStopp` | environment or working tree broken | nobody, the card stays | the run ends |

After a halt, the way on is `/requirement #N`; only the human removes `kit:clarify`.

**What was checked and what was not.** Skipped checks show in two places: in the completion report on the work package, where the session lists the checks it ran and skipped with their reason, and in the run report of the pass, with one line per session and a sum line over the run. The runner reads this from `.claude/checks-summary.json` and checks again itself if the evidence does not match the commit (`nachgeprueft` or red).

**The result state.** Next to the daily log `.claude/night-run-<datum>.log`, every run writes `.claude/night-run-<datum>-<uhrzeit>.json`: per package outcome, duration, commit, model, cost and check runs. The block `Prueflaeufe und Zielmarke:` in the report says how many packages stayed below `night.goalImplementationMin`. The runner deletes daily logs and run folders under `.claude/protokolle/` after the period `night.logRetentionDays`; JSON and `.tsv` files remain.

**A run without work names its reason.** If a run ends without a package, the run header carries `noWorkReason` with the sentence from the log. Without `--chain`: `Ready ist leer — nichts zu tun.`, `Keine der <N> Karten in Ready traegt das Label '<name>' — nichts zu tun.`, `Alle <N> Karten in Ready wurden am Gate zurueckgestellt — …` or `Die Umsetzung ist belegt: <grund> — der Lauf endet ohne Paket.` With `--chain`: `Keine Kette zu fahren: keine Karte traegt das Label '<name>'.` or `Keine Kette zu fahren: alle <N> gekennzeichneten Karten mit dem Label '<name>' wurden uebersprungen, …`. Each sentence carries label and number. The set-back sentence takes precedence over `Ready ist leer`. If no case applies, it says `Kein Grund ermittelbar — … bitte melden.` A held lock is a quiet run with a reason; a lock that cannot be written is a hard stop of error class `umgebung` with `fehlerText`, without `noWorkReason`. A run with work does not carry the field.

**Delivery to the board.** With `issueTracker: toolbox` the runner delivers the result state to kanban-kit as it goes, a hard stop with `abortReason`. If delivery fails, the file remains.

**Afterwards:** read the log, look through the backlog, `/kit-review`, your own test, `push main`.

### When something goes wrong
<!-- de: db4e4a9dd671 -->

If the session ends with a CLI error, the runner stops hard and the card stays in Ready. If it ends without In review, the card goes back to the backlog with a comment; the runner first tries to rescue leftovers in the working tree.

**Salvage.** Before the runner gives up the leftovers, it runs `node .claude/kit/checks.mjs run --finish <id> --fresh`. Going through `checks.mjs run` is deliberate: it leaves `.claude/checks-summary.json`, the evidence the commit gate reads. The area-based selection of the package stage applies; checks of the stages `push` and `merge` stay out; `formatFixCommand` works as described under [Settings](/en/einstellungen#worth-setting). If they are green, a salvage session gets ten minutes to commit and move the card. Otherwise the runner saves the leftovers in the stash `nachtrest #<id> <lauf>`, the card goes to the backlog, and the run goes on. A hard stop happens only where a commit may be incomplete.

**The waiting session.** No session ends with its own work still running. If the final text says it is still waiting for its own work, the runner attaches the note `## Nachtlauf: wartende Sitzung` with the last state to the card; the next session names it. Waiting for a human does not count.

Log, comment and result state carry the same line `Grund: …`, for example `Grund: Session am Zeitlimit beendet`.

### The halt at a protected file
<!-- de: 02b4cd37c150 -->

If a package names a file only a human may write and is not released, the runner sets it back: Backlog, label `kit:protected`, comment `## Geschuetzte Datei`. The way back: make the change yourself, remove `kit:protected`, pull to Ready.

## The time-limit abort
<!-- de: 56eec18c8c80 -->

If a session ends at the time limit, the runner attaches the note `## Nachtlauf: Zeitgrenze erreicht` to the card. It names the limit of the round, the state according to the session's own account, that is its lines `FORTSCHRITT: AK<n> — …`, a recommendation to split the package that is explicitly no requirement, and the leftovers in the working directory.

No statement about its cause follows from the abort. The unit in the result state carries `zeitlimitBeendet: true`, the run header `zielUmsetzungMin`, the target this run calculated with.

Visible earlier: `/issues` writes `Sitzungsumfang: passt | reisst` into the package, and the run report of the chain ends with `- Voraussichtlich über der Sitzungszeitgrenze: #N, #M`.

The yardstick is the time limit of one session, `--timeout-min`, default 60 minutes. What is not meant is `night.chain.implementationMin`, the budget of the implementation stage, nor the target `night.goalImplementationMin`.

## The stuck package
<!-- de: 05c3936814e6 -->

If the same check fails again and again in the same way, the session ends before its time limit. `checks.mjs run` remembers a failure fingerprint per red command: the names of the failed tests, otherwise the first error message. Once the sequence of identical failures reaches `night.stuckAfter`, the next call runs nothing more when unattended: it reports `Pruefung festgefahren: <Kommando> — <Fehler>` and ends with exit code 3. Interactively only a hint appears.

The runner ends the session, saves leftovers in the stash, sets `run:aborted` with `Grund: Session an einer Pruefung festgefahren` and moves the package to the backlog. The note `## Nachtlauf: an einer Pruefung festgefahren` names check, error, attempts and running time. Next: read the error, get the leftovers back, rework, back to Ready.

## The chain
<!-- de: 7ac5c68298a8 -->

A business requirement goes in; at the end a reviewed plan, work packages and a report lie on it. Under **variant A** the packages stay in the backlog. Under **variant B** the chain pulls them to Ready itself and implements them; your GO then lies in marking the card.

**The gesture** is the label `kit:night` on a groomed card in the backlog. The runner consumes the label at start: every setting allows exactly one chain, an abort needs a new gesture.

**The review as a precondition.** At start the marked card must also carry `review:done`, the business requirement as well as the plan document (Plandokument) of a plan order. If it is missing, the chain label stays, and the card gets the comment `## Kette nicht gestartet: Pruefung fehlt` once, with the way via `/issue-review`.

**The variant** is set by the label `kit:carry-through` on the same card; it is not consumed.

```bash
node .claude/kit/night.mjs --chain --dry-run   # candidates, reviewer state, budgets
node .claude/kit/night.mjs --chain             # real run
```

`--max` counts chains here (default 3).

**Conditions.** A candidate has the title `[Requirement]` or `[Plan]`, is in the backlog, carries no `kit:clarify` and waits for no event. Before the first chain every candidate is set to `run:running` with "Lauf angenommen um …, Vorabprüfung läuft"; then a preflight session checks reviewers and tracker. If it fails, the run status (Laufstand) shows `run:aborted` with `Kette nicht gestartet um <Zeit>: <Grund>`, and the labels stay. The chain works in its own worktree.

| Stage | Session | when the chain ends here |
|---|---|---|
| plan | `/techplan #F` writes the plan | no plan: `abgebrochen` |
| form check | `issue check-form`, on red a correction session | still red after `correctionRounds`: `abgebrochen` |
| review | `/issue-review #M`, the reviewer of the `plan` stage | open question in the reviewed plan: `angehalten` |
| pakete | `/issues #M` | no package: `abgebrochen` or `angehalten` |
| abdeckung | a read-only session holds the packages against the requirement | never, it is information |
| umsetzung (variant B) | `/implement-next #P` per package | lock held or main copy not clean: `unvollstaendig` |

**Four outcomes**, one per chain: `fertig`, `unvollstaendig` (the ordered implementation did not happen, the packages lie in the backlog), `angehalten` (a question is waiting for you) and `abgebrochen` (failed technically or on the budget, with a reason). An abort ends only this chain.

**Budgets** are in `night.chain`, all optional, with these defaults:

```json
{
  "night": {
    "chain": {
      "label": "kit:night",
      "variantBLabel": "kit:carry-through",
      "planMin": 20,
      "reviewMin": 15,
      "packagesMin": 15,
      "coverageMin": 10,
      "implementationMin": 120,
      "preparationMin": 120,
      "costUsd": 50,
      "costUsdB": 150,
      "correctionRounds": 2
    }
  }
}
```

What each field limits is described under [Settings](/en/einstellungen#fine-tuning).

**The report.** On every outcome the chain attaches a comment `## Nachtbericht, Kette <stempel>` to the marked card: outcome, stages, packages, decisions, coverage, key figures. It ends with `Dieser Bericht ist Verlauf. Verbindlich fuer die naechste Kette wird eine Entscheidung erst als Satz im Fachplan.` If the tracker does not accept it, it waits as `.claude/night-bericht-<F>-<stempel>.md` and is added later.

**The way back after `angehalten`.** An open question in the plan stops the chain only after the review, before the cut into packages. The chain writes the question as `## Kette angehalten` on the marked card and sets `kit:clarify`. The way leads via the plan: the answer as an entry under `## Architektonische Entscheidungen`, `## Offene Fragen` back to `- Keine.`, remove `kit:clarify`, finally `kit:night` on the plan. The next chain takes it as a plan order and starts at `pakete`. If your answer changed more in the plan than the entry itself, the chain reviews it again itself beforehand. If a new plan comes about instead, older ones get the comment `Ueberholt durch Plan #M2`.

**Chain and implementation side by side.** Chain and run may run at the same time: the chain in the worktree, the run in the main copy. Under variant B the chain also builds in the main copy; both take the lock `.claude/night-umsetzung.lock` for that, which the chain waits for at most `night.chain.implementationMin`. Only one runner ever works on a business root.

### How far a chain runs: the goal
<!-- de: eac0823acb7a -->

A goal label on the same card as `kit:night` sets where the chain ends this time. The stages keep their order.

| Goal | last stage | what is yours afterwards |
|---|---|---|
| `goal:plan` | `review` | read the plan, then `kit:night` on the plan. |
| `goal:packages` | `abdeckung` | pull the packages to Ready. |
| `goal:implementation` | `umsetzung` | test the packages in In review, then `push main`. |
| `goal:push-prepared` | `vorbereitung` | read the preparation's report, then `push main`. |

A goal from `umsetzung` on is at the same time the GO for the packages, like `kit:carry-through`. `planreview:1` or `planreview:2` on the requirement sets whether one or two models review the plan. At start the runner consumes `kit:night`, the goal and `planreview:*` together. All six labels are created once per board.

A card is refused with the comment `## Kette nicht gestartet: unpassende Einstellung` if it carries more than one `goal:*` or both `planreview:*`, `goal:plan` on a plan document, `planreview:*` on a plan document, or `planreview:*` when its plan already carries `Plan-Review:`.

The project remains the upper limit: if `night.chain.transitions` blocks a transition, the chain ends there at the project limit. The stage `vorbereitung` runs `/push-main prepare` without pushing ([/push-main](/en/prozess#push-main)).

### A finished plan as an order
<!-- de: d133993c06ee -->

`kit:night` on a `[Plan]` issue in the backlog starts a plan order (Plan-Auftrag). The plan carries `review:done`, no `kit:clarify`, `## Offene Fragen` says `- Keine.`, its origin is valid, and its requirement waits for no event. Without a line `Fachliche Quelle:` it runs as its own root; if `Fachliche Quelle: Issue #N` hits a card, coverage holds the packages against it; if the line points nowhere, the plan stays where it is.

The stage `plan` is dropped, the run starts at `pakete`. `review` runs before it only if the plan has changed since its review beyond the entered answer. `kit:carry-through` only counts on the plan itself; then variant B runs.

The business requirement gives way to the plan: if both carry the chain label, the plan runs.

Of two marked plans of the same root, the younger one runs.

### Waiting for an event
<!-- de: 7ec323a13d09 -->

If a finished requirement waits for something outside the project, say a tariff that can be chosen, you mark that with

```bash
node .claude/kit/board.mjs issue hold <N> --reason "wartet, bis Tarif X wählbar ist"
```

The command writes the line `Waiting for event: <reason>` into the section `## Goal` and sets the label `kit:on-hold`. The line is what counts; the label makes the waiting visible on the board.

As long as the line stands, no chain starts for the requirement, and no packages come out of a plan for it. Report and `--dry-run` list it among the skipped ones with the reason for waiting. `kit:night` stays on the card. Waiting is not an open question and is separate from `kit:clarify`. Once the event has happened, you lift the waiting:

```bash
node .claude/kit/board.mjs issue hold <N> --lift
```

That removes line and label. The next chain takes the requirement up again, without a new review and without a new `kit:night`. Only the human lifts it.

### Allowlist for third-party reviewers
<!-- de: b8483b7b986c -->

The runner's preflight starts a third-party tool directly; without an entry such as `Bash(codex:*)` the session hangs until the time limit.

## The run status
<!-- de: 4138392d8aae -->

The state of a run is on the board, not in the process. The card carries at most one of the labels `run:running`, `run:aborted` and `run:waiting`, plus exactly one comment `## Laufstand`, which is replaced on every change. The comment is a blackboard, not a history; the run report remains the history. The line `Protokoll:` names the file `.claude/protokolle/<lauf>/<karte>-<stufe>.log` of the step.

`run:aborted` means aborted technically. `run:waiting` names what the card is waiting for:

- `wartet: Übergang <x> im Projekt nicht freigegeben — weiter mit kit:night`
- `wartet: Karte ohne Freigabe zur Umsetzung`
- "Halt: Frage wartet auf den Menschen — siehe `## Kette angehalten`"

If the card carried a goal, `Ziel: <plan|pakete|umsetzung|push-vorbereitet>`, `Prüfer: <1|2>` and, with a blocked transition, `Grenze: <letzte erreichbare Stufe>` appear in the run status. At the goal the header reads `fertig bis <Ziel>`, below it `Als Nächstes:`.

**Repeating.** `kit:night` starts the chain at the first stage without a result; what exists is not created twice. A fresh plan only comes about once the old one is in Done.

**Transitions.** `night.chain.transitions` releases the transitions one by one. `coverageImplementation` only works together with `kit:carry-through` on the card.

**One retry.** There is an automatic retry only for environment errors while the run is alive; the run status notes "2. Versuch". A dead run is not repeated.

### The watchdog
<!-- de: 54b5010e88a6 -->

A detached watchdog checks every minute. A run counts as silent only once its pulse is older than `night.status.deadlineMin` and its process no longer exists; a run that is alive never counts as silent. Then the watchdog sets every running card to `run:aborted` with `nicht beendet, letztes Lebenszeichen <zeit>, Frist <n> min`.

### The journal
<!-- de: e381eeca979b -->

Every state goes first as a line into `.claude/lauf/<lauf>.jsonl`. If the board does not accept it, it is added later as soon as the board answers again.

If the `pakete` stage dies in the middle of cutting, the next run shows "Teilschnitt vorhanden (#a, #b) — eine Wiederholung legte doppelt an; Teilschnitt am Board aufräumen, dann erneut kit:night".

You get the leftovers of a failed package back with `git stash apply stash@{<n>}`.

### The evidence cases
<!-- de: 8703eb4c2a78 -->

| Case | Card state afterwards | Way forward |
|---|---|---|
| Without a trace: the run dies in the pre-check | after the deadline `run:aborted` with `nicht beendet, letztes Lebenszeichen <zeit>, Frist <n> min` | fix the cause, then `kit:night` |
| Aborted although finished: time budget exceeded, result exists | `run:aborted` with a reason | `kit:night`: the stage counts as found |
| Outcome unknown: board briefly unreachable | "2. Versuch"; if it fails, the other cards `run:waiting` with `nicht begonnen: …` | start again or `kit:night` |
| One package halts the run | only this package `run:aborted`, dependent ones with "hängt an #N", leftovers in the stash `nachtrest #<id> <lauf>` | rework, back to Ready |
| A package gets stuck | `run:aborted` with `Grund: Session an einer Pruefung festgefahren` | read the note, rework |
| Interleaved logs: chain and check run at the same time | the line `Protokoll:` names `.claude/protokolle/<lauf>/<karte>-<stufe>.log` | open the named file |

## Running with a local model
<!-- de: 6f7b4c5d2d4d -->

> **Untested.** The way follows from the runner's architecture but has not been tried in practice.

A stage in `night.tiers` can use `command` to start a program of its own, or Claude Code talks to a local model through a proxy such as [LiteLLM](https://docs.litellm.ai/):

```bash
ANTHROPIC_BASE_URL=http://localhost:4000 \
  node .claude/kit/night.mjs --model lokal-qwen --label kit:lokal --max 1
```

A routing label of its own separates the simple cards.

## Effort of the process
<!-- de: 628fd161e0fa -->

`node .claude/kit/effort.mjs evaluate` reads the latest result states and writes `.claude/aufwand.md` and `.claude/aufwand.json`. The finding appears at the end of the run log and in `/push-main` and is not a gate.

**The implementation target** (Zielmarke der Umsetzung) shows how many implementations exceed the target, by how much on average and at most. The average is taken over the overruns. The target comes from the run header of the state. The same block is in `.claude/aufwand.json` as `zielmarke`.

**Time-limit aborts stand apart.** Their completion time is unknown, so they enter no average.

**Each machine stands on its own.** Without an option the report evaluates the runs of the machine `effort.mjs` runs on; `--machine <name>` chooses another. Runs of other machines and older ones without a machine enter no figure.

**Median per check command.** Next to the sum, the table of checks gives per command the median of a complete execution; flaky, repeated and adopted ones do not count. Without a complete execution it says "not measured", never zero.

**Tool basis per tier.** The table by task tier gives per tier the tool time per package and its share of the package time.

Number of runs and thresholds: block `workload` under [Settings](/en/einstellungen#fine-tuning).

## Consumption of interactive sessions
<!-- de: e0127a5b7e04 -->

`board.mjs session report` adds up the tokens of an interactive session and delivers them to kanban-kit; the installer enters the hooks for it ([What the installer writes](/en/einrichtung#what-the-installer-writes)). Using the waypoints from `issue move` in `.claude/wegmarken.tsv`, the reporter splits the sum among the cards. If a model is missing in `kit/preise.mjs`, it reports no amount, never a 0.
