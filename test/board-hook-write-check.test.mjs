// Der Hook, der Schreibwerkzeuge an geschuetzten Dateien abweist (Issue #1740).
//
// Am 2026-10-15 hat eine Runner-Session im Modus auto die geschuetzte
// `.claude/workflow.config.json` mit `Edit` geaendert, obwohl `Edit(…)` unter
// `permissions.deny` stand. Der Hook prueft `Edit`, `Write` und `NotebookEdit` selbst gegen
// die Schreibsperren des Projekts — unabhaengig davon, wie Claude Code die Regel im
// jeweiligen Modus auswertet. Dass board.mjs den Rumpf von stdin liest und den Exitcode
// setzt, belegt `test/ablauf-board-hook-cli.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { hookSchreibenPruefen } from "../kit/board/hook.mjs";

const DENY = { permissions: { deny: ["Edit(.claude/workflow.config.json)", "Write(docs/geheim/**)", "Bash(rm -rf *)"] } };

function mitProjekt(settings, fn) {
  const dir = mkdtempSync(join(tmpdir(), "write-check-"));
  mkdirSync(join(dir, ".claude"));
  if (settings !== undefined) writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify(settings), "utf-8");
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Ruft den Hook im selben Prozess; `status` und `stderr` wie bei einem gestarteten Prozess. */
function hook(dir, eingabe) {
  const text = typeof eingabe === "string" ? eingabe : JSON.stringify(eingabe);
  const { exitCode, stderr } = hookSchreibenPruefen({ eingabeLesen: () => text, env: { CLAUDE_PROJECT_DIR: "" }, cwd: dir });
  return { status: exitCode, stderr };
}

const ereignis = (tool_name, file_path) => ({ tool_name, tool_input: { file_path } });

test("[write-check] Edit, Write und NotebookEdit auf einen geschuetzten Pfad enden mit Exit 2", () => {
  mitProjekt(DENY, (dir) => {
    for (const werkzeug of ["Edit", "Write"]) {
      const res = hook(dir, ereignis(werkzeug, ".claude/workflow.config.json"));
      assert.equal(res.status, 2, `${werkzeug}: ${res.stderr}`);
    }
    const notebook = hook(dir, { tool_name: "NotebookEdit", tool_input: { notebook_path: "docs/geheim/a.ipynb" } });
    assert.equal(notebook.status, 2, notebook.stderr);
    const mitFilePath = hook(dir, ereignis("NotebookEdit", "docs/geheim/a.ipynb"));
    assert.equal(mitFilePath.status, 2, mitFilePath.stderr);
  });
});

test("[write-check] ein absoluter Pfad unter der Wurzel trifft wie der relative", () => {
  mitProjekt(DENY, (dir) => {
    const res = hook(dir, ereignis("Edit", join(dir, ".claude", "workflow.config.json")));
    assert.equal(res.status, 2, res.stderr);
    const glob = hook(dir, ereignis("Write", join(dir, "docs", "geheim", "tief", "x.md")));
    assert.equal(glob.status, 2, glob.stderr);
  });
});

test("[write-check] die Meldung nennt Pfad, Sperre und den Halt mit dem Kommentar ## Geschuetzte Datei", () => {
  mitProjekt(DENY, (dir) => {
    const { stderr } = hook(dir, ereignis("Edit", ".claude/workflow.config.json"));
    assert.match(stderr, /\.claude\/workflow\.config\.json/, "der Pfad");
    assert.match(stderr, /Edit\(\.claude\/workflow\.config\.json\)|permissions\.deny/, "der Grund: die Sperre");
    assert.match(stderr, /Mensch/, "nur ein Mensch schreibt die Datei");
    assert.match(stderr, /## Geschuetzte Datei/, "der Halt-Kommentar");
    assert.match(stderr, /issue check-protected/, "der Weg zum Kommentar");
  });
});

test("[write-check] ein ungeschuetzter Pfad endet mit Exit 0 und ohne Ausgabe", () => {
  mitProjekt(DENY, (dir) => {
    for (const pfad of ["src/app.mjs", join(dir, "README.md"), "docs/offen.md", ".claude/workflow.config.local.json"]) {
      assert.deepEqual(hook(dir, ereignis("Edit", pfad)), { status: 0, stderr: "" }, pfad);
    }
  });
});

test("[write-check] ohne permissions.deny endet jeder Aufruf mit Exit 0", () => {
  for (const settings of [undefined, {}, { permissions: { allow: ["Edit(.claude/workflow.config.json)"] } }]) {
    mitProjekt(settings, (dir) => {
      for (const pfad of [".claude/workflow.config.json", ".claude/settings.json", ".claude/hooks/x.sh", "kit/a.mjs"]) {
        assert.equal(hook(dir, ereignis("Write", pfad)).status, 0, `${JSON.stringify(settings)} ${pfad}`);
      }
    });
  }
});

test("[write-check] andere Werkzeuge und Eingaben ohne Pfad bleiben unberuehrt", () => {
  mitProjekt(DENY, (dir) => {
    assert.equal(hook(dir, { tool_name: "Read", tool_input: { file_path: ".claude/workflow.config.json" } }).status, 0);
    assert.equal(hook(dir, { tool_name: "Edit", tool_input: {} }).status, 0);
  });
});

test("[write-check] eine unlesbare Eingabe laesst durch und sagt es auf stderr", () => {
  mitProjekt(DENY, (dir) => {
    const res = hook(dir, "{ kaputt");
    assert.equal(res.status, 0);
    assert.match(res.stderr, /write-check/);
  });
});
