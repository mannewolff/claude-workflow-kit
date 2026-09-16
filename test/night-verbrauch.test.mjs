// Der Verbrauch eines Laufs, je Einheit und ohne Einheit (Issue #669).
//
// `verbrauchAddieren` summiert die Mengen einer Session feldweise; eine fehlende Menge
// traegt nichts bei und bleibt `null`, solange nie eine kam — eine 0 behauptete, es sei
// nichts verbraucht worden. `verbrauchOhneEinheit` ist die Differenz, die nur der Runner
// kennt: Lauf-Summe minus Summe ueber die Einheiten.

import { test } from "node:test";
import assert from "node:assert/strict";

import { verbrauchAddieren, verbrauchLeer, verbrauchOhneEinheit } from "../kit/night.mjs";

const SESSION = { kostenUsd: 1.5, eingabeTokens: 10, ausgabeTokens: 20, cacheErzeugtTokens: 30, cacheGelesenTokens: 40 };

test("[night-29] verbrauchAddieren summiert feldweise und laesst Fehlendes auf null", () => {
  const ziel = verbrauchLeer();
  assert.deepEqual(ziel, { kostenUsd: null, eingabeTokens: null, ausgabeTokens: null, cacheErzeugtTokens: null, cacheGelesenTokens: null });
  verbrauchAddieren(ziel, SESSION);
  verbrauchAddieren(ziel, { kostenUsd: 0.25, eingabeTokens: 1, ausgabeTokens: null, cacheErzeugtTokens: undefined, cacheGelesenTokens: 0, zuege: 9 });
  verbrauchAddieren(ziel, null);
  assert.deepEqual(ziel, { kostenUsd: 1.75, eingabeTokens: 11, ausgabeTokens: 20, cacheErzeugtTokens: 30, cacheGelesenTokens: 40 });
  const nie = verbrauchAddieren(verbrauchLeer(), { kostenUsd: null });
  assert.equal(nie.kostenUsd, null, "eine nie gemeldete Menge bleibt null");
});

test("[night-30] der Rest ist Lauf-Summe minus Summe der Einheiten und groesser null, sobald eine Session ohne Karte lief", () => {
  const lauf = { verbrauch: verbrauchLeer(), einheiten: [{ id: "7" }, { id: "8" }, { id: "9", verbrauch: verbrauchLeer() }] };
  // Zwei Sessions an Karten, eine ohne (etwa der Vorflug).
  verbrauchAddieren(lauf.verbrauch, SESSION);
  verbrauchAddieren(lauf.einheiten[0].verbrauch = verbrauchLeer(), SESSION);
  verbrauchAddieren(lauf.verbrauch, SESSION);
  verbrauchAddieren(lauf.einheiten[1].verbrauch = verbrauchLeer(), SESSION);
  verbrauchAddieren(lauf.verbrauch, { kostenUsd: 0.1, eingabeTokens: 5, ausgabeTokens: 6, cacheErzeugtTokens: 7, cacheGelesenTokens: 8 });
  const rest = verbrauchOhneEinheit(lauf);
  assert.deepEqual(rest, { kostenUsd: 0.1, eingabeTokens: 5, ausgabeTokens: 6, cacheErzeugtTokens: 7, cacheGelesenTokens: 8 });
  for (const feld of Object.keys(rest)) assert.ok(rest[feld] > 0, `${feld} muss groesser null sein`);
});

test("[night-30] ohne Session an einer Karte ist der ganze Verbrauch Rest; ohne Lauf-Menge bleibt das Feld null", () => {
  const lauf = { verbrauch: verbrauchAddieren(verbrauchLeer(), { kostenUsd: 2, eingabeTokens: 3 }), einheiten: [{ id: "1" }] };
  assert.deepEqual(verbrauchOhneEinheit(lauf), { kostenUsd: 2, eingabeTokens: 3, ausgabeTokens: null, cacheErzeugtTokens: null, cacheGelesenTokens: null });
  assert.deepEqual(verbrauchOhneEinheit({ einheiten: [] }), verbrauchLeer());
});

test("[night-30] die Kostendifferenz traegt kein Gleitkomma-Rauschen", () => {
  const lauf = { verbrauch: verbrauchAddieren(verbrauchLeer(), { kostenUsd: 0.3 }), einheiten: [{ id: "1", verbrauch: verbrauchAddieren(verbrauchLeer(), { kostenUsd: 0.1 }) }, { id: "2", verbrauch: verbrauchAddieren(verbrauchLeer(), { kostenUsd: 0.2 }) }] };
  assert.equal(verbrauchOhneEinheit(lauf).kostenUsd, 0);
});
