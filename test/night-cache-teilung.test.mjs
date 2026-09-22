// Die Teilung des Zwischenspeichers nach Haltedauer (Issue #749, Review-Fund W2).
//
// `leseKennzahlen()` las bisher nur `usage.cache_creation_input_tokens` — eine Summe. Die
// Preistabelle (kit/preise.mjs) fuehrt fuer den Zwischenspeicher zwei Saetze,
// `cacheSchreiben5m` und `cacheSchreiben1h`, die um bis zu 60 Prozent auseinander liegen.
// Ohne die Teilung waere die Kostenverteilung aus Kriterium 2 der Auswertung geraten.
//
// Geprueft wird die reine, exportierte Funktion — ohne Subprozess, wie in
// night-kennzahlen.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { leseKennzahlen } from "../kit/night.mjs";

test("[night-45] ein result-Ereignis mit cache_creation liefert die Teilung als eigene Felder", () => {
  const zeile = JSON.stringify({
    type: "result",
    total_cost_usd: 1.5,
    duration_api_ms: 1000,
    num_turns: 3,
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 202998,
      cache_creation: { ephemeral_5m_input_tokens: 150000, ephemeral_1h_input_tokens: 52998 },
      cache_read_input_tokens: 8883160,
    },
  });
  const k = leseKennzahlen(zeile);
  assert.equal(k.cache5mTokens, 150000);
  assert.equal(k.cache1hTokens, 52998);
  // Die Summe bleibt unveraendert, auch wenn sie von der Teilung abweicht.
  assert.equal(k.cacheErzeugtTokens, 202998);
});

test("[night-45] ein result-Ereignis ohne cache_creation laesst beide Teilungsfelder null, die Summe bleibt", () => {
  const zeile = JSON.stringify({
    type: "result",
    usage: { cache_creation_input_tokens: 202998 },
  });
  const k = leseKennzahlen(zeile);
  assert.equal(k.cache5mTokens, null);
  assert.equal(k.cache1hTokens, null);
  assert.equal(k.cacheErzeugtTokens, 202998, "die Summe darf ohne Teilung nicht verschwinden");
});

test("[night-45] eine krumm getypte cache_creation liefert fuer beide Felder null", () => {
  const zeile = JSON.stringify({
    type: "result",
    usage: { cache_creation_input_tokens: 100, cache_creation: "nicht ein Objekt" },
  });
  const k = leseKennzahlen(zeile);
  assert.equal(k.cache5mTokens, null);
  assert.equal(k.cache1hTokens, null);
  assert.equal(k.cacheErzeugtTokens, 100);
});

test("[night-45] die uebrigen acht Felder bleiben unveraendert — die Feldmenge ist festgehalten", () => {
  const zeile = JSON.stringify({
    is_error: false, duration_api_ms: 296247, num_turns: 37, stop_reason: "end_turn",
    total_cost_usd: 2.41,
    usage: {
      input_tokens: 70, output_tokens: 17688,
      cache_creation_input_tokens: 202998,
      cache_creation: { ephemeral_5m_input_tokens: 150000, ephemeral_1h_input_tokens: 52998 },
      cache_read_input_tokens: 8883160,
    },
    type: "result",
  });
  const k = leseKennzahlen(zeile);
  assert.deepEqual(k, {
    kostenUsd: 2.41,
    apiDauerMs: 296247,
    zuege: 37,
    stopReason: "end_turn",
    isError: false,
    eingabeTokens: 70,
    ausgabeTokens: 17688,
    cacheErzeugtTokens: 202998,
    cacheGelesenTokens: 8883160,
    cache5mTokens: 150000,
    cache1hTokens: 52998,
  });
});
