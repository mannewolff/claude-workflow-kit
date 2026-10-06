// `leseStromereignis` liest eine Zeile des Session-Stroms (Issue #960).
//
// Dieselben zwoelf Zeilen standen dreimal in `kit/night.mjs`: zweimal woertlich als
// lokales `parse` in `werkzeugZeitBeobachter` und `prueflaufBeobachter`, einmal in
// anderer Form als Schritte in der Schleife von `leseKennzahlen`. SonarCloud meldete
// die beiden identischen als `javascript:S4144`.
//
// Geprueft wird die reine, exportierte Funktion — ohne Subprozess, Muster
// `night-session-kennzahlen.test.mjs`. Dass sich am Verhalten der drei Nutzer nichts geaendert
// hat, belegen deren eigene Tests, die fuer dieses Paket unveraendert bleiben.

import { test } from "node:test";
import assert from "node:assert/strict";

import { leseStromereignis } from "../kit/night/session.mjs";

test("[night-960-1] ein bereits geparstes Objekt wird durchgereicht", () => {
  // Der Grund fuer diesen Zweig: Die Beobachter bekommen ihre Zeile teils schon
  // geparst. Ein zweites JSON.parse darauf wuerde werfen.
  const obj = { type: "assistant", message: { content: [] } };
  assert.equal(leseStromereignis(obj), obj, "dasselbe Objekt, nicht eine Kopie");
});

test("[night-960-2] etwas, das weder Objekt noch String ist, ergibt null", () => {
  for (const wert of [null, undefined, 42, true, Symbol("x"), () => {}]) {
    assert.equal(leseStromereignis(wert), null, `${String(wert)} ergibt null`);
  }
});

test("[night-960-3] eine Zeile ohne fuehrende Klammer ergibt null", () => {
  // Der billige Vorfilter: Ein Stromereignis ist immer ein JSON-Objekt. Ohne ihn
  // liefe JSON.parse ueber jede Fliesstext-Zeile, und der Beobachter sitzt im
  // stdout-Handler jeder Session.
  assert.equal(leseStromereignis("Fliesstext ohne Klammer"), null);
  assert.equal(leseStromereignis(""), null);
  assert.equal(leseStromereignis("[1,2,3]"), null, "ein Array ist kein Stromereignis");
});

test("[night-960-4] unlesbares JSON ergibt null, statt zu werfen", () => {
  assert.equal(leseStromereignis('{"type":'), null);
  assert.equal(leseStromereignis("{nicht json}"), null);
});

test("[night-960-5] gueltiges JSON wird gelesen, auch mit Leerraum davor und danach", () => {
  const gelesen = leseStromereignis('  \t {"type":"result","num_turns":7}  \n ');
  assert.deepEqual(gelesen, { type: "result", num_turns: 7 });
});
