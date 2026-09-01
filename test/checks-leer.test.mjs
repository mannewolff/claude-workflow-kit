// Das leere Paket (Issue #423).
//
// Wurde nichts veraendert, laeuft keine Pruefung. Der Zustand steht ausdruecklich
// im Ergebnis (`leeresPaket: true`) und nicht bloss als leere Liste — sonst ist
// "es gibt nichts zu tun" von "die Auswahl hat versagt" nicht zu unterscheiden,
// und beide sehen fuer den Aufrufer gleich gruen aus.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitRepo, plan, kommandos } from "./helpers/checks-repo.mjs";

const CONFIG = {
  buildChecks: [
    "npx eslint .",
    { cmd: "npm run typecheck", always: true },
    { cmd: "npm run build", areas: ["frontend"] },
  ],
  checkAreas: { frontend: ["frontend/**"] },
};

test("nichts veraendert: leeresPaket true und keine einzige Pruefung laeuft", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    const ergebnis = plan(dir);

    assert.equal(ergebnis.leeresPaket, true);
    assert.equal(ergebnis.vollerUmfang, false);
    assert.deepEqual(ergebnis.geaendert, []);
    assert.deepEqual(ergebnis.bereiche, []);
    assert.deepEqual(ergebnis.laufen, [], "auf einem leeren Paket laeuft nichts");
  });
});

test("im leeren Paket wird auch die entschieden immer laufende Pruefung ausgelassen — mit Grund", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    const ergebnis = plan(dir);

    assert.deepEqual(
      kommandos(ergebnis.ausgelassen).sort(),
      ["npm run build", "npm run typecheck", "npx eslint ."],
    );
    for (const e of ergebnis.ausgelassen) {
      assert.match(e.grund, /leeres Paket/, `Grund benennt das leere Paket nicht: ${e.grund}`);
    }
  });
});

test("das leere Paket traegt trotzdem eine aufgeloeste Basis", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    const ergebnis = plan(dir);

    assert.match(ergebnis.basis, /^[0-9a-f]{7,40}$/, `basis ist kein aufgeloester Commit: ${ergebnis.basis}`);
  });
});
