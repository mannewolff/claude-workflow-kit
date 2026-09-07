// Der Minimal-Glob von `spec.mjs luecken` (Issue #500, Coverage aus Plan #492).
//
// `globZuRegex` steckt Zeichen fuer Zeichen dieselbe Fassung wie in
// kit/checks.mjs — und war hier nur zur Haelfte gemessen: Die Tests von #445
// arbeiten alle mit Mustern der Form "<verzeichnis>/**", und damit blieben drei
// Zweige unberuehrt, die der Ausdruck sehr wohl kennt: das maskierte
// Sonderzeichen, das einfache '*' innerhalb eines Segments und das '**' mit
// folgendem Trenner, das ganz verschwinden darf.
//
// Gemessen wird nicht am Ausdruck selbst — er ist nicht exportiert — sondern an
// dem, was `luecken` aus ihm macht: Welche Dateien fallen unter den Bereich und
// welche nicht. Das ist die Frage, wegen der es die Funktion gibt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitFixture, spec, configSchreiben, dateiSchreiben } from "./helpers/spec-fixture.mjs";

/**
 * Legt die genannten Dateien an, setzt `spec.bereiche` auf die uebergebene
 * Zuordnung und fragt `luecken` nach dem Bereich 'alpha'. Zurueck kommt die
 * Lueckenliste — sie ist hier die Liste der erfassten Punkte, denn keine der
 * Dateien wird von einer Aussage beruehrt (specs/ fehlt ganz).
 */
function punkte(bereiche, dateien) {
  let ergebnis;
  mitFixture(null, (dir) => {
    for (const pfad of dateien) dateiSchreiben(dir, pfad);
    configSchreiben(dir, { spec: { seit: "2026-09-02", bereiche } });

    const res = spec(dir, "luecken", "--bereich", "alpha");
    assert.equal(res.status, 0, `Exit ${res.status}, stderr: ${res.stderr}`);
    ergebnis = JSON.parse(res.stdout).bereiche.alpha.luecken;
  });
  return ergebnis;
}

test("ein '*' bleibt im Segment: 'kit/*.mjs' trifft nicht in ein Unterverzeichnis", () => {
  assert.deepEqual(
    punkte({ alpha: ["kit/*.mjs"] }, ["kit/eins.mjs", "kit/unter/zwei.mjs", "kit/drei.txt"]),
    ["kit/eins.mjs"],
    "'*' steht fuer '[^/]*' — weder der Trenner noch die andere Endung duerfen durchrutschen",
  );
});

test("die Sonderzeichen des Musters werden maskiert, nicht als Regex gelesen", () => {
  // Ohne Maskierung waere der Punkt ein beliebiges Zeichen und 'kitXeins.mjs'
  // faele in den Bereich — der Glob meinte aber genau den Punkt.
  assert.deepEqual(
    punkte({ alpha: ["kit/eins.mjs"] }, ["kit/eins.mjs", "kit/einsXmjs"]),
    ["kit/eins.mjs"],
    "'.' im Muster ist ein Punkt, kein Platzhalter",
  );
});

test("'**/' darf ganz verschwinden: das Muster trifft auch im Wurzelverzeichnis", () => {
  // Genau dafuer steht der Zweig mit dem Trenner: '(?:.*/)?' ist optional, sonst
  // braeuchte jede Datei mindestens ein Verzeichnis ueber sich.
  assert.deepEqual(
    punkte({ alpha: ["**/*.md"] }, ["oben.md", "tief/unten.md", "tief/unten.txt"]),
    ["oben.md", "tief/unten.md"],
  );
});

test("'**' ohne Trenner laeuft ueber Segmentgrenzen hinweg", () => {
  assert.deepEqual(
    punkte({ alpha: ["kit/**"] }, ["kit/eins.mjs", "kit/tief/zwei.mjs", "tools/drei.mjs"]),
    ["kit/eins.mjs", "kit/tief/zwei.mjs"],
  );
});

test("ein Bereich ohne Musterliste erfasst keinen Punkt und ist trotzdem bekannt", () => {
  // `bereiche: { alpha: null }` ist die Config eines Bereichs, der benannt, aber
  // noch nicht zugeschnitten ist. Er darf nicht abstuerzen und nicht alles
  // erfassen: ohne Muster gibt es keinen Punkt, zu dem etwas fehlen koennte.
  assert.deepEqual(punkte({ alpha: null }, ["kit/eins.mjs", "tools/zwei.mjs"]), []);
});
