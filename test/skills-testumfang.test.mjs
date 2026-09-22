// Tests fuer die Regel zum Testumfang waehrend der Arbeit (Issue #835).
//
// Auswertung des Nachtlaufs vom 2026-09-22: Die volle Suite lief je Paket
// fuenf- bis achtmal, haeufig nur, weil dieselbe Ausgabe mit einem anderen
// Filter noch einmal gelesen werden sollte. Sie machte 96,9 % der gemessenen
// Pruefzeit aus. Die Skills schrieben bis dahin nur „TDD … bis gruen" vor und
// sagten nichts darueber, mit welchem Umfang eine Session zwischendurch testet.
//
// Geprueft wird Text, nicht Verhalten — wie in
// `test/skills-implement-checks.test.mjs`. Der Wert liegt darin, dass eine
// spaetere Umformulierung auffaellt, bevor sie eine Nacht wieder teuer macht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Alle vier Implementierungs-Skills tragen die Regel: Die Nacht startet
// `/implement-next`, interaktiv kostet derselbe Mehrfachlauf dieselbe Zeit,
// und die Zwei-Schritt-Gangart (`/implement-test` + `/implement-done`) testet
// waehrend der Arbeit genauso.
const SKILLS = ["implement-next", "implement-ready", "implement-done", "implement-test"].map(
  (name) => ({
    name,
    text: readFileSync(join(repoRoot, "skills", name, "SKILL.md"), "utf-8"),
  }),
);

const ANKER = "**Nur die Tests des Pakets laufen lassen.**";

// Der Block ab dem Anker bis zur naechsten Leerzeile nach Punkt 4.
function regelblock(text) {
  const start = text.indexOf(ANKER);
  assert.notEqual(start, -1, `der Anker ${ANKER} fehlt`);
  const ende = text.indexOf("\n\n", text.indexOf("\n4.", start));
  assert.notEqual(ende, -1, "der Regelblock endet nicht nach Punkt 4");
  return text.slice(start, ende);
}

for (const { name, text } of SKILLS) {
  test(`${name}: die Regel zum Testumfang steht im Skill`, () => {
    assert.ok(text.includes(ANKER),
      "der Skill nennt die Regel zum Testumfang nicht");
  });

  // Punkt 1: stackneutral formuliert — `node --test <datei>` nur als Beispiel,
  // weil die Skills in jedem Konsumentenprojekt gelten.
  test(`${name}: Punkt 1 verlangt den gezielten Lauf per Datei oder Filter`, () => {
    const block = regelblock(text);
    assert.match(block, /^1\..*(ber(ü|ue)hrt|ber(ü|ue)hren)/m,
      "Punkt 1 begrenzt den Lauf nicht auf die Tests, die das Paket beruehrt");
    assert.match(block, /^1\..*Datei oder Filter/m,
      "Punkt 1 nennt den gezielten Lauf nicht stackneutral (Datei oder Filter des Test-Runners)");
    assert.match(block, /node --test test\//,
      "das Beispiel fuer den gezielten Lauf fehlt");
  });

  // Punkt 2: Der eine volle Lauf ist das Commit-Gate. Er steht hier ohne
  // Schrittnummer, weil die Nummer je Skill abweicht und `/implement-test`
  // gar nicht committet.
  test(`${name}: Punkt 2 verbietet den selbst gestarteten vollen Lauf`, () => {
    const block = regelblock(text);
    assert.match(block, /^2\..*volle Suite startet die Session nicht selbst/m,
      "Punkt 2 sagt nicht, dass die Session die volle Suite nicht selbst startet");
    assert.match(block, /^2\..*checks\.mjs run/m,
      "Punkt 2 nennt den einen vollen Lauf `checks.mjs run` nicht");
  });

  // Punkt 3: Der teuerste beobachtete Fehler war der zweite Lauf fuer einen
  // anderen Ausgabefilter. Die Ablage folgt der Transportregel — Platzhalter
  // `<tmpdir>`, nicht die Variable: Ein Variablen-Redirect wird unbeaufsichtigt
  // als 'path is runtime-determined' abgewiesen (skills-9/skills-10, geprueft
  // in `test/skills-transport.test.mjs`).
  test(`${name}: Punkt 3 schreibt die Ausgabe einmal in eine Datei ausserhalb des Projekts`, () => {
    const block = regelblock(text);
    assert.match(block, /^3\..*<tmpdir>/m,
      "Punkt 3 nennt den Platzhalter `<tmpdir>` nicht");
    assert.doesNotMatch(block, /\$TMPDIR|\$\{TMPDIR\}/,
      "Punkt 3 nennt die Variable statt des Platzhalters — der Redirect waere unbeaufsichtigt abgewiesen");
    assert.match(block, /^3\..*(zweiter|Zweiter) Lauf/m,
      "Punkt 3 schliesst den zweiten Lauf fuer einen anderen Filter nicht aus");
  });

  // Punkt 4: Nach rot wird gezielt nachgebessert, nicht die ganze Suite
  // wiederholt — sonst faellt die eingesparte Zeit hinten wieder an.
  test(`${name}: Punkt 4 regelt den Weg nach einem roten Lauf`, () => {
    const block = regelblock(text);
    assert.match(block, /^4\..*rot/m,
      "Punkt 4 nennt den roten Lauf nicht");
    assert.match(block, /^4\..*fehlschlagenden Tests gezielt/m,
      "Punkt 4 verlangt nicht, zuerst die fehlschlagenden Tests gezielt laufen zu lassen");
    assert.match(block, /^4\..*erst dann erneut/m,
      "Punkt 4 sagt nicht, dass `checks.mjs run` erst nach Gruen erneut startet");
  });
}

// Eine Regel, die in vier Skills unterschiedlich lautet, ist vier Regeln. Der
// Vergleich haelt sie zusammen, wenn eine Stelle spaeter angefasst wird.
test("die Regel lautet in allen vier Skills gleich", () => {
  const [erster, ...weitere] = SKILLS;
  const vorbild = regelblock(erster.text);
  for (const { name, text } of weitere) {
    assert.equal(regelblock(text), vorbild,
      `${name} traegt eine abweichende Fassung der Regel`);
  }
});

// Die Regel steht vor dem Commit-Gate: Punkt 1 und 3 wirken waehrend der
// Arbeit. Hinter `checks.mjs run` kaemen sie zu spaet.
for (const { name, text } of SKILLS.filter((s) => s.name !== "implement-test")) {
  test(`${name}: die Regel steht vor dem Pruef-Abschnitt`, () => {
    const anker = text.indexOf(ANKER);
    const abschnitt = text.search(/### \d+\. Pruefungen vor dem Commit/);
    assert.notEqual(abschnitt, -1, "der Abschnitt 'Pruefungen vor dem Commit' fehlt");
    assert.ok(anker < abschnitt,
      "die Regel steht hinter dem Pruef-Abschnitt — dann wirkt sie waehrend der Arbeit nicht mehr");
  });
}
