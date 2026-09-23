// Die Vergleichsfunktion fuer Textlisten (Issue #493, S2871).
//
// kit/checks.mjs, kit/befunde.mjs und kit/night.mjs fuehren je eine eigene
// Fassung — die Dateien sind eigenstaendige Single-File-Tools ohne gemeinsames
// Modul (#440). Der Test haelt die Zusage fest: sortiert wird mit dem
// Standardvergleich und nicht mit localeCompare, dessen Reihenfolge an der
// Locale der Maschine haengt.

import { test } from "node:test";
import assert from "node:assert/strict";

import { vergleicheText as vergleicheTextChecks } from "../kit/checks.mjs";
import { vergleicheText as vergleicheTextBefunde } from "../kit/befunde.mjs";
import { vergleicheText as vergleicheTextNight } from "../kit/night.mjs";

// Die Eingabe trennt die beiden Vergleiche: Der Standardvergleich ordnet nach
// UTF-16-Codepunkten, stellt also Grossbuchstaben vor Kleinbuchstaben und "ä"
// ans Ende. localeCompare unter `de` liefert stattdessen ["a", "ä", "b", "B"].
const EINGABE = ["b", "ä", "B", "a"];
const ERWARTET = ["B", "a", "b", "ä"];

test("vergleicheText in kit/checks.mjs sortiert mit dem Standardvergleich, nicht nach Locale", () => {
  assert.deepEqual([...EINGABE].sort(vergleicheTextChecks), ERWARTET);
});

test("vergleicheText in kit/befunde.mjs sortiert mit dem Standardvergleich, nicht nach Locale", () => {
  assert.deepEqual([...EINGABE].sort(vergleicheTextBefunde), ERWARTET);
});

test("vergleicheText in kit/night.mjs sortiert mit dem Standardvergleich, nicht nach Locale", () => {
  assert.deepEqual([...EINGABE].sort(vergleicheTextNight), ERWARTET);
});

// Alle drei Fassungen sind dieselbe Funktion — der Test faengt ein Auseinander-
// driften beim Nachziehen der SYNC-Kommentare.
test("alle drei Fassungen von vergleicheText liefern dieselbe Reihenfolge", () => {
  for (const [a, b] of [["a", "b"], ["b", "a"], ["a", "a"], ["B", "a"], ["ä", "b"]]) {
    assert.equal(vergleicheTextBefunde(a, b), vergleicheTextChecks(a, b));
    assert.equal(vergleicheTextNight(a, b), vergleicheTextChecks(a, b));
  }
});
