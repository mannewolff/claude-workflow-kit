/**
 * Tests fuer kit/board/config-teile.mjs — je Einstellung ihr Teil nach Zweck
 * (Issue #1731, Plan #1710 A5 bis A7).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TEILE, ZUORDNUNG, teilVon, kennzeichenVon } from "../kit/board/config-teile.mjs";
import { SCHLUESSEL } from "../kit/board/config-namen.mjs";

const schema = JSON.parse(readFileSync(new URL("../templates/workflow.config.schema.json", import.meta.url), "utf8"));
const wurzeln = Object.keys(schema.properties);

test("TEILE in der Reihenfolge der Seite", () => {
  assert.deepEqual(TEILE, ["einrichten", "lohnt", "verwaltet", "fein"]);
});

test("jedes Wurzelfeld des Schemas hat einen Teil, unter beiden Namen", () => {
  for (const feld of wurzeln) {
    assert.ok(TEILE.includes(teilVon(feld)), `kein Teil fuer ${feld}`);
    const englisch = SCHLUESSEL[feld];
    assert.equal(teilVon(englisch), teilVon(feld), `englischer Name ${englisch}`);
  }
});

test("kein Teil nennt ein Feld, das das Schema nicht kennt", () => {
  const englisch = new Set(wurzeln.map((feld) => SCHLUESSEL[feld]));
  for (const feld of Object.keys(ZUORDNUNG)) assert.ok(englisch.has(feld), `unbekannt: ${feld}`);
  assert.equal(Object.keys(ZUORDNUNG).length, wurzeln.length);
});

test("Pfade erben den Teil ihres Wurzelfelds", () => {
  assert.equal(teilVon("night.chain.label"), "fein");
  assert.equal(teilVon("vorgeschichte"), "lohnt");
  assert.equal(teilVon("buildChecks[].cmd"), "einrichten");
  assert.equal(teilVon("unbekannt"), null);
});

test("kennzeichenVon", () => {
  assert.equal(kennzeichenVon("provider"), "veraltet");
  assert.equal(kennzeichenVon("version"), "installer");
  assert.equal(kennzeichenVon("szenarienAb"), "installer");
  assert.equal(kennzeichenVon("nurGeruest[].muster"), "intern");
  assert.equal(kennzeichenVon("history"), null);
});
