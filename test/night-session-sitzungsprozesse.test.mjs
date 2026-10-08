// Die Reserve des Bash-Limits einer Session (Issue #668, #902) — ein reiner Baustein, im
// selben Prozess gegen den Teil kit/night/session.mjs.
//
// Seit Issue #1231 eine eigene Datei: Sie stand in der Ablauf-Pruefung der wartenden
// Sitzung, die heute ablauf-night-wartend-runde.test.mjs heisst. Die Suche nach den
// Prozessen einer Session ueber ihre Marke ist mit Issue #1270 entfallen; das Warten auf
// die Prozessgruppe pruefen night-session-timeout-group.test.mjs und
// ablauf-night-wartend-runde.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { bashZeitlimit, BASH_RESERVE_MS } from "../kit/night/session.mjs";

// --- night-91: die Reserve zwischen Bash-Limit und Rundenzeitlimit (Issue #902) ---

test("[night-91] das Bash-Limit laesst der Session eine Reserve zum Melden", () => {
  // Eine Stunde Runde: die feste Reserve von zehn Minuten greift, weil sie unter den
  // 20 Prozent (12 Minuten) liegt.
  assert.equal(bashZeitlimit(60 * 60 * 1000), 50 * 60 * 1000);
  // Eine Minute Runde: jetzt greift der Anteil, sonst bliebe nichts uebrig.
  assert.equal(bashZeitlimit(60 * 1000), 48 * 1000);
  assert.equal(BASH_RESERVE_MS, 10 * 60 * 1000);
});

test("[night-91] das Bash-Limit bleibt positiv und stets unter dem Rundenzeitlimit", () => {
  for (const timeoutMs of [2, 5, 100, 1000, 60 * 1000, 40 * 60 * 1000, 60 * 60 * 1000]) {
    const grenze = bashZeitlimit(timeoutMs);
    assert.ok(grenze >= 1, `nicht positiv bei ${timeoutMs}: ${grenze}`);
    assert.ok(grenze < timeoutMs, `nicht unter dem Rundenzeitlimit bei ${timeoutMs}: ${grenze}`);
  }
});
