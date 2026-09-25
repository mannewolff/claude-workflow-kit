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

// Der Block ab dem Anker bis zur naechsten Leerzeile nach Punkt 5.
function regelblock(text) {
  const start = text.indexOf(ANKER);
  assert.notEqual(start, -1, `der Anker ${ANKER} fehlt`);
  const ende = text.indexOf("\n\n", text.indexOf("\n5.", start));
  assert.notEqual(ende, -1, "der Regelblock endet nicht nach Punkt 5");
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

  // Plan #917, E3: Der gezielte Lauf endet nicht an der geaenderten Datei. Wer
  // nur ihre eigenen Tests faehrt, uebersieht, was von ihr abhaengt — die
  // eingesparte Zeit zahlt sich dann als roter Commit-Lauf zurueck.
  test(`${name}: der Block verlangt auch die Tests der Abhaengigen`, () => {
    const block = regelblock(text);
    assert.match(block, /abh(ä|ae)ng/,
      "der Block sagt nicht, dass auch die Tests der Abhaengigen laufen");
  });

  // Gibt es die Tests der Abhaengigen nur als vollstaendige Gruppe, ist der
  // Bereichslauf der sanktionierte Weg — kein Verstoss gegen die
  // Zehn-Minuten-Marke, und der Beobachter zaehlt ihn getrennt.
  test(`${name}: der Block nennt den sanktionierten Gruppenlauf`, () => {
    const block = regelblock(text);
    assert.match(block, /checks\.mjs run --bereich <name>/,
      "der Block nennt den Bereichslauf `checks.mjs run --bereich <name>` nicht");
    assert.match(block, /kein Versto(ß|ss)/,
      "der Block sagt nicht, dass der Bereichslauf kein Verstoss gegen die Zehn-Minuten-Marke ist");
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

  // Punkt 3: Der teuerste beobachtete Fehler war der zweite Lauf auf
  // unveraendertem Stand. Seit Issue #863 verhindert ihn das Werkzeug selbst —
  // der Skill NENNT die Wiederverwendung nur noch, statt eine Bedienregel dagegen
  // aufzustellen. Genannt werden muss sie trotzdem: Wer sie nicht kennt, deutet
  // die Meldung als uebersprungene Pruefung.
  test(`${name}: Punkt 3 nennt die Wiederverwendung auf unveraendertem Stand`, () => {
    const block = regelblock(text);
    assert.match(block, /^3\..*unver(ä|ae)ndertem Stand/m,
      "Punkt 3 nennt den unveraenderten Stand nicht");
    assert.match(block, /^3\..*--frisch/m,
      "Punkt 3 nennt den Schalter `--frisch` nicht, mit dem der echte Lauf erzwungen wird");
  });

  // Punkt 4: Die Ablage aus Issue #835 — jetzt als Hinweis, nicht mehr als
  // Vorgabe. Sie folgt weiter der Transportregel: Platzhalter `<tmpdir>`, nicht
  // die Variable, denn ein Variablen-Redirect wird unbeaufsichtigt als 'path is
  // runtime-determined' abgewiesen (skills-9/skills-10, geprueft in
  // `test/skills-transport.test.mjs`).
  test(`${name}: Punkt 4 haelt die Datei-Ablage als Hinweis bereit`, () => {
    const block = regelblock(text);
    assert.match(block, /^4\..*<tmpdir>/m,
      "Punkt 4 nennt den Platzhalter `<tmpdir>` nicht");
    assert.doesNotMatch(block, /\$TMPDIR|\$\{TMPDIR\}/,
      "Punkt 4 nennt die Variable statt des Platzhalters — der Redirect waere unbeaufsichtigt abgewiesen");
  });

  // Punkt 5: Nach rot wird gezielt nachgebessert, nicht die ganze Suite
  // wiederholt — sonst faellt die eingesparte Zeit hinten wieder an.
  test(`${name}: Punkt 5 regelt den Weg nach einem roten Lauf`, () => {
    const block = regelblock(text);
    assert.match(block, /^5\..*rot/m,
      "Punkt 5 nennt den roten Lauf nicht");
    assert.match(block, /^5\..*fehlschlagenden Tests gezielt/m,
      "Punkt 5 verlangt nicht, zuerst die fehlschlagenden Tests gezielt laufen zu lassen");
    assert.match(block, /^5\..*erst dann erneut/m,
      "Punkt 5 sagt nicht, dass `checks.mjs run` erst nach Gruen erneut startet");
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
