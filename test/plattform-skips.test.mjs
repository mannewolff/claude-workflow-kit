// Kein Test ueberspringt sich wegen des Plattformnamens (Issue #1138, Plan #1128 E6).
//
// Die Windows-Pruefung soll nichts auslassen, was unter macOS und Linux geprueft wird.
// Erlaubt bleiben nur Skips nach einer Faehigkeit, die auch dort fehlen kann: ein
// Dateisystem ohne Unterschied zwischen Gross- und Kleinschreibung, eine fehlende CLI,
// der Lauf als root. Ein Skip nach `win32` ist dagegen eine Luecke, die erst auffaellt,
// wenn unter Windows etwas bricht, das niemand gemessen hat.
//
// Erkennungsregel: Eine Zeile, die `win32` enthaelt und in derselben Anweisung `skip`
// oder eine Konstante `NUR_POSIX*` nennt, ist ein Fund. Das Wort `win32` allein ist
// erlaubt — Tests mit injizierter Plattform (`plattform: "win32"`) sind erwuenscht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SELBST = fileURLToPath(import.meta.url);
const TESTS = dirname(SELBST);

const VERBOTEN = /\bskip\b|\bNUR_POSIX\w*/;
// Wo eine Anweisung endet: Was danach folgt, gehoert nicht mehr zur Skip-Bedingung.
const ANWEISUNG_ENDET = /[;{]$|\),?$/;
const HOECHSTENS_ZEILEN = 4;

/**
 * Die Funde in einem Quelltext: je Zeile mit `win32`, deren Anweisung `skip` oder
 * `NUR_POSIX*` nennt, die Zeilennummer (ab 1).
 */
function skipFunde(quelle) {
  const zeilen = quelle.split(/\r?\n/);
  const funde = [];
  zeilen.forEach((zeile, i) => {
    if (!zeile.includes("win32")) return;
    let anweisung = zeile;
    for (let j = i; j < zeilen.length && j < i + HOECHSTENS_ZEILEN; j++) {
      if (j > i) anweisung += `\n${zeilen[j]}`;
      if (ANWEISUNG_ENDET.test(zeilen[j].trimEnd())) break;
    }
    if (VERBOTEN.test(anweisung)) funde.push(i + 1);
  });
  return funde;
}

function testdateien(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const pfad = join(dir, e.name);
    if (e.isDirectory()) return testdateien(pfad);
    return e.name.endsWith(".mjs") && pfad !== SELBST ? [pfad] : [];
  });
}

function fundeIn(datei) {
  return skipFunde(readFileSync(join(TESTS, datei), "utf-8"));
}

test("[plattform-skips] kein Test in test/ ueberspringt sich wegen win32", () => {
  const funde = testdateien(TESTS).flatMap((pfad) =>
    skipFunde(readFileSync(pfad, "utf-8")).map((zeile) => `${relative(TESTS, pfad)}:${zeile}`));
  assert.deepEqual(funde, [],
    `Skip nach Plattformnamen statt nach Faehigkeit (Plan #1128, E6):\n${funde.join("\n")}`);
});

test("[plattform-skips] eine eingeschleuste Skip-Zeile mit win32 ist ein Fund", () => {
  const quelle = [
    'test("x", () => {});',
    'test("y", { skip: process.platform === "win32" }, () => {});',
  ].join("\n");
  assert.deepEqual(skipFunde(quelle), [2]);
});

test("[plattform-skips] eine NUR_POSIX-Konstante ueber mehrere Zeilen ist ein Fund", () => {
  const quelle = [
    'const NUR_POSIX_SYMLINK = process.platform === "win32"',
    '  ? { skip: "Windows: kein Privileg." }',
    "  : {};",
  ].join("\n");
  assert.deepEqual(skipFunde(quelle), [1]);
  // Der Skip steht erst in der Folgezeile: Auch das ist dieselbe Anweisung.
  assert.deepEqual(skipFunde('const OHNE = process.platform === "win32"\n  ? { skip: "Windows" }\n  : {};'), [1]);
});

test("[plattform-skips] eine injizierte Plattform ist kein Fund", () => {
  const quelle = [
    'const r = gitBashPfad({ plattform: "win32", existiert: () => true });',
    "assert.equal(r.pfad, null);",
    'test("z", { skip: !hatGh }, () => {});',
  ].join("\n");
  assert.deepEqual(skipFunde(quelle), []);
});

test("[plattform-skips] die Faehigkeits-Skips nach E6 gelten nicht als Fund", () => {
  // root (checks-hash), Gross-/Kleinschreibung (board-luecken, board-kontext-notiz),
  // fehlende CLI (cli-grammar).
  for (const datei of ["checks-hash.test.mjs", "board-luecken.test.mjs", "board-kontext-notiz.test.mjs", "cli-grammar.test.mjs"]) {
    assert.deepEqual(fundeIn(datei), [], `${datei} traegt einen Plattform-Skip`);
  }
});
