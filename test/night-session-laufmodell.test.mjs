// Das Modell des Laufs kommt aus der Config (Issue #994).
//
// Bis dahin stand es fest im Code (`DEFAULT_MODEL`), und nur `--model` konnte es aendern.
// `night.modelle` ist bloss die Liste der erlaubten Namen, `night.stufen` gilt nur fuer
// Pakete mit `Aufgabenstufe:` — ein Projekt, das ueberall `claude-opus-5-5` eingetragen
// hatte, fuhr Plan, Review und Abdeckung trotzdem mit `claude-opus-5`.
//
// Vorrang: `--model` vor `night.modell` vor `DEFAULT_MODEL`. `night.modell` muss in
// `night.modelle` stehen; sonst endet der Runner vor dem Vorflug, statt still auf ein
// Modell zurueckzufallen, das niemand gewaehlt hat.
//
// Die Startzeile des Runners und sein Abbruch vor dem Start stehen seit Issue #1229 in
// test/ablauf-night-session-laufmodell.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { laufModell } from "../kit/night/session.mjs";

const ERLAUBT = ["claude-opus-5-5", "claude-sonnet-5"];

// --- Die reine Funktion ---

test("laufModell: --model gewinnt vor night.modell", () => {
  const r = laufModell({ model: "claude-sonnet-5", modelGesetzt: true }, { night: { modell: "claude-opus-5-5", modelle: ERLAUBT } });
  assert.deepEqual(r, { modell: "claude-sonnet-5", herkunft: "--model", fehler: null });
});

test("laufModell: ohne --model gilt night.modell", () => {
  const r = laufModell({ model: "claude-opus-5", modelGesetzt: false }, { night: { modell: "claude-opus-5-5", modelle: ERLAUBT } });
  assert.deepEqual(r, { modell: "claude-opus-5-5", herkunft: "night.modell", fehler: null });
});

test("laufModell: ohne beides gilt die Vorgabe", () => {
  const r = laufModell({ model: "claude-opus-5", modelGesetzt: false }, { night: { modelle: ERLAUBT } });
  assert.deepEqual(r, { modell: "claude-opus-5", herkunft: "Vorgabe", fehler: null });
  assert.equal(laufModell({ model: "claude-opus-5", modelGesetzt: false }, {}).herkunft, "Vorgabe");
});

test("laufModell: night.modell ausserhalb von night.modelle ist ein Fehler, der Feld und Wert nennt", () => {
  const r = laufModell({ model: "claude-opus-5", modelGesetzt: false }, { night: { modell: "claude-haiku-4-5", modelle: ERLAUBT } });
  assert.equal(r.modell, null);
  assert.match(r.fehler, /night\.modell/);
  assert.match(r.fehler, /claude-haiku-4-5/);
  assert.match(r.fehler, /night\.modelle/);
});

test("laufModell: ohne night.modelle ist jedes night.modell ein Fehler", () => {
  const r = laufModell({ model: "claude-opus-5", modelGesetzt: false }, { night: { modell: "claude-opus-5-5" } });
  assert.equal(r.modell, null);
  assert.match(r.fehler, /claude-opus-5-5/);
});

test("laufModell: --model wird wie bisher nicht gegen night.modelle geprueft", () => {
  const r = laufModell({ model: "claude-fremd-1", modelGesetzt: true }, { night: { modell: "claude-opus-5-5", modelle: ERLAUBT } });
  assert.deepEqual(r, { modell: "claude-fremd-1", herkunft: "--model", fehler: null });
});
