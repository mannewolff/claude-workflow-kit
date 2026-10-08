# Check areas: parts, dependent areas and flow checks
<!-- de: 63e7457414bb -->

This page is for projects that use the kit and want to assign their checks (Prüfungen) in a targeted way. The goal: A work package (Arbeitspaket) checks what it touches, not the whole suite on every change. The basics of `buildChecks`, `checkAreas` and the check stages are in the [documentation](/en/dokumentation); this page is about how they work together.

## Parts and areas
<!-- de: cbe09f3261ea -->

An **area** (Bereich) is a name in `checkAreas` with a list of file patterns. A check command in `buildChecks` names in `areas` which areas it belongs to. `checks.mjs run` starts only the commands whose areas a change touches. Together these are the check areas (Prüfbereiche).

A **part** (Teil) is a source file (or a small group) that forms an area of its own. In the kit itself, the night runner (Nacht-Runner) and the board tool are split up this way: `kit/night.mjs` and `kit/board.mjs` are now only entry points, the logic lives in parts under `kit/night/` and `kit/board/`. Each part has its tests, and a change to a part triggers only those tests — plus those of the dependent parts.

## Dependent areas from the import graph
<!-- de: 533d9f29ed9b -->

Which parts are also affected by a change is derived by `checks.mjs` from the **import graph**, not from a hand-kept list:

- The starting point is every changed file. From it the chain runs to all files that import it, and from there on to their importers — transitively, through files with and without a pattern.
- Every importer reached touches its areas. If a package changes a file in area A and a file from area B imports that file, B counts as touched.
- The report names the path, for example `Bereich board-einstieg beruehrt ueber Import von kit/board/grundlagen.mjs` (area board-einstieg touched via import of kit/board/grundlagen.mjs). That makes it traceable why a check ran.
- If the imports cannot be determined, the full scope applies: `voller Umfang: die Importe liessen sich nicht erheben` (full scope: the imports could not be determined).

Internally this derivation is called `abhaengigeBereiche`. It errs in only one direction: When in doubt it checks more, never less. A hand-kept list, by contrast, goes stale silently and then skips checks.

### Shared foundations
<!-- de: 9b0e80546798 -->

What almost every part needs — shell calls, errors, config access, logging — lives in a part of its own, in the kit `kit/board/grundlagen.mjs` and `kit/night/grundlagen.mjs`. There is no special list "shared" ("gemeinsam"): Because almost every part imports the foundations, a change to them triggers the dependent parts by itself via the graph, and the report names the import path.

Test helpers stay in the patterns of all areas that use them. A file without a pattern triggers the full scope, as before.

### Limit: JavaScript sources only
<!-- de: c36ae3ed42fd -->

The derivation only takes effect in projects with JavaScript sources — files with the extension `.mjs`, `.cjs` or `.js` — once these import one another. Projects in other languages (Java, Python, TypeScript builds without these extensions …) get no dependent areas from the graph. They assign exclusively via the patterns in `checkAreas`; the assignment aid below shows them where a cut is missing.

### Non-literal imports are invisible
<!-- de: e8d435f65364 -->

The analysis sees static and dynamic imports with a **literal** path (`import "./x.mjs"`, `await import("./x.mjs")`). An import whose path only comes into being at runtime — for instance via `pathToFileURL(join(dir, name))` — it does not see. In the kit this concerns the night runner's neighbour imports of `board.mjs`, `checks.mjs`, `aufwand.mjs`, `wirksamkeit.mjs` and `befunde.mjs`, as well as the Windows import of the board part in `checks.mjs`.

Such couplings belong **by hand** in the `areas` of the check command whose part loads the neighbour. The kit pins this down with a coupling gate (`test/config-teile.test.mjs` via `tools/verflechtung.mjs`), which measures the mention of source paths as strings.

## Flow checks
<!-- de: f14a8f829c00 -->

Most tests check in the same process: They import the part and call its functions. Some behaviour, however, can only be proven as a whole flow — for instance that the night runner starts the board CLI as a child process. Such tests are called **flow checks** (Ablauf-Prüfungen).

- **Marking:** A test file that, itself or via a helper under `test/helpers/`, starts a program from `kit/` or `tools/` as a child process carries the line

  ```js
  // Ablauf-Pruefung: <reason why a lightweight proof is not enough>
  ```

- **Group:** In the kit, flow checks live in files `test/ablauf-*.test.mjs` and run in check commands of their own, separate from the lightweight tests. Their `areas` name the areas of all programs the flow starts — so the process coupling is captured without a config key of its own, and the coupling gate checks it.

### The guard's rules
<!-- de: 0596b933425d -->

The guard test `test/checks-leichtigkeit.test.mjs` checks every test file, without an exception list:

1. **Mark flow checks:** Whoever starts a child process from `kit/` or `tools/` — directly or via an import chain through `test/helpers/` — carries the line `// Ablauf-Pruefung:` with a reason.
2. **No pauses:** no fixed waiting time (`await setTimeout(…)`, `pause(ms)` without a condition). A bounded wait for a condition (`warteAuf(pruefung, ms)`) is allowed only in a marked flow check and fails with a finding when the deadline expires.
3. **Marked hangers:** `sleep <n>` in a stub only if the same line carries `# haengt` — as a process the test aborts and does not wait for.
4. **Import from the part:** A test that is not a flow check imports from the part (`../kit/night/kette.mjs`), not from the entry point. An import via the entry point would couple it to all parts.

The rules apply to the kit itself. A project decides for itself how lightweight its checks become; the pattern can be adopted.

## Assignment aid: broadly assigned commands
<!-- de: 448cabacb53d -->

A heavy suite often shows itself in a check command that is assigned to every area and therefore runs on every change. The kit reports this:

- An area-bound command of the package stage (Paketstufe) counts as **broad** if its `areas` name all of the areas, or all but one, and there are at least three area-bound commands.
- `checks.mjs plan` and `checks.mjs run` then write the line

  ```
  hinweis: <cmd> ist jedem Bereich zugeordnet und laeuft bei jeder Aenderung — Zuschnitt pruefen (checks.mjs bereiche)
  ```

  into the block `Fuer den Abschlussbericht:` (for the completion report (Abschlussbericht)). The line says: `<cmd>` is assigned to every area and runs on every change — check the cut.

- The note stops nothing. It is an invitation to split the command up or to narrow its `areas`. `node .claude/kit/checks.mjs bereiche` shows the evaluation per area and per command for this.

### `gekoppelteBereiche`
<!-- de: 8290e9affe04 -->

Sometimes the breadth is intended — for instance because a file that almost every test group loads forces the coupling. Then the config enters the area with a reason:

```json
"gekoppelteBereiche": [
  { "bereich": "grundlagen", "grund": "every test group loads the shared fixture" }
]
```

An entry changes nothing about the verdict; it only suppresses the note line for commands that name the area, and `checks.mjs bereiche` records "durch Kopplung erzwungen: …" (forced by coupling: …). No reason, no entry. The key applies team-wide; a value in `workflow.config.local.json` is ignored.

## In short: how a project assigns its suite
<!-- de: e9cf3713ee01 -->

1. Create areas in `checkAreas`, one per part of the code.
2. Split the suite into check commands and give each one only its areas in `areas`.
3. In JavaScript projects: do not maintain dependencies by hand — the import graph supplies them. Only non-literal imports go into `areas` by hand.
4. In other projects: assign via the patterns in `checkAreas`.
5. Read the report: Every `hinweis:` line about a broad command is a candidate for cutting down — or an entry in `gekoppelteBereiche` with a reason.
