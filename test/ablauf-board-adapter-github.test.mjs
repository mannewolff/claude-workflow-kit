// Ablauf-Pruefung: Das Praefix "Unerwarteter Fehler" vergibt allein der catch-Block um main() im Einstieg kit/board.mjs; der Adapter wirft nur, und im selben Prozess ist dieser Block nicht erreichbar.
//
// Rest der GitHub-Adapter-Tests aus `board-github-schreiben.test.mjs` (Issue #188,
// #836). Die uebrigen Tests laufen seit Issue #1217 im selben Prozess gegen
// kit/board/adapter.mjs (`board-adapter-github-*.test.mjs`); dieser eine prueft die
// Fehlerform der CLI und startet sie darum als Kindprozess.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runBoard } from "./helpers/board-fixture.mjs";
import { mitProjekt } from "./helpers/board-github-fixture.mjs";

// Ein Fehler, der nicht aus dem Adapter kommt (hier: gh liefert kaputtes JSON),
// muss als "Unerwarteter Fehler" erkennbar sein — nicht als Bedienfehler.
test("Unerwartete Fehler tragen ein anderes Praefix als BoardError", () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "get", "42"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Unerwarteter Fehler: /);
  }, {
    regeln: [{ match: "^issue view", stdout: "kein JSON" }],
  });
});
