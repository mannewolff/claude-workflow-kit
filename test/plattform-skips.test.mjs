// Kein Test ueberspringt sich wegen des Plattformnamens (Issue #1138, Plan #1128 E6).
//
// Die Windows-Pruefung soll nichts auslassen, was unter macOS und Linux geprueft wird.
// Erlaubt bleiben nur Skips nach einer Faehigkeit, die auch dort fehlen kann: ein
// Dateisystem ohne Unterschied zwischen Gross- und Kleinschreibung, eine fehlende CLI,
// der Lauf als root. Ein Skip nach dem Plattformnamen ist dagegen eine Luecke, die erst
// auffaellt, wenn unter Windows etwas bricht, das niemand gemessen hat.
//
// Die Erkennungsregel ist die Art `skips` aus `tools/windows-brueche.mjs` (Issue #1157,
// Plan #1150 E19) und wird dort beschrieben und geprueft. Dieser Waechter bleibt
// blockierend: Ein Fund macht ihn rot, ein Vermerk nimmt hier nichts aus.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { skipFunde } from "../tools/windows-brueche.mjs";

const SELBST = fileURLToPath(import.meta.url);
const TESTS = dirname(SELBST);
// Die eingebauten Brueche des Werkzeugs sind Absicht (Plan #1150, E17).
const FIXTURES = join(TESTS, "fixtures", "windows-brueche");

function testdateien(dir) {
  if (dir === FIXTURES) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const pfad = join(dir, e.name);
    if (e.isDirectory()) return testdateien(pfad);
    return e.name.endsWith(".mjs") && pfad !== SELBST ? [pfad] : [];
  });
}

function fundeIn(datei) {
  return skipFunde(readFileSync(join(TESTS, datei), "utf-8"));
}

test("[plattform-skips] kein Test in test/ ueberspringt sich wegen des Plattformnamens", () => {
  const funde = testdateien(TESTS).flatMap((pfad) =>
    skipFunde(readFileSync(pfad, "utf-8")).map((zeile) => `${relative(TESTS, pfad)}:${zeile}`));
  assert.deepEqual(funde, [],
    `Skip nach Plattformnamen statt nach Faehigkeit (Plan #1128, E6):\n${funde.join("\n")}`);
});

test("[plattform-skips] die eingebauten Brueche unter test/fixtures/windows-brueche/ zaehlen nicht", () => {
  assert.deepEqual(testdateien(FIXTURES), []);
  assert.ok(!testdateien(TESTS).some((pfad) => pfad.startsWith(FIXTURES)));
});

test("[plattform-skips] die Faehigkeits-Skips nach E6 gelten nicht als Fund", () => {
  // root (checks-hash), Gross-/Kleinschreibung (board-luecken, board-kontext-notiz),
  // fehlende CLI (cli-grammar).
  for (const datei of ["checks-hash.test.mjs", "board-luecken.test.mjs", "board-kontext-notiz.test.mjs", "cli-grammar.test.mjs"]) {
    assert.deepEqual(fundeIn(datei), [], `${datei} traegt einen Plattform-Skip`);
  }
});
