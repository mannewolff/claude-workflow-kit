// Tests fuer die Label-Normalisierung der listIssues-Adapter (Issue #158).
// labelNamesFrom kapselt die einzige nicht-triviale Logik: rohe Backend-Labels
// (GitLab liefert Objekte {name}, andere evtl. nackte Strings, oder das Feld
// fehlt ganz) auf ein flaches Array von Namen normalisieren. Die Adapter-Klassen
// selbst sind bewusst nicht exportiert (CLI-/fetch-Nebenwirkungen); getestet wird
// wie bei board-auth/board-create die reine, exportierte Funktion.
// Laeuft mit dem eingebauten node:test — keine Dependency: node --test

import { test } from "node:test";
import assert from "node:assert/strict";

import { labelNamesFrom } from "../kit/board.mjs";

test("GitLab-Form: Array von {name}-Objekten -> Namen", () => {
  assert.deepEqual(labelNamesFrom([{ name: "kit:nightrun" }, { name: "In review" }]), ["kit:nightrun", "In review"]);
});

test("nackte Strings bleiben erhalten", () => {
  assert.deepEqual(labelNamesFrom(["a", "b"]), ["a", "b"]);
});

test("gemischte Objekte und Strings", () => {
  assert.deepEqual(labelNamesFrom([{ name: "a" }, "b"]), ["a", "b"]);
});

test("leeres Array -> leeres Array", () => {
  assert.deepEqual(labelNamesFrom([]), []);
});

test("fehlendes Feld (undefined/null) -> leeres Array", () => {
  assert.deepEqual(labelNamesFrom(undefined), []);
  assert.deepEqual(labelNamesFrom(null), []);
});

test("kein Array (Fehlform) -> leeres Array", () => {
  assert.deepEqual(labelNamesFrom("nope"), []);
  assert.deepEqual(labelNamesFrom({ name: "x" }), []);
});

test("null-Elemente werden gefiltert", () => {
  assert.deepEqual(labelNamesFrom([{ name: "a" }, null, "b"]), ["a", "b"]);
});
