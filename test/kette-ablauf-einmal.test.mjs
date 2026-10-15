// Ablauf-Pruefung: einmalLaufen legt sein Fixture ueber setupProjekt aus helpers/kette-ablauf.mjs an, dem Prozess-Fixture des Runners; die Tests hier starten den Runner selbst nicht.
//
// Ein geteilter Lauf je Datei (Plan #1685, E9; Issue #1693).
//
// `einmalLaufen(schluessel, fn)` faehrt einen Lauf hoechstens einmal je Datei und gibt jedem
// Leser dieselbe eingefrorene Kopie seines Ergebnisses. Das Fixture-Verzeichnis gehoert
// allein dem Helfer; er raeumt es erst im `after()` der Datei ab, nach dem letzten Leser.
// Scheitert der Lauf, scheitert jeder Leser mit derselben Meldung.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { einmalLaufen } from "./helpers/kette-ablauf.mjs";

// Jedes Verzeichnis, das ein Test hier sah. Das `after()` dieser Datei steht hinter dem des
// Helfers — es ist spaeter angemeldet und laeuft darum nach ihm.
const gesehen = new Set();
after(() => {
  for (const dir of gesehen) assert.equal(existsSync(dir), false, `das Verzeichnis ${dir} liegt nach dem after() noch`);
});

test("ein zweiter Aufruf mit gleichem Schluessel startet keinen zweiten Lauf", () => {
  let laeufe = 0;
  const lauf = () => einmalLaufen("zaehlen", () => {
    laeufe += 1;
    return { nummer: laeufe };
  });
  const erster = lauf();
  const zweiter = lauf();
  assert.equal(laeufe, 1, "der Lauf startete ein zweites Mal");
  assert.equal(zweiter, erster, "der zweite Leser bekam ein anderes Ergebnis");
  assert.equal(zweiter.nummer, 1);
  gesehen.add(erster.dir);

  // Ein anderer Schluessel ist ein anderer Lauf, in einem eigenen Verzeichnis.
  const anderer = einmalLaufen("zaehlen-anders", () => ({ nummer: 99 }));
  assert.notEqual(anderer.dir, erster.dir);
  gesehen.add(anderer.dir);
});

test("das Ergebnis ist eine eingefrorene Kopie", () => {
  const original = { liste: [1, 2], tief: { wert: "a" } };
  const ergebnis = einmalLaufen("einfrieren", (dir) => {
    writeFileSync(join(dir, "lauf.txt"), "gelaufen\n");
    return original;
  });
  gesehen.add(ergebnis.dir);
  assert.equal(existsSync(join(ergebnis.dir, "lauf.txt")), true, "der Lauf bekam das Verzeichnis nicht");

  assert.ok(Object.isFrozen(ergebnis), "das Ergebnis ist nicht eingefroren");
  assert.ok(Object.isFrozen(ergebnis.liste) && Object.isFrozen(ergebnis.tief), "eine tiefere Ebene ist nicht eingefroren");
  assert.throws(() => { ergebnis.liste.push(3); }, TypeError);
  assert.throws(() => { ergebnis.tief.wert = "b"; }, TypeError);

  // Eine Kopie: Was der Lauf danach an seinem eigenen Objekt aendert, erreicht keinen Leser.
  original.liste.push(3);
  assert.deepEqual(einmalLaufen("einfrieren", () => assert.fail("zweiter Lauf")).liste, [1, 2]);
  assert.equal(Object.isFrozen(original), false, "der Helfer fror das Objekt des Laufs selbst ein");
});

test("scheitert der Lauf, scheitert jeder Leser mit derselben Meldung", () => {
  let laeufe = 0;
  const lauf = () => einmalLaufen("scheitern", () => {
    laeufe += 1;
    throw new Error("der Lauf ist gescheitert");
  });
  assert.throws(lauf, { message: "der Lauf ist gescheitert" });
  assert.throws(lauf, { message: "der Lauf ist gescheitert" });
  assert.equal(laeufe, 1, "der gescheiterte Lauf startete ein zweites Mal");
});

test("das Verzeichnis liegt nach dem ersten Leser noch — abgeraeumt wird erst im after() der Datei", () => {
  // Derselbe Schluessel wie im ersten Test; einzeln gestartet faehrt dieser Test den Lauf selbst.
  const { dir } = einmalLaufen("zaehlen", () => ({ nummer: 1 }));
  assert.equal(existsSync(dir), true, "das Verzeichnis wurde vor dem after() abgeraeumt");
  gesehen.add(dir);
});
