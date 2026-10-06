// Ablauf-Pruefung: Dass board.mjs die Achse hook an den Teil weiterreicht, den Hook-Rumpf von stdin liest und den Befund als Exitcode 2 meldet, belegt nur ein gestartetes kit/board.mjs.
//
// Der Hook ueber die Kommandozeile (Issue #995, umgestellt mit Issue #1223). Zerlegung,
// Settings-Dateien und jeder Durchlass-Grund stehen im selben Prozess in
// `test/board-hook-*.test.mjs`; hier bleibt, was einen Prozess braucht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";

const BOARD = "node .claude/kit/board.mjs issue list";

function mitProjekt(fn) {
  const dir = setupProjekt(null, "board-hook-cli-");
  writeFileSync(join(dir, ".claude", "settings.json"),
    JSON.stringify({ sandbox: { excludedCommands: ["node .claude/kit/board.mjs*"] } }), "utf-8");
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function hook(dir, command) {
  return runBoard(dir, ["hook", "bash-pruefen"], { CLAUDE_PROJECT_DIR: "", KIT_AGENT_MODEL: "" },
    { input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }) });
}

test("[hook-cli] ein Befund endet mit Exit 2 und der Begruendung auf stderr", () => {
  mitProjekt((dir) => {
    const res = hook(dir, `${BOARD} | head -5`);
    assert.equal(res.status, 2, res.stderr);
    assert.match(res.stderr, /node \.claude\/kit\/board\.mjs\*/);
  });
});

test("[hook-cli] ohne Befund endet der Hook mit Exit 0 und ohne Ausgabe", () => {
  mitProjekt((dir) => {
    const res = hook(dir, BOARD);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stderr, "");
  });
});

test("[hook-cli] ein unbekannter hook-Befehl endet mit Exit 1", () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["hook", "unbekannt"], { CLAUDE_PROJECT_DIR: "" }, { input: "" });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Unbekannter hook-Befehl/);
  });
});
