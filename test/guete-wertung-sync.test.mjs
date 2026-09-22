// Die Nachbauten `gueteAuswerten` (Issue #817) und `fehlermerkmal` (Issue #859)
// in kit/night.mjs gegen ihre Originale in kit/checks.mjs.
//
// Der Nacht-Runner prueft vor einem Rettungsversuch die Pflichtchecks selbst und
// muss dabei zum selben Urteil kommen wie das Kommando, das der Mensch spaeter
// fuehrt — sonst rettet er einen Stand, den `/push-main` ohnehin anhaelt. Die
// Kit-Werkzeuge sind eigenstaendige Single-File-Tools; night.mjs kennt
// checks.mjs nur als Kindprozess und traegt beide Urteile deshalb selbst. Gleich
// gehalten werden sie ueber einen `SYNC:`-Kommentar auf beiden Seiten und diesen
// Test, der je Nachbau beide Fassungen an derselben Fallliste gegeneinander haelt.
//
// Die Fehlermerkmale stehen hier NICHT woertlich: Diese Suite laeuft selbst unter
// der Merkmal-Pruefung dieses Repos, und ein Merkmal in einem Testnamen faerbte
// den eigenen Prueflauf rot. Deshalb entstehen die Literale erst zur Laufzeit —
// derselbe Weg wie in test/checks-fehlermerkmal.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { gueteAuswerten as ausChecks, fehlermerkmal as merkmalAusChecks } from "../kit/checks.mjs";
import { gueteAuswerten as ausNight, fehlermerkmal as merkmalAusNight } from "../kit/night.mjs";

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

// --- Die Merkmal-Pruefung (Issue #859) --------------------------------------

/** Die beiden Merkmale, zur Laufzeit gebaut — siehe Kopfkommentar. */
const MERKMAL_STUFE = `${String.fromCharCode(91)}ERROR${String.fromCharCode(93)}`;
const MERKMAL_BAU = ["BUILD", "FAILURE"].join(" ");

// Je Fall: Name und Ausgabe des Kommandos.
const MERKMAL_FAELLE = [
  ["erstes Merkmal allein", `Tests laufen\n${MERKMAL_STUFE} Checkstyle\n`],
  ["zweites Merkmal allein", `nur das zweite: ${MERKMAL_BAU}`],
  ["beide Merkmale, das zweite zuerst", `x\n${MERKMAL_BAU}\ny\n${MERKMAL_STUFE}\n`],
  ["gruene Ausgabe", "alles gut, 42 Tests gruen\nBUILD SUCCESS\n"],
  ["leere Ausgabe", ""],
  [
    "ein Merkmal mitten in einer langen Ausgabe",
    `${"Zeile ohne Befund\n".repeat(400)}${MERKMAL_STUFE} spaet im Log\n${"noch eine Zeile\n".repeat(400)}`,
  ],
];

for (const [name, ausgabe] of MERKMAL_FAELLE) {
  test(`[checks-9] [night-65] beide Merkmal-Pruefungen urteilen gleich: ${name}`, () => {
    assert.equal(merkmalAusNight(ausgabe), merkmalAusChecks(ausgabe));
  });
}

test("[checks-9] [night-65] die Merkmal-Fallliste deckt beide Ausgaenge ab", () => {
  const urteile = new Set(MERKMAL_FAELLE.map(([, ausgabe]) => merkmalAusChecks(ausgabe)));

  assert.ok([...urteile].some((u) => u !== null), "kein getroffener Fall in der Liste");
  assert.ok(urteile.has(null), "kein merkmalfreier Fall in der Liste");
  assert.ok(urteile.has(MERKMAL_STUFE) && urteile.has(MERKMAL_BAU), "nicht beide Merkmale in der Liste");
});
