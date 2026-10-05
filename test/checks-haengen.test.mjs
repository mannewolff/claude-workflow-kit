// Eine haengende Pruefung wird abgebrochen (Issue #1077).
//
// In der Nacht zum 30.09.2026 hing im Abschlusslauf von #1069 ein Test 30 Minuten lang.
// `checks.mjs` vermerkte die Obergrenze nur und wartete, bis das Werkzeug der Session
// aufgab. Jetzt hat jede Pruefung eine Abbruchgrenze: das Fuenffache des Medians ihrer
// gruenen Laeufe, mindestens drei Minuten, ohne Historie 15 Minuten. Wer sie reisst,
// wird mit seiner ganzen Prozessgruppe beendet und steht als haengend rot da.
//
// Die Tests setzen Mindestwert, Vorgabe und Abbruchfrist ueber die Umgebung herab —
// wie `KIT_CHECKS_PRUEFDAUER_OBERGRENZE_MS` —, damit niemand Minuten schlafen muss.
// `run` laeuft im selben Prozess (Issue #1212). Den Abbruch einer haengenden Pruefung
// samt Enkel und die Weitergabe eines Signals an `checks.mjs` belegt
// `ablauf-checks-haengen.test.mjs`: Dort sterben echte Prozesse, und darauf wird gewartet.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { checksMit, mitRepo, datei, eintrag, zusammenfassung } from "./helpers/checks-repo.mjs";
import { HAENGER_HELFER, helferAufruf } from "./helpers/haenger-aufruf.mjs";
import {
  haengeGrenzeMs, HAENGEN_FAKTOR, HAENGEN_MINDEST_MS, HAENGEN_VORGABE_MS,
} from "../kit/checks.mjs";

// --- Die Grenze aus der Historie -------------------------------------------

const zeile = (cmd, ergebnis, dauerMs) => ({ cmd, ergebnis, dauerMs });

test("ohne Historie gilt die Vorgabe", async () => {
  assert.equal(haengeGrenzeMs("npm test", [], {}), HAENGEN_VORGABE_MS);
  assert.equal(haengeGrenzeMs("npm test", [zeile("anderes", "gruen", 1000)], {}), HAENGEN_VORGABE_MS);
});

test("rote Laeufe zaehlen nicht zur Historie", async () => {
  assert.equal(haengeGrenzeMs("npm test", [zeile("npm test", "rot", 9_000_000)], {}), HAENGEN_VORGABE_MS);
});

test("mit Historie gilt das Vielfache des Medians der gruenen Laeufe", async () => {
  const min = (s) => s * 60_000;
  const zeilen = [4, 5, 6].map((m) => zeile("npm test", "gruen", min(m)));
  assert.equal(haengeGrenzeMs("npm test", zeilen, {}), HAENGEN_FAKTOR * min(5));
});

test("die Grenze faellt nie unter den Mindestwert", async () => {
  const zeilen = [1000, 2000, 3000].map((ms) => zeile("npm test", "gruen", ms));
  assert.equal(haengeGrenzeMs("npm test", zeilen, {}), HAENGEN_MINDEST_MS);
});

test("Mindestwert und Vorgabe lassen sich ueber die Umgebung herabsetzen", async () => {
  const env = { KIT_CHECKS_HAENGEN_MINDEST_MS: "100", KIT_CHECKS_HAENGEN_VORGABE_MS: "200" };
  assert.equal(haengeGrenzeMs("x", [], env), 200);
  assert.equal(haengeGrenzeMs("x", [zeile("x", "gruen", 10)], env), 100);
  assert.equal(haengeGrenzeMs("x", [], { KIT_CHECKS_HAENGEN_VORGABE_MS: "keine Zahl" }), HAENGEN_VORGABE_MS);
});

// --- Der Abbruch im echten Lauf ----------------------------------------------

const FRIST_MS = 60_000;
const UMGEBUNG = {
  KIT_CHECKS_HAENGEN_VORGABE_MS: "1500",
  KIT_CHECKS_HAENGEN_MINDEST_MS: "1500",
  KIT_CHECKS_HAENGEN_FRIST_MS: "500",
};

function runMit(dir, env = {}) {
  return checksMit(dir, { env }, "run");
}

const KURZ = helferAufruf("warte", "200");

test("ein Kommando unter der Grenze bleibt unberuehrt", { timeout: FRIST_MS }, async () => {
  await mitRepo({ config: { buildChecks: [{ cmd: KURZ }] } }, async (dir) => {
    datei(dir, "src/x.txt");
    const res = await runMit(dir, UMGEBUNG);
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    const lauf = eintrag(zusammenfassung(dir).laufen, KURZ);
    assert.equal(lauf.ergebnis, "gruen");
    assert.equal(lauf.haengend, undefined);
    assert.ok(!existsSync(join(dir, "enkel.pid")));
  });
});

// `node --test` ohne Pfade fuehrt jede `.mjs` unter `test/` aus, auch den Helfer — ohne
// Argument muss er darum still und gruen enden, sonst ist die ganze Suite rot (Issue #1142).
test("der Helfer endet ohne Modus still mit Exit 0, ein unbekannter Modus bleibt laut", async () => {
  const leer = spawnSync(process.execPath, [HAENGER_HELFER], { encoding: "utf-8" });
  assert.equal(leer.status, 0, leer.stderr);
  assert.equal(leer.stdout + leer.stderr, "");

  const unsinn = spawnSync(process.execPath, [HAENGER_HELFER, "unsinn"], { encoding: "utf-8" });
  assert.equal(unsinn.status, 2);
  assert.match(unsinn.stderr, /unbekannter Modus unsinn/);
});
