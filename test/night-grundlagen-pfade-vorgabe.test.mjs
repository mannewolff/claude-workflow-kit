// Die Pfade der Nachbarn ohne Test-Hook (Issue #1224): Der Teil liegt eine Ebene unter
// night.mjs, die Nachbarn liegen neben night.mjs. Eigene Datei, weil die Hooks beim Laden
// gelesen werden (siehe night-grundlagen-pfade).

import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const kitDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "kit");
delete process.env.KIT_ROOT;
delete process.env.NIGHT_NACHBAR_DIR;
const g = await import(pathToFileURL(join(kitDir, "night", "grundlagen.mjs")).href);

test("ohne Hook liegen Kommandos und Module neben night.mjs, nicht neben dem Teil", () => {
  assert.equal(g.NACHBAR_DIR, kitDir);
  assert.equal(g.BOARD_PATH, join(kitDir, "board.mjs"));
  assert.equal(g.BEFUNDE_PATH, join(kitDir, "befunde.mjs"));
  assert.equal(g.NACHBAR_BOARD, join(kitDir, "board.mjs"));
});
