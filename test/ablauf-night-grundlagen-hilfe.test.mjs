// Ablauf-Pruefung: --help und --version antwortet der Einstieg kit/night.mjs vor dem Laden seiner Teile, auch als einzeln kopierte Datei — das zeigt nur ein Start als Programm.
//
// Test fuer das --help-Flag des Nacht-Runners (Issue #151) und die Zusage aus Issue #170.
// --help (und -h) zeigt die Usage und endet mit Exit 0, BEVOR Config-/Board-Checks laufen —
// es funktioniert also auch ausserhalb eines Projekt-Roots. Seit Issue #1224 beantwortet der
// Einstieg beide Flags, bevor er kit/night/grundlagen.mjs laedt (Plan #1199, E2). Wie der
// Parser ein unbekanntes Argument abweist, prueft night-grundlagen-argumente im selben Prozess.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, copyFileSync } from "node:fs";
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
  // Die Aufrufe, die docs-nachtkette und docs-pruefen in der Doku belegen, nennt die Usage
  // als eigene Option (Issue #1235: der Prozessstart steht nur noch hier).
  for (const flag of ["--kette", "--pruefen"]) {
    assert.match(res.stdout, new RegExp(`^[ \\t]+${flag}\\s`, "m"), `Usage nennt ${flag} nicht als Option`);
  }
});

test("-h ist die Kurzform von --help, auch hinter einem anderen Flag", () => {
  const res = runOutsideProject("--max", "3", "-h");
  assert.equal(res.status, 0, `-h haette mit Exit 0 enden muessen: ${res.stderr}`);
  assert.match(res.stdout, /--max/, "Kurzform zeigt die Usage nicht");
});

test("[night-6] --version und --help antworten auch als einzeln kopierte Datei ohne kit/night/", () => {
  const dir = mkdtempSync(join(tmpdir(), "night-einzeln-"));
  try {
    copyFileSync(nightPath, join(dir, "night.mjs"));
    const version = spawnSync(process.execPath, [join(dir, "night.mjs"), "--version"], { cwd: dir, encoding: "utf-8" });
    assert.equal(version.status, 0, version.stderr);
    assert.match(version.stdout, /^night\.mjs \(claude-workflow-kit v\d+\.\d+\.\d+\)\n$/);
    const hilfe = spawnSync(process.execPath, [join(dir, "night.mjs"), "--help"], { cwd: dir, encoding: "utf-8" });
    assert.equal(hilfe.status, 0, hilfe.stderr);
    assert.match(hilfe.stdout, /^Nacht-Runner:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unbekanntes Argument endet mit Exit 1 und verweist auf --help", () => {
  const res = runOutsideProject("--gibtsnicht");
  assert.equal(res.status, 1, "unbekanntes Argument haette mit Exit 1 enden muessen");
  assert.match(res.stderr, /Unbekanntes Argument: --gibtsnicht/, "Fehlermeldung fehlt");
  assert.match(res.stderr, /--help/, "Fehlermeldung verweist nicht auf --help");
});
