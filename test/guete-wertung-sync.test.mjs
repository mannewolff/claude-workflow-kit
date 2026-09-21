// Der Nachbau `gueteAuswerten` in kit/night.mjs gegen das Original in
// kit/checks.mjs (Issue #817).
//
// Der Nacht-Runner prueft vor einem Rettungsversuch die Pflichtchecks selbst und
// muss dabei zum selben Urteil kommen wie das Kommando, das der Mensch spaeter
// fuehrt — sonst rettet er einen Stand, den `/push-main` ohnehin anhaelt. Die
// Kit-Werkzeuge sind eigenstaendige Single-File-Tools; night.mjs kennt
// checks.mjs nur als Kindprozess und traegt die Wertung deshalb selbst. Gleich
// gehalten werden beide Fassungen ueber einen `SYNC:`-Kommentar auf beiden
// Seiten und diesen Test, der sie an derselben Fallliste gegeneinander haelt.

import { test } from "node:test";
import assert from "node:assert/strict";

import { gueteAuswerten as ausChecks } from "../kit/checks.mjs";
import { gueteAuswerten as ausNight } from "../kit/night.mjs";

const PROZENT = String.raw`\((\d+)%\)`;

// Je Fall: Name, guete-Block, Ausgabe des Kommandos.
const FAELLE = [
  ["84 unter Marke 90", { muster: PROZENT, marke: 90 }, "Killed 5 (84%)"],
  ["90 genau auf Marke 90", { muster: PROZENT, marke: 90 }, "Killed 9 (90%)"],
  ["184 gegen Marke 80", { muster: PROZENT, marke: 80 }, "Killed 99 (184%)"],
  ["leere Gruppe gegen Marke 0", { muster: String.raw`(\d*)`, marke: 0 }, "BUILD SUCCESS"],
  ["Leerzeichen-Gruppe gegen Marke 0", { muster: String.raw`Score:(\s*)`, marke: 0 }, "Score:   84"],
  ["kein Treffer", { muster: PROZENT, marke: 80 }, "BUILD SUCCESS"],
];

for (const [name, guete, ausgabe] of FAELLE) {
  test(`[checks-9] [night-65] beide Wertungen urteilen gleich: ${name}`, () => {
    assert.deepEqual(ausNight(guete, ausgabe), ausChecks(guete, ausgabe));
  });
}

test("[checks-9] [night-65] die Fallliste deckt beide Ausgaenge ab — sonst waere die Gleichheit wertlos", () => {
  const urteile = new Set(FAELLE.map(([, guete, ausgabe]) => ausChecks(guete, ausgabe).erfuellt));

  assert.ok(urteile.has(true), "kein erfuellter Fall in der Liste");
  assert.ok(urteile.has(false), "kein verfehlter Fall in der Liste");
});
