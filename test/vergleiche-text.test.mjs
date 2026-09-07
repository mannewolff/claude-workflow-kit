// Die Vergleichsfunktion fuer Textlisten (Issue #493, S2871).
//
// kit/spec.mjs und kit/checks.mjs fuehren je eine eigene Fassung — beide Dateien
// sind eigenstaendige Single-File-Tools ohne gemeinsames Modul (#440). Der Test
// haelt fuer beide dieselbe Zusage fest: sortiert wird mit dem Standardvergleich
// und nicht mit localeCompare, dessen Reihenfolge an der Locale der Maschine
// haengt.

import { test } from "node:test";
import assert from "node:assert/strict";

import { vergleicheText as vergleicheTextSpec } from "../kit/spec.mjs";
import { vergleicheText as vergleicheTextChecks } from "../kit/checks.mjs";

// Die Eingabe trennt die beiden Vergleiche: Der Standardvergleich ordnet nach
// UTF-16-Codepunkten, stellt also Grossbuchstaben vor Kleinbuchstaben und "ä"
// ans Ende. localeCompare unter `de` liefert stattdessen ["a", "ä", "b", "B"].
const EINGABE = ["b", "ä", "B", "a"];
const ERWARTET = ["B", "a", "b", "ä"];

test("vergleicheText in kit/spec.mjs sortiert mit dem Standardvergleich, nicht nach Locale", () => {
  assert.deepEqual([...EINGABE].sort(vergleicheTextSpec), ERWARTET);
});

test("vergleicheText in kit/checks.mjs sortiert mit dem Standardvergleich, nicht nach Locale", () => {
  assert.deepEqual([...EINGABE].sort(vergleicheTextChecks), ERWARTET);
});
