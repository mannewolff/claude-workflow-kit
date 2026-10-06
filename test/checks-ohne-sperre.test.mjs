// Keine rechnerweite Pruefsperre mehr (Issue #1241, Plan #1199 E12).
//
// Bis #1241 nahm `checks.mjs run` vor dem ersten Kommando eine Sperre im Temp-Verzeichnis,
// und ein zweiter Lauf wartete auf den ersten. Kriterium 2 von #1198 verlangt, dass es
// keine Stelle mehr gibt, an der sich die Prueflaeufe aller Projekte anstellen. Der
// Lastbeleg mit drei gleichzeitigen Laeufen war ohne Wartezeit gruen (#1239). Zwei echte
// gleichzeitige Laeufe zeigt test/ablauf-checks-ohne-sperre.test.mjs; hier steht, was ohne
// Prozessstart pruefbar ist.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CHECKS = join(dirname(fileURLToPath(import.meta.url)), "..", "kit", "checks.mjs");

test("[1241] checks.mjs kennt die Sperre nicht mehr", () => {
  const quelle = readFileSync(CHECKS, "utf-8");
  for (const name of ["KIT_CHECKS_LOCK", "mitSperre", "kit-checks-run.lock"]) {
    assert.ok(!quelle.includes(name), `${name} steht noch in kit/checks.mjs`);
  }
});
