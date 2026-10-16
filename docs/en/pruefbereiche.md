# Check areas: parts, dependent areas and flow checks
<!-- de: 0820edb0211c -->

A work package (Arbeitspaket) checks what it touches, not the whole suite. This page shows how a project assigns its checks (Prüfungen) for that; the basics are in the [documentation](/en/dokumentation).

## Setting up and maintaining areas
<!-- de: c1129abd0ed1 -->

1. **Get the suggestion:** `node .claude/kit/checks.mjs areas suggest` measures which files every test loads or mentions, in JavaScript, TypeScript and Java. It names per area the patterns together with the tests and files behind them, and per check command the areas that should trigger it. Without a config, the folders of the test files form the groups.
2. **Read:** Trace every area through the tests named. The suggestion gives reasons for merging and splitting as well; a command whose tests load separate areas is named with the test files per part, without a command line.
3. **Adopt:** The suggestion never changes the config. What fits, the human enters into `checkAreas` and into the `areas` of the `buildChecks`, fully, partly or not at all.
4. **Scaffold paths:** If many tests only mention a path without loading it, the suggestion names it as a candidate for `nurGeruest`. An entry carries a pattern and a reason; the measurement then does not count the path as loaded.
5. **Compare:** `node .claude/kit/checks.mjs areas compare` compares the config with the measurement. If a test loads a file whose area its command does not trigger, that is a gap and a risk; an area none of the tests loads is only a notice. The same comparison runs as `hinweis:` in the check run of every package that creates or changes a test file, and in the runner the run report (Laufbericht) collects it. It never stops and changes nothing.
6. **Cannot be assessed:** If it cannot be determined which tests a command runs, for example with another language, it keeps its areas and is shown with a reason as "nicht beurteilbar" (cannot be assessed). Linters and commands with `always` count as "nicht aus der Auswertung abgeleitet" (not derived from the evaluation). A missing measurement is never an all-clear.

## Parts and areas
<!-- de: 456dd5e5433e -->

An **area** (Bereich) is a name in `checkAreas` with a list of file patterns. A check command in `buildChecks` names its areas in `areas`, and `checks.mjs run` starts only the commands whose areas a change touches.

A **part** (Teil) is a source file or small group with its own area and its own tests. A change triggers its tests and those of the parts that depend on it.

## Dependent areas from the import graph
<!-- de: 9e6b6cf21c40 -->

Which parts are affected as well, `checks.mjs` derives from the import graph:

- From every changed file, the chain runs transitively to all files that import it; each one reached touches its areas.
- The report names the path, for example `Bereich board-einstieg beruehrt ueber Import von kit/board/grundlagen.mjs`.
- If the imports cannot be determined, the full scope applies.

The derivation errs in one direction only: when in doubt it checks more, never less.

### Shared foundations
<!-- de: 3c2af3b2dbdb -->

What almost every part needs is in a part of its own; a change to it triggers the dependent parts through the graph. Test helpers are in the patterns of all areas that use them. A file without a pattern triggers the full scope.

### Limit: JavaScript sources only
<!-- de: 3267fbe67d52 -->

The graph is built from files ending in `.mjs`, `.cjs` or `.js` that import one another. Projects in other languages assign solely through the patterns in `checkAreas`. The measurement for `areas suggest` and `areas compare`, by contrast, continues from source to source for TypeScript and Java.

### Non-literal imports are invisible
<!-- de: 9bc8f0920bbb -->

Static and dynamic imports with a literal path are determined (`import "./x.mjs"`, `await import("./x.mjs")`). A path that only arises at run time, for example via `pathToFileURL(join(dir, name))`, stays invisible. Such couplings go by hand into the `areas` of the check command whose part loads the neighbour.

## Flow checks
<!-- de: 26cb42cc142b -->

Most tests call a part in the same process. What can only be shown as a whole flow, for example a program that starts another as a child process, is checked by **flow checks** (Ablauf-Prüfungen).

- **Marking:** A test file that starts a program of the project as a child process, itself or through a helper, carries in its header the line

  ```js
  // Ablauf-Pruefung: <Grund, warum ein leichter Beleg nicht reicht>
  ```

- **Group:** Flow checks run in check commands of their own, separate from the light tests. Their `areas` name the areas of all programs the flow starts.

### The watchdog's rules
<!-- de: 0db7bdb1a190 -->

In the kit, a watchdog (Wächter) test checks every test file on every change under `test/`:

1. **Marking:** Whoever starts a child process, also through helpers, carries the line `// Ablauf-Pruefung:` with a reason.
2. **No pauses:** no fixed waiting time; bounded waiting for a condition only in a flow check.
3. **Marked hangers:** `sleep <n>` in a stub only with `# haengt` on the same line.
4. **Import from the part:** A light test imports from the part, not from the entry point.

A project can adopt the pattern.

## Assignment aid: broadly assigned commands
<!-- de: 8861f237d7d0 -->

If a command's `areas` name all areas or all but one, with at least three area-bound commands, `plan` and `run` report:

```
hinweis: <cmd> ist jedem Bereich zugeordnet und laeuft bei jeder Aenderung — Zuschnitt pruefen (checks.mjs areas)
```

`node .claude/kit/checks.mjs areas` shows the evaluation per area.

### `coupledAreas`
<!-- de: 79a260edcd8a -->

If the breadth is intended, the config enters the area with a reason:

```json
"coupledAreas": [
  { "area": "grundlagen", "reason": "jede Testgruppe laedt die gemeinsame Fixture" }
]
```

The entry only suppresses the notice line; no entry without a reason. It applies team-wide.
