// Tests fuer die Create-Response-Interpretation des Toolbox-Adapters (Issue #141, Bug #140).
// kanban-kit >= 1.5 legt Creates als board-lose Pool-Idee an und liefert nur { id };
// aeltere Backends liefern { number } fuer die angelegte Board-Karte.
// Laeuft mit dem eingebauten node:test — keine Dependency:  node --test

import { test } from "node:test";
import assert from "node:assert/strict";

import { interpretToolboxCreateResponse } from "../kit/board.mjs";

test("Alter Vertrag: number vorhanden -> Board-Karte mit Anzeigenummer", () => {
  const result = interpretToolboxCreateResponse({ id: 73, number: 42 });
  assert.deepEqual(result, { id: "42" });
});

test("Neuer Pool-Vertrag: nur id -> ideaId + pending, keine Board-Nummer", () => {
  const result = interpretToolboxCreateResponse({ id: 80 });
  assert.deepEqual(result, { id: null, ideaId: "80", pending: true });
});

test("number: null wird wie fehlend behandelt (Pool-Fall)", () => {
  const result = interpretToolboxCreateResponse({ id: 80, number: null });
  assert.deepEqual(result, { id: null, ideaId: "80", pending: true });
});

test("Weder number noch id: harter Fehler mit Response-Auszug, nie 'undefined'", () => {
  assert.throws(
    () => interpretToolboxCreateResponse({ foo: "bar" }),
    /Create-Response.*foo.*bar/s
  );
});

test("Leere oder fehlende Response: harter Fehler", () => {
  assert.throws(() => interpretToolboxCreateResponse({}), /Create-Response/);
  assert.throws(() => interpretToolboxCreateResponse(null), /Create-Response/);
});
