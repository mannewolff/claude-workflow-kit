# Settings
<!-- de: a37c652236f7 -->

The kit reads its settings (Einstellungen) from `.claude/workflow.config.json` in the project. The file belongs in the repository and applies to the whole team. Next to it, `.claude/workflow.config.local.json` may exist, which does not belong in the repository: it carries personal deviations (persönliche Abweichungen), such as a different review model, your own trigger phrases or the path to a token. Whatever applies only team-wide, the kit ignores in the personal file.

Instead of editing the files by hand, you can maintain the settings through a local interface. It is a single file, [settings.mjs](https://docs.mwolff.org/settings.mjs), and works across all projects under one folder:

```bash
node settings.mjs ~/ki-projects
```

The address it shows at startup carries an access token and can only be reached from this machine. The interface groups the settings into the parts Reviewers, Pairings, Review stages, Findings, Check commands and areas, Night chain, Workload, Effectiveness, Task tiers and simple groups. For every setting that may deviate personally, it shows the team value, the personal deviation and the value that applies. It rejects invalid values with a reason before saving, and only the changed value is saved.

## All settings
<!-- de: 07edcf55594f -->

<!-- einstellungen:start -->
_This section is generated from `templates/workflow.config.schema.json` by `node tools/config-referenz.mjs`; changes belong in the schema, not here._

- `language` — Language of the kit in this project: de (German) or en (English). Valid: `de`, `en`. Default: `de`.

- `codeHost` — Where the code lives (push, pull requests). Valid: `github`, `gitlab`, `local`. Default: `github`.

- `issueTracker` — Where the issues are managed. Valid: `github`, `gitlab`, `local`, `toolbox`. Default: `github`.

- `provider` — Is carried over to `codeHost` and `issueTracker` on loading; do not set it in a new config. Valid: `github`, `gitlab`, `local`. No default.

- `buildChecks` — Commands that checks.mjs run executes at the completion check of a package and at push main (build, tests): first those marked "vorab" one after another, then those marked "gleichzeitig" in parallel, then the rest one after another in config order. Default: `[]`.
- `buildChecks[]` — A check command, as a command string or as an object with `cmd` and the fields below. No default.
- `buildChecks[].cmd` — The command line as it would appear in the string form. No default.
- `buildChecks[].areas` — Area names from `checkAreas`; the check runs when one of them is touched. No default.
- `buildChecks[].always` — true = always runs, by decision, regardless of the touched areas. No default.
- `buildChecks[].stage` — When the check is due: "paket" at the completion of a work package, "push" before publishing, "merge" before the release. Valid: `paket`, `push`, `merge`. Default: `paket`.
- `buildChecks[].notAtCompletion` — Why this check need not carry the completion of a single work package: "zusammenspiel" = it checks how several parts work together, "volleTestmenge" = it draws its finding from the complete test set. Valid: `zusammenspiel`, `volleTestmenge`. Default: not set, the check also runs at completion.
- `buildChecks[].completionAreas` — Area names from checkAreas whose direct touch makes a check with "nichtBeimAbschluss" run at the completion of a work package too. Default: not set, the check is skipped at completion.
- `buildChecks[].quality` — Marks this check as a quality measurement: it measures how many deliberately planted faults the tests notice, and a value below the threshold stops publishing. No default.
- `buildChecks[].quality.pattern` — Regular expression with exactly one group; it picks the measured percentage from the command's output. No default.
- `buildChecks[].quality.marker` — The percentage from which the measurement suffices. Values: 0 to 100. No default.
- `buildChecks[].concurrent` — Whether this check may run alongside others in "checks.mjs run". Default: `false`.
- `buildChecks[].upfront` — Whether this check runs in "checks.mjs run" before all others. Default: `false`.
- `buildChecks[].kind` — With `hinweis` the check only reports and never stops. Valid: `hinweis`. Default: an ordinary check whose red result stops the run.

- `checkAreas` — Named areas of the project: the key is the area name, the value a list of path patterns. No default.

- `noCheck` — Files for which there is explicitly nothing to check — the third answer next to "touches an area" and "matches no pattern, so full scope". Default: `[]`.
- `noCheck[].pattern` — Path pattern as in checkAreas: "*" within a segment, "**" across segment boundaries, "/" as separator. No default.
- `noCheck[].reason` — Why no check reads the content of this file. No default.

- `coupledAreas` — Areas that a measured coupling forces into almost every check command — for example a file that almost every test group loads. Default: `[]`.
- `coupledAreas[].area` — Name of the area as it appears in checkAreas. No default.
- `coupledAreas[].reason` — Which measured coupling forces the area into almost every check command. No default.

- `testLocations` — Where a component's own tests live — from this, issue check-form reports test hints for a plan: for each own test of a listed component that the plan does not name, one hint that affects neither ok nor the exit code. Default: the kit's locations for TypeScript and Java.
- `testLocations[].source` — Pattern of the source file, for example src/{pfad}/{name}.ts. No default.
- `testLocations[].test` — Pattern of its own test, with the same placeholders and * within a segment, for example src/{pfad}/{name}*.test.ts. No default.
- `testLocations[].defaults` — Inserts the kit's defaults at this position. Value: `true`. No default.

- `scaffoldOnly` — Paths that test files only create as scaffolding — mentioning them in a test file proves no coupling. Default: `[]`.
- `scaffoldOnly[].pattern` — Path pattern as in checkAreas: "*" within a segment, "**" across segment boundaries, "/" as separator. No default.
- `scaffoldOnly[].reason` — Why no test file checks this path but at most creates it as scaffolding. No default.

- `mutationCommand` — Command for mutation tests (optional). Default: empty.

- `qualityCommands` — Further commands or command prefixes that start a quality measurement (optional). Default: `[]`.

- `formatFixCommand` — Command that fixes formatting violations mechanically (e.g. 'mvn spotless:apply' or 'npx prettier --write .'). Default: empty.

- `installCommand` — Command that sets up the project's dependencies in the project directory (e.g. 'npm ci', 'uv sync', 'mvn -q dependency:go-offline'). Default: empty.

- `mainBranch` — Branch for local commits and push (step 7). Default: `main`.

- `productionBranch` — Target branch for the PR in step 8 (merge production). Default: `production`.

- `pushCheck` — Where the full check run before 'push main' takes place. Valid: `lokal`. Default: `lokal`.
- `pushCheck.location` — The place of the full run: the project's build service. Valid: `buildDienst`. No default.
- `pushCheck.branch` — The check branch to which /push-main pushes the state before the push and which it deletes again afterwards. No default.

- `reviewScope` — Scope of the review material: 'diff' = git diff since the last push; 'full' = the entire source code. Valid: `diff`, `full`. Default: `diff`.

- `reviewModel` — The Claude variant of the reviewer pair reviewModel/reviewCommand: model ID for the reviewer subagent (Opus pin). Default: `claude-opus-4-8`.

- `reviewCommand` — The foreign variant of the reviewer pair reviewModel/reviewCommand: command line of a foreign CLI (e.g. 'codex exec --model gpt-5') that receives the review prompt via stdin and writes its answer to stdout. Default: not set, `reviewModel` reviews.

- `reviewReadLimit` — Belongs to reviewCommand: the read-only switch of the foreign CLI that the kit appends to the command line (e.g. '--sandbox read-only'), split at whitespace like reviewCommand. Default: the built-in switch for codex.

- `triggers` — Trigger phrases for the three human stop points. Default: the values of the fields below.
- `triggers.go` — Phrase for the GO to implement. Default: `GO`.
- `triggers.push` — Phrase for the push to mainBranch (step 7). Default: `push main`.
- `triggers.merge` — Phrase for the PR to productionBranch (step 8). Default: `merge production`.

- `local` — Settings for the local issue tracker (issueTracker: 'local'). Default: the values of the fields below.
- `local.issuesDir` — Directory of the issue Markdown files, relative to the project root. Default: `issues`.

- `columns` — Mapping of the internal statuses to board column or label names. Default: the values of the fields below.
- `columns.backlog` — Name of the column or label for Backlog; on GitLab, `Open` turns it into the open state without a label. Default: `Backlog`.
- `columns.ready` — Name of the column or label for Ready — released, the human's GO. Default: `Ready`.
- `columns.in_progress` — Name of the column or label for In progress — the work package currently being worked on. Default: `In progress`.
- `columns.in_review` — Name of the column or label for In review — done locally, not yet pushed. Default: `In review`.
- `columns.done` — Name of the Done column on GitHub and locally; GitLab always uses the closed state. Default: `Done`.

- `github` — GitHub-specific settings. No default.
- `github.projectNumber` — Number of the GitHub Project board (gh project list). Values: from 1. No default.

- `toolbox` — Settings for the Toolbox issue tracker (issueTracker: 'toolbox'). No default.
- `toolbox.host` — Base URL of the Toolbox instance. No default.
- `toolbox.tokenFile` — Path (relative to the project directory) to a file holding the project- or board-bound token. No default.

- `issueReview` — Issue review across several models. No default.
- `issueReview.requiredBeforeReady` — If true, the night runner moves Ready issues without a review marker back to the backlog with a comment. Default: `false`.
- `issueReview.reviewers` — The order is the control: the frontmost entries that are not the author are taken; how many is set by reviewStufen. No default.
- `issueReview.reviewers[].name` — Short name, compared with the issue's author model. No default.
- `issueReview.reviewers[].kind` — 'claude' runs as a subagent via the Agent tool, 'command' as any foreign CLI (prompt via stdin). Valid: `claude`, `command`. No default.
- `issueReview.reviewers[].model` — Only for kind 'claude': model identifier. No default.
- `issueReview.reviewers[].command` — Only for kind 'command': command line, e.g. 'codex exec --model gpt-5'. No default.
- `issueReview.reviewers[].readLimit` — Only for kind 'command': the read-only switch of the foreign tool that the kit appends to the command line (e.g. '--sandbox read-only'), split at whitespace like command. No default.
- `issueReview.pairs` — Explicit mapping author -> reviewer. Default: no assignment, the order in `reviewers` applies.

- `reviewStages` — Staffing and perspective of the three review levels: the functional concern, the plan to get there, the single work package. Default: per tier the roles of the role catalogue, one reviewer per role, only if the whole block is missing; if a tier or a field is missing in a block that is present, the config check aborts.
- `reviewStages.requirement` — Review of the functional concern ([Requirement] issue) before a plan is made from it. No default.
- `reviewStages.requirement.reviewer` — How many reviewers review this level. Values: from 1. Default: `2`, only if the whole `reviewStages` block is missing; a block that is present needs the field.
- `reviewStages.requirement.roles` — One role name per reviewer, in the order of assignment. Default: `form-beobachtbarkeit`, `abgrenzung`, only if the whole `reviewStages` block is missing; a block that is present needs the field.
- `reviewStages.plan` — Review of the plan document ([Plan] issue) before it is split into work packages. No default.
- `reviewStages.plan.reviewer` — How many reviewers review this level. Values: from 1. Default: `2`, only if the whole `reviewStages` block is missing; a block that is present needs the field.
- `reviewStages.plan.roles` — One role name per reviewer, in the order of assignment. Default: `architektur-bestand`, `schnitt-abhaengigkeiten`, only if the whole `reviewStages` block is missing; a block that is present needs the field.
- `reviewStages.issue` — Review of the single work package before the GO. No default.
- `reviewStages.issue.reviewer` — How many reviewers review this level. Values: from 1. Default: `1`, only if the whole `reviewStages` block is missing; a block that is present needs the field.
- `reviewStages.issue.roles` — One role name per reviewer, in the order of assignment. Default: `pruefbarkeit`, only if the whole `reviewStages` block is missing; a block that is present needs the field.

- `night` — Night mode. No default.
- `night.chain` — Budgets and markers of the night chain (night.mjs --chain). No default.
- `night.chain.label` — The marker on the functional requirement or the plan document that starts the chain. Default: `kit:night`.
- `night.chain.variantBLabel` — The marker that flags the marked card for the chain's implementation stage (variant B). Default: `kit:carry-through`.
- `night.chain.planMin` — Time budget of the plan stage in minutes, including correction rounds. Default: `20`.
- `night.chain.packagesMin` — Time budget of the packages stage in minutes, including correction rounds. Default: `15`.
- `night.chain.reviewMin` — Time budget of the reviewer session on the plan in minutes. Default: `15`.
- `night.chain.coverageMin` — Time budget in minutes of the coverage session that holds the packages against the functional plan, or against the plan. Default: `10`.
- `night.chain.implementationMin` — Time budget of the implementation stage (variant B) in minutes, across all implementation sessions of the chain. Default: `120`.
- `night.chain.preparationMin` — Deadline for preparing the push in minutes, waiting and check run included: this is the longest it waits until nothing is building any more in the night. Default: `120`.
- `night.chain.costUsd` — Cost budget per chain in US dollars, summed over all sessions of the chain; checked after every session. Default: `50`.
- `night.chain.costUsdB` — Cost budget per chain in US dollars for the implementation stage (variant B), summed over all sessions of the chain; checked after every session. Default: `150`.
- `night.chain.correctionRounds` — Maximum number of correction sessions per document after a red form check. Values: from 1. Default: `2`.
- `night.chain.transitions` — Which transitions of the chain may follow automatically. Default: every transition follows, implementation only for a card with the variant B label.
- `night.chain.transitions.planReview` — After the plan, the review of the plan follows automatically. Default: `true`.
- `night.chain.transitions.reviewPackages` — After the review of the plan, the work packages follow automatically. Default: `true`.
- `night.chain.transitions.packagesCoverage` — After the work packages, the coverage against the functional requirement or against the plan follows automatically. Default: `true`.
- `night.chain.transitions.coverageImplementation` — After the coverage, the implementation follows automatically. Default: only a card with the variant B label is implemented.
- `night.chain.transitions.implementationPreparation` — After the implementation, the preparation of the push follows automatically if the card's goal reaches that far. Default: `true`.
- `night.status` — The run status: how a card of a chain or an implementation night shows its status on the board (board.mjs issue run-state). Default: the values of the fields below.
- `night.status.labels` — The names of the three run status labels. Default: the values of the fields below.
- `night.status.labels.running` — Label of a card a run is currently working on. Default: `run:running`.
- `night.status.labels.aborted` — Label of a card aborted for technical reasons: repeating is enough. Default: `run:aborted`.
- `night.status.labels.waiting` — Label of a waiting card; what it is waiting for is stated verbatim in the run status. Default: `run:waiting`.
- `night.status.deadlineMin` — Detection deadline in minutes from a run's last sign of life; after that its card shows the last status with the addition 'nicht beendet' (not finished). Default: `10`.
- `night.status.pauseMin` — Pause in minutes before the one automatic attempt after an environment error of the live run. Default: `5`.
- `night.model` — The model of the night run: it starts every session that has no model of its own — the plan, review and coverage stages of the chain, the correction rounds and every package without a task level. Default: the model built into the night runner.
- `night.models` — The model names the night runner may start — ordered, descending by strength: the first entry is the strongest, the last the fastest model. Default: empty, every session starts with the model of the run.
- `night.tiers` — Model or command per difficulty level of a work package, ordered schwer/mittel/leicht (hard/medium/easy). Default: no tier, every package runs with the model of the run.
- `night.tiers.hard` — Model or command for a hard task. No default.
- `night.tiers.hard.model` — Model ID for this level. No default.
- `night.tiers.hard.effort` — Thinking effort for this level, passed to the Claude CLI as --effort. Valid: `low`, `medium`, `high`, `xhigh`, `max`. Default: the Claude CLI's own setting.
- `night.tiers.hard.command` — Command line of a foreign program for this level — a project artefact with the same level of trust as reviewCommand; the pattern ^claude- does not apply here. No default.
- `night.tiers.hard.name` — The program's self-description next to kommando. No default.
- `night.tiers.medium` — Model or command for a medium task. No default.
- `night.tiers.medium.model` — Model ID for this level. No default.
- `night.tiers.medium.effort` — Thinking effort for this level, passed to the Claude CLI as --effort. Valid: `low`, `medium`, `high`, `xhigh`, `max`. Default: the Claude CLI's own setting.
- `night.tiers.medium.command` — Command line of a foreign program for this level — a project artefact with the same level of trust as reviewCommand; the pattern ^claude- does not apply here. No default.
- `night.tiers.medium.name` — The program's self-description next to kommando. No default.
- `night.tiers.easy` — Model or command for an easy task. No default.
- `night.tiers.easy.model` — Model ID for this level. No default.
- `night.tiers.easy.effort` — Thinking effort for this level, passed to the Claude CLI as --effort. Valid: `low`, `medium`, `high`, `xhigh`, `max`. Default: the Claude CLI's own setting.
- `night.tiers.easy.command` — Command line of a foreign program for this level — a project artefact with the same level of trust as reviewCommand; the pattern ^claude- does not apply here. No default.
- `night.tiers.easy.name` — The program's self-description next to kommando. No default.
- `night.tierRule` — Replaces the built-in rule by which /issues and /task determine the level of a work package. Default: the kit's rule.
- `night.stuckAfter` — Number of identically failed runs of the same check after which an unattended session is stopped at the next check call; interactively the same number only produces a hint. Values: from 2. Default: `3`.
- `night.goalImplementationMin` — Target for the duration of an implementation in minutes; the report shows how many packages stayed below it. Default: `10`.
- `night.logRetentionDays` — Period in days after which the night runner deletes its logs, once at the start of every run: the daily logs .claude/night-run-`<datum>`.log and the run folders under .claude/protokolle/, measured by their last modification. Values: from 1. Default: `14`.

- `checkRun` — The review run: a run during the day that has several marked functional requirements reviewed one after another without anyone watching. Default: the values of the fields below.
- `checkRun.label` — The marker on the functional requirement that the run has reviewed. Default: `kit:check`.
- `checkRun.checkMin` — Time budget of the reviewer session per card in minutes. Default: `25`.
- `checkRun.costUsd` — Cost budget per run in US dollars, summed over all sessions of the run; checked after every session, never in the middle of one. Default: `25`.

- `workload` — The effort of the process (unattended runs): how many result records the evaluation considers and from which thresholds it reports a finding. Default: the values of the fields below.
- `workload.runs` — The maximum number of the most recent completed result records the evaluation includes, most recent first. Default: `10`.
- `workload.thresholds` — From which share the evaluation reports a finding. Default: the values of the fields below.
- `workload.thresholds.checkShare` — Share of the total check time that the largest single mandatory check may take before a finding appears. Values: 0 to 1. Default: `0.5`.
- `workload.thresholds.narrowingWithoutEffect` — Whether a finding appears when narrowing the checks by area was measured but never took effect. Default: `true`.
- `workload.thresholds.toolShare` — Share of the total running time that pure tool work may take before a finding appears. Values: 0 to 1. Default: `0.5`.
- `workload.thresholds.writeCostShare` — Share of the total costs that the costs of the third item (writing) may take before a finding appears. Values: 0 to 1. Default: `0.75`.

- `effectiveness` — The effectiveness of the checks: over which time window the evaluation counts executions and objections, and from which counts and thresholds it reports a finding. Default: the values of the fields below.
- `effectiveness.windowDays` — How many days back the evaluation counts. Default: `30`.
- `effectiveness.neverFlaggedFromRuns` — From how many executions in the window a check that has never objected becomes a finding. Default: `10`.
- `effectiveness.rateThreshold` — From which return rate a finding appears. Values: 0 to 1. Default: `0.2`.
- `effectiveness.rateFromPackages` — From how many evaluated work packages in the window the return rate may trigger a finding. Default: `10`.
- `effectiveness.candidatesMax` — The maximum number of cards the return rate evaluates, most recent entries into In review first. Default: `200`.

- `findings` — Recurring findings of the model reviews: from how many occurrences a proposal arises from them. Default: the values of the fields below.
- `findings.threshold` — From how many occurrences of the same finding a proposal arises. Default: `3`.

- `history` — Before a requirement or plan is written, searches earlier requirements on the project's own board on the same subject, archived ones included, and names the relevant ones in the new document. Default: `false`.

- `scenariosFrom` — Cut-off of the scenario duty: the card number from which a requirement on the board must carry a Scenarios section with at least one complete scenario. Values: from 1. Default: not set, the obligation applies to no card on the board; the installer sets the field on update.

- `contractRepos` — The partner repos of this project: repos that read or write something this project also defines — a name, a marker, a format. Default: `[]`, no partner repo.
- `contractRepos[].name` — Short name of the partner repo, for example kanban-kit: lowercase letters and digits, words separated by single hyphens. No default.
- `contractRepos[].url` — Address from which the partner repo can be cloned, for example https://github.com/mannewolff/kanban-kit.git. No default.
- `contractRepos[].branch` — Main branch of the partner repo: a contract is checked against the built state on this branch. Default: `main`.
<!-- einstellungen:ende -->

## kontext.config.json
<!-- de: e47ded014f0f -->

`/session-start` and `/document` read the location of the memory vault (Memory-Vault) from `~/.claude/kontext.config.json` for all projects on the machine and from `.claude/kontext.config.json` for one project. Both files are merged field by field, the fields of the project file win. The files do not belong in the repository.

- `vault` — Absolute path to the memory vault; without it, `/document` writes the daily log into the project directory. No default.
- `always` — Files relative to the vault that `/session-start` always reads. Default: `[]`.
- `projectDocs` — Files or glob patterns relative to the project directory that `/session-start` reads. Default: `["CLAUDE-*", ".claude/CLAUDE-*"]`.
- `project` — Name of the project in the vault, needed only if it differs from the repo name. Default: the name of the repo.
- `logPath` — Pattern of the daily log file relative to the vault, with the placeholders `{date}` and `{project}`; as soon as two projects use the same vault, `{project}` belongs in it. Default: `Log/{date}.md`.
- `parentProject` — Umbrella project above several service repos, under which their notes lie together. No default.
