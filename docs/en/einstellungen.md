# Settings
<!-- de: fa32a2ba342f -->

The kit reads its settings (Einstellungen) from `.claude/workflow.config.json`; the file belongs in the repository and applies to the whole team. Next to it, `.claude/workflow.config.local.json`, which does not belong in the repository, carries personal deviations (persönliche Abweichungen), such as a different review model or the path to a token; whatever applies only team-wide, the kit ignores there. Every setting goes by its English name. The kit still reads German names, but never writes them.

The settings below come in four parts: Needed at setup, Worth setting, Managed by the kit (deprecated, set by the installer or internal) and Fine-tuning with good defaults. If a setting is missing from the file, its default applies. Each one also appears with the same sentence in `.claude/workflow.config.example.jsonc`; the kit never reads that file.

You can also maintain the settings through a local interface, the single file [settings.mjs](https://docs.mwolff.org/settings.mjs), for all projects under one folder:

```bash
node settings.mjs ~/ki-projects
```

Its address carries an access token and can only be reached from this machine. The interface groups the settings into the parts Reviewers, Pairings, Review stages, Findings, Check commands and areas, Night chain, Workload, Effectiveness, Task tiers and simple groups. For every setting that may deviate personally, it shows the team value, the deviation and the value that applies; it rejects invalid values with a reason before saving.

## All settings
<!-- de: 07edcf55594f -->

<!-- einstellungen:start -->
_This section is generated from `templates/workflow.config.schema.json` by `node tools/config-referenz.mjs`; changes belong in the schema, not here._

### Needed at setup

- `language` — Language of the kit in this project: de (German) or en (English). Valid: `de`, `en`. Default: `de`. Switches the kit's texts, board names and comments to English; set `en` when the team works in English.

- `codeHost` — Where the code lives (push, pull requests). Valid: `github`, `gitlab`, `local`. Default: `github`. Decides where pushes go and where pull requests are opened; set it at setup when the code is not on GitHub.

- `issueTracker` — Where the issues are managed. Valid: `github`, `gitlab`, `local`, `toolbox`. Default: `github`. Decides where the board lives; set it at setup when the issues are not on GitHub, for example `local` for files in the repo.

- `buildChecks` — The project's check commands (build, tests). Default: `[]`. Decides what is checked before each commit and before `push main`; enter the project's build and test commands at setup.
- `buildChecks[]` — A check command, as a command string or as an object with `cmd` and the fields below. No default.
- `buildChecks[].cmd` — The command line as it would appear in the string form. No default.
- `buildChecks[].areas` — Area names from `checkAreas`; the check runs when one of them is touched. No default.
- `buildChecks[].always` — true = always runs, by decision, regardless of the touched areas. No default.
- `buildChecks[].stage` — When the check is due: "paket" at the completion of a work package, "push" before publishing, "merge" before the release. Valid: `paket`, `push`, `merge`. Default: `paket`.
- `buildChecks[].notAtCompletion` — Why the check may be skipped at the completion of a single package. Valid: `zusammenspiel`, `volleTestmenge`. Default: not set, the check also runs at completion.
- `buildChecks[].completionAreas` — Areas whose touch makes the check run at completion too. Default: not set, the check is skipped at completion.
- `buildChecks[].quality` — Marks this check as a quality measurement whose value below the threshold stops publishing. No default.
- `buildChecks[].quality.pattern` — Regular expression with exactly one group; it picks the measured percentage from the command's output. No default.
- `buildChecks[].quality.marker` — The percentage from which the measurement suffices. Values: 0 to 100. No default.
- `buildChecks[].concurrent` — Whether this check may run alongside others in "checks.mjs run". Default: `false`.
- `buildChecks[].upfront` — Whether this check runs in "checks.mjs run" before all others. Default: `false`.
- `buildChecks[].kind` — With `hinweis` the check only reports and never stops. Valid: `hinweis`. Default: an ordinary check whose red result stops the run.

- `mainBranch` — Branch for local commits and push (step 7). Default: `main`. The branch for local commits and `push main`; set it only when it is not called `main`.

- `productionBranch` — Target branch for the PR in step 8 (merge production). Default: `production`. The branch `merge production` opens the pull request against; set it only when it is not called `production`.

- `local` — Settings for the local issue tracker (issueTracker: 'local'). Default: the values of the fields below. The folder where the local tracker keeps its issues; set it only with `issueTracker` `local` and a folder other than `issues`.
- `local.issuesDir` — Directory of the issue Markdown files, relative to the project root. Default: `issues`.

- `github` — GitHub-specific settings. No default. The GitHub project whose columns are the board; needed at setup with a board on GitHub, the installer enters it.
- `github.projectNumber` — Number of the GitHub Project board (gh project list). Values: from 1. No default.

- `toolbox` — Settings for the Toolbox issue tracker (issueTracker: 'toolbox'). No default. Access to the author's Toolbox tracker; set it only with `issueTracker` `toolbox`.
- `toolbox.host` — Base URL of the Toolbox instance. No default.
- `toolbox.tokenFile` — Path (relative to the project directory) to a file holding the project- or board-bound token. No default.

- `issueReview` — Issue review across several models. No default. Decides which models review requirement, plan and packages; set it at setup, because without reviewers the night chain stops before it starts.
- `issueReview.requiredBeforeReady` — If true, the night runner moves Ready issues without a review marker back to the backlog with a comment. Default: `false`.
- `issueReview.reviewers` — The reviewers in the order in which they are taken; never the author. No default.
- `issueReview.reviewers[].name` — Short name, compared with the issue's author model. No default.
- `issueReview.reviewers[].kind` — 'claude' runs as a subagent via the Agent tool, 'command' as any foreign CLI (prompt via stdin). Valid: `claude`, `command`. No default.
- `issueReview.reviewers[].model` — Only for kind 'claude': model identifier. No default.
- `issueReview.reviewers[].command` — Only for kind 'command': command line, e.g. 'codex exec --model gpt-5'. No default.
- `issueReview.reviewers[].readLimit` — Only for kind 'command': the read-only switch of the third-party tool. No default.
- `issueReview.pairs` — Explicit mapping author -> reviewer. Default: no assignment, the order in `reviewers` applies.

### Worth setting

- `checkAreas` — Named areas of the project. No default. Maps paths to named areas so that a check runs only when its area is touched; set it as soon as the full check run takes too long.

- `noCheck` — Files that no check reads. Default: `[]`. Takes files that no check reads out of the full check run; set it when, for example, a plain text change triggers every check.
- `noCheck[].pattern` — Path pattern as in checkAreas: "*" within a segment, "**" across segment boundaries, "/" as separator. No default.
- `noCheck[].reason` — Why no check reads the content of this file. No default.

- `coupledAreas` — Areas with a measured coupling. Default: `[]`. Records with a reason that an area triggers almost every check because of a measured coupling; set it when the evaluation reports such an area and the coupling is intended.
- `coupledAreas[].area` — Name of the area as it appears in checkAreas. No default.
- `coupledAreas[].reason` — Which measured coupling forces the area into almost every check command. No default.

- `testLocations` — Where a component's own tests live. Default: the kit's locations for TypeScript and Java. Tells the kit where a component's tests live, so that a plan gets hints about affected tests; set it when the layout does not follow the TypeScript or Java pattern.
- `testLocations[].source` — Pattern of the source file, for example src/{pfad}/{name}.ts. No default.
- `testLocations[].test` — Pattern of its own test, with the same placeholders and * within a segment, for example src/{pfad}/{name}*.test.ts. No default.
- `testLocations[].defaults` — Inserts the kit's defaults at this position. Value: `true`. No default.

- `mutationCommand` — Command for mutation tests (optional). Default: empty. Runs mutation tests before each `push main` that only report; set it when the project has a tool such as PIT or Stryker.

- `qualityCommands` — Further commands or command prefixes that start a quality measurement (optional). Default: `[]`. Keeps further quality measurements out of the packages' acceptance criteria; set it when the project has an expensive measurement that is not a check.

- `formatFixCommand` — Command that fixes formatting violations. Default: empty. Fixes formatting violations itself and checks once more instead of ending the run red; set it when the project has a formatter.

- `installCommand` — Command that installs the dependencies. Default: empty. Installs the dependencies in a fresh worktree; set it when the project uses worktrees and has to install packages, for example with `npm ci`.

- `pushCheck` — Where the full check run before 'push main' takes place. Valid: `lokal`. Default: `lokal`. Moves the full check run before `push main` to the build service; set it when it takes too long locally or the CI checks the same anyway.
- `pushCheck.location` — The place of the full run: the project's build service. Valid: `buildDienst`. No default.
- `pushCheck.branch` — The check branch that /push-main pushes before the push and deletes afterwards. No default.

- `reviewScope` — Scope of the review material. Valid: `diff`, `full`. Default: `diff`. Decides whether the code review reads only the diff since the last push or the whole source; set `full` for a review of the whole project.

- `reviewModel` — The Claude model of the code review. Default: `claude-opus-4-8`. The Claude model that reviews the code; set it when a model other than the default is to review.

- `reviewCommand` — A third-party CLI as code reviewer, counterpart of reviewModel. Default: not set, `reviewModel` reviews. Lets a third-party CLI review the code instead of Claude; set it when a model from another provider is to review.

- `reviewStages` — Staffing and perspective of the three review levels: the functional concern, the plan to get there, the single work package. Default: per tier the roles of the role catalogue, one reviewer per role, only if the whole block is missing; if a tier or a field is missing in a block that is present, the config check aborts. Decides how many reviewers with which roles review at each stage; set it when a stage is to be reviewed more thoroughly or more sparingly.
- `reviewStages.requirement` — Review of the functional concern ([Requirement] issue) before a plan is made from it. No default.
- `reviewStages.{requirement,plan}.reviewer` — How many reviewers review this level. Values: from 1. Default: `2`, only if the whole `reviewStages` block is missing; a block that is present needs the field.
- `reviewStages.requirement.roles` — One role name per reviewer, in the order of assignment. Default: `form-beobachtbarkeit`, `abgrenzung`, only if the whole `reviewStages` block is missing; a block that is present needs the field.
- `reviewStages.plan` — Review of the plan document ([Plan] issue) before it is split into work packages. No default.
- `reviewStages.plan.roles` — One role name per reviewer, in the order of assignment. Default: `architektur-bestand`, `schnitt-abhaengigkeiten`, only if the whole `reviewStages` block is missing; a block that is present needs the field.
- `reviewStages.issue` — Review of the single work package before the GO. No default.
- `reviewStages.issue.reviewer` — How many reviewers review this level. Values: from 1. Default: `1`, only if the whole `reviewStages` block is missing; a block that is present needs the field.
- `reviewStages.issue.roles` — One role name per reviewer, in the order of assignment. Default: `pruefbarkeit`, only if the whole `reviewStages` block is missing; a block that is present needs the field.

- `history` — Earlier requirements on the same subject. Default: `true`. Lets requirement and plan name earlier requirements on the same subject; switch it off with `false` only when the board's history does not matter.

- `contractRepos` — The partner repos of this project. Default: `[]`, no partner repo. Requires every plan to have a contracts section on the partner repos; add an entry as soon as another repo reads or writes a name, a format or a marker of this project.
- `contractRepos[].name` — Short name of the partner repo, for example kanban-kit: lowercase letters and digits, words separated by single hyphens. No default.
- `contractRepos[].url` — Address from which the partner repo can be cloned, for example https://github.com/mannewolff/kanban-kit.git. No default.
- `contractRepos[].branch` — Main branch of the partner repo: a contract is checked against the built state on this branch. Default: `main`.

### Managed by the kit

- `version` — _Set by the installer._ Version identifier x.y.z. Default: `1.4.0`.

- `provider` — _Deprecated._ Is carried over to `codeHost` and `issueTracker` on loading; do not set it in a new config. Valid: `github`, `gitlab`, `local`. No default.

- `scenariosFrom` — _Set by the installer._ Cut-off of the scenario requirement, as a card number. Values: from 1. Default: not set, the obligation applies to no card on the board; the installer sets the field on update.

### Fine-tuning

Exceptions for the check-area comparison; set it when areas suggest names a path as a candidate for this list.

- `scaffoldOnly` — Paths that test files only create as scaffolding — mentioning them in a test file proves no coupling. Default: `[]`.
- `scaffoldOnly[].pattern` — Path pattern as in checkAreas: "*" within a segment, "**" across segment boundaries, "/" as separator. No default.
- `scaffoldOnly[].reason` — Why no test file checks this path but at most creates it as scaffolding. No default.

- `reviewReadLimit` — The read-only switch of the third-party CLI from reviewCommand. Default: the built-in switch for codex.

The phrases the human uses to release the three stop points.

- `triggers` — Trigger phrases for the three human stop points. Default: the values of the fields below.
- `triggers.go` — Phrase for the GO to implement. Default: `GO`.
- `triggers.push` — Phrase for the push to mainBranch (step 7). Default: `push main`.
- `triggers.merge` — Phrase for the PR to productionBranch (step 8). Default: `merge production`.

The names of the columns and labels, when the board calls them differently from the kit.

- `columns` — Mapping of the internal statuses to board column or label names. Default: the values of the fields below.
- `columns.backlog` — Name of the column or label for Backlog; on GitLab, `Open` turns it into the open state without a label. Default: `Backlog`.
- `columns.ready` — Name of the column or label for Ready — released, the human's GO. Default: `Ready`.
- `columns.in_progress` — Name of the column or label for In progress — the work package currently being worked on. Default: `In progress`.
- `columns.in_review` — Name of the column or label for In review — done locally, not yet pushed. Default: `In review`.
- `columns.done` — Name of the Done column on GitHub and locally; GitLab always uses the closed state. Default: `Done`.

Night mode: which models may run, how long an implementation should take and when a run counts as stuck.

- `night` — Night mode. No default.

The budgets of the night chain: time, cost and correction rounds per step before the chain stops.

- `night.chain` — Budgets and markers of the night chain (night.mjs --chain). No default.
- `night.chain.label` — The marker on the functional requirement or the plan document that starts the chain. Default: `kit:night`.
- `night.chain.variantBLabel` — The marker that flags the marked card for the chain's implementation stage (variant B). Default: `kit:carry-through`.
- `night.chain.planMin` — Time budget of the plan stage in minutes, including correction rounds. Default: `20`.
- `night.chain.packagesMin` — Time budget of the packages stage in minutes, including correction rounds. Default: `15`.
- `night.chain.reviewMin` — Time budget of the reviewer session on the plan in minutes. Default: `15`.
- `night.chain.coverageMin` — Time budget of the coverage session in minutes. Default: `10`.
- `night.chain.implementationMin` — Time budget of the implementation stage (variant B) in minutes, across all implementation sessions of the chain. Default: `120`.
- `night.chain.preparationMin` — Time limit of the push preparation in minutes, waiting and check run included. Default: `120`.
- `night.chain.costUsd` — Cost budget per chain in US dollars, summed over all sessions of the chain; checked after every session. Default: `50`.
- `night.chain.costUsdB` — Cost budget per chain in US dollars for the implementation stage (variant B). Default: `150`.
- `night.chain.correctionRounds` — Maximum number of correction sessions per document after a red form check. Values: from 1. Default: `2`.
- `night.chain.transitions` — Which transitions of the chain may follow automatically. Default: every transition follows, implementation only for a card with the variant B label.
- `night.chain.transitions.planReview` — After the plan, the review of the plan follows automatically. Default: `true`.
- `night.chain.transitions.reviewPackages` — After the review of the plan, the work packages follow automatically. Default: `true`.
- `night.chain.transitions.packagesCoverage` — After the work packages, the coverage against the functional requirement or against the plan follows automatically. Default: `true`.
- `night.chain.transitions.coverageImplementation` — After the coverage, the implementation follows automatically. Default: only a card with the variant B label is implemented.
- `night.chain.transitions.implementationPreparation` — Whether the push preparation follows the implementation. Default: `true`.

How a card shows its run status on the board: labels, deadline and pause.

- `night.status` — A card's run status on the board. Default: the values of the fields below.
- `night.status.labels` — The names of the three run status labels. Default: the values of the fields below.
- `night.status.labels.running` — Label of a card a run is currently working on. Default: `run:running`.
- `night.status.labels.aborted` — Label of a card aborted for technical reasons: repeating is enough. Default: `run:aborted`.
- `night.status.labels.waiting` — Label of a waiting card; what it is waiting for is stated verbatim in the run status. Default: `run:waiting`.
- `night.status.deadlineMin` — Detection period in minutes after a run's last sign of life. Default: `10`.
- `night.status.pauseMin` — Pause in minutes before the one automatic attempt after an environment error of the live run. Default: `5`.
- `night.model` — The model of every night-run session that has no model of its own. Default: the model built into the night runner.
- `night.models` — The model names the night runner may start, strongest first. Default: empty, every session starts with the model of the run.

Which model the night run starts for each difficulty tier of a package.

- `night.tiers` — Model or command per difficulty level of a work package, ordered hard/medium/easy. Default: no tier, every package runs with the model of the run.
- `night.tiers.hard` — Model or command for a hard task. No default.
- `night.tiers.{hard,medium,easy}.model` — Model ID for this level. No default.
- `night.tiers.{hard,medium,easy}.effort` — Thinking effort for this level, passed to the Claude CLI as --effort. Valid: `low`, `medium`, `high`, `xhigh`, `max`. Default: the Claude CLI's own setting.
- `night.tiers.{hard,medium,easy}.command` — Command line of a third-party program for this tier. No default.
- `night.tiers.{hard,medium,easy}.name` — The program's self-description next to command. No default.
- `night.tiers.medium` — Model or command for a medium task. No default.
- `night.tiers.easy` — Model or command for an easy task. No default.
- `night.tierRule` — Replaces the built-in rule by which /issues and /task determine the level of a work package. Default: the kit's rule.
- `night.stuckAfter` — Number of identically failed runs of the same check after which an unattended session is stopped. Values: from 2. Default: `3`.
- `night.goalImplementationMin` — Target for the duration of an implementation in minutes. Default: `10`.
- `night.logRetentionDays` — Period in days after which the night runner deletes its logs. Values: from 1. Default: `14`.

The daily check run: its label, its time and its cost.

- `checkRun` — The daily check run. Default: the values of the fields below.
- `checkRun.label` — The marker on the functional requirement that the run has reviewed. Default: `kit:check`.
- `checkRun.checkMin` — Time budget of the reviewer session per card in minutes. Default: `25`.
- `checkRun.costUsd` — Cost budget per run in US dollars, checked after every session. Default: `25`.

The thresholds from which the workload evaluation reports a finding.

- `workload` — Scope and thresholds of the workload evaluation. Default: the values of the fields below.
- `workload.runs` — The maximum number of the most recent completed result records the evaluation includes, most recent first. Default: `10`.
- `workload.thresholds` — From which share the evaluation reports a finding. Default: the values of the fields below.
- `workload.thresholds.checkShare` — Highest share of the largest mandatory check in the check time without a finding. Values: 0 to 1. Default: `0.5`.
- `workload.thresholds.narrowingWithoutEffect` — Whether a finding appears when narrowing the checks by area was measured but never took effect. Default: `true`.
- `workload.thresholds.toolShare` — Share of the total running time that pure tool work may take before a finding appears. Values: 0 to 1. Default: `0.5`.
- `workload.thresholds.writeCostShare` — Highest share of the writing costs in the total costs without a finding. Values: 0 to 1. Default: `0.75`.

Time window and thresholds by which the effectiveness evaluation reports a check as ineffective.

- `effectiveness` — Time window and thresholds of the effectiveness evaluation. Default: the values of the fields below.
- `effectiveness.windowDays` — How many days back the evaluation counts. Default: `30`.
- `effectiveness.neverFlaggedFromRuns` — From how many executions in the window a check that has never objected becomes a finding. Default: `10`.
- `effectiveness.rateThreshold` — From which return rate a finding appears. Values: 0 to 1. Default: `0.2`.
- `effectiveness.rateFromPackages` — From how many evaluated work packages in the window the return rate may trigger a finding. Default: `10`.
- `effectiveness.candidatesMax` — The maximum number of cards the return rate evaluates, most recent entries into In review first. Default: `200`.

From how many recurring findings of the model reviews a proposal arises.

- `findings` — Recurring findings of the model reviews: from how many occurrences a proposal arises from them. Default: the values of the fields below.
- `findings.threshold` — From how many occurrences of the same finding a proposal arises. Default: `3`.
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
