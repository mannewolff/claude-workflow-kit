// Die Argumente des Nacht-Runners im selben Prozess (Issue #404, #517, #640, #867, #1224).
//
// `parseArgs` stand bis Issue #1224 nur ueber einen Start von kit/night.mjs zur Pruefung.
// Seit die Grundlagen ein eigener Teil sind, laeuft der Parser hier direkt; ein Abbruch geht
// ueber `fail` an den angebundenen `laufAbbrechen`, den der Test werfen laesst.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseArgs, loeseModusDefaults, grundlagenAnbinden, DEFAULT_MODEL, DEFAULT_LABEL, DEFAULT_MAX_SESSIONS,
  DEFAULT_MAX_KETTEN,
} from "../kit/night/grundlagen.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

class Abbruch extends Error {}
grundlagenAnbinden({ laufAbbrechen: (grund) => { throw new Abbruch(grund); } });

/** Der Parser ohne die Zeile `Fehler: …`, die fail() auf stderr schreibt. */
function lies(...argv) {
  const schreiben = process.stderr.write;
  process.stderr.write = () => true;
  try {
    return parseArgs(argv);
  } finally {
    process.stderr.write = schreiben;
  }
}

test("ohne Argumente gelten die Vorgaben der Implementierung", () => {
  const args = lies();
  assert.equal(args.max, DEFAULT_MAX_SESSIONS);
  assert.equal(args.model, DEFAULT_MODEL);
  assert.equal(args.modelGesetzt, false);
  assert.equal(args.label, DEFAULT_LABEL);
  assert.equal(args.timeoutMin, 60);
  assert.equal(args.verbose, true);
  assert.equal(args.kette, false);
  assert.equal(args.pruefen, false);
});

test("Flags mit Wert und Schalter landen in ihren Feldern", () => {
  const args = lies("--max", "4", "--model", "m", "--label", "none", "--timeout-min", "9", "--dry-run", "--yolo", "--no-checks-ok");
  assert.deepEqual(
    { max: args.max, model: args.model, modelGesetzt: args.modelGesetzt, label: args.label, labelGesetzt: args.labelGesetzt, timeoutMin: args.timeoutMin, dryRun: args.dryRun, yolo: args.yolo, noChecksOk: args.noChecksOk },
    { max: 4, model: "m", modelGesetzt: true, label: "none", labelGesetzt: true, timeoutMin: 9, dryRun: true, yolo: true, noChecksOk: true },
  );
});

test("--verbose nimmt nur no und yes und verschluckt kein folgendes Flag (Issue #867)", () => {
  assert.equal(lies("--verbose", "no").verbose, false);
  assert.equal(lies("--verbose", "yes").verbose, true);
  const ohneWert = lies("--verbose", "--max", "5");
  assert.equal(ohneWert.verbose, true);
  assert.equal(ohneWert.max, 5);
  assert.throws(() => lies("--verbose", "off"), /--verbose kennt nur die Werte no und yes \(gelesen: off\)/);
});

test("die Kette zaehlt Ketten und braucht keine Pruefung der Paketstufe (Issue #517)", () => {
  const args = lies("--kette");
  assert.equal(args.max, DEFAULT_MAX_KETTEN);
  assert.equal(args.noChecksOk, true);
  assert.equal(lies("--kette", "--max", "1").max, 1);
});

test("der Prueflauf faehrt ohne Zahlendeckel, prueft aber ein gesetztes --max", () => {
  assert.equal(lies("--pruefen").max, null);
  assert.throws(() => lies("--pruefen", "--max", "0"), /--max braucht eine Zahl >= 1/);
});

test("loeseModusDefaults laesst einen gesetzten Wert stehen, auch einen unbrauchbaren", () => {
  assert.deepEqual(loeseModusDefaults({ max: null }), { max: DEFAULT_MAX_SESSIONS });
  assert.ok(Number.isNaN(loeseModusDefaults({ max: Number.NaN }).max));
  assert.deepEqual(loeseModusDefaults({ max: null, kette: true }), { max: DEFAULT_MAX_KETTEN, noChecksOk: true });
});

for (const [argv, meldung] of [
  [["--kette", "--pruefen"], /--kette und --pruefen sind zwei Laeufe/],
  [["--pruefen", "--dry-run"], /Der Prueflauf hat keine Vorschau/],
  [["--kette", "--label", "x"], /--kette kennt kein --label/],
  [["--pruefen", "--label", "x"], /--pruefen kennt kein --label/],
  [["--max", "abc"], /--max braucht eine Zahl >= 1/],
  [["--timeout-min", "0"], /--timeout-min braucht eine Zahl >= 1/],
  [["--gibtsnicht"], /Unbekanntes Argument: --gibtsnicht — siehe --help/],
]) {
  test(`${argv.join(" ")} wird abgewiesen`, () => {
    assert.throws(() => lies(...argv), (err) => err instanceof Abbruch && meldung.test(err.message));
  });
}

for (const flags of [["--review"], ["--erzeuge"], ["--stufe", "plan"], ["--review-label", "x"], ["--erzeuge-label", "x"]]) {
  test(`[night-15] ${flags[0]} nennt --kette statt eines unbekannten Arguments`, () => {
    assert.throws(() => lies(...flags), (err) => {
      assert.match(err.message, new RegExp(`${flags[0]} gibt es seit Stufe 2 nicht mehr; die Nacht-Kette ist --kette`));
      assert.doesNotMatch(err.message, /Unbekanntes Argument/);
      return true;
    });
  });
}

test("die Hilfe des Einstiegs nennt dieselben Vorgaben wie die Grundlagen (SYNC)", () => {
  // Der Einstieg beantwortet --help vor dem Laden der Teile und fuehrt die Vorgaben darum als
  // Text. Gelesen wird die Quelle, nicht ein Start: Der Wortlaut genuegt fuer den Gleichlauf.
  const einstieg = readFileSync(join(repoRoot, "kit", "night.mjs"), "utf-8");
  assert.ok(einstieg.includes(`sonst night.modell, sonst ${DEFAULT_MODEL})`), "die Hilfe nennt ein anderes Vorgabemodell");
  assert.ok(einstieg.includes(`(Default ${DEFAULT_LABEL}); --label none`), "die Hilfe nennt ein anderes Vorgabelabel");
});
