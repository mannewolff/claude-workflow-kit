// Test fuer das --help-Flag des Nacht-Runners (Issue #151).
// --help (und -h) zeigt die Usage und endet mit Exit 0, BEVOR Config-/Board-
// Checks laufen — es funktioniert also auch ausserhalb eines Projekt-Roots.
// Ein unbekanntes Argument endet weiterhin mit Exit 1 und verweist auf --help.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const nightPath = join(dirname(fileURLToPath(import.meta.url)), "..", "kit", "night.mjs");

// Leeres Temp-Verzeichnis als cwd: keine workflow.config.json, kein git-Repo.
function runOutsideProject(...cliArgs) {
  const dir = mkdtempSync(join(tmpdir(), "night-help-"));
  try {
    return spawnSync(process.execPath, [nightPath, ...cliArgs], { cwd: dir, encoding: "utf-8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("--help zeigt die Usage und endet mit Exit 0, auch ohne Projekt-Root", () => {
  const res = runOutsideProject("--help");
  assert.equal(res.status, 0, `--help haette mit Exit 0 enden muessen: ${res.stderr}`);
  for (const flag of ["--max", "--model", "--timeout-min", "--dry-run", "--yolo", "--no-checks-ok"]) {
    assert.match(res.stdout, new RegExp(flag), `Usage nennt ${flag} nicht`);
  }
  assert.match(res.stdout, /TBX_TOKEN/, "Usage zeigt das Night-Board-Beispiel nicht");
  assert.match(res.stdout, /caffeinate/, "Usage zeigt das caffeinate-Beispiel nicht");
});

test("-h ist die Kurzform von --help", () => {
  const res = runOutsideProject("-h");
  assert.equal(res.status, 0, `-h haette mit Exit 0 enden muessen: ${res.stderr}`);
  assert.match(res.stdout, /--max/, "Kurzform zeigt die Usage nicht");
});

test("unbekanntes Argument endet mit Exit 1 und verweist auf --help", () => {
  const res = runOutsideProject("--gibtsnicht");
  assert.equal(res.status, 1, "unbekanntes Argument haette mit Exit 1 enden muessen");
  assert.match(res.stderr, /Unbekanntes Argument: --gibtsnicht/, "Fehlermeldung fehlt");
  assert.match(res.stderr, /--help/, "Fehlermeldung verweist nicht auf --help");
});
