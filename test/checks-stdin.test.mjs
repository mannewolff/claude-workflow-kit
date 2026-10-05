// Die stdin der Pruefungen, die `checks.mjs run` startet (Issue #1076).
//
// Seit Issue #1070 startet `run` jede Pruefung mit `spawn(cmd, { shell: true })`. Ohne
// `stdio`-Angabe war die stdin des Kindes eine Pipe, deren Schreibende `checks.mjs`
// hielt und nie schloss. Jeder Nachfahre, der von stdin liest, ohne eine eigene zu
// bekommen, wartete darauf endlos — in der Nacht vom 30.09.2026 ein `node --test`
// → `board.mjs issue comment 0001 --text -` eine halbe Stunde lang.
//
// Belegt wird die Wirkung, nicht die Option: Ein Kommando, das stdin bis zum Ende
// liest, muss sofort Ende-der-Eingabe sehen. Die Abbruchgrenze fuer haengende
// Pruefungen (Issue #1077) ist nur die Notbremse des Tests, damit ein Rueckfall rot wird
// statt die Suite aufzuhalten. `run` laeuft im selben Prozess (Issue #1212): Dessen
// stdin bleibt offen wie die einer Session.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checksMit, mitRepo, datei, eintrag, zusammenfassung } from "./helpers/checks-repo.mjs";

const FRIST_MS = 20_000;

/** Liest stdin bis zum Ende und meldet, wie viele Zeichen kamen. */
const LIEST_STDIN = `node -e "const t = require('fs').readFileSync(0, 'utf-8'); console.log('stdin zu Ende nach ' + t.length + ' Zeichen')"`;

/** `run` mit Frist: Nach ihr bricht `checks.mjs` das Kommando als haengend ab. */
function runMitFrist(dir) {
  const grenze = String(FRIST_MS);
  return checksMit(dir, { env: { KIT_CHECKS_HAENGEN_VORGABE_MS: grenze, KIT_CHECKS_HAENGEN_MINDEST_MS: grenze } }, "run");
}

for (const gleichzeitig of [false, true]) {
  test(`ein Kommando, das stdin liest, sieht sofort Ende-der-Eingabe (gleichzeitig: ${gleichzeitig})`, async () => {
    const config = { buildChecks: [{ cmd: LIEST_STDIN, gleichzeitig }] };
    await mitRepo({ config }, async (dir) => {
      datei(dir, "src/x.txt");

      const res = await runMitFrist(dir);

      const lauf = eintrag(zusammenfassung(dir).laufen, LIEST_STDIN);
      assert.equal(lauf.haengend, undefined,
        `das Kommando wurde nach ${FRIST_MS} ms abgebrochen — es wartete auf stdin`);
      assert.equal(res.status, 0, `run endete mit ${res.status}: ${res.stdout}${res.stderr}`);
      assert.match(res.stdout, /stdin zu Ende nach 0 Zeichen/);
      assert.ok(lauf.dauerMs < FRIST_MS / 2, `das Kommando brauchte ${lauf.dauerMs} ms`);
    });
  });
}
