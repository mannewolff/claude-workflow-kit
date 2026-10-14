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
<!-- de: 258614bb895b -->

**Step 4: the GO.** You decide which issues go into this batch. That is where the planning lies: how much work at once, which priority, which dependencies. The GO has two granularities: under **variant A** you pull each work package to Ready individually. Under **variant B** you instead mark in advance the card that starts the chain — the business requirement or the plan document — with the label from `night.kette.varianteBLabel` (see [Second mode](/en/nachtbetrieb#the-night-chain)) — the GO then applies in advance to all work packages that the night chain cuts from it; the chain pulls them to Ready itself and implements them in the same night.

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
