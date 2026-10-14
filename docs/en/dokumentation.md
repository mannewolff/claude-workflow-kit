# Documentation: claude-workflow-kit
<!-- de: 96272fea15f5 -->

The kit turns Claude Code into a workshop with a fixed sequence: a requirement passes through eight steps all the way to production. The AI plans, cuts work packages (Arbeitspakete), implements, checks and has its work reviewed. Three decisions stay with you. This page gives the overview and shows where the details are.

## Concept
<!-- de: 1390e22be3e6 -->

The kit consists of three parts: eighteen skills, a config in the project and an installer. It is neither a platform nor an agent.

The skills know no particular project. Build commands, branch names, checks and review model are in `.claude/workflow.config.json`. When a skill improves, that applies after the next installer run in every project that uses the kit.

All access to issues and board goes through the board adapter (Board-Adapter) `.claude/kit/board.mjs`. It talks to GitHub, GitLab or a local folder `issues/`, and the skills notice none of it.

Where to find what:

- [Setup](/en/einrichtung): installation, config, issue tracker, updating.
- [The process](/en/prozess): the eight steps, every skill with purpose and next step, a complete pass.
- [Night mode](/en/nachtbetrieb): have work packages implemented unattended.
- [Settings](/en/einstellungen): every setting with effect and default.

## Prerequisites
<!-- de: 63de301597ca -->

- **Operating system:** macOS, Linux or Windows via WSL2. On Windows the kit works entirely in WSL2; the guide [Windows via WSL2](/en/wsl2) describes the setup.
- **Node.js 18 or later** for installer and commands.
- **git**: every skill works in a git repository.
- **Claude Code** in a current version with skills.
- **Your tracker's CLI:** `gh` for GitHub, `glab` for GitLab, each logged in once. With the local tracker you need none.
- **A board** with the columns (Spalten) Backlog, Ready, In progress, In review and Done, if you use GitHub or GitLab. GitLab represents the columns through labels.

A vault for notes across sessions is optional; `/session-start` and `/document` also run without it. The file for it is described under [kontext.config.json](/en/einstellungen#kontext-config-json).

## The eight steps
<!-- de: a310e71fe95e -->

| Step | What | Who | Skill |
|---------|-----|-----|-------|
| 1 | Formulate the requirement | Human | – |
| 2 | Plan | AI | [/techplan](/en/prozess#techplan) |
| 3 | Create work packages | AI | [/issues](/en/prozess#issues) |
| 4 | GO: pull packages to Ready | Human | – |
| 5 | Implement | AI | [/implement-ready](/en/prozess#implement-ready) |
| 6 | Review by a second model | AI | [/kit-review](/en/prozess#kit-review) |
| 7 | Push to main | Human | [/push-main](/en/prozess#push-main) |
| 8 | Merge to production | Human | [/merge-production](/en/prozess#merge-production) |

Between step 7 and 8 you check the test server. Alongside the eight steps stand skills that prepare the sequence or split it more finely: `/triage` brings an idea onto its lane, `/requirement`, `/issue-review` and `/groom` clarify a business requirement (fachliche Anforderung) before planning, and `/implement-next`, `/implement-test` and `/implement-done` implement a single package. All of them are under [The skills](/en/prozess#the-skills).

## Three lanes
<!-- de: 92aca10d7787 -->

Not every task needs all eight steps. The kit knows three lanes (Bahnen).

**Lane 1 — Small change.** One file, one asset or one config value, without migration, endpoint, data model or security-relevant logic and at most one module. The AI implements directly and commits; plan, work package and GO are left out. Here too the commit gate (Commit-Gate) requires a green `node .claude/kit/checks.mjs run`.

**Lane 2 — Feature.** The full sequence: `/techplan`, `/issues`, GO, `/implement-ready`. Typical are a data model with several defensible cuts or an endpoint whose contract is open.

**Lane 3 — `[Task]`.** More than a trifle, but nothing to weigh up. [/task](/en/prozess#task) creates exactly one work package with the prefix `[Task]` after your confirmation, without business plan, plan and breakdown. Typical are a rename across many files or mechanical follow-up work.

The choice follows three rules, in this order:

1. If the task fits lane 1 and there is nothing to weigh up, lane 1 applies.
2. Otherwise it depends on whether several defensible paths are open: then lane 2 applies, otherwise lane 3.
3. If that is unclear, lane 2 applies.

So the number of files does not decide: twelve files with nothing to weigh up are lane 3, a single file with two defensible cuts is lane 2. Before every task the AI names its lane.

## The three human stop points
<!-- de: 8c9815ba465c -->

**The GO (step 4).** You pull the work packages to Ready and thereby decide what gets built next, in which order and how much at once. For night mode you can give the GO in advance: if you mark a business requirement or a plan with the label from `night.chain.variantBLabel`, the [night chain](/en/nachtbetrieb#the-night-chain) (Nacht-Kette) pulls the packages cut from it to Ready itself and implements them.

**The push (step 7).** Only `push main` brings the commits to the test server. Every push needs your own approval; before it you can still change or discard the scope, including the decisions a night has made.

**The merge (step 8).** After your check on the test server, `merge production` brings the state to production.

The kit deliberately does not automate these three steps. The AI does the work, you decide.

## Guardrails instead of prompts
<!-- de: 69c3956abba3 -->

A model writes what occurs most often in its training data, which is often a deprecated API or an outdated idiom. A request in the prompt does little against that. The kit relies on guardrails (Leitplanken) that fail in the mandatory gate: a lint or compiler rule in the `buildChecks` that derives from existing annotations, for example `@typescript-eslint/no-deprecated` or Java with `-Xlint:deprecation` and `-Werror`. Which rules apply is set by each project in its config.

The same principle applies to the kit's instructions, with the yardstick "rule in the text or rule in the tool" (Regel im Text oder Regel im Werkzeug): what can be checked from output or result is checked by a command; the text keeps only what needs a judgement in the individual case. Where nothing can be measured, the kit demands a fixed form of answer that makes a violation visible, see [Statements: believe instead of checking](/en/prozess#statements-believe-instead-of-checking).

## What is deliberately not in the kit
<!-- de: 0ac965120554 -->

**Security gates.** Secrets, SQL concatenation and missing input validation are found more reliably in CI by tools such as gitleaks, Semgrep or SpotBugs than by a model. The kit's review complements them.

**Other AI tools.** The skills are written for Claude Code. Codex reads `AGENTS.md`, Cursor `.cursor/rules`; if you use several tools, you maintain the instructions in their formats yourself.

## Names for those moving up from version 4
<!-- de: b1b22bf7277d -->

Version 5 gives skills, commands, options, values, prefixes and labels English names.

### Skills
<!-- de: 9682f2c2455b -->

An old name is rejected, and the message names the new one.

| Old | New |
|-----|-----|
| `/kontext`, `/context` | `/session-start` |
| `/fachplan` | `/requirement` |
| `/review` | `/kit-review` |
| `/plan` (signpost) | dropped, the planning step is `/techplan` |

### Command files
<!-- de: d09a212fa282 -->

| Old | New |
|-----|-----|
| `kit/befunde.mjs` | `kit/findings.mjs` |
| `kit/aufwand.mjs` | `kit/effort.mjs` |
| `kit/wirksamkeit.mjs` | `kit/effectiveness.mjs` |
| `einstellungen.mjs` | `settings.mjs` |

### Commands
<!-- de: 2b0afb5ad9b5 -->

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

### Options
<!-- de: 55fdc0006a01 -->

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

### Choice values
<!-- de: 0955e13fcb52 -->

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

### Title prefixes
<!-- de: 9f2044ba1843 -->

New cards carry the English ones, the kit still recognises the German ones on open cards.

| Old | New |
|-----|-----|
| `[Fachlich]` | `[Requirement]` |
| `[Idee]` | `[Idea]` |
| `[Mensch]` | `[Human]` |

### Labels
<!-- de: 132dc65edbac -->

The kit sets the English ones, recognises the German ones on open cards and removes them wherever it would remove the English one.

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

`kit:on-hold` is new and has no old German name. It shows on the board that a business requirement waits for an external event; what counts is the line `Waiting for event: <reason>` in the section `## Goal`. `node .claude/kit/board.mjs issue hold <N> --reason "<reason>"` sets both, `issue hold <N> --lift` removes both, see [Waiting for an event](/en/nachtbetrieb#waiting-for-an-event).

## License
<!-- de: 2b0491623e20 -->

MIT: you may freely use, modify and redistribute the kit.
