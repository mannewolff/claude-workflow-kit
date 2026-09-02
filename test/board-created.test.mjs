// Anlagedatum in `issue get` (Issue #457).
//
// Das Gate aus Ausbaustufe 4 wertet nur Pakete, die ab einem Stichtag angelegt
// wurden. Dafuer braucht es je Paket ein Anlagedatum — bis #457 lieferte das nur
// der local-Tracker, und dort als "" statt als Abwesenheit.
//
// createdFrom vereinheitlicht die vier Formen, analog zu labelNamesFrom (#158)
// und normalizeComments (kanban-kit#449). Es kuerzt auf den Kalendertag, den die
// Plattform nennt — ohne Umrechnung in eine Zeitzone: Das Gate vergleicht Tage,
// und "in UTC umrechnen" und "den Tag nehmen, den die Plattform nennt" sind
// verschiedene Ergebnisse.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createdFrom } from "../kit/board.mjs";

test("UTC-Form mit Z wird auf den Kalendertag gekuerzt", () => {
  assert.deepEqual(createdFrom("2026-08-14T09:12:33Z"), { created: "2026-08-14" });
});

// Der Offset wird NICHT verrechnet: 23:30+02:00 waere in UTC der 14.08. 21:30 —
// derselbe Tag, aber bei 01:30+02:00 waere es der Vortag. Der Tag, den die
// Plattform nennt, ist der Tag, den das Gate sieht.
test("Offset-Form wird gekuerzt, nicht in eine Zeitzone umgerechnet", () => {
  assert.deepEqual(createdFrom("2026-08-14T23:30:00+02:00"), { created: "2026-08-14" });
});

test("Ein reines Datum bleibt unveraendert", () => {
  assert.deepEqual(createdFrom("2026-01-02"), { created: "2026-01-02" });
});

// Ein erfundenes Anlagedatum waere schlimmer als keins: Das Gate wuerde ein altes
// Paket als neu werten und an ihm scheitern. Deshalb fehlt das Feld, statt "" oder
// "heute" zu liefern.
test("Fehlender Wert: das Feld fehlt im Ergebnis", () => {
  assert.deepEqual(createdFrom(undefined), {});
  assert.equal("created" in createdFrom(undefined), false);
});

test("Leerer Wert: das Feld fehlt im Ergebnis", () => {
  assert.deepEqual(createdFrom(""), {});
});

test("Formwidriger Wert: das Feld fehlt im Ergebnis", () => {
  assert.deepEqual(createdFrom("14.08.2026"), {});
  assert.deepEqual(createdFrom("2026-8-4"), {});
  assert.deepEqual(createdFrom("gestern"), {});
});

// Der Toolbox-Adapter zieht mehrere Feldnamen in Betracht, weil der richtige nicht
// gegen die Live-Instanz belegt ist (#457, manueller Pruefpunkt).
test("Mehrere Kandidaten: der erste gueltige gewinnt", () => {
  assert.deepEqual(createdFrom(undefined, "2026-08-14T09:12:33Z"), { created: "2026-08-14" });
  assert.deepEqual(createdFrom("", "2026-03-01"), { created: "2026-03-01" });
  assert.deepEqual(createdFrom("2026-01-02", "2026-03-01"), { created: "2026-01-02" });
  assert.deepEqual(createdFrom(undefined, null, ""), {});
  assert.deepEqual(createdFrom(), {});
});

test("Nicht-String: das Feld fehlt im Ergebnis", () => {
  assert.deepEqual(createdFrom(null), {});
  assert.deepEqual(createdFrom(1755158400000), {});
  assert.deepEqual(createdFrom({ tag: "2026-08-14" }), {});
});
