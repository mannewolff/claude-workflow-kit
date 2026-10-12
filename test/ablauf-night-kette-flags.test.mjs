// Ablauf-Pruefung: Argumentpruefung, --help und der Config-Fehler eines kaputten Budgets entstehen im Einstieg kit/night.mjs, bevor die Kette laeuft — belegbar nur am Exit-Code und an der Ausgabe des Prozesses.
//
// Aufruf, Dry-Run und Kandidatenwahl der Nacht-Kette (Plan #638, A13, E6; Issue #643), soweit
// sie den Einstieg brauchen. Dry-Run und Kandidatenwahl stehen im selben Prozess in
// `night-kette-flags.test.mjs` (Issue #1233).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { NIGHT, run, mitProjekt } from "./helpers/kette-ablauf.mjs";

test("[night-19] --chain mit --label wird abgewiesen: das Kettenlabel steht in der Config", () => {
  mitProjekt((dir) => {
    const res = run(dir, ["--chain", "--label", "kit:x"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /--chain kennt kein --label/);
    assert.match(res.stderr, /night\.kette\.label/);
  });
});

test("[night-19] --help nennt --chain", () => {
  const res = spawnSync(process.execPath, [NIGHT, "--help"], { encoding: "utf-8" });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /^[ \t]+--chain\s+Night chain/m);
});

test("[night-19] ein kaputtes Budget bricht vor dem Ergebnisstand mit dem Feldnamen ab", () => {
  mitProjekt((dir) => {
    const res = run(dir, ["--chain"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /night\.kette\.planMin muss eine Zahl groesser 0 sein/);
    assert.deepEqual(readdirSync(join(dir, ".claude")).filter((n) => n.startsWith("night-run-")), []);
  }, { planMin: 0 });
});
