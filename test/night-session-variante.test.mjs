// Variantenerkennung der Nacht-Kette: varianteVon und die Weiche in der Stufenfolge
// (Plan #691, E2/E3/E12; Issue #694).
//
// varianteVon ist rein und pruefbar an Fixtures: kein Wurf, auch nicht ohne budget.
// Die Stufenfolge bleibt unter Variante A bei den vier bestehenden Stufen; das macht
// dieses Paket fuer sich pruefbar, bevor die Stufe `umsetzung` in #695 dazukommt.
//
// Die Weiche in der Stufenfolge, Vorschau, Hilfe und Schlusszeile pruefen seit Issue #1229
// die Ablauf-Pruefungen in test/ablauf-night-session-variante.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { varianteVon } from "../kit/night/session.mjs";

test("[night-33] varianteVon: Karte mit dem Label ergibt B, ohne A", () => {
  const budget = { varianteBLabel: "kit:durchziehen" };
  assert.equal(varianteVon({ labels: ["kit:night", "kit:durchziehen"] }, budget), "B");
  assert.equal(varianteVon({ labels: ["kit:night"] }, budget), "A");
});

test("[night-33] varianteVon mit einem abweichenden varianteBLabel aus dem Budget: B beim gesetzten Label und bei beiden Vorgabenamen", () => {
  const budget = { varianteBLabel: "kit:weiterziehen" };
  assert.equal(varianteVon({ labels: ["kit:weiterziehen"] }, budget), "B");
  // Seit Issue #1425 (Plan #1420, E7) gelten neben dem gesetzten Wert beide Vorgabenamen.
  assert.equal(varianteVon({ labels: ["kit:durchziehen"] }, budget), "B");
  assert.equal(varianteVon({ labels: ["kit:carry-through"] }, budget), "B");
  assert.equal(varianteVon({ labels: ["kit:sonstwas"] }, budget), "A", "ein fremdes Label zaehlt nicht");
});

test("[night-33] varianteVon bei fehlenden labels, leerem Array und fehlendem budget ergibt A ohne Wurf", () => {
  const budget = { varianteBLabel: "kit:durchziehen" };
  assert.equal(varianteVon({}, budget), "A");
  assert.equal(varianteVon({ labels: [] }, budget), "A");
  assert.equal(varianteVon({ labels: ["kit:durchziehen"] }, undefined), "A");
  assert.equal(varianteVon(undefined, budget), "A");
});
