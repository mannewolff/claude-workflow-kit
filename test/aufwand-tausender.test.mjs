// Haelt die Bedeutung des Tausendertrenners fest, den SonarQube in beiden Berichts-
// werkzeugen als super-linear meldet (S8786, Issue #877):
// `ziffern.replaceAll(/\B(?=(\d{3})+$)/g, ".")`.
//
// Der Ausdruck steht — wie die uebrigen Textformen — wortgleich in kit/aufwand.mjs und
// kit/wirksamkeit.mjs (SYNC-Vermerk aus #440). Beide werden hier gegen dieselbe Liste
// gefahren: Driften sie auseinander, faellt es hier auf und nicht erst im Bericht.
//
// Die Datei heisst nach kit/aufwand.mjs, obwohl sie beide prueft: Das Muster
// `test/aufwand-*.test.mjs` der buildChecks fasst sie damit, und dasselbe Kommando faehrt
// ohnehin auch `test/wirksamkeit-*`. Ein Name ausserhalb aller Muster liesse jedes
// kuenftige Arbeitspaket den vollen Testumfang fahren.
//
// Diese Tests liefen gegen den Stand VOR dem Umbau gruen, die Laufzeitprobe war rot.

import { test } from "node:test";
import assert from "node:assert/strict";

import { tausenderPunkte as aufwandPunkte, zahlform as aufwandZahl } from "../kit/aufwand.mjs";
import { tausenderPunkte as wirksamkeitPunkte, zahlform as wirksamkeitZahl } from "../kit/wirksamkeit.mjs";

const PUNKTE = [["aufwand", aufwandPunkte], ["wirksamkeit", wirksamkeitPunkte]];
const ZAHL = [["aufwand", aufwandZahl], ["wirksamkeit", wirksamkeitZahl]];

const ZIFFERN_PAARE = [
  ["", ""],
  ["0", "0"],
  ["7", "7"],
  ["99", "99"],
  ["999", "999"],
  ["1000", "1.000"],
  ["9999", "9.999"],
  ["12345", "12.345"],
  ["123456", "123.456"],
  ["1234567", "1.234.567"],
  ["1000000", "1.000.000"],
  ["123456789012", "123.456.789.012"],
  // Fuehrende Nullen sind Ziffern wie andere auch — gruppiert wird von hinten.
  ["0001000", "0.001.000"],
];

for (const [wo, fn] of PUNKTE) {
  test(`tausenderPunkte (${wo}) setzt den Punkt alle drei Ziffern von hinten`, () => {
    for (const [ein, aus] of ZIFFERN_PAARE) {
      assert.equal(fn(ein), aus, `Eingabe ${JSON.stringify(ein)}`);
    }
  });

  test(`tausenderPunkte (${wo}) laesst stehen, was keine reine Ziffernfolge ist`, () => {
    // `toFixed` liefert bei nicht endlichen Zahlen 'Infinity' und 'NaN'. Der alte
    // Lookahead fand dort keine Stelle, an der der Rest aus Dreiergruppen von ZIFFERN
    // bestand, und liess den Text unveraendert. Genau das muss so bleiben: 'Inf.ini.ty'
    // waere eine neue, falsche Ausgabe.
    assert.equal(fn("Infinity"), "Infinity");
    assert.equal(fn("NaN"), "NaN");
  });
}

for (const [wo, fn] of ZAHL) {
  test(`zahlform (${wo}): Komma als Dezimal-, Punkt als Tausendertrenner`, () => {
    assert.equal(fn(0, 0), "0");
    assert.equal(fn(999, 0), "999");
    assert.equal(fn(1000, 0), "1.000");
    assert.equal(fn(1234567, 0), "1.234.567");
    assert.equal(fn(1234.5, 1), "1.234,5");
    assert.equal(fn(1234567.89, 2), "1.234.567,89");
    assert.equal(fn(0.5, 1), "0,5");
    // Das Vorzeichen steht vor der Gruppierung, nicht darin.
    assert.equal(fn(-1234567, 0), "-1.234.567");
    assert.equal(fn(-1234.5, 1), "-1.234,5");
    assert.equal(fn(-0.5, 1), "-0,5");
  });
}

// --- Laufzeitprobe ----------------------------------------------------------
//
// `(\d{3})+$` im Lookahead ist der teure Teil: An JEDER Position der Zeichenkette
// probiert die Engine jede Aufteilung des Rests in Dreiergruppen durch, und das `g`-Flag
// laesst sie alle Positionen anlaufen.
//
// Eine Zahl dieser Laenge entsteht im Bericht nicht. Gemessen wird trotzdem am Ausdruck
// selbst — wie in Issue #396 begruendet: Nur so trifft die Probe den Pfad, den SonarQube
// bemaengelt, statt nur den Aufrufvertrag zu bestaetigen.

const GROSS = 32 * 1024;
const GRENZE_MS = 100;

function dauer(fn) {
  const t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

for (const [wo, fn] of PUNKTE) {
  test(`tausenderPunkte (${wo}) bleibt bei 32 KiB Ziffern unter ${GRENZE_MS} ms`, (t) => {
    const ziffern = "1".repeat(GROSS);
    const ms = dauer(() => fn(ziffern));
    t.diagnostic(`${wo}: ${ms.toFixed(2)} ms bei ${GROSS} Ziffern`);
    assert.ok(ms < GRENZE_MS, `${wo}: ${ms.toFixed(1)} ms — erwartet unter ${GRENZE_MS} ms`);
  });
}
