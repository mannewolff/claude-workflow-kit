# Documentation: claude-workflow-kit
<!-- de: 43a011243c37 -->

A thin tool layer that makes a 9-step core process for AI-assisted development executable in Claude Code. The kit automates the AI steps and deliberately leaves the three human responsibility thresholds in place.

## Concept
<!-- de: ae70dd2d21bd -->

The kit is not a platform and not an agent. It is a library of eighteen skills, a project-local config and an installer.

The skills are written independently of any project. Everything project-specific (build commands, branch names, review model) comes from the config file. An update to a skill therefore applies in every project in which you use the kit. You do not have to adjust anything in each repo when the process evolves.

The core process has nine steps. Step 1 is your requirement; the AI takes over steps 2, 3, 5, 6 and 7. The three human stop points (Stop-Punkte) are step 4 (GO), step 8 (push) and step 9 (merge); between push and merge you check the test server. Eleven further skills stand outside the numbering and structure the working rhythm: /session-start, /triage, /requirement, /groom, /issue-review, /task, /implement-test and /implement-done, /implement-next, /retro and /document.

## Prerequisites
<!-- de: f996d869a5ee -->

**Node.js 18 or later.** The installer is written in Node and therefore runs on macOS, Linux and Windows via WSL2 without depending on a particular shell ecosystem.

**Windows: WSL2.** The kit runs on macOS, Linux and Windows via WSL2 to the same extent. On Windows it works in WSL2; how to set it up is described in the guide [Windows via WSL2](/en/wsl2).

**git.** Claude Code and the whole process require git. Without a git repository, no skill works.

**Claude Code in a current version.** The skills use the skills system of Claude Code. Older versions may not know this system.

**A board adapter (Board-Adapter) — and the matching CLI.** All issue and board operations run through `.claude/kit/board.mjs`, the board adapter. The adapter shields the skills from the concrete platform. What you need depends on the chosen issue tracker:

| Issue tracker | Prerequisite |
|---------------|---------------|
| `github` | `gh` (GitHub CLI), once `gh auth login` |
| `gitlab` | `glab` (GitLab CLI), once `glab auth login` |
| `local` | Nothing — issues live as files in `issues/` |

**A project board, if you use GitHub or GitLab as issue tracker.** The board needs these five columns (Spalten): Backlog, Ready, In progress, In review, Done. On GitHub these are project board columns (GitHub Projects), on GitLab they are represented by labels. In local mode there is no board — the adapter writes and reads YAML frontmatter files directly.

**`kontext.config.json` for /session-start and /document (optional).** Both skills also run without this file, in degraded mode. If you want persistent cross-project memory: With a global installation the installer asks for the vault path and creates the file automatically; with a project-local installation you create it manually. Details in the section [kontext.config.json](/en/einstellungen#kontext-config-json).

## The three human stop points
<!-- de: 5a39b1f9c656 -->

**Step 4: the GO.** You decide which issues go into this batch. That is where the planning lies: how much work at once, which priority, which dependencies. The GO has two granularities: under **variant A** you pull each work package to Ready individually. Under **variant B** you instead mark in advance the card that starts the chain — the business requirement or the plan document — with the label from `night.kette.varianteBLabel` (see [Second mode](/en/dokumentation#second-mode-the-night-chain)) — the GO then applies in advance to all work packages that the night chain cuts from it; the chain pulls them to Ready itself and implements them in the same night.

**Step 8: the push.** You change the test server. Every batch needs an approval of its own, because between commit and push lies the last chance to reconsider the scope. Under variant B, the push is at the same time the moment in which you accept or discard the night's work together with its decisions: the night report on the business plan lists what the chain decided, and until the push none of these decisions is binding.

**Step 9: the merge.** You bring code to production. You checked on the test server, you carry the responsibility, you merge.

The kit does not automate these three. That is not a missing feature. It is the point of the kit: AI does the work, humans make the decisions.

## Three lanes
<!-- de: 7ca6129d141b -->

Not every task needs the full 9-step process. The kit distinguishes three lanes (Bahnen):

**Lane 1 — small change.** Exactly one file, one asset or one config value; no database migration; no new or changed endpoint; no data model; at most one module affected; no security-relevant logic. Implement directly, one commit, no push without a trigger phrase — no plan, no issue, no GO. This commit, too, requires a green `node .claude/kit/checks.mjs run` on the state to be committed: The commit gate is mechanical and knows no lane.

**Lane 2 — feature.** Outside lane 1, as soon as there is something to weigh up — or it is unclear whether there is something to weigh up. Full process: `/techplan` → `/issues` → GO → `/implement-ready`. Typical: a data model with several defensible cuts, an endpoint whose contract is still open, a migration with a question about the way back.

**Lane 3 — `[Task]`.** Above the trivial, but without anything to weigh up. No business concept (Fachkonzept), no plan, no breakdown: a single work package (Arbeitspaket) with the title prefix `[Task]`, created with [/task](/en/prozess#task) after you confirm the route — then reviewed and released like any other package. Typical: a renaming across several files, a rejected tool finding, a mechanical follow-up job.

**The selection rule, in this order:**

1. If the counting lane-1 rule applies **and there is nothing to weigh up**, lane 1 applies.
2. Otherwise the need to weigh up decides: There is something to weigh up when **several defensible routes** are open. A finding with exactly one correct outcome is not a trade-off. With something to weigh up, lane 2 applies, without it lane 3.
3. If it is **unclear** whether there is something to weigh up, lane 2 applies.

Size alone therefore no longer decides, and that is the actual change compared with earlier: A change to twelve files without a trade-off is lane 3; an architectural change to a single file where several cuts are defensible is lane 2. The old version of lane 2, in contrast, counted features — data model, endpoint, migration, security, more than one module — and thus sent even the unambiguous through the full process.

When in doubt, lane 2 applies; that also covers an unclear need to weigh up. Before every new task the AI names the lane out loud ("Das ist Bahn 1/2/3, ich …" — "This is lane 1/2/3, I …") — examples: swapping an icon or favicon, a text correction or a config default are lane 1; a renaming across several files without a trade-off is lane 3; a new table, a new endpoint or a new UI feature are lane 2.

**A special case worth naming: rejection as a valid result.** A tool reports a finding, and the finding is defensibly rejected — that, too, is work, and it is typical lane-3 work. So that the rejection holds, the acceptance criterion of such a `[Task]` is the **versioned suppression rule** that the tool itself evaluates, with the justification right next to it: The tool reads the rule, the justification addresses humans and later sessions. In the kit the pattern lives in `sonar-project.properties` — the exclusion of the rule `javascript:S4036` as a versioned line, with a written-out explanation above it of why it is defensible. A rejection marked as "accepted" by hand in the web UI, in contrast, does not hold: The next finding of the same kind arises outside of it. Such a task is verified by running the same tool again — the rejected finding stays away, **and an independent control finding is still reported**; without it, a silent tool cannot be told apart from an effective exclusion. If a tool lacks a versionable route, developing one belongs in an initiative (Vorhaben) of its own, and no cross-tool register is created — it would be a second list next to the rule files that none of the tools reads.

## Night mode
<!-- de: 39ead8bf56a6 -->

Night mode (Nachtbetrieb) knows **two operating modes**: the **implementation night** (Umsetzungsnacht), which this section describes, and the **night chain** (see [Second mode](/en/dokumentation#second-mode-the-night-chain)), which turns a business plan into the reviewed plan and the work packages without building anything. Both are the night; the [check run](/en/prozess#the-check-run), which has business requirements reviewed, belongs to the day and is described on the process page. The implementation night works through the Ready column unattended — with a **fresh session per issue**, so that no context accumulates over many issues and quality does not degrade creepingly. The night runner (`.claude/kit/night.mjs`, comes with the installer) starts one headless session per issue with `/implement-next #N` — the issue is **handed to the session bindingly**, it does not choose it itself — waits for it to end and checks success exclusively on the board: issue in In review = success. Nothing is **ever** pushed at night — the three stop points remain human, unchanged.

**Evening ritual (the GO):** Pull issues to Ready and bring them into the desired order by drag & drop — the runner works through the column from top to bottom. Dependencies must be written as `Issue #N` in the dependencies section (see issue format): The runner automatically defers issues with unfulfilled `#N` references. Four kinds of card it skips mechanically — commented back to the backlog, without starting a session: business issues (`[Requirement]` title, [PO loop](/en/prozess#po-loop-business-and-technical-issues)), **ideas** (`[Idea]` title), **plan documents** (`[Plan]` title) and **human steps** (Menschenschritte, `[Human]` title). A raw idea is not an implementable issue — with trade-offs it goes through `/requirement #N`, without trade-offs through `/task #N`; a plan document describes a route and is only cut into work packages by `/issues`. Without the gate a session would reject them correctly, but the runner cannot tell this rejection from a failure — the session is burned and the comment on the board misleading. With a plan document it would be worse: It would carry no reason for rejection in itself and would be implemented, and that would look like a success on the board. A **human step**, by contrast, is a work package, but its task lies outside the repository — a setting in a web interface, an account, an access, an approval —, and no move of a session gets it done. Its comment says explicitly that the card is **waiting** and has not failed: Without the gate the runner would count the session's correct inaction as a failure, and the card would look like a failed package in the backlog (documented case: kanban-kit #1256). After acting, the human moves it on themselves. Also deferred is every card whose task or acceptance criterion names a **protected file** and that the human has not released, as well as a card with the label `kit:protected` — more on this under [The halt at a protected file](/en/dokumentation#the-halt-at-a-protected-file).

**Why a card waits at the dependency gate.** The deferral comment remains the one sentence `Nachtlauf: Abhaengigkeit #N nicht erfuellt (liegt in Backlog, Ready oder In progress) — Issue zurueckgestellt.` (night run: dependency #N not fulfilled, it lies in Backlog, Ready or In progress — issue deferred). Below it, separated by a blank line, comes the block `Abhaengigkeiten, wie der Nachtlauf sie liest:` (dependencies as the night run reads them) with one line per dependency: number and title, fulfilled or unfulfilled, the origin (from a reference line or from explanatory text) together with the text passage and, for a document, the document hint. After that the cycles follow as `Kreis: #A -> #B -> #A` (cycle), with the addition „dieses Paket wartet auf einen Kreis“ (this package waits on a cycle) if the package only depends on it. The log names every cycle in a second log line; log line, result state and chain report otherwise keep the one-line sentence. The trial run (`--dry-run`) shows the same lines indented below the line of every package with at least one dependency, also for packages that would get a session; the first line of the package stays unchanged. That way you recognise an accidental dependency without opening the package. The convention for this is under [/issues](/en/prozess#issues).

**Fixed kit state.** Every unattended run — implementation night, chain, check run — binds itself at start to the commit that `origin/<mainBranch>` points to — the last push, read without `git fetch`. Fixed are thus the tools including the check before every commit, the skills and the rule texts; whatever a package of the same night changes about them only takes effect after `push main`. What is checked remains the configuration of the project and its tests; they come from the state of the respective package. The kit state (Kit-Stand) appears as the line `Kit-Stand: <commit> (origin/<mainBranch> vom <Zeit>)` in the run report (`kitStand` in `.claude/night-run-*.json`), in the night report (Nachtbericht) and on every comment of the run. After a run in the main copy, its installed copy stays at that state until `node tools/sync-blobs.mjs` brings it up to the working copy; until then `sync-blobs --check` names it as outdated. In the kit repo, `push main` catches this up itself: after catching up the main copy it runs the post-push step from `RELEASING.md`, `node tools/sync-blobs.mjs`, and the installed copy stands on the state just published (issue #1523). A machine that fetches the state only via `git pull` keeps calling `sync-blobs` by hand. If a package needs the changed tool, skill or rule text of another package as a tool, its reference line carries the addition `Issue #N (wartet auf Push)` (waits for push). The chain does not pull such a package to Ready even under variant B: It stays waiting in the backlog and appears in the night report as not started with the reason „wartet auf einen Push (Issue #N)“ (waits for a push).

**Start:**

```bash
node .claude/kit/night.mjs --dry-run   # shows what would run — starts nothing
node .claude/kit/night.mjs             # real run
```

Flags: `--max <N>` (session limit per night, default 10), `--model <id>` (model of the run; without the flag `night.modell` from the config applies, otherwise `claude-opus-5` — see "Where a session's model comes from"), `--timeout-min <N>` (time limit per round, default 60), `--dry-run`, `--no-checks-ok` (start without any check carrying the package stage — otherwise the runner refuses, because implementing at night without a gate is risky; a list of nothing but `push` and `merge` checks is the same as an empty one for implementation), `--yolo` (see Permissions), `--label <name>` (routing label, default `kit:nightrun`; `none` switches the filter off), `--verbose no` (switches off the live progress log, which is otherwise on; `--verbose yes` switches it on explicitly, `--verbose` without a value is the default and therefore has no effect), `--help`. In addition the config field `formatFixCommand` (see below) — not a flag, because it is project-specific.

**Routing label — which Ready issues the night run works on.** By default the runner processes only issues from Ready that carry the label `kit:nightrun`; all others stay untouched (no move, no comment). That way you mark the subset for the night run on **one** board and keep the rest for interactive work — without a second board with a token of its own, which would make `Issue #N` dependencies between the boards unresolvable. The label can be overridden with `--label <name>`; `--label none` switches the filter off completely (then, as before, strictly the topmost Ready issue is next). A `--dry-run` shows unlabelled issues visibly as "skipped". On **GitLab** labels already are the status mechanism — choose a routing label name there that collides with no status label (the default `kit:nightrun` with its namespace prefix does that). **Scope:** Whoever used `night.mjs` without labels so far must now give their night issues the label `kit:nightrun` or set `--label none` — otherwise the run finds nothing.

**The live progress log is the normal case and needs no flag.** The runner reads the session's `stream-json` output live and writes compact event lines into the night log and to the console — tool calls and text snippets, each with the issue number:

```
[18:24:10]   #401 > Bash: mvn -q verify
[18:25:02]   #401 > Edit: src/main/java/.../ProjectIdeaEventService.java
[18:26:11]   #401 > Claude: Tests green, committing now.
```

The final completion message still lands in the log as well; the streaming complements it and does not replace it. It is switched off explicitly with `--verbose no` — then the runner logs only start and end per round, and during a long session you cannot see what it is working on right now (`claude -p` only outputs its completion message at the end). Forgetting the flag used to cost the progress log in exactly the night you needed it; that is why the default has been reversed since issue #867. A bare `--verbose` stays permitted and without effect, so that existing calls and scripts keep running unchanged.

**The result state — the night as JSON.** Every run puts, next to the text log (`.claude/night-run-<datum>.log`), a machine-readable result state (Ergebnisstand) under `.claude/night-run-<datum>-<uhrzeit>.json`: per work package one unit with outcome, duration, commit and the key figures of the session (cost, API duration, turns), plus the conclusion of the whole run (`regulaer` or `harterStopp`, in the stop case with error class and reason). The outcomes of a unit are: `erfolg`, `zurueckgestellt`, `angehalten` (see below), `uebersprungen`, `liegengeblieben`, `abgebrochen` (a package without result whose leftovers are in the stash, see "When something goes wrong") and `harterStopp`. The file is rewritten completely after every round, so an aborted run leaves the state up to the abort. **Consumption:** Next to cost, API duration and turns, the key figures of every session carry the four token amounts from the CLI — `eingabeTokens`, `ausgabeTokens`, `cacheErzeugtTokens`, `cacheGelesenTokens`. Every unit sums them as `verbrauch` over all its sessions (including salvage and chain stages) and names its kind of run as `art`; the run header carries `verbrauch` over all sessions of the run, including the pre-flight, and `verbrauchOhneEinheit` as the part that belongs to no card. A field for which no amount ever arrived stays `null` — a 0 would claim that nothing was consumed. **Check runs:** Next to `zeiten` every unit carries `prueflaeufe` with the block `arbeit` — what check runs the session started during its work: `anzahl` all of them (a Bash call whose first program is that of a configured check group), `volle` those of them that literally matched a check group command, `volleNoetig` the sanctioned group runs via `checks.mjs run --area <name>`, and `dauerMs` the sum of their spans. Several sessions of a card add up like the times. The completion attempt — `checks.mjs run` without `--area` — is deliberately **not** in `anzahl`, otherwise it would count twice: It has its own block `abschluss` next to `arbeit`, with `anzahl` and `dauerMs`. An adopted run (`Ergebnis uebernommen` — result adopted —, because the state is unchanged) counts there as an attempt **without** duration — `checks.mjs` passes on the values of the earlier run, and a span of this call would be inherited, not measured. A session without a requested stream (command stage with a third-party program) contributes nothing; if no session of the card measured, the field is missing entirely — "not measured" is something other than "none". Only the measurement is stored: What follows from it — runs per completion, share of the running time, distance to the target mark `night.zielUmsetzungMin` — is calculated by the report. **Lookups:** The last two fields a unit is created with are `umsetzung` and `auskunft`. `umsetzung` is `true` as soon as a session of the unit started with `/implement-next`, `/implement-ready`, `/implement-test` or `/implement-done`; chain stages, card creation and check runs stay `false`, decided at the start of the session and not by the kind of run. `auskunft` is `{ ms, aufrufe }`: the time spent on queries to the board and on processing their answers. What is measured is the span from the tool call to its result. Thinking time does not count. As a query count `board.mjs issue get|list|epics|activity|auftrag`, `board.mjs context`, `gh`/`glab issue view|list` and `gh api …/issues…`. As processing counts such a query piped to `jq`, `node -e` or `python`, and also every call that names a result path offloaded by Claude Code (`tool-results/`). Writing calls such as `issue move`, `issue comment` and `issue report` do not count. Several sessions of a card add up. `null` means "not measured": no session, or a command stage without a stream. An observed session without any lookup, by contrast, carries `{ ms: 0, aufrufe: 0 }`. `complete` is `false` in the file while the run is running and only becomes `true` at the regular end — a hard stop leaves it at `false` there (the report to the board says something different about this, see the paragraph "Delivery to the board" further below). The time of day belongs in the name because the text log is a daily file for appending, but JSON cannot be appended to — the second run of a day would otherwise overwrite the first. **The only exclusion is `--dry-run`**: A dry run works through nothing and has nothing to report.

**The check runs and the target mark appear in both reports.** A measurement is only useful if someone reads it, and the night reports in two places: The implementation night writes its check report to the console and into the daily log, the chain leaves its night report as a comment on the marked card. The block `Prueflaeufe und Zielmarke:` (check runs and target mark) appears in **both** places — in the log below the checks of the sessions, in the night report under `### Umsetzung` — and carries one line per package with the round duration, the number of check runs, of those the `volle` and the `Gruppenlaeufe` (group runs), and the number of completion attempts. If no session of the card measured, the line says `Prueflaeufe nicht gemessen` (check runs not measured) and names no zero. Below it the sum: `- N von M Paketen unter <marke> Minuten.` (N of M packages under `<mark>` minutes) — the mark is `night.zielUmsetzungMin`, without the field the default 10 applies. Only units that went through an implementation round are counted; the business plan unit of the chain and packages without a session stay out. The calculation uses the round duration including all checks and corrections, and it is calculated in the report — a second copy in the file would be the same truth in a second place. **Gaps in the mapping** appear alongside: If the check summary of a package carried files without an area pattern (`ohneZuordnung`), the report names **every** one of them by name. That colours nothing red — the completion of the package stays untouched; it is a finding for the morning that an area needs a pattern.

**Neither the file nor the key figures depend on a flag.** The runner requests the detailed session output (`stream-json`) in every unattended run and thereby always gets cost, API duration and turns — also with `--verbose no`, which alone controls whether the events additionally appear on the console and in the daily log. A field `kennzahlenHinweis` therefore no longer exists since issue #668. In the past the whole file depended on the flag — that cost the evaluation in exactly the night in which someone had forgotten it, and that is the night in which you need it: **The reason for an abort weighs more than the key figures of a smooth run.** Part of the consequence is that even a run that already fails at the **pre-flight** (Vorflug) — crash leftover in *In progress*, unclean working tree, empty `buildChecks`, reviewer pre-flight — leaves a result state with `abschluss: "harterStopp"` and an error class, although it has not worked through a single package. That is exactly where you look for the reason in the morning.

**The reason for a hard stop is in the file as text.** The error class says *where* it broke (`harterStopp`, `umgebung`, `tracker`, `zustand`) — the reason says *what* happened, verbatim with the sentence that goes into the text log anyway. It stands in **exactly one place**: in the field `grund` of the affected unit, to which the run refers via `fehlerEinheit`. Only the pre-flight stop knows no card — it runs before a candidate has been drawn —, and so its reason is in the run's `fehlerText`, and `fehlerEinheit` stays empty there. For an unclean working tree the reason additionally names the left-over files; **from the eleventh entry on** it is shortened to the count and the first ten, in the order of `git status --porcelain`. Before, you had to search the text log or start a session for exactly this question. If, against expectation, a reason is missing, the run carries the last remembered stop text together with a note that the handover broke, otherwise a substitute text with a request to report it — the field is never empty.

**A run without work names its reason.** If a night ends without a single work package having been up, the run header carries the field `noWorkReason` for it — verbatim with the sentence that goes into the text log anyway. There are six named cases. In the **implementation night**: Ready is empty (`Ready ist leer — nichts zu tun.` — Ready is empty, nothing to do), none of the Ready issues carries the routing label (`Keine der <N> Karten in Ready traegt das Label '<name>' — nichts zu tun.` — none of the N cards in Ready carries the label), all cards were deferred at the gate (`Alle <N> Karten in Ready wurden am Gate zurueckgestellt — …` — all N cards were deferred at the gate) or the implementation is occupied by another run (`Die Umsetzung ist belegt: <grund> — der Lauf endet ohne Paket.` — the implementation is occupied, the run ends without a package). With `--chain`: no card carries the chain label (`Keine Kette zu fahren: keine Karte traegt das Label '<name>'.` — no chain to run, no card carries the label) or all were skipped because a prerequisite is missing (`Keine Kette zu fahren: alle <N> gekennzeichneten Karten mit dem Label '<name>' wurden uebersprungen, …` — all N marked cards were skipped). Every sentence carries the label and the number or the holding process, so that the morning recognises the case without asking and does not first have to read the text log alongside.

**The deferral sentence takes precedence over `Ready ist leer`.** If the run emptied Ready itself by deferring every card at the gate, it says exactly that — and does not claim that Ready was empty from the start. And a run that ended without a session, without any of the six cases applying, does not stay silent but carries the fallback sentence `Kein Grund ermittelbar — … bitte melden.` (no reason determinable — please report): An empty field would leave open whether there was nothing to say or a situation remained unnamed.

**An implementation lock that cannot be written is not a quiet run.** If the lock file cannot be written, that is a fault of the environment: The run ends as a hard stop of error class `umgebung`, the reason is in the run's `fehlerText`, and `noWorkReason` is absent — without `noWorkReason` you can see at a glance in the morning that something broke here. A merely **occupied** lock, by contrast, stays a quiet run with a reason (`Die Umsetzung ist belegt: …`). Without the field an empty night looked like an aborted one in the evaluation: no unit, no hard stop, no hint that there was simply nothing to do. A run with work does not carry it.

**Delivery to the board.** With `issueTracker: toolbox` the runner delivers the result state to kanban-kit continuously — after every unit and at the end, via `board.mjs nightrun report` to `POST /api/kanban/night-runs`, with the project-bound token. **The first report goes out before the first work package is up:** immediately after the result state has been created, with an empty package list and `complete: false`. A run that already stalls in the pre-flight or in the first session is thus visible on the board — before, it could not be told apart from a night that never started. The start report produces no log line, and in the dry run it is dropped like every other report. kanban-kit replaces the same run with every report. **A hard stop arrives as a completed run:** The report carries `complete: true` together with `abortReason` — the reason for the stop, shortened to the 4,000 characters of the contract —, and the board thereby evaluates the run as a fault and shows the reason. The **file**, unaffected by this, keeps `complete: false`, because the run never got through. Before, nobody reported the stop: The night stayed on the board unfinished among the active runs, although it had long been dead. The reason arises as a cascade — the run's `fehlerText`, otherwise the `grund` of the unit designated by `fehlerEinheit`, otherwise "Harter Stopp" (hard stop) with the error class. A single broken chain is **not** an abort of the run: It ends regularly and reports no `abortReason`; its outcome is on the red package. For this the board must be at least on kanban-kit **v2.7.0** — an older one silently discards the unknown field and would show the stop as a night completed green. If the delivery fails, the run does **not** end as a failure: The log names the reason, and the file remains the fallback. With every other tracker the delivery is dropped with a log line.

The **text log** — that is, the `.log` file from above — stays alongside unchanged and remains the way for whoever wants the details; the result state does not replace it, it complements it with an evaluable form. Two version details are in the file: `schemaFassung` as the first field names the version of the format — needed by whoever evaluates the file — and `erzeugtVon` the kit state that wrote it, for whoever wants to know when looking which runner was at work. Kept separate because a kit release does not change the `schemaFassung` and a format change does not wait for a release. The runner does not count the file as an unclean working tree — it does not have to be committed; whoever's `.gitignore` does not list `.claude/*` will still see it in `git status` in the morning.

**What was checked — and what was not.** The sessions check by area (see [Area-based checks](/en/einrichtung#area-based-checks-checkareas)), and the omissions are visible in **two** places: in the **completion report on the work package**, where the session lists checks run and omitted, each with its reason, and in the **run report of the pass** — there one line per session and below it a sum line over the whole run. A session without a check appears explicitly as "unchecked", a package without changes as "empty package"; none of it hides behind an empty list. A session that dies **during** the check run appears as **red** and no longer as "unchecked": Since the [summary accompanies the run](/en/einrichtung#the-commit-gate), an unfinished version with `nicht gestartet` (not started) is left behind in this case. The shift is intended — a dead checker is an objection, not a failed measurement. The runner does not read this from the completion report but from the summary that `checks.mjs` leaves in `.claude/checks-summary.json`: What the machine evaluates passes nowhere here through text formulated by a model.

**The proof only counts for the package's commit.** The summary always contains only the **last** check run of a session — whoever starts `checks.mjs run` once more after the commit, say as a manual test, and aborts it, leaves a version that did not measure the delivered state at all. The runner therefore holds the file against the session's commit: Every file the commit changes must have been checked in it with exactly the blob that landed in the commit — the same question the [commit gate](/en/einrichtung#the-commit-gate) asks against the index before the commit. An aborted run (`abgeschlossen: false`) never counts as proof. If it does not match, **the runner re-checks itself**: It runs the package stage of the `buildChecks` and reports the session as **`nachgeprueft`** (re-checked, green) or **red**, in both cases with the reason in the line („Nachweis gehörte nicht zum Commit …“ — proof did not belong to the commit). `nachgeprueft` is a success like `geprueft` and is coloured green on the control panel just the same. If the session left no commit, there is nothing to compare — then everything stays as the summary says.

**Night run against a different board (Toolbox/kanban-kit).** If your project runs against a kanban-kit tracker, you can switch the whole night run to a night board of its own: create a token in the admin UI and bind it to the night board, store it as a second gitignored file next to the normal `tokenFile` (e.g. `.claude/tbx-night.token`) and start the runner with `TBX_TOKEN` per call:

```bash
TBX_TOKEN="$(cat .claude/tbx-night.token)" caffeinate -i node .claude/kit/night.mjs
```

This works because `TBX_TOKEN` is the highest level of the [token precedence](/en/einrichtung#toolbox) and the environment variable is inherited across the whole process chain: from the runner to its own `board.mjs` calls **and** to every headless session, whose `board.mjs` calls inherit it in turn. The entire run thus changes board — Ready source and all feedback (move, comment). A split ("pull issues from board B, report to board A") is deliberately not possible: The board is the runner's only coordination signal. Important: set `TBX_TOKEN` only like this, per call — never export it permanently (say in `.zshrc`), otherwise it wins against the `tokenFile` in **every** project. All of this applies only to the Toolbox/kanban-kit tracker; with GitHub and GitLab the board is separated per repo via the config (`github.projectNumber` or status labels), and there is no switching per call there.

**Model information in the activity history (kanban-kit).** The runner sets `KIT_AGENT_MODEL` for every session to the model it actually starts with — since v1.54 that is no longer necessarily the value of `--model` but the model of the respective card (see below). The variable is inherited via the same process chain as `TBX_TOKEN` — down to the session's `board.mjs` calls — and the adapter attaches it as the header `X-Agent-Model` to every board request. The activity history then shows, next to the origin, which model was used at night. This is explicitly a **self-report of the client, not proof**: The server verifies session and token, not the model — the board page marks the value accordingly ("lt. Angabe", as stated). Interactive sessions do not set the variable and therefore make no statement; no statement is more honest than a guessed one. Only kanban-kit evaluates the header on the server side; other trackers ignore it.

**Where a session's model comes from.** Up to v1.53 every session of a night ran with the same model: `--model`, once for the whole run. A recommendation on the work package had no effect. Since v1.54 a fixed order applies — model name of the card, then task level, then model of the run:

1. If the body of the card carries a line `Empfohlenes Modell: <name>` **and** `<name>` is in `night.modelle`, the session starts with this model. The same value goes into `--model` and into `KIT_AGENT_MODEL`. The model name wins against an `Aufgabenstufe:` line set at the same time; if a card carries both, the level stays without effect, and the reason in the result state notes the double statement.
2. Otherwise, and only if `night.stufen` is active (at least one level assigned) and the card carries an `Aufgabenstufe:` line, the level applies: Starting from this level the runner searches upwards — **leicht → mittel → schwer** — for the first assigned **and** startable level. An unassigned or non-startable level is skipped, never undercut: A task for which the intended level is missing would rather run with a stronger model than with a weaker one.
3. Otherwise the model of the run applies. It comes from `--model`, without the flag from `night.modell` in the shared `.claude/workflow.config.json`, and only without both from the runner's default (`claude-opus-5`). The start line names it together with its origin, for example `Modell claude-opus-5-5 (night.modell)`. `night.modell` must be in `night.modelle`; otherwise the runner ends before the start with a reason instead of silently falling back to the default. A `night.modell` in the personal file is ignored and reported. The model of the run also applies to business plan, plan, review and breakdown of the chain (issue #994).

**`night.modelle` is the only check — and it is a security gate, not a convenience.** Without it a value from an issue body would wander unseen into the command line; a package with `Empfohlenes Modell: --dangerously-skip-permissions` would be an attack via a card. That is why the comparison is against a **list** and not against a pattern: A pattern can be extended, a list cannot. A value with a leading hyphen or with spaces does not even count as a candidate, and the schema already rejects it in the config check. The same list applies to a level with `modell`: A level model name must likewise be in `night.modelle`, otherwise the configuration check rejects it — two separate lists could otherwise drift apart. A level with `kommando` instead checks whether the first word of the command line can be found via the same shell that starts later. This shell is `sh`. As everywhere, the task goes to the program as an argument and never into the shell string.

**How thoroughly a level thinks.** Next to `modell` a level optionally carries `effort` — the thoroughness of thinking, which goes as `--effort` to the session's Claude CLI. Possible values are `low`, `medium`, `high`, `xhigh` and `max`. Without the field the CLI's default applies; a level without `effort` therefore behaves as before. The field belongs exclusively to a level with `modell`: Next to `kommando` a third-party program starts, for which the kit cannot set a thoroughness. There it is a configuration error and is not silently ignored but reported with the path `night.stufen.<stufe>.effort` — likewise a value outside the five.

**Where the thoroughness takes effect — and where not.** Model and thoroughness always come as a pair from **one** level entry: If the runner moves upwards, the thoroughness of the level that actually provided the model applies, never that of the unassigned one below. It stays without effect wherever the level did not provide the model — with the card's `Empfohlenes Modell:` and with the model of the run — and in the command branch, where a third-party program starts that does not know `--effort`. The night chain's sessions for business plan, plan and breakdown also stay unaffected; the implementation stage runs its packages through the same round as the implementation night and therefore gets the thoroughness too. It is visible in four places: in the hint line of a round, in the preview `--dry-run`, in the **result state** as the field `effort` of the unit (after `stufeVerwendet`, `null` if none was set) and in the report of the implementation stage as a parenthetical addition after the model. A package's salvage session runs with the same bundle as its regular round, so also with the same thoroughness.

A card name **outside** the list is not a failure: The session runs with the model of the run, and the unit in the result state carries `modellHerkunft: "lauf"` together with `modellGrund` with the rejected name. A missing line and an empty list also lead to the run's model, then without a reason — a missing recommendation is the normal case and not a finding. A model that does not start despite a valid name, by contrast, remains a failure like any other.

**Start error on the highest level.** The runner re-checks whether a level is startable **before** the first work step of every package. If the intended level fails, it moves upwards as described above; if that also fails on the highest level (`schwer`), there is no way out left. Then **no** session starts — a silent fallback to the model of the run would be wrong, because whoever sets a level wants the package to run at that level. The package counts as a failure, gets a comment with the reason and goes back to the backlog.

**The pre-flight.** Before the first round of a night the runner checks once, without network, whether every **assigned** level is startable, and writes a warning into the log for a non-startable level. That does not hold up the night — it is an early hint that individual packages will later move up or fail, not a start condition for the whole run. If the setting is not active, the pre-flight writes no line.

**The preview.** `night.mjs --dry-run` names for every Ready issue which model would actually start and where from — `(Karte)`, `(Stufe <name>)` or `(Lauf)` (card, level, run) —, together with a fallback hint if the card's own level is unassigned and a startable level was only found further up. A package without a startable level appears in it explicitly as "würde nicht starten" (would not start), never as a running session.

**A worked example with a local model.** A project operates its own, locally hosted model for easy tasks, via a command-line program instead of a Claude model ID:

```json
{
  "night": {
    "modelle": ["claude-opus-5", "claude-sonnet-5"],
    "stufen": {
      "leicht": {
        "kommando": "mein-lokal-runner",
        "name": "lokal-llama"
      }
    }
  }
}
```

If a Ready issue carries `Aufgabenstufe: leicht`, the runner starts `mein-lokal-runner` instead of the `claude` CLI and passes it the task (`/implement-next #N`) as an argument. `KIT_AGENT_MODEL` carries the value from `name` (`lokal-llama`) — in the command branch there is no Claude model name; the field there is purely a self-report of the program. Setting up and operating this program is the project's business, not the kit's; the kit only starts the process. So that the card is afterwards treated like any other, the program must deliver the same as a regular session: a local commit, the issue in In review and an entry in the completion report (criterion 6) — the runner evaluates exclusively board state and working tree; it does not care which program produced them.

A package's **salvage session** runs with the same model as its regular round: It checks that round's intermediate state, and the recommendation applied to the card, not to the operating mode. The **implementation stage of the night chain** pulls its work packages through the same `laufeRunde` as the implementation night — so the level route applies to it as well. For business plan, plan and breakdown of the chain (`/techplan`, `/issue-review`, `/issues`), by contrast, the model of the run still applies: They are not attached to any single card.

A project **without `night.stufen`** notices none of this: Planning, packages, night run, pre-flight and report behave as before — every card still carries only `Empfohlenes Modell:`, and the model choice stays with the two cases card/run.

The list `night.modelle` is **ordered**, descending by strength: first entry the strongest, last the fastest model. From this `/issues` derives what it recommends to a work package.

**Permissions.** Unattended means: nobody answers permission dialogs. The runner therefore starts the sessions with `--permission-mode auto --permission-prompts none` (issue #940); everything else you allow selectively via an allowlist in the project's `.claude/settings.json`. The two flags belong together: In auto mode a classifier decides, and so your allowlist takes effect at night too — unlike the earlier mode, which accepted edits wholesale and carried a built-in block for sensitive files along with it that no `allow` entry lifted. What the classifier cannot decide would become a prompt; `none` rejects it automatically instead of sending it to an SDK host the runner does not have. Without `none` the session would hang until the round's time limit. Before the first session the runner checks in every operating mode whether `.claude/settings.json`, `.claude/settings.local.json` and `~/.claude/settings.json` — where present — are valid JSON, and stops hard on an error with path and parser message (in the dry run only reported): An invalid file puts all its settings out of force, and at night you would only see an approval prompt that nobody answers. The allowlist, for example:

```json
{
  "permissions": {
    "allow": [
      "Bash(node .claude/kit/board.mjs:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git show:*)",
      "Bash(mvn:*)",
      "Bash(npm --prefix frontend:*)"
    ]
  }
}
```

For unattended operation it is best to allow the **tool**, not the individual command: `Bash(mvn:*)` instead of `Bash(mvn verify:*)`. The reason is the prefix matching of the allowlist — a pattern only applies if the beginning of the command matches exactly. `Bash(mvn verify:*)` covers `mvn verify`, but not `mvn -q verify`, `mvn clean verify` or an `mvn test` for a partial run; yet sessions legitimately phrase such variants. A tool-wide entry catches all of them. The four read-only Git commands belong in there too, so that a session does not fail at a harmless `git status` while preparing the commit. **Trade-off:** A tool-wide entry gives the session more latitude (any `mvn` goals, any `npm` scripts). For the project's own build tools that is the pragmatic cut at night; whoever wants to stay narrower enters the buildChecks literally instead (including all flags) and pays for it with rounds that fail at an unforeseen command variant.

A command outside the allowlist is rejected immediately in headless operation; a well-behaved session then keeps implementing, but cannot run its checks and therefore does not commit — the round ends promptly without an In review result (dirty tree → hard stop, clean tree → backlog), not only after `--timeout-min`. That is intended: better a lost round than an unattended action. Whoever sets `--yolo` instead switches off **all** permission checks of the night sessions (`--dangerously-skip-permissions`); the stop points then depend on the skill prompt alone. A deliberate case-by-case decision, not a default.

**Two further layers: sandbox and environment.** The allowlist decides whether a command is *allowed* — not in which environment it runs. Claude Code additionally runs Bash commands in a **sandbox**, which among other things seals off Unix sockets. If a check needs a socket (typically: Testcontainers integration tests via `mvn verify` that address the Docker/Colima socket), it fails at the sandbox despite a matching allow rule, and the way out ("run again without sandbox") is an interactive prompt — unanswerable at night. Take such commands out of the sandbox via [`sandbox.excludedCommands`](https://code.claude.com/docs/en/sandboxing):

```json
{
  "sandbox": {
    "enabled": true,
    "excludedCommands": ["mvn *"]
  }
}
```

**Kit scripts with board access.** The kit, too, needs entries in `sandbox.excludedCommands`, namely for every script that reaches the board — directly or via a subprocess. A subprocess inherits the sandbox: `node .claude/kit/findings.mjs suggest` starts `board.mjs` via `spawnSync`, and this `board.mjs` has no network as long as `findings.mjs` itself is not in the list — the entry for `board.mjs` alone is not enough. The same applies to `effectiveness.mjs`. Add to that the reviewer command:

```json
{
  "sandbox": {
    "enabled": true,
    "excludedCommands": [
      "node .claude/kit/board.mjs*",
      "node .claude/kit/night.mjs*",
      "node .claude/kit/findings.mjs*",
      "node .claude/kit/effectiveness.mjs*",
      "codex *"
    ]
  }
}
```

If the check additionally lacks an **environment variable** (e.g. `DOCKER_HOST`, so that Testcontainers finds the socket), set it in the `env` block of `settings.json` — **not** as a command prefix. An `env DOCKER_HOST=… mvn …` falls out of both patterns: The first token is then `env`, not `mvn`, so neither the allow rule `Bash(mvn:*)` nor `excludedCommands: ["mvn *"]` applies. In the `env` block the variable applies to every session, and `mvn` inherits it without a prefix:

```json
{
  "env": {
    "DOCKER_HOST": "unix:///<pfad-zum>/docker.sock"
  }
}
```

The setup recipe for night mode therefore has three layers that must all fit: the **allowlist** allows the command, `sandbox.excludedCommands` frees it from isolation, the `env` block supplies it with variables. (For Testcontainers specifically, a `~/.testcontainers.properties` with `docker.host` does the job as an alternative — it lies outside the project, but is independent of Claude Code in return.)

**Pipe and redirection lift the exception (from Claude Code 2.1.277).** Claude Code now only takes a compound line out of the sandbox if **every** part matches an entry in `excludedCommands`. `node .claude/kit/board.mjs issue-review check 2>&1 | head -40` therefore runs entirely in the sandbox, because `head` is in no list — including the codex that `board.mjs` starts, and without network. The same applies to a redirection into or out of a file (`codex exec … < prompt.txt`, `… > liste.json`), even if nothing else is in the line. Only `2>&1` (and any other redirection to a descriptor such as `>&2`) leaves the exception in place, measured under 2.1.283.

**No `cd` into the release worktree (Issue #1372).** `/push-main` and `/merge-production` create their worktree under the temp directory. Claude Code resets the working directory away from there after every call, and `cd <pfad> && node .claude/kit/checks.mjs …` would drop out of `excludedCommands` under the rule above. The skills therefore name the worktree in every call themselves: `git -C <pfad> …`, `node .claude/kit/checks.mjs run --in <pfad> …` and, for any other command, `node .claude/kit/worktree.mjs in <pfad> -- <kommando>`. `worktree.mjs create` returns the path as a realpath, because `npm ci --prefix` fails through the macOS symlink of the temp directory. Anyone who still wants to work with `cd` in the worktree adds the temp directory and its realpath under `permissions.additionalDirectories`.

The installer therefore enters a **`PreToolUse` hook** with matcher `Bash` into the `hooks` block of the project's `settings.json`: `node .claude/kit/board.mjs hook bash-check`. It reads the patterns from `sandbox.excludedCommands` and — only out of consideration for older settings, Claude Code itself does not know the key — `sandbox.network.excludedCommands` from `.claude/settings.json` and `.claude/settings.local.json`, and rejects a Bash line (exit 2, reason to the session) if a part of it matches a pattern and the line at the same time

- redirects into or out of a file (`<`, `>`, `>>`, `&>`, here-doc), or
- contains a pipe or a further command (`|`, `&&`, `||`, `;`, line break) whose parts do not all match.

Characters in quotation marks do not count (`--text "a > b"` stays allowed), nor do lines without a matching pattern. The reason names the pattern and the correct form: call the command alone; Claude Code itself stores a large output in a file, which a second call can filter. If the hook cannot read its input or a settings file, it lets the call through and writes a line to stderr — a broken hook locks no session.

**No background work without supervision.** The same hook `bash-check` rejects a Bash call with `run_in_background: true` as soon as `KIT_AGENT_MODEL` is set (exit 2, reason to the session). An unattended session has no follow-up turn: If it ends its turn while the command is still running, the session is over and its result lost — in the night of 30.09.2026 with #1065, although the rule was in the skills. The right way is to call the command in the foreground; the session's Bash time limit reaches to just below the round limit (#668). Interactively, background work stays allowed. The hook does not cover the tool `Agent`: Whether an agent runs in the background is not reliably stated in the call (#1081).

**When something goes wrong:** The runner distinguishes three cases. **Infrastructure false start** — the session itself ends with exit ≠ 0 (auth expired, CLI broken): hard stop, the issue stays untouched in Ready, because nothing is wrong with it; the CLI error message is directly in the console log. That way a broken environment does not clear out the whole Ready column. **Functional failure** — the session ends cleanly (exit 0), but the issue is not in In review: the runner comments on it and puts it back into the backlog, and the run continues with the next issue. A **timeout** (`--timeout-min`) counts as issue-specific — the session ran out of time — and is treated like a functional failure; **why** it ran out does not follow from this and is at most in the note on the package (see [The time-limit abort](/en/dokumentation#the-time-limit-abort)). If a round without a result leaves an unclean working tree and the rescue (salvage, see below) fails as well, the runner secures the leftovers with `git stash push --include-untracked -m "nachtrest #<id> <lauf>"`: Exactly what counts as a leftover is secured, including unversioned files. The card goes to the backlog, its comment and its run status `abgebrochen` name the stash, and the run continues with the next package. That way a package that fails at itself only stops itself, and still nothing is built on half-finished changes. You get the leftovers back with `git stash list` and `git stash apply stash@{<n>}`. A package that depends on a package aborted in this run goes back at the dependency gate as before and additionally shows the run status `wartet` with „hängt an #N (abgebrochen in diesem Lauf)“ (depends on #N, aborted in this run). A hard stop (exit ≠ 0) remains where a commit may be incomplete: for leftovers after a **successful** round, for a rescue that committed or pulled the card to In review and still leaves leftovers, and when the leftovers cannot be secured. Every package appears with its run status on its own card: `laeuft` at the start of the round, `fertig` at In review with proof, `wartet` at a halt and otherwise `abgebrochen` with a reason. Before the start the runner also checks: no issue in In progress (crash leftover), clean working tree, `buildChecks` present.

**The fourth outcome: `angehalten`.** An implementation session decides instead of asking: Whatever is unclear during implementation and is not in the stop class from `CLAUDE-workflow.md` is decided and recorded in the completion report under `### Entscheidungen`. If, however, a question of the stop class comes up, the session does not choose but **halts**: It takes back its own share of the changes, marks the issue with `kit:clarify`, states the question as a board comment and moves it to the backlog. The runner recognises this by the comment, writes a log line of its own and **keeps running**.

This outcome must be distinguished from the two neighbouring ones, and that is exactly why it has a name of its own:

| Outcome | What happened | Who comments and moves | Consequence for the run |
|---|---|---|---|
| `zurueckgestellt` | the session did not get the task finished | the runner | continue with the next issue |
| `angehalten` | the task is solvable, but a decision is missing | the session itself — the runner does nothing here | continue with the next issue |
| `harterStopp` | the environment or the working tree is broken | nobody, the issue stays untouched | the run ends |

A halt is **not a failure**: The session acted correctly by not guessing. That is why it appears in the result state as a counter of its own next to `erfolg`, `zurueckgestellt` and `fehlschlag` — whoever had to look for the waiting decisions in the deferral count in the morning would not find them. The way forward leads via `/requirement #T`: The skill takes the halted task together with the decision comment as input and turns it into a business requirement. The same number form has a second input — an `[Idea]` that calls for a trade-off; if there is nothing to weigh up about it, `/task #N` is the way instead. Only the human removes `kit:clarify` in the process.

#### The halt at a protected file
<!-- de: 74b14bdb3bb6 -->

**A protected file (geschützte Datei) is not a question but an action.** Some files may only be written by a human — in the kit, the settings under `.claude/` (`settings.json`, `settings.local.json`, `.claude/hooks/`). If a package has to change one of them, it halts, and it does so with the label `kit:protected` instead of `kit:clarify`: With `kit:clarify` a decision is waiting, with `kit:protected` an action. Like `review:done`, the label has to be created once per board; the machine sets it, only the human may remove it. The halt comment begins with `## Geschuetzte Datei` (protected file), names every file with the quoted line from the package and records as its last line `Label kit:protected gesetzt` (label set) or, if the label is missing on the board, `Label kit:protected nicht gesetzt` (label not set). The run does not abort because of the missing label; the card is only released, however, after a halt with the label set.

**Before the start.** The night runner checks every Ready package against the protected paths before a session begins: If the task or the acceptance criterion names a protected file and the package is not released, it goes to the backlog, gets the label and the halt comment, and the run continues. In the **implementation stage of the chain** (variant B) the package is already in the backlog; there the runner sets label and comment without a move, and every package that depends on it gets the dependency comment and stays put as well. The same check is delivered by `issue brief` during the day with the consequence `geschuetzt`.

**When only the writing fails.** If the package does not name the file and Claude Code rejects the write access, the session halts by itself: take back its own share by name, backlog, label, halt comment via `issue check-protected <id> --path <pfad>`. If it does not follow this and leaves an unclean tree without a halt, the runner catches the case: If its stream carries a rejected `Write` or `Edit` on a protected path in `permission_denials`, it secures the intermediate state in the stash `nachtrest #<id> <lauf>`, moves the card to the backlog, records the halt together with the location of the intermediate state and continues with the next package.

**In the report** the halt appears with the kind `geschuetzt`, separate from the stop questions: as a key figure of its own „Geschuetzte Dateien“ (protected files) and under „Wartende Handlung an geschuetzter Datei“ (pending action at a protected file), not under „Offene Stopp-Frage“ (open stop question).

**The way back:** make the change to the file yourself, remove the label `kit:protected`, move the card to Ready. On the next attempt the package counts as released and runs through normally.

**Salvage — when the work is finished but the board does not know it.** A headless session has no follow-up turn. If it starts a long check in the background and ends its turn before the result is there, the result is lost — the board shows a failure although the work was complete. Before the runner stops hard on "not in In review AND dirty", it therefore checks for itself — with **`node .claude/kit/checks.mjs run --finish <id> --fresh`** in the project, that is exactly the run that the completion of a card also performs. The route via `checks.mjs` is the core of the matter: This run leaves the summary `.claude/checks-summary.json`, and **it is exactly what the commit gate reads**. When the runner used to run the `buildChecks` itself, it measured green at a place the gate does not know — the summary still held the session's red result, and the salvage session could not commit: In this situation the rescue could never succeed. Now there is one truth about "green" instead of two. `--fresh` belongs to it, otherwise the command would, on an unchanged state, adopt exactly the red result the runner doubts; `--finish <id>` keeps the scope of a card completion (package stage, without integration checks (Zusammenspiel-Prüfungen) and without quality measurement) and assigns the run to the card. With the route comes its **area-based selection**: The checks of the touched areas run — a separate, further selection would again be the second truth that the incident cost. Checks with `stufe` `push` or `merge` stay out as before, they are only due at publishing. If the checks are green, **exactly one** salvage session per issue gets the chance to check the intermediate state against the issue, commit it and move the board (time limit 10 minutes; it no longer runs any builds). Red checks and a failed attempt each have a log line of their own. Without a commit the leftovers go into the stash and the run continues (see "When something goes wrong"). The pre-check merges the `env` block from `.claude/settings.json` and `.claude/settings.local.json` into its environment — otherwise it lacks project-specific variables (for Testcontainers, for example) that otherwise only Claude Code's own Bash calls get, and it reports a false red.

**If the salvage does not carry, there are three end states — not one.** They call for three different moves in the morning. The first secures the leftovers in the stash, and the night continues. The other two end in a hard stop, because a commit may be incomplete there. Log line, board comment and the `grund` of the result state therefore name them:

| End state | What the runner found | What to do about it |
|---|---|---|
| `SALVAGE-VERSUCH gescheitert` (salvage attempt failed) | no new commit, card not moved | the session left nothing behind; the leftovers are in the stash `nachtrest #<id> <lauf>`, reason and run status name it |
| `SALVAGE UNVOLLSTAENDIG` (salvage incomplete) | new commit, card not moved | the work is local — the commit hash and the paths left behind are given with it, only the board move is missing |
| `SALVAGE WIDERSPRUECHLICH` (salvage contradictory) | card in In review, working tree unclean | the card claims more than is committed; the affected paths are given with it |

Whether a commit was made is told by comparing the commit hash before and after the salvage session: Before the regular round the working tree is clean, so a new commit is the only trace it reliably leaves. **The salvage only moves the board with a clean working tree** — its instruction prescribes the order: commit, see `git status --porcelain` empty, only then move. Without that, the third case would be the rule instead of the exception.

**So that it does not come to a salvage in the first place.** The rescue move treats the damage, not the cause — and three times it did not carry, because the checks were red afterwards. Since v1.54 the runner therefore puts two things in front of it:

- **The `Monitor` tool is blocked for implementation sessions** (`--disallowedTools Monitor`), and their Bash time limit is set to the round time limit (`BASH_MAX_TIMEOUT_MS`, `BASH_DEFAULT_TIMEOUT_MS`). `Monitor` is the tool with which a session waits for a background run of its own — and that is exactly how it ends its turn. Without the tool it is left with the foreground call, whose result it can still use; without the raised time limit it would die after ten minutes on the clock instead of on the code. This is a guardrail, not a request: The instruction to actively wait for a background check has been in the `local-check` skill for a long time and was in the context of exactly the sessions that nevertheless ended waiting.
- **The runner only measures once no process of the session is running any more.** After a session ends it waits for its process group, at most until the rest of the round time limit. Otherwise the salvage pre-check would start its own build next to one still running — two simultaneous Testcontainers runs snatch the resources from each other, and the red says nothing about the code. If something is still running after the deadline, a note appears in the log and the run continues.

**The waiting session (wartende Sitzung).** Since v2.0.3 the rule applies to every unattended session: **No session ends with its own work still running.** It waits for the result of the long work it started, or aborts that work and reports the abort as a failure. Background work explicitly stays allowed; the only thing not allowed is to stop while it is still running. If a session does so anyway, this used to look like a regular end without a commit — that is, like giving up, although the work may have been almost finished.

**It is recognised by the closing text**, not by the tool and not by the time: phrases such as „warte auf" (waiting for), „läuft noch" (still running), „im Hintergrund" (in the background) or „sobald … fertig ist" (as soon as … is finished). **Waiting for a human does not count** — if the closing text speaks of an answer, feedback, an approval, a GO, a clarification or a review, the session has lost nothing: Its question is on the board, and the halt route above has already recorded it. Only the closing text is read; a waiting message in the middle of the run has no consequence, because whoever finishes later says something different at the end.

**What the runner then does.** The round gets its own reason — the same line in log, board comment and `grund` of the result state, see the table below. The work package gets a comment under the anchor `## Nachtlauf: wartende Sitzung` (night run: waiting session): the case, the last known state (the closing text, shortened from 2,000 characters) and, if there are any, the leftovers in the working directory. The unit in the result state carries `wartendBeendet: true`. Nothing changes in the flow: With a clean working tree the package goes back to the backlog like on any failure and the run continues. The next session that picks up the package names the note instead of silently continuing halfway.

**With an unclean working tree the salvage comes first.** If it rescues the round, that is the end of it — then nothing was lost, and a second verdict on the same event would be a second truth. If it is not possible (red checks) or has failed, reason, note and `wartendBeendet` are added; with a failed salvage the reason of the waiting session comes **before** its end state from the table above, because these are two events: why the regular round left nothing behind, and what the salvage found.

**In the night chain** a stage session with a waiting closing text ends as `abgebrochen`, with the same reason, and its note is attached to the document of the stage — to the plan, to the package. The only exception is the stage `abdeckung`: Its information *is* a text about running work, and a detection there would discard the finding precisely when it has something to say.

**It is counted.** `effort.mjs` keeps the sessions that ended waiting as a figure of their own and names them in the finding in a line of their own — also at zero, and then explicitly as zero: The case is rare, and silence would leave open whether it did not occur or was not counted.

**The hard stop names the reason, not only the state.** Up to v1.53 the log said „nicht in In review UND Working Tree dirty" (not in In review AND working tree dirty) — that is the consequence. Whoever reviews in the morning now distinguishes five cases with five different next steps:

| Prefix in the log | What happened |
|---|---|
| `Grund: Session regulaer beendet ohne Commit (end_turn)` | The session ended normally without finishing (reason: session ended regularly without commit) |
| `Grund: Sitzung hat auf eine selbst angestossene Arbeit gewartet und ist ohne Ergebnis beendet worden` | The session started a long piece of work and waited for it — headless there is no follow-up turn, see above (reason: session waited for work it started itself and was ended without result) |
| `Grund: Session am Zeitlimit beendet` | The session ran out of time; what it ran out on is said by the note on the package — not by this line (reason: session ended at the time limit) |
| `Grund: Session mit is_error beendet` | Abort (reason: session ended with is_error) |
| `Grund: Pflichtcheck rot — <Kommando> (Session)` or `(Vorpruefung des Runners)` | Work on the code; the red command and the last 15 lines of its output are given with it (reason: mandatory check red, in the session or in the runner's pre-check) |

The reason appears in the log, in the board comment and in the `grund` of the result state — the same line in all three places. So that `stop_reason` is available at all, the implementation run has **always** requested the stream output since v1.54, even with the history log switched off (`--verbose no`); the former field `kennzahlenHinweis` in the result state has thereby been dropped.

**Platform shell for `buildChecks` and `formatFixCommand`.** Both values are freely configured command lines and therefore necessarily need a shell — unlike the fixed commands of the board adapter, which has managed entirely without a shell since v1.27. The runner starts them in `/bin/sh`. **Consequence:** The same command line applies on macOS, Linux and WSL2. You write chaining with `&&`, pipes, redirections such as `2>/dev/null` and variables such as `X=1 npm test` in POSIX syntax, once for all platforms. The variables the night runner sets for its sessions (`LAUF_VARIABLEN` in `kit/night/laufvariablen.mjs`, for example `NIGHT_ISSUE_ID`, `NIGHT_KETTE_STUFE`, `KIT_NIGHT_RUN`, `KIT_AGENT_MODEL`) are not inherited by the check commands; whatever is in the command line or in the `env` block of the `settings.json` still applies.

**`formatFixCommand` — a format violation must not topple a run.** If you set a command in the `workflow.config.json` that repairs formatting mechanically (`"formatFixCommand": "mvn spotless:apply"`, for frontends for example `"npx prettier --write ."`), it runs **exactly once** on red checks in the salvage pre-check, and the checks are repeated **exactly once**. If they turn green as a result, the run continues and the log shows the intervention with `FORMAT-FIX angewendet` (format fix applied) — no silent intervention. If they stay red, the format was not the cause, and the package aborts, its leftovers go into the stash. Background: A single wrongly wrapped Javadoc comment once ended a complete night run although the work was correct. A format violation can be fixed deterministically and says nothing about the functional quality — a failed test, by contrast, does, and with it the package aborts. Without the field nothing changes.

### The time-limit abort
<!-- de: 31984bf58642 -->

**A session that ends on the clock leaves a note.** Up to v3.3 all that remained of the time limit was the reason `Grund: Session am Zeitlimit beendet` (session ended at the time limit) — in the morning the card said *that* time ran out, but nothing about how far the session had got. Since then the runner attaches a comment under the anchor `## Nachtlauf: Zeitgrenze erreicht` (night run: time limit reached) to the work package in this case. It carries four things: the limit this round reckoned with (if it is missing, it says „Grenze nicht bekannt" — limit not known — and no invented number); the **state according to the session's own account**, that is the lines `FORTSCHRITT: AK<n> — …` it reported along the way; a **recommendation** to the human to cut the package into parts, expressly as a suggestion and **not a requirement**; and the leftovers in the working directory, if there are any.

Three states of the progress are distinguished and appear differently in the text: „nicht beobachtet" (not observed — the round ran without a stream), „keine Auskunft" (no information — the session did not report a progress line up to the abort) and the reported state itself. Merging the first two would be the same lie as a 0 for a missing measurement. Structurally there is no closing text: At the time limit the session is killed together with its process group, a `result` event never arrives.

**Nothing follows from the abort about its cause.** That time ran out does not say whether the package was cut too large, whether the session lost its way or whether a single run took unusually long. The note says this itself — and that is why no other place says anything different either: neither the reason table above nor the timeout paragraph in "When something goes wrong".

**The case is counted twice.** The unit in the result state carries `zeitlimitBeendet: true` — the field is missing where the case did not occur, instead of carrying `false`: A `false` would claim a measurement that did not exist. The run header of the same state carries `zielUmsetzungMin`, the target mark this run reckoned with; the evaluation measures every state against its own mark instead of against today's configuration, because that may have been different between two nights. What becomes of it is described under [Effort of the process](/en/dokumentation#effort-of-the-process).

**Visible beforehand already: the estimate on the package.** Since `/issues`, every work package carries the line `Sitzungsumfang: passt | reisst — <ein Satz>` (session scope: fits | breaks — one sentence) in its `## Kontext`. The stage block of the chain's night report summarises them and ends with the line `- Voraussichtlich über der Sitzungszeitgrenze: #N, #M` (expected to exceed the session time limit); if there is no such case, it says „keine" (none), and a package without the line appears as „#N nicht eingeschätzt" (#N not estimated) — a missing verdict is not a good one. Without this line you would have to open every card in the morning to find the large packages.

**The yardstick of the estimate is the time limit of *one session*** — `--timeout-min`, default 60 minutes, also in the night chain, where every session starts with the same limit. Expressly **not** meant is `night.kette.umsetzungMin`: That is the budget of the whole implementation stage, is only checked between two sessions and says nothing about a single package. Nor is the target mark `night.zielUmsetzungMin` meant — it is a benchmark for the evaluation, not an abort limit.

### The stuck package
<!-- de: a486800c5b8c -->

**A session that fails at the same check again and again ends before its time limit.** Until then such a package ran on until the clock stopped it, by default after 60 minutes: The session changed something, the check stayed red, for the same reason as before. The time was missing for the other packages of the night, and in the morning the package only carried the note about the time limit, not what it was stuck on. Since then the check tool brakes by itself.

**Counting is per check.** `checks.mjs run` remembers its failure fingerprint for every red command: the names of the failed tests, for a check without test names such as a build the first error message. Timestamps, durations, temporary paths and random values are ignored. If the same check fails in a row with the same fingerprint, its sequence grows; green results of other checks do not interrupt it. It only ends when exactly this check turns green or fails differently — a different test than before counts as progress. Every real run via `checks.mjs run` counts as an attempt, partial runs included; an adopted result does not count, nor does a test the session starts outside the tool.

**The limit is `night.festgefahrenNach`**, default 3. When the sequence reaches it, the run announces the last allowed attempt. Unattended (`KIT_AGENT_MODEL` set) the next call runs nothing any more, not even with `--fresh`: It prints `Pruefung festgefahren: <Kommando> — <Fehler>` (check stuck), leaves the previous summary in place, adds only `festgefahren.ausgeloest` and ends with exit code 3. The brake is a rule of the tool, not a request to the model: The session gets no check result any more. The night runner recognises the mark in the stream and ends the session.

**What the runner does afterwards.** No rescue attempt begins for the package; it would only run against the same red check again. If there are changes in the working directory, it secures them as for every aborted package in the stash `nachtrest #<id> <lauf>`; if that fails, the night ends with a hard stop. The package gets the run status `run:aborted` with the reason `Grund: Session an einer Pruefung festgefahren` (session stuck at a check) and goes to the backlog, the other packages continue on a clean state. There is no label of its own.

**How you recognise it in the morning.** The package carries a note under the anchor `## Nachtlauf: an einer Pruefung festgefahren` (night run: stuck at a check). It names the check, the recurring error, the number of attempts, the running time up to the abort and the time limit of the session; the stash name is in the comment before it, and if there was nothing to secure, the note says so itself. In the night report the package appears as an outcome of its own: in the check report a line `festgefahren an <Prüfung> (<n> Versuche)` with running time, time limit and `gesparte Zeit (Schaetzung)` (saved time, estimate), under the chain's `### Umsetzung` in the list „festgefahren“, and the runner's closing line counts `, N festgefahren`. That separates it from the time-limit abort and from the waiting session: There the time ran out or the session waited; here it demonstrably hung at a check.

**How to continue.** Read the error in the note, find the leftovers with `git stash list` and get them back with `git stash apply stash@{<n>}`, improve the package or cut it differently and pull it back to Ready — only your new GO lets it run again. Once it is done, `git stash drop stash@{<n>}` clears the entry.

**Interactively nothing aborts.** If `KIT_AGENT_MODEL` is empty, after the last allowed and every further identical failure the run only prints `Hinweis: festgefahren an <Kommando> — <n>-mal gleich gescheitert (<Fehler>)` (hint: stuck at a command, failed the same way n times); result and exit code stay the same, you decide.

### Second mode: the night chain
<!-- de: 0fe43c79081f -->

**Since the process rework (September 2026) there have been two operating modes: the implementation night above and the night chain.** The former modes review and generation were dropped from the runner with stage 2 of the rework; the check chain behind them — marker as gate, finding classes, synthesis, routing label per stage — already went with stage 1 (implementation plan in `docs/prozess-umbau-stufe-1.md`). The chain replaces both: A business requirement goes in in the evening, and in the morning a reviewed plan, the work packages and a report are attached to it — or a finished plan goes in and comes back out as work packages (see [A finished plan as an order](/en/dokumentation#a-finished-plan-as-an-order)). What happens to the packages afterwards is decided by the **variant** (Variante) of the marked card: Under **variant A** the chain implements **nothing** — the packages stay in the backlog, the GO to Ready is still yours, and the implementation is the night after. Under **variant B** the chain moves the packages to Ready itself and implements them in the same night — your GO then already lies in the marking of the card, no longer in the individual move to Ready.

**The gesture:** the label `kit:night` on the groomed `[Requirement]` issue in the backlog — or on a finished `[Plan]` document, see [A finished plan as an order](/en/dokumentation#a-finished-plan-as-an-order). The runner **consumes it at the start** of the chain — every setting authorises exactly one chain; an abort leads to a report with a reason and a new gesture, not to a silent repetition. The label name comes from `night.kette.label` and has to be created once on the board (GitHub `gh label create`, kanban-kit `POST /api/boards/{boardId}/labels`).

**The review as a prerequisite.** The chain label alone is no longer enough: At the start of the run the marked card must additionally carry the label `review:done` — the business requirement just as much as the plan document of a plan order (Plan-Auftrag). The way there is `/issue-review <Nummer>`, which reviews the card and sets `review:done`. If it is missing, the card is skipped: It keeps its chain label, the gesture is not consumed, and it gets once the comment with the anchor `## Kette nicht gestartet: Pruefung fehlt` (chain not started: review missing), which names the reason and the way via `/issue-review`. This is a different case from the run status `Kette nicht gestartet` (chain not started) after a failed reviewer pre-flight: There the reviewers were not reachable, here the review of the requirement itself is missing — both begin with the same text, but the hint is a comment of its own with an anchor, while the pre-flight finding is in the run status. Like `kit:night` and `kit:carry-through`, `review:done` has to be created once on the board; if not a single card carries it, the runner reports this in the log.

**The variant:** a second, independent label on the same card, `kit:carry-through` (`night.kette.varianteBLabel`), marks it for variant B. It is read where `kit:night` is as well — for a plan order, that is, on the plan, not on the business requirement behind it. Unlike `kit:night` it is **not consumed** — it stays on the card, because it marks the card itself and not just the one run; a later chain for it (for example after `angehalten`) reads it again. If it is missing, variant A applies. Like `kit:night` it has to be created once on the board.

**Start:**

```bash
node .claude/kit/night.mjs --chain --dry-run   # candidates, reviewer state, budgets — starts nothing
node .claude/kit/night.mjs --chain             # real run
```

Flags: `--max <N>` counts **chains** here (default 3); `--model <id>` and `--verbose` as above — so the live history log also runs here without a flag, `--verbose no` switches it off. `--label` does not apply here — the chain reads its label from the config, and `--chain --label` is rejected. The runner rejects the switches of the dropped modes with a hint at `--chain`; an old routing label that is still set gets a log line, no effect. The `buildChecks` requirement does not apply to the chain: It builds nothing and commits nothing.

**Conditions:** A candidate carries the label, has the title `[Requirement]` (or `[Plan]`, see [A finished plan as an order](/en/dokumentation#a-finished-plan-as-an-order)), is in the **backlog** and carries no `kit:clarify` — there an answer is waiting that has to be in the plan beforehand. A card without either prefix is skipped with the reason that the marker applies to the business requirement or to the plan document. Whatever carries the label but may not run appears with a reason as `uebersprungen` in the result state, and the label stays. Before the first chain the **reviewer pre-flight** runs as before: a pre-flight session of its own checks the reviewers and the tracker in the environment of the sessions, not in the runner (see the allowlist below). Even before that, every candidate is set in the [run status](/en/dokumentation#the-run-status) to `run:running` with „Lauf angenommen um …, Vorabprüfung läuft“ (run accepted at …, pre-check running) — if the run dies in the pre-check, the card is thus not left without a trace. If the pre-flight fails, this becomes `run:aborted` with `Kette nicht gestartet um <Zeit>: <Grund>` (chain not started at a time, with reason) in the run status, every candidate keeps its label, and the run ends hard — the gesture is not consumed, because nothing ran. A comment of its own is no longer created for this. A dry run sets no status. Unlike the implementation night, the chain requires **neither a clean working tree nor an empty In progress column**: It works in a worktree of its own and runs alongside an implementation night.

**The worktree.** Every chain gets a `git worktree` under the temp directory (`kette-<repo>-<F>-<stempel>`), into which the runner mirrors the main copy's `.claude/` — kit copy, skills, settings, tokens —, without the logs. With the local tracker, the config in the worktree points to the `issues` directory of the main copy, so that the cards are created there. After the chain the worktree is removed, and worktrees left behind are cleaned up by the next start.

**The flow per stage**, each with its own session in the worktree and `KIT_AGENT_MODEL` set:

| Stage | Session | Result | when the chain ends here |
|---|---|---|---|
| plan | `/techplan #F` | a `[Plan]` document with `Fachliche Quelle: Issue #F` — if there are several, the most recent | no plan: `abgebrochen`; stop question in `## Offene Fragen`: `angehalten` — also the question about an open contract with the other repo (P14) that lists all open V numbers |
| form check | `issue check-form` in the chain's worktree, on red a correction session with exactly the violations — if a message asks for a question under `## Offene Fragen` (P14), it writes it there, never a line `Entschieden:`; if test hints remain on the plan, the runner writes them as a comment `## Testhinweise der Formpruefung` (test hints of the form check) on the plan | green form, up to `korrekturrunden` rounds per document; test hints stop nothing | still red: `abgebrochen` |
| review | `/issue-review #M` — the reviewer of the stage `plan` | marker `Plan-Review:`, findings and incorporation as comments on the plan | `kit:clarify` on the plan: `angehalten` with the question from the last comment |
| pakete | `/issues #M` | only cards with `Plan: Issue #M` count; each goes through the form check | no package and the comment `Kein Eingang für /issues` (no input for /issues) on the plan: `angehalten`; no package without it: `abgebrochen` |
| abdeckung | a reading session holds the packages against the business plan or against the plan | its text — mapping, without package, growth — in the result state and in the report | never: The coverage is information, not a gate; if it is missing, the reason is in the report |
| umsetzung (variant B only) | `/implement-next #P` per work package, word for word as in the implementation night | package moved to Ready, implemented (In review) or deferred; the session learns nothing about the chain, it sees a regular Ready package | lock `night-umsetzung.lock` already held **or** main copy unclean before the first package: stage skipped, fallback to variant A, `unvollstaendig`; hard stop: `abgebrochen`; at least one package halts on a stop question: `angehalten` (the package already carries `kit:clarify` itself, the business plan gets no second halt) |

Other new cards without the origin line appear as „nicht zuordenbar" (not assignable) in the report; if the coverage session writes to the board contrary to its instructions, the report records that too.

**A chain without an executed implementation is not called successful.** If the stage `umsetzung` skips its work — because another implementation holds the lock or the main copy is unclean before the first package —, the chain ends on the outcome `unvollstaendig`, not on `fertig`. It lies between the two: The chain ran through and did not do something that was ordered; it holds nobody up (unlike `angehalten`, no question is waiting for you) and nothing broke (unlike `abgebrochen`). On the board the event appears **yellow without an error class**, the reason is in its excerpt. The night report names under `### Umsetzung` as its first line `- ausgelassen: <grund> — die Pakete bleiben in Backlog.` (skipped, with reason — the packages stay in Backlog), and the reason with the prefix `Umsetzung ausgelassen:` (implementation skipped) is already up top under `### Ausgang`. That way you can see in the morning without looking into the log that the order "push the packages straight through" was not carried out, what prevented it and where the packages are now. Before, this case could not be told apart from a successful night. **The lock itself stays:** Two implementations in one working directory do not work, the chain does not wait for it to become free and falls back to variant A immediately as before. The only thing that has changed is what you see afterwards. You move the packages to Ready yourself in the morning.

**Without review approval, variant B falls back to variant A.** If the project carries `issueReview.requiredBeforeReady: true`, the stage `umsetzung` checks every package with the same gate as the implementation night — and packages freshly cut by `/issues` do not carry a review marker yet. Every package thereby drops out of the stage and stays commented in the backlog; for this night the chain ends as under variant A, with a reviewed plan and packages in the backlog, without implementation. The report names the reason per package.

**If the review stage aborts after the findings are already on the plan**, the chain leaves the comment `## Review unvollstaendig` (review incomplete) there with the reason for the abort and the way forward (`/issue-review #M` by hand). This gap is exactly what an abort hits most often — the incorporation comes at the end of the stage —, and without a note the document later looks like an unreviewed one: The review has been paid for, the findings are on the board, the body carries no `Plan-Review:` marker. The note does not change the outcome, it stays `abgebrochen` with its reason.

**Three outcomes**, exactly one per chain: `fertig` (plan reviewed, packages are in the backlog), `angehalten` (a question of the stop class is waiting for you) and `abgebrochen` (failed technically or on the budget, with a reason). Abort reasons are: no plan or no package created; form still violated after the correction rounds; time budget of a stage exhausted; cost budget exceeded — checked **after** the session, never in the middle, because a half-written document would be the more expensive mistake; false start of a session; a stage session that stopped with its own work still running ([The waiting session](/en/dokumentation#night-mode), the exception is the stage `abdeckung`) — it leaves its note on the document of its stage. An abort only ends this chain, the next candidate gets its turn.

**Budgets** are in `night.kette` of the `workflow.config.json`, all optional, with these starting values:

```json
{
  "night": {
    "kette": {
      "label": "kit:night",
      "varianteBLabel": "kit:carry-through",
      "planMin": 20,
      "reviewMin": 15,
      "paketeMin": 15,
      "abdeckungMin": 10,
      "umsetzungMin": 120,
      "vorbereitungMin": 120,
      "kostenUsd": 50,
      "kostenUsdB": 150,
      "korrekturrunden": 2
    }
  }
}
```

`varianteBLabel` marks the marked card for the implementation stage (variant B); `umsetzungMin` is its time budget, `kostenUsdB` its own cost cap.

The minutes apply per stage (correction rounds count against their stage), `kostenUsd` per chain across all sessions, `korrekturrunden` per document. The chain always requests the session stream: Cost and key figures are in the result state per stage (`art: "kette"`, the budgets in the run header); a session without a key figure counts 0 and increases `kostenUnbekannt`. If the block or individual fields in it are missing, the starting values apply — and that is visible: Before the first chain a log line names the affected fields with their value, and the run header of the result state carries them as `budgetAusDefault`.

**The report on the marked card.** With every outcome the chain leaves a comment with the anchor `## Nachtbericht, Kette <stempel>` (night report, chain) — on the card on which you set the label, for a plan order that is on the plan: the outcome with reason; the stages (first the order — `Plan #M (fachliche Quelle #F)` or `fachliche Anforderung #F` —, then the variant, then the plan with duration, cost, correction rounds, reviewer and marker, for an adopted plan instead `als Auftrag uebernommen, nicht neu geschrieben` (adopted as an order, not rewritten); packages with titles; cards that cannot be assigned); **all decisions of the night**, numbered consecutively — the bullet points from `## Architektonische Entscheidungen` of the plan verbatim and the `Entscheidung:` lines from the context of the packages; the rejected findings from the comment `## Einarbeitung, Runde 1`; the coverage; key figures (packages reached, duration since chain start, number of decisions and stop questions, cost out of budget, `kostenUnbekannt`); with `angehalten` the open stop question; superseded plans; under variant B the section `### Ursprungsdokumente` — which origin documents (Ursprungsdokumente) have moved to In review or, if the plan is not through, why not and which packages are missing. It ends with the sentence `Dieser Bericht ist Verlauf. Verbindlich fuer die naechste Kette wird eine Entscheidung erst als Satz im Fachplan.` (This report is history. A decision only becomes binding for the next chain as a sentence in the business plan.) — and that is exactly the morning ritual: read the report, review plan and packages, write what is to apply as a sentence into the business plan, move packages to Ready.

**Waiting reports.** If the tracker does not accept the comment, the report lies as `.claude/night-bericht-<F>-<stempel>.md` in the main copy — not a leftover in the working tree, like `night-run-*` —, and the field `bericht` of the unit names the path. At the next start of any operating mode (not in a dry run) the runner delivers waiting reports and deletes the file; if the tracker stays dead, the file stays and the run continues.

**The way back after `angehalten`.** The chain writes the one question as a comment `## Kette angehalten` (chain halted) on the **marked card** — the one on which you set the label in the evening — and sets `kit:clarify` there; plan and the packages cut up to then stay as a draft. The way forward leads via the **plan**, and the comment lists its steps: the answer as an entry under `## Architektonische Entscheidungen` of the plan, `## Offene Fragen` back to `- Keine.` (an addition after it is allowed), `/issue-review #M`, remove `kit:clarify` from the plan and from the business requirement, finally `kit:night` on the plan. The next chain then takes it as a **plan order** and continues from the stage `pakete` on. The answer does **not** belong under `## Offene Fragen`: There the chain reads it as a further open question and skips the plan with your own answer text as the exclusion reason. If instead a new plan is created (because you start again from the business plan), it is the valid one; older plans for the same business plan get the comment `Ueberholt durch Plan #M2` (superseded by plan #M2; no label, no move) and appear in the report under „Ueberholt" (superseded). The chain reads each of these comments back once; if it does not find it on the card again, it continues, but lists the plan not as superseded but with a reason under „Ueberholt, nicht bestaetigt" (superseded, not confirmed) — a report that claims an action nobody sees on the board is worse than none. `kit:clarify` is removed exclusively by the human — a run that was allowed to clear its own `kit:clarify` could release itself.

**Chain and implementation side by side.** The two operating modes mean different cards and columns: `kit:night` on the business plan in the backlog, `kit:nightrun` on the work package in Ready. A run is always exactly one operating mode (`--chain` or not), but two runs may drive at the same time — the chain in the worktree, the implementation in the main copy. One restriction applies under **variant B**: Its stage `umsetzung` builds in the main copy like the implementation night, not in the worktree, and both take the same lock `.claude/night-umsetzung.lock` for it — whoever holds it first builds. The implementation night skips its implementation when the lock is taken; the chain waits and tries again every 60 seconds, at most until its implementation budget (`night.kette.umsetzungMin`) is used up — the waiting time counts towards it, the run status stays `läuft` with the text „wartet auf die Umsetzung seit …“ (waiting for the implementation since …). If the implementation does not become free, the chain skips it and ends as `unvollstaendig`. Under variant A the restriction does not apply: The chain never builds, and the lock stays free. **The state of the main copy does not hold up the chain:** Uncommitted leftovers — for example from an implementation night running in parallel — it checks neither beforehand nor after the pre-flight session, because it does not touch the main copy at all. Only under variant B does it measure it once before the first package: If the main copy is not clean then, it skips the implementation **regularly** as with the held lock — the packages stay in the backlog, the reason with the file names is in the report, and the run ends without an error. Cleaning up and moving the packages to Ready yourself is then left to the human.

**One runner per root.** Several chains and check runs may run side by side, also on two computers on the same board. A business root — the requirement together with the plans for it — is processed by exactly one runner. It claims the root during selection: It reads the run status of the card, writes its own run status `läuft` with the lines `Lauf-ID: <host>/<pid>/<stempel>`, `Stand: <Zeit>` and `Position: <k> von <n>`, waits for a confirmation period and reads again. If the most recent run status then belongs to it, the root is its own; otherwise it leaves it out, names it in the log with the reason „bereits von einem laufenden Runner beansprucht (`<Lauf-ID>`)“ (already claimed by a running runner) and enters it in the journal as `abgegeben`, without touching the card further. So you recognise a claimed card by the run status `läuft` with a run ID. **Takeover after a crash:** A run ID counts as dead if on the same computer its process is no longer running, or, from another computer, if `Stand:` is older than position times the total budget of the kind of run plus 15 minutes. Then a later start takes over the root and names the takeover in the log; the marking stays, nobody has to mark again. **Only what belongs to a dead process is cleaned up:** Every worktree and every kit state carries a holder file `<ordner>.halter` with computer and process; a start only removes folders without a holder or with a finished process and names the removed leftovers in the log.

#### How far a chain runs: the goal
<!-- de: d1d4c37236de -->

**The goal (Ziel) says where the chain ends.** Without a further label a chain runs as far as variant and project allow. With a goal label you decide per card how far it should run this time: This business plan you only let be planned and reviewed, that one up to the packages, a third up to the implementation and a fourth up to the prepared publication. The stages are in a fixed order; a goal only determines where the chain ends, nothing can be skipped or rearranged. The goal is attached to the same card as `kit:night` — to the business requirement or to the plan document — and only works together with it: A goal without `kit:night` starts nothing and stays in place.

| Goal | last stage | what is yours in the morning |
|---|---|---|
| `goal:plan` | `review` | Read the plan, then `kit:night` on the plan. The plan is reviewed, there are no packages yet; the next chain breaks it down as a plan order. |
| `goal:packages` | `abdeckung` | Move packages to Ready. Plan, packages and their coverage against the requirement (for a plan without a requirement against the plan) are there, nothing is built. |
| `goal:implementation` | `umsetzung` | Test the packages in In review, then `push main`. The chain moved the packages to Ready itself and implemented them, as under variant B. |
| `goal:push-prepared` | `vorbereitung` | Read the preparation's message, then `push main`. In addition, version note and change note are ready as a checked commit, see [/push-main](/en/prozess#push-main). |

After the end at the goal, the last column appears verbatim in the [run status](/en/dokumentation#the-run-status), in the line `Als Nächstes:` (next) under the header `fertig bis <Ziel>` (finished up to the goal). If a human step (Menschenschritt) is waiting among the packages not yet started (`[Human]` card), it says instead `Menschenschritt #<N> erledigen, dann kit:night an #<Karte> — <K> Paket(e) hängen daran.` (complete the human step, then kit:night on the card — so many packages depend on it), and the night report lists under `### Ausgang` under `fertig` per human step the line `wartet auf Menschenschritt #<N> <Titel> — daran hängen #A, #B, …` (waits for the human step with its title — #A, #B, … depend on it) (also the packages that depend on it only indirectly via others).

**The GO is in the goal.** A goal from `umsetzung` onwards is at the same time the GO for the packages of this card, just like `kit:carry-through`. That stays valid and counts as `goal:implementation`; if both are on one card, the one reaching further applies. Without either of them the night moves no package to Ready. Not even `goal:push-prepared` releases the push: It remains your trigger phrase `push main`.

**How many models review the plan.** On a business requirement, `planreview:1` or `planreview:2` determines whether one model or two different ones review the plan; there is no more than that. Without a label the project's setting applies. You choose two when a plan seems delicate enough to you. The review stage passes the number to its session as `KIT_PLAN_REVIEWER`.

**Consumed like `kit:night`.** At the start the runner removes `kit:night`, the goal and `planreview:*` together — every setting applies to exactly one run. What was set you read afterwards in the run status in the lines `Ziel:` (goal) and `Prüfer:` (reviewers). If you restart a chain after a halt or after it stopped at the project limit, only a newly set goal applies; without one it behaves like a chain without a goal. `kit:carry-through`, by contrast, is still not consumed.

**Create the labels once per board.** `goal:plan`, `goal:packages`, `goal:implementation`, `goal:push-prepared`, `planreview:1` and `planreview:2` have to be created once per board like `kit:night` (GitHub `gh label create`, kanban-kit `POST /api/boards/{boardId}/labels`). Their names are fixed and not configurable.

**What does not fit is rejected before anything is created.** The selection rejects a card with the reason `unpassende Einstellung: …` (unsuitable setting) if it

- carries more than one `goal:*` or both `planreview:*`,
- carries `goal:plan` as a plan document (the plan already exists) — meant is `goal:plan` on a plan document,
- carries a `planreview:*` as a plan document — the number of reviewers only applies on the business requirement, `planreview:*` on a plan document is therefore rejected,
- carries `planreview:*` as a business requirement, but its plan already has a `Plan-Review:` marker.

The card then keeps all its labels and gets once the comment `## Kette nicht gestartet: unpassende Einstellung` (chain not started: unsuitable setting) with the reason and the step that makes it startable again. The gesture is not consumed.

**The project remains the upper limit.** If `night.kette.uebergaenge` blocks a transition before the goal, the chain ends there: The run status shows `run:waiting` with `wartet: Übergang <x> im Projekt nicht freigegeben — weiter mit kit:night` (waits: transition not released in the project — continue with kit:night) and names in the line `Grenze:` (limit) the last reachable stage, and the night report additionally writes under `### Ausgang` the line `an der Projektgrenze stehen geblieben, nicht am Ziel <z>` (stopped at the project limit, not at the goal). For the transition into the preparation there is the fifth switch `umsetzungVorbereitung`; without an entry it is `true`, only an explicit `false` stops the chain before the preparation.

**The preparation belongs to the whole state.** If at least one chain reaches the goal `push-vorbereitet`, the stage `vorbereitung` follows once after all chains of the run. It waits until nothing is building any more — until the implementation lock is free and no other run of this project is building —, at most `night.kette.vorbereitungMin` minutes (default 120, waiting and check run together). Then it starts `/push-main prepare` in a worktree of its own; what happens there and how `push main` takes over the state in the morning is described under [/push-main](/en/prozess#push-main). Nothing is pushed at night. The message appears as a night report of its own `## Nachtbericht, Kette <stempel> — Vorbereitung` (night report, chain — preparation) on every card that triggered the preparation — with result, checked state, the packages in the state, open checks and, if applicable, the red check together with the cards it touches —, and at the fixed place `.claude/push-vorbereitung.json`. If the deadline expires, the result is called „nicht vorbereitet“ (not prepared) with the reason.

#### A finished plan as an order
<!-- de: 677c811ec033 -->

**The gesture on the plan.** The chain accepts not only a business requirement but also a finished plan document: `kit:night` on a `[Plan]` issue in the backlog starts a **plan order**. That is the way back from a halt (see below) and at the same time the way to have a plan written by hand during the day broken down overnight.

**The four conditions** are the same as for the business requirement, only measured on the other card: The plan is in the **backlog**, carries `review:done`, carries **no** `kit:clarify` and has a valid origin. For the origin there are three cases:

- **No line `Fachliche Quelle:`** — the plan was created without a business requirement, for example from an idea via `/triage` or from a conversation. It runs as its own root, and the coverage holds the packages against the plan; the report says so.
- **The line `Fachliche Quelle: Issue #N` hits a card** — the plan runs as before, the coverage holds the packages against the requirement `#N`.
- **The line points into the void** — it names a card that cannot be found. The plan stays where it is, and the report names the line.

If one of the conditions is missing, the plan is skipped with a reason and keeps its chain label; the gesture is not consumed. This also includes an open question in the document itself: Under `## Offene Fragen` it must say `- Keine.` (an addition after it is allowed).

**What is dropped.** A plan order does **not** run the stages `plan` and `review` — the plan is written and reviewed. The run starts at the stage `pakete` (`/issues #M`) and continues as usual: coverage against the business requirement `#N` or against the plan, under variant B the implementation. The plan stays untouched: **No** second `[Plan]` document is created, its number moves unchanged into the origin line of the packages and into the report, and **no** older plan gets an `Ueberholt durch Plan` comment. In the report the plan stage therefore appears as `als Auftrag uebernommen, nicht neu geschrieben` instead of with duration and cost.

**The variant on the plan.** The chain reads `kit:carry-through` on the same card as `kit:night` — for a plan order, that is, on the plan. A `kit:carry-through` on the business requirement behind it has no effect: **Variant B** only applies if the plan itself is marked.

**Two collision rules** resolve cases where more is marked than necessary:

- **The requirement gives way to the plan.** If a business requirement `#N` carries the chain label and so does a plan created from it, the **plan** runs; the requirement goes to `uebersprungen` with a reason and keeps its label. This also applies if the plan itself is skipped — otherwise the night would plan the requirement anew while the finished plan lies next to it.
- **Of two plans of the same root, the more recent one runs.** If several marked plans carry the same business source, the one with the higher number runs; the older one goes to `uebersprungen` with a reason. Both reasons name the number of the card that runs instead.

A business plan order for one requirement and a plan order for another, by contrast, both run in the same night — the rules only apply within the same root. A card that gives way uses up no `--max` slot.

#### Allowlist for third-party reviewers
<!-- de: 324056d8f427 -->

Reviewers with `kind: "claude"` run as the reader agent `kit-pruefer` and need no permission. A reviewer with **`kind: "command"`** is no longer started through the session's Bash during the review, but by the kit: `node .claude/kit/board.mjs issue-review start` starts the third-party tool itself, at its read boundary. For this the review needs the entry for `board.mjs` in the allowlist and `node .claude/kit/board.mjs*` in `sandbox.excludedCommands` (see "Kit scripts with board access") — otherwise the tool runs in the session's sandbox, without network. The review needs no entry of its own for the tool.

The **pre-flight of the night runner**, by contrast, still checks the reviewers by starting the third-party command directly, and therefore still needs the entry for the tool. If it is missing, a permission prompt appears at night that nobody answers. That is not an error with a log line: **The session hangs until the timeout.** Enter both before the first review run starts:

```json
{
  "permissions": {
    "allow": [
      "Bash(node .claude/kit/board.mjs:*)",
      "Bash(codex:*)"
    ]
  }
}
```

The entry names the **tool**, not the full command line — for the same reason as with the buildChecks above (prefix matching). Whoever has configured several foreign CLIs enters each one individually. A setup with exclusively `kind: "claude"` reviewers does not need the tool entry.

### The run status
<!-- de: c2eaf1aa265a -->

**The state of a run is on the board, not in the process.** Until then it lived in the running runner: If the process died, the knowledge died with it, because the night report is only written at the exit, and a crash is not an exit. That is why every card of a chain or implementation night carries its own state, visible without a look into the log.

**Three labels and a comment.** The card carries at most one of the three labels `run:running`, `run:aborted` and `run:waiting`, plus exactly one comment `## Laufstand` (run status), which is replaced at every change. It names the last step begun and the last step completed, each with a point in time. The comment is a board, not a history; the night report remains the history. Whoever wants to know *what* happened in a night reads the report; whoever wants to know *where* a card stands now reads the run status.

**Abort and halt can be told apart.** `run:aborted` means: technically aborted, repeating is enough. `run:waiting` says verbatim in the run status what the card is waiting for, in one of three forms:

- `wartet: Übergang <x> im Projekt nicht freigegeben — weiter mit kit:night` (waits: transition not released in the project — continue with kit:night) — the project has not released the transition (see below);
- `wartet: Karte ohne Freigabe zur Umsetzung` (waits: card without release for implementation) — the transition into the implementation is released, but the card carries no `kit:carry-through`;
- „Halt: Frage wartet auf den Menschen — siehe `## Kette angehalten`“ (halt: question waits for the human — see `## Kette angehalten`) — a halt on the content. The path for it via `kit:clarify` and the comment `## Kette angehalten` stays as it is.

**Goal, number of reviewers and limit.** If the card carried a goal or a `planreview:*` at the start, their values are in every version below the header, because the labels themselves are used up by then: `Ziel: <plan|pakete|umsetzung|push-vorbereitet>` (goal), `Prüfer: <1|2>` (reviewers) and, if the project blocks a transition before the goal, `Grenze: <letzte erreichbare Stufe>` (limit: last reachable stage). If the chain ends at its goal, the header reads `fertig bis <Ziel>` (finished up to goal), and below it is the line `Als Nächstes:` (next) with the step that now belongs to you (see [How far a chain runs](/en/dokumentation#how-far-a-chain-runs-the-goal)). Without a goal and without `planreview:*` the run status looks as it did before.

**One log per step.** Every step of a card — a stage of the chain, an implementation round, a check of the check run — additionally writes its runner lines and the output of its session to `.claude/protokolle/<lauf>/<karte>-<stufe>.log`, a second attempt to `<karte>-<stufe>-v2.log`. The run status names the path in the line `Protokoll:` (log). That way the log of a step stands apart from other runs running at the same time. The daily log `.claude/night-run-<datum>.log` remains and carries the run ID in every line in the brackets of the timestamp: `[<Zeitpunkt> <lauf>]`.

**Repeat with the same gesture.** There is no command of its own for a single step. `kit:night` on the card starts the chain at the first stage without a result: What is already there — plan, review note, packages, coverage, implemented packages in In review — counts as done and is not created twice, even if the previous run then failed at the clock or at the board. An existing plan counts as a result as long as it is not in Done; a fresh plan is only created once the old one is in Done. Whoever wants a new plan closes the old plan.

**Release transitions individually.** Which transitions of the chain may follow automatically is set by the project in `night.kette.uebergaenge`, with the four switches `planReview`, `reviewPakete`, `paketeAbdeckung` and `abdeckungUmsetzung`. The kit's default releases the first three. For `abdeckungUmsetzung` there is no default: Without an entry the behaviour from before the setting applies, a chain with `kit:carry-through` implements after the coverage, one without ends there `fertig` (finished). `abdeckungUmsetzung` only works together with `kit:carry-through` on the card: The GO can never be given project-wide, it stays on the individual card. An explicit `false` stops a chain with `kit:carry-through` before the implementation, a `true` lets a chain without the label end with `wartet: Karte ohne Freigabe zur Umsetzung`. A blocked transition ends with `run:waiting` in the first form above.

**One attempt, only for the living run.** An automatic attempt only exists for environment errors, as long as the run is alive: The board was not reachable, or a session did not come about. Then the run tries the step again exactly once after a pause, and the run status notes „2. Versuch“ (2nd attempt). If that fails too, the run halts visibly. A session that came about and ended without a result, at the time limit or without proof is a package error and gets no attempt. A dead run is not repeated: It cannot repeat itself, and a restart from outside would be a run without a gesture. After the deadline its cards show „nicht beendet“ (not finished), and it continues with `kit:night`.

#### The watchdog
<!-- de: b5355a8d7893 -->

Who notices a run that died without saying goodbye, and when it counts as silent.

At the start of the run the runner starts a detached watchdog (Wächter), which checks every minute. For this the run writes a sign of life to its pulse file `.claude/lauf/<lauf>.puls` every minute. It only counts as silent once this sign of life is older than the deadline `night.stand.fristMin` (default 10 minutes) **and** the runner process no longer exists. A run that is alive therefore never counts as silent, even if a step writes no pulse for a long time. If the run is silent, the watchdog sets every card still on `laeuft` to `run:aborted` with `nicht beendet, letztes Lebenszeichen <zeit>, Frist <n> min` (not finished, last sign of life, deadline) and ends. There is no restart. If the watchdog died with the computer, the next run makes up for it at its start.

#### The journal
<!-- de: 5e01a22f58d6 -->

What a run records along the way so that its state survives the process.

Every run writes every state, before it hands it to the board, as a line into its journal `.claude/lauf/<lauf>.jsonl`. If the board does not accept a state, the line stays open, and on the board the last visible state applies. Open lines are filled in as soon as the board answers again: in the same run at the next state, otherwise at the start of the next run. The log names every catch-up with „Laufstand nachgetragen“ (run status filled in). The journal is the memory of the run; you only have to read it if the board remained owing a state.

**Partial cut.** If the stage `pakete` dies in the middle of the cut, the card carries „pakete begonnen für #M“ (packages begun for #M) without „pakete fertig für #M“ (packages finished for #M). The next run then does not repeat the stage, but shows `run:aborted` with „Teilschnitt vorhanden (#a, #b) — eine Wiederholung legte doppelt an; Teilschnitt am Board aufräumen, dann erneut kit:night“ (partial cut present — a repetition would create duplicates; clean up the partial cut on the board, then kit:night again). Cleaning up means: close or delete the named packages on the board, then put `kit:night` on the card again. Packages without any run status entry, for example created by hand, are not a partial cut.

**Leftovers in the stash.** If a failed package leaves changes in the working tree and the salvage does not succeed, they lie in the stash `nachtrest #<id> <lauf>`, and the run status of the package names it. You get them back with `git stash list` and `git stash apply stash@{<n>}`; once the package is done, `git stash drop stash@{<n>}` clears the entry.

#### The evidence cases
<!-- de: 8276a1cc01d4 -->

For every evidence case (Belegfall) of the business requirement: what state the card shows on the board afterwards and with which gesture it continues.

| Case | Card state afterwards | Way forward |
|---|---|---|
| Without a trace: the run dies in the pre-check | first `run:running` with „Lauf angenommen um …, Vorabprüfung läuft“ (run accepted at …, pre-check running), after the deadline `run:aborted` with `nicht beendet, letztes Lebenszeichen <zeit>, Frist <n> min` | read the log, fix the cause, then put `kit:night` on the card again |
| Aborted although finished: the review stage exceeds the time budget, the review note is already in the plan | `run:aborted` with the reason; the run status names the last completed step | put `kit:night` on the card again: The stage counts as found, the chain starts at the first stage without a result |
| Outcome unknown: the board is briefly unreachable | if the attempt after the pause succeeds, the state of the card with „2. Versuch“; if it fails, `run:aborted` with `abgebrochen, Umgebungsfehler um <zeit>: …` (aborted, environment error at), the remaining cards of the run `run:waiting` with `nicht begonnen: der Lauf hielt um <zeit> an — …` (not begun: the run halted at) | after a successful attempt nothing; otherwise, once the board answers again, start the run again or put `kit:night` on the chain again |
| A package halts the night: session without commit, time limit or waiting session | only this package `run:aborted` with reason, it goes to the backlog; dependent packages `run:waiting` with „hängt an #N (abgebrochen in diesem Lauf)“ (depends on #N, aborted in this run); leftovers in the stash `nachtrest #<id> <lauf>`; the remaining packages keep running | read the reason, fetch leftovers from the stash if needed, improve the package and pull it back to Ready |
| A package gets stuck: the same check fails `night.festgefahrenNach` times the same way, long before the time limit | only this package `run:aborted` with `Grund: Session an einer Pruefung festgefahren`, note `## Nachtlauf: an einer Pruefung festgefahren` with check, error and attempts, it goes to the backlog; leftovers in the stash `nachtrest #<id> <lauf>`; in the night report the outcome of its own `festgefahren`, not time limit or waiting session; the remaining packages keep running | read the error in the note, fetch leftovers from the stash if needed, improve the package and pull it back to Ready |
| Interleaved logs: chain and check run run at the same time | every run status names in the line `Protokoll:` the file `.claude/protokolle/<lauf>/<karte>-<stufe>.log` of its step | open the named file; in the daily log the run ID in `[<Zeitpunkt> <lauf>]` separates the runs |

### Running with a local model
<!-- de: f9e64ca25f4d -->

> **Untested.** This section describes a path that follows from the architecture of the runner and should work without any change to the kit — but it has **not been tried in practice** here. Neither was LiteLLM set up nor was a run made against a local model. Take it as a reasoned proposal, not as a report of experience.

The idea: have simple issues built at night by a local model, while review and demanding issues keep running via Anthropic.

**Why a proxy is needed.** Claude Code speaks exclusively the Anthropic Messages API; local runners such as Ollama speak the OpenAI format. A translator belongs in between — [LiteLLM](https://docs.litellm.ai/) is the usual choice. Two things are differently reliable here: That Claude Code can point to an endpoint of its own via `ANTHROPIC_BASE_URL` is [officially documented](https://code.claude.com/docs/en/llm-gateway) (gateway pattern), as is `--model` per call. Operating a local model behind this endpoint, by contrast, is community terrain and not supported by Anthropic.

A minimal LiteLLM configuration:

```yaml
model_list:
  - model_name: lokal-qwen
    litellm_params:
      model: ollama/qwen2.5-coder:14b
      api_base: http://localhost:11434
```

**Mixed operation: put the variable in front of the command, do not export it.**

```bash
ANTHROPIC_BASE_URL=http://localhost:4000 \
  node .claude/kit/night.mjs --model lokal-qwen --label kit:lokal --max 3
```

`ANTHROPIC_BASE_URL` acts globally for a process, `--model`, by contrast, per call — that sounds like an obstacle to mixed operation, but here it is not one. The runner starts every session as a child process of its own and passes `process.env` through. If you put the variable **in front of the night run command**, it applies exclusively to its sessions; an interactive Claude Code session running in parallel stays untouched. An `export` in the `.zshrc` would break exactly that — then your interactive work would also run via the proxy.

**Split via labels.** The [routing label](/en/dokumentation#night-mode) is enough for the separation, no new flag is needed: Give the simple issues a label of their own (say `kit:lokal`) and run two runs one after the other — one with the local model and this label, a regular one with `kit:nightrun`.

**The review stays untouched.** `/kit-review` uses the `reviewModel` from the `workflow.config.json` and is completely decoupled from the night run model. What a local model built at night is still examined by the strong model in the morning.

**Where the limits are — unvarnished.** A night session must be able to do more than write code: It must call tools reliably (board operations via `board.mjs`, file edits, Git), sustain a multi-stage chain and commit cleanly at the end. In our experience small models break exactly at that, not at the programming itself. Projects with sharp gates — mutation tests, coverage ratchets, multi-stage build chains — are realistically out of reach for a small local model. The sensible area of use is changes without a test obligation: documentation, text corrections, configuration values, small mechanical adjustments.

**What protects you when it goes wrong.** Nothing broken gets into the repo: The [salvage pre-check](/en/dokumentation#night-mode) runs the mandatory checks itself before anything is committed at all, after red checks the leftovers of a package go into the stash instead of into the next commit, and the leftover guard ends the run as soon as a successful round leaves uncommitted leftovers. A failed local run costs you electricity and time, not the code base.

**Getting started.** Begin with a single documentation issue:

```bash
ANTHROPIC_BASE_URL=http://localhost:4000 \
  node .claude/kit/night.mjs --model lokal-qwen --label kit:lokal --max 1
```

The progress log shows you every tool call of the session without further ado. From it you see within minutes whether the model handles the board operations cleanly — that is the quickest feasibility test, and it decides the question before you invest a whole night.

**Morning ritual:** Read the log (`.claude/night-run-<datum>.log`: issue, duration, result, commit per round) — the same state is additionally available for evaluation as `.claude/night-run-<datum>-<uhrzeit>.json` next to it —, then as always `/kit-review` → your own test → `push main`. Deferred issues are in the backlog with a comment.

## Effort of the process
<!-- de: 0536099b68ee -->

Since issue #748/#749 every result state of a night session (`.claude/night-run-<datum>-<uhrzeit>.json`) already carries duration, cost, quantity, model and check status. `node .claude/kit/effort.mjs evaluate` reads the most recent of them, aggregates time, checks, scope, cost and the effort per task level and writes from this `.claude/aufwand.md` (for humans) and `.claude/aufwand.json` (for the two output places below). The tool only says what stands out — never what to do, and it stays silent when nothing stands out.

**Where the finding appears.** In exactly two places, and both together: as a closing block in the run log `.claude/night-run-<datum>.log`, which every unattended run writes itself at the end, and in the skill `/push-main`, which runs `node .claude/kit/effort.mjs finding` before the first step and shows the output. Both are necessary: If night mode starts without any human involvement in future, perhaps nobody reads the run report any more; publishing, by contrast, remains a step that a human triggers themselves.

**By task level.** The report carries a section of its own that shows one line per pair of task level and thoroughness (`effort`): units, duration, cost, red check states and rework, every number with the number of runs that carry it. That way a level can be compared before and after a change of its thoroughness, without running a comparison run of its own for it. The same block is in `.claude/aufwand.json` as `jeStufe`.

**What counts as rework there.** A unit whose final status is not `in_review` **or** whose check status was red. Counted are exclusively work packages with a started session — recognisable by `art: "implementierung"` and a field `endStatus`. Units without a session (skipped, left lying, deferred) and the units of the night chain carry neither final status nor check status; counted as rework, they would all be one, and the rate would only measure how often a gate held. The costs of this table are the amounts reported per unit, not the calculated division from the section "Kosten" (cost). A line "ohne Stufe" (without level) is at the end: It collects states before issue #711 and cards whose model did not come via a level.

**Distribution.** The sums say how much time passed in total, not how it is distributed across the packages. The section "Verteilung" (distribution) therefore shows per kind of run (`implementierung`, `kette`, `pruefung`) a table with one line per task level ("ohne Stufe" at the end): for duration, thinking, tool work, rest and check runs per package the median and the 90th percentile, each with the number of values and of runs behind it. The calculation is nearest-rank, so every value output is one that was actually measured. The dominant kind of time is the largest of the three medians thinking, tool and rest; if one of them is missing, "nicht bestimmbar" (not determinable) stands there together with the kind of time that is not measured. Check runs per package add up `prueflaeufe.arbeit.anzahl` and `prueflaeufe.abschluss.anzahl`; a unit without this information does not count as 0. Added to that is the share of time-limit aborts, counted as for the target mark. The **chain stage** (plan, review, packages, coverage, implementation) is not recorded on the unit and therefore cannot be shown separately; the chain units are together under the kind of run `kette`. The same block is in `.claude/aufwand.json` as `verteilung`.

**The target mark of the implementation.** A report block of its own, "Zielmarke der Umsetzung" (target mark of the implementation), shows how many implementations exceed the target mark: of how many measured implementations how many lie above it, by how much on average and at the maximum. The average is taken over the **exceedances** and not over all attempts — whoever averaged in the ones that were kept would get a number that falls with every further good package without a single bad one having got better. Counting is per **attempt**, not per package: A package in two attempts counts twice, and it is precisely the second attempt that is expensive. The mark comes from the **run header** of the respective state (`zielUmsetzungMin`) and not from today's configuration; states without this information — every one before v3.3 — stand separately and go into none of these numbers. The same block is in `.claude/aufwand.json` as `zielmarke`. It says what was counted and nothing about why: No cause follows from an exceeded mark.

**Time-limit aborts stand separately and go into no average.** An implementation whose unit carries `zeitlimitBeendet` (see [The time-limit abort](/en/dokumentation#the-time-limit-abort)) counts solely as a time-limit abort — in no attempt, in no series, in no average. Its completion time is unknown: The session was aborted at the clock, and how long it would still have needed nobody knows. Kept as an exceedance it would shift the average by a value that no measurement carries — reporting an estimate as a measurement would be wrong. The report therefore names their number in a sentence of its own. If there is no basis at all, "nicht gemessen" (not measured) stands there and no 0.

**Lookups.** A report block of its own, "Auskünfte" (lookups), shows per implementation unit the time spent on fetching and taking apart board lookups, in minutes and with the number of calls — measured by the night runner as the span from the tool call to its result for every query to the board and every processing of its answer; thinking time does not count. Below it is the average over the implementation units together with the number of units that carry it. An implementation unit is one whose session started with `/implement-next`, `/implement-ready`, `/implement-test` or `/implement-done`; all others (chain, creating cards, check runs) stand in a line of their own "keine Umsetzung" (no implementation) and do not go into the average. A unit without measurement (`auskunft: null`) and one from a state before issue #1026 without the field stand as "nicht gemessen" and never go into the average as 0. The same block is in `.claude/aufwand.json` as `auskuenfte`.

**Measuring transcripts afterwards.** `node .claude/kit/effort.mjs info <transkript…>` measures Claude Code transcripts (`*.jsonl` under `~/.claude/projects/<projekt>/`) with **the same** rule as the night runner — that way a reference value can be determined from a run that lay before the measurement. The output names minutes and calls per file and in total, with several files also the average per file. A file that cannot be read or one without timestamps is reported explicitly and not counted as 0; the command then ends with exit 1.

**No gate.** The finding holds up neither a run nor `/push-main`. A failure of the evaluation is a log line, not an abort.

**Changing the number of runs and the thresholds.** Both are in the optional block `aufwand` of the `.claude/workflow.config.json` (see [All settings](/en/einstellungen)) — if the block or a field in it is missing, the built-in defaults apply, so an existing project gets the evaluation without further setup. `aufwand.laeufe` determines how many of the most recent result states are included; `aufwand.schwellen` carries the four limit values (`pruefungAnteil`, `eingrenzungOhneWirkung`, `werkzeugAnteil`, `schreibkostenAnteil`) from which a finding appears. In the settings interface the block is under the topic "Nachtbetrieb" (night mode).

## Consumption of interactive sessions
<!-- de: 2f6c9a20dd00 -->

The night run reports its consumption itself (see above). For the sessions in which you sit at the computer yourself, the **session reporter** (Sitzungs-Melder) does that: `board.mjs session report` reads the session transcript of Claude Code, sums input, output and cache tokens and delivers them via the same route as the runner — `POST /api/kanban/night-runs`, only with `kind`/`mode` **INTERACTIVE** and the start time of the session as the key. It takes the path of the transcript from `--transcript` or as `transcript_path` from the body that a Claude Code hook passes in on stdin.

**Who calls it.** Nobody by hand. With a project-local installation the installer enters two entries into the `hooks` block of `.claude/settings.json`, and Claude Code calls the reporter by itself:

| Event | Call | Effect |
|---|---|---|
| `Stop` | `node .claude/kit/board.mjs session report` | ongoing, `complete: false`, throttled to one report per five minutes |
| `SessionEnd` | `node .claude/kit/board.mjs session report --complete` | final, `complete: true` — afterwards the waypoint file is empty |

The entries are in the **project** file and not in the user settings under `~/.claude`: The target project comes from the binding of the token in the working directory, and a user-wide setting would report from every directory — including every foreign one.

The installer **supplements** the file, it does not replace it: `env`, `sandbox`, `permissions` and foreign hook entries stay in place, and a second run changes nothing more. If `settings.json` is not a readable JSON object, it does not touch it and names the two entries to add by hand — what it cannot read, it cannot preserve either.

**If the reporter stays silent** although token and tracker are right, a look at the sandbox is worthwhile: If it runs in the project, the call needs a network release — `node .claude/kit/board.mjs*` in `sandbox.excludedCommands` of the same file (see "Kit-Skripte mit Board-Zugriff", kit scripts with board access). Without it the reporter gets as far as the delivery and fails there with `nicht-eingeliefert` (not delivered); that does not disturb the session, only the consumption is missing. `sandbox.network.excludedCommands` is not a key of Claude Code and is silently ignored.

**Switching off.** Delete the respective entry from the `hooks` block in `.claude/settings.json`: both for completely, only the one under `Stop` for "only at the end of the session". The file is not versioned, so the decision applies to your machine. A later installer run enters the deleted entry again — whoever wants to silence the reporter permanently takes away its precondition instead of the hook: Without a project-bound token in the working directory and with every `issueTracker` except `toolbox` it stays silent by itself and says so too (`kein-token`, `kein-board` — no token, no board).

**The known gap: worktrees.** An interactive session in a `git worktree` does **not** report. A freshly created worktree carries only the versioned files, and `.claude/*` is excluded via `.gitignore`: Missing there are `settings.json` — that is, the hook — and `.claude/kit/` — that is, the reporter. For the worktrees of the night chain this has no consequences, because `KIT_AGENT_MODEL` is set there and the reporter would stay silent anyway; the runner reports these sessions itself. Whoever, by contrast, creates a worktree by hand and works in it will not find this consumption in the control centre (Leitstand). Remedy by hand: copy `.claude/settings.json` and `.claude/kit/` over from the main working tree.

**Assignment to cards.** `issue move` notes every move to *In progress* and *In review* with a timestamp in `.claude/wegmarken.tsv` (waypoints). The reporter divides the session sum among the cards by these timestamps. What lies between no two waypoints it reports as a rest without a card number — it is in the session sum, but in no card. The same applies to periods in which **two cards were open at the same time**: If two sessions run in the same directory, their waypoints mix in one file, and an assignment would be guessed. It is omitted.

**When it reports.** At the end of the session with `complete: true` — afterwards the waypoint file is empty. In between ongoing with `complete: false`, throttled to at most one report per five minutes: Reporting only at the end would lose every crashed session, unthrottled every move would create an HTTP call.

**When it does not report.** With `KIT_AGENT_MODEL` set the reporter stays completely silent — this session was started by the night runner and it already reports it itself; a second path would count it twice. Without a project-bound access token in the working directory it reports nothing either; the target project comes from the binding of the token and not from the call. Both end without an error: The reporter is bookkeeping, not a condition, and must never disturb a session. For the same reason a failed delivery has no consequences — the waypoints stay in place, the next attempt still sees the same stretch.

**The price table needs maintenance.** The session transcript carries no dollar amount, only token quantities. The amount is therefore calculated, with the rates from **`kit/preise.mjs`** (in the installed project: `.claude/kit/preise.mjs`). The file carries in its header the date of its state and the source the numbers come from. **It goes out of date by itself:** A new model is missing from it, and then the reporter reports **no** amount for the affected sum — never a 0 and never an estimated one. The token quantities are there anyway. Whoever sees a missing amount in the control centre adds the model to `MODELL_STUFEN` and sets `PREISE_STAND` anew; the levels themselves only change when Anthropic changes the prices. If the file is missing entirely — for example next to an individually copied `board.mjs` —, the reporter keeps running, just without an amount.

## Guardrails instead of prompts
<!-- de: b24d15be7ea4 -->

A language model reproduces the most frequent pattern of its training corpus, not the most current one. An API deprecated months ago still stands in millions of lines of old code as the normal way; the deprecation notice is an edge case against this mass. The result is an error in thinking, materialised many times over: the same outdated or deprecated idiom, rolled out across all call sites — and often only visible late in an external analysis.

For such recurring, class-wide errors the same principle applies as with the coverage gate: a **hard guardrail that fails in the mandatory gate**, instead of a prompt or a document that asks. A prompt to discipline is skipped under time pressure; a lint or compiler rule in the `buildChecks`, which agent and CI run through anyway, cannot commit green in the first place. Concretely:

- **The guardrail derives from existing annotations** instead of keeping a hand-maintained blacklist that itself goes out of date: `@typescript-eslint/no-deprecated` reads JSDoc `@deprecated`, Java reports every deprecated API as a build error with `-Xlint:deprecation` and `-Werror`. The analyzer scales with the ecosystem, the list only with the discipline of its upkeep.
- **The gate is the main catch, SonarQube or similar the safety net.** The round trip via main catches reliably, but late — the error is then already on main. The check belongs at the front, in `/local-check` and `/implement-ready`, where the agent runs it before completion.
- **The concrete rule catalogue lives in the respective project** (`buildChecks` in the config, lint setup in the repo), not in the kit. The kit only anchors the transferable principle.

**The yardstick behind it: "rule in the text or rule in the tool".** It is in `CLAUDE-workflow.md` and applies to every instruction supplied: An **operating instruction** (Bedienvorgabe) — whether it is followed can be read from output or result, a tool could carry it out in the reader's place — belongs in the tool; a **judgement rule** (Urteilsregel), which demands a decision in the individual case, stays in the text. Mixed rules are taken apart, not rounded. Which rule of `/local-check` has moved where according to this yardstick is listed in [Rules in the tool](/en/regeln-im-werkzeug) — line by line, with kind, degree of transfer (Überführungsgrad) and new place.

**The borderline case: when no guardrail can be had.** Some things cannot be measured — whether a model believed a statement instead of looking it up, for instance. There the declared self-report takes the place of the gate: The fixed answer form „Mitteilung übernommen, ungeprüft — …“ (statement adopted, unchecked) from [Statements: believe instead of checking](/en/prozess#statements-believe-instead-of-checking) forces nothing, but makes every violation a visible contradiction. Visible contradiction instead of a gate — the same principle, only with the weaker means, because the stronger one does not exist here.

## What is deliberately not in the kit
<!-- de: aca615ac0b04 -->

**Security gates belong in the CI, not in a skill.** gitleaks finds secrets, Semgrep or SpotBugs find SQL concatenation and missing input validation. A deterministic tool shares no blind spot with any language model. A red build blocks the push mechanically, more reliably than any model. The review skill complements these tools, it does not replace them.

**No multi-tool adapter.** The concept is transferable, the format is not. Codex reads `AGENTS.md`, Cursor `.cursor/rules`. If you want to use several engines, you need the skill library in several formats in parallel in the repo. That is feasible, but not part of this kit.

## Names for those moving up from version 4
<!-- de: 1d4adf73a086 -->

**Skills.** An old name is rejected, and the message names the new one.

| Old | New |
|-----|-----|
| `/kontext`, `/context` | `/session-start` |
| `/fachplan` | `/requirement` |
| `/review` | `/kit-review` |
| `/plan` (signpost) | dropped, the planning step is `/techplan` |

**Command files.**

| Old | New |
|-----|-----|
| `kit/befunde.mjs` | `kit/findings.mjs` |
| `kit/aufwand.mjs` | `kit/effort.mjs` |
| `kit/wirksamkeit.mjs` | `kit/effectiveness.mjs` |
| `einstellungen.mjs` | `settings.mjs` |

**Commands.**

| Command | Old | New |
|----------|-----|-----|
| `kit/board.mjs` | `kontext`, `sitzung` | `context`, `session` |
| `kit/board.mjs` | `issue melden`, `nightrun melden`, `sitzung melden` | `issue report`, `nightrun report`, `session report` |
| `kit/board.mjs` | `issue stand`, `issue auftrag`, `issue ursprung` | `issue run-state`, `issue brief`, `issue origin` |
| `kit/board.mjs` | `issue check-geschuetzt`, `issue vorgeschichte`, `issue fragen` | `issue check-protected`, `issue history`, `issue questions` |
| `kit/board.mjs` | `issue-review pruefauftrag` | `issue-review review-brief` |
| `kit/board.mjs` | `hook bash-pruefen` | `hook bash-check` |
| `kit/board.mjs` | `code schutz` with `einrichten`, `aussetzen`, `wiederherstellen`, `nachpruefen` | `code protection` with `setup`, `suspend`, `restore`, `verify` |
| `kit/checks.mjs` | `bereiche` | `areas` |
| `kit/findings.mjs` | `arten`, `pruefen`, `buchen`, `vorschlag`, `auswerten`, `befund` | `kinds`, `check`, `record`, `suggest`, `evaluate`, `finding` |
| `kit/effort.mjs` | `auswerten`, `befund`, `auskunft` | `evaluate`, `finding`, `info` |
| `kit/effectiveness.mjs` | `auswerten`, `befund`, `kandidaten` | `evaluate`, `finding`, `candidates` |
| `kit/worktree.mjs` | `anlegen`, `entfernen`, `im`, `nachziehen-pruefen`, `rueckweg` | `create`, `remove`, `in`, `catch-up-check`, `return` |
| `kit/worktree.mjs` | `vorbereitung-festhalten`, `vorbereitung-pruefen` | `record-preparation`, `check-preparation` |

**Options.**

| Command | Old | New |
|----------|-----|-----|
| `kit/board.mjs` | `--teil`, `--zustand`, `--spalte`, `--pfad`, `--zweig`, `--nur-pfad` | `--part`, `--state`, `--column`, `--path`, `--branch`, `--path-only` |
| `kit/board.mjs` | `--stufe`, `--rolle`, `--datei`, `--material-datei`, `--auftrag`, `--ausgabe`, `--protokoll` | `--stage`, `--role`, `--file`, `--material-file`, `--brief`, `--output`, `--transcript` |
| `kit/board.mjs` | `--begriffe`, `--dateien`, `--ohne`, `--vergleich` | `--terms`, `--files`, `--without`, `--compare` |
| `kit/checks.mjs` | `--stufe`, `--bereich`, `--abschluss`, `--frisch`, `--wiederholen` | `--stage`, `--area`, `--finish`, `--fresh`, `--retry` |
| `kit/night.mjs` | `--kette`, `--pruefen`, `--waechter` | `--chain`, `--check`, `--watcher` |
| `kit/findings.mjs` | `--datei`, `--stufe`, `--karte`, `--art`, `--abgelehnt` | `--file`, `--stage`, `--card`, `--kind`, `--rejected` |
| `kit/effort.mjs` | `--laeufe` | `--runs` |
| `kit/effectiveness.mjs` | `--fenster` | `--window` |
| `kit/worktree.mjs` | `--praefix`, `--ergebnis`, `--offen`, `--verwerfen` | `--prefix`, `--result`, `--open`, `--discard` |
| `install.mjs` | `--sprache`, `--schutz` | `--language`, `--protection` |

**Choice values.**

| Place | Old | New |
|--------|-----|-----|
| `kit/board.mjs --art` | `fachlich`, `idee`, `mensch` | `requirement`, `idea`, `human` |
| `kit/board.mjs --state` | `laeuft`, `abgebrochen`, `wartet`, `fertig` | `running`, `aborted`, `waiting`, `done` |
| `kit/board.mjs --stage` | `fachlich` | `requirement` |
| `kit/checks.mjs --stage` | `paket` | `package` |
| `kit/findings.mjs --stage` | `fachlich` | `requirement` |
| `kit/worktree.mjs --result` | `gruen`, `gruen-offen`, `rot` | `green`, `green-open`, `red` |
| `kit/worktree.mjs --fetch` | `fehlgeschlagen` | `failed` |
| `/push-main` | `vorbereiten`, `notfall` | `prepare`, `emergency` |

**Title prefixes.** New cards carry only the English ones; the kit still recognises the German ones on open cards.

| Old | New |
|-----|-----|
| `[Fachlich]` | `[Requirement]` |
| `[Idee]` | `[Idea]` |
| `[Mensch]` | `[Human]` |

**Labels.** The kit sets only the English ones; it still recognises the German ones on open cards and removes them wherever it would remove the English one.

| Old | New |
|-----|-----|
| `kit:klaeren` | `kit:clarify` |
| `kit:geschuetzt` | `kit:protected` |
| `kit:durchziehen` | `kit:carry-through` |
| `kit:pruefen` | `kit:check` |
| `lauf:laeuft` | `run:running` |
| `lauf:abgebrochen` | `run:aborted` |
| `lauf:wartet` | `run:waiting` |
| `review:fertig` | `review:done` |
| `ziel:plan` | `goal:plan` |
| `ziel:pakete` | `goal:packages` |
| `ziel:umsetzung` | `goal:implementation` |
| `ziel:push-vorbereitet` | `goal:push-prepared` |

## License
<!-- de: 574befe785b2 -->

MIT. The kit is free to use, modify and redistribute.
