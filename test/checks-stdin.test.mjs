// Die stdin der Pruefungen, die `checks.mjs run` startet (Issue #1076).
//
// Seit Issue #1070 startet `run` jede Pruefung mit `spawn(cmd, { shell: true })`. Ohne
// `stdio`-Angabe war die stdin des Kindes eine Pipe, deren Schreibende `checks.mjs`
// hielt und nie schloss. Jeder Nachfahre, der von stdin liest, ohne eine eigene zu
// bekommen, wartete darauf endlos — in der Nacht vom 30.09.2026 ein `node --test`
// → `board.mjs issue comment 0001 --text -` eine halbe Stunde lang.
//
// Belegt wird die Wirkung, nicht die Option: Ein Kommando, das stdin bis zum Ende
// liest, muss sofort Ende-der-Eingabe sehen. Die Frist am spawnSync ist nur die
// Notbremse des Tests, damit ein Rueckfall rot wird statt die Suite aufzuhalten.

import "./helpers/checks-sperre.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { CHECKS, mitRepo, datei, eintrag, zusammenfassung } from "./helpers/checks-repo.mjs";

const FRIST_MS = 20_000;

/** Liest stdin bis zum Ende und meldet, wie viele Zeichen kamen. */
const LIEST_STDIN = `node -e "const t = require('fs').readFileSync(0, 'utf-8'); console.log('stdin zu Ende nach ' + t.length + ' Zeichen')"`;

/** `run` mit Frist; die stdin von checks.mjs selbst bleibt offen wie in einer Session. */
function runMitFrist(dir) {
  return spawnSync(process.execPath, [CHECKS, "run"], {
    cwd: dir, encoding: "utf-8", timeout: FRIST_MS, killSignal: "SIGKILL",
  });
}

for (const gleichzeitig of [false, true]) {
  test(`ein Kommando, das stdin liest, sieht sofort Ende-der-Eingabe (gleichzeitig: ${gleichzeitig})`, () => {
    const config = { buildChecks: [{ cmd: LIEST_STDIN, gleichzeitig }] };
    mitRepo({ config }, (dir) => {
      datei(dir, "src/x.txt");

      const res = runMitFrist(dir);

      assert.equal(res.signal, null,
        `run wurde nach ${FRIST_MS} ms abgebrochen — das Kommando wartete auf stdin`);
      assert.equal(res.status, 0, `run endete mit ${res.status}: ${res.stdout}${res.stderr}`);
      assert.match(res.stdout, /stdin zu Ende nach 0 Zeichen/);
      const lauf = eintrag(zusammenfassung(dir).laufen, LIEST_STDIN);
      assert.ok(lauf.dauerMs < FRIST_MS / 2, `das Kommando brauchte ${lauf.dauerMs} ms`);
    });
  });
}
