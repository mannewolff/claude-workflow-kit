// Gründlichkeit je Aufgabenstufe (Issue #845, Plan #843 E1, E2).
//
// `night.stufen.<stufe>.effort` geht als `--effort` an die Claude-CLI. Einem fremden
// Programm kann das Kit keine Gründlichkeit setzen — neben `kommando` ist das Feld
// deshalb ein Konfigurationsfehler und wird nicht stillschweigend ignoriert.
//
// Geprüft wird auf beiden Ebenen: Das Schema weist die Form ab (über den
// Mini-Validator, gefahren gegen das in kit/einstellungen.mjs eingebettete Schema —
// so fällt zugleich auf, wenn tools/sync-blobs.mjs nicht lief), die Zusatzregel
// benennt das Feld mit seinem Pfad.

import { test } from "node:test";
import assert from "node:assert/strict";

import { pruefe, zusatzregeln, SCHEMA } from "../kit/einstellungen.mjs";
import { pruefe as pruefeMini } from "./helpers/mini-validator.mjs";

const fehler = (befunde) => befunde.filter((b) => b.art === "fehler");
const STUFENSCHEMA = SCHEMA.properties.night.properties.stufen.properties.leicht;
const config = (leicht) => ({
  reviewModel: "claude-opus-5",
  night: { modelle: ["claude-opus-5", "claude-sonnet-5"], stufen: { leicht } },
});

const WERTE = ["low", "medium", "high", "xhigh", "max"];

test("[einstellungen-8] effort neben modell wird für jeden der fünf Werte angenommen", () => {
  for (const wert of WERTE) {
    const eintrag = { modell: "claude-sonnet-5", effort: wert };
    assert.deepEqual(zusatzregeln(config(eintrag)), [], `${wert}: Zusatzregel meldet einen Befund`);
    assert.deepEqual(fehler(pruefe(config(eintrag), null)), [], `${wert}: Prüfung meldet einen Fehler`);
    assert.deepEqual(pruefeMini(STUFENSCHEMA, eintrag), [], `${wert}: das Schema weist den Eintrag ab`);
  }
});

test("[einstellungen-8] effort neben kommando ergibt einen Befund am Pfad night.stufen.<stufe>.effort", () => {
  const eintrag = { kommando: "mein-runner", name: "Mein Runner", effort: "high" };
  const b = zusatzregeln(config(eintrag));
  assert.equal(b.length, 1);
  assert.equal(b[0].pfad, "night.stufen.leicht.effort");
  assert.equal(b[0].art, "fehler");
  assert.match(b[0].grund, /kommando/);
  assert.ok(
    fehler(pruefe(config(eintrag), null)).some((f) => f.pfad === "night.stufen.leicht.effort"),
    "die Prüfung über beide Ebenen meldet den Pfad nicht",
  );
  assert.ok(pruefeMini(STUFENSCHEMA, eintrag).length > 0, "das Schema lässt effort neben kommando durch");
});

test("[einstellungen-8] ein Wert außerhalb der fünf ergibt einen Befund am selben Pfad", () => {
  const eintrag = { modell: "claude-sonnet-5", effort: "gruendlich" };
  const b = zusatzregeln(config(eintrag));
  assert.equal(b.length, 1);
  assert.equal(b[0].pfad, "night.stufen.leicht.effort");
  assert.equal(b[0].art, "fehler");
  assert.match(b[0].grund, /gruendlich/);
  assert.ok(
    fehler(pruefe(config(eintrag), null)).some((f) => f.pfad === "night.stufen.leicht.effort"),
    "die Prüfung über beide Ebenen meldet den Pfad nicht",
  );
  assert.ok(pruefeMini(STUFENSCHEMA, eintrag).length > 0, "das Schema lässt einen unbekannten Wert durch");
});

test("[einstellungen-8] ohne effort bleibt alles beim Alten", () => {
  for (const eintrag of [{ modell: "claude-sonnet-5" }, { kommando: "mein-runner", name: "Mein Runner" }]) {
    assert.deepEqual(zusatzregeln(config(eintrag)), []);
    assert.deepEqual(fehler(pruefe(config(eintrag), null)), []);
    assert.deepEqual(pruefeMini(STUFENSCHEMA, eintrag), []);
  }
});

test("[einstellungen-8] jede der drei Stufen kennt effort mit denselben fünf Werten", () => {
  for (const stufe of ["schwer", "mittel", "leicht"]) {
    const feld = SCHEMA.properties.night.properties.stufen.properties[stufe].properties.effort;
    assert.ok(feld, `night.stufen.${stufe}.effort fehlt im Schema`);
    assert.deepEqual(feld.enum, WERTE, `night.stufen.${stufe}.effort führt andere Werte`);
    assert.match(feld.description, /--effort/, `night.stufen.${stufe}.effort nennt das Flag nicht`);
    assert.match(feld.description, /Voreinstellung/, `night.stufen.${stufe}.effort nennt die Voreinstellung nicht`);
  }
});
