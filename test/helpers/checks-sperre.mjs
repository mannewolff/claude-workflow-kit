// Ein eigener Sperrpfad je Testprozess (Issue #958, Aufgabe 3).
//
// `checks.mjs run` nimmt seit Issue #958 eine MASCHINENWEITE Sperre, damit zwei
// Runner auf einer Maschine ihre Pruefungen nicht gleichzeitig fahren. Genau das
// darf die eigene Testsuite nicht treffen: `node --test` faehrt die Testdateien
// parallel, und 82 der 196 Dateien starten Subprozesse. Jeder Test, der `run` echt
// ausfuehrt, wuerde dieselbe Vorgabe-Sperre nehmen wie jeder andere — die Suite
// liefe Datei fuer Datei statt parallel. Das ist die eine Wirkung, die das Paket
// nicht haben darf: Es arbeitete gegen das Ziel, die Pruefzeit zu senken.
//
// Der Hebel ist die Umgebung des TESTPROZESSES, nicht die jedes einzelnen Aufrufs:
// `node --test` gibt jeder Testdatei einen eigenen Prozess, und jeder Kindprozess
// erbt `process.env`. Ein Import dieses Moduls deckt damit auch die spawn-Aufrufe,
// die an den Helfern vorbeigehen (etwa der direkte `spawn` in
// checks-lauf-abbruch.test.mjs) und die, die ueber night.mjs mittelbar bei
// `checks.mjs run` landen.
//
// Das Wegwerf-Verzeichnis liegt AUSSERHALB der Wegwerf-Projekte, nicht in ihnen:
// Eine Sperrdatei im Projekt waere fuer `git status` ein ungetrackter Rest — sie
// zoege jeden Lauf in den vollen Umfang und liesse den Rest-Guard der Nacht-Tests
// anschlagen.
//
// `??=`, nicht `=`: Ein Test, der den Pfad selbst setzt — die Tests der Sperre
// selbst —, behaelt seinen.

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Der Name der Umgebungsvariablen — dieselbe Konstante nennt kit/checks.mjs. */
export const SPERRE_ENV = "KIT_CHECKS_LOCK";

let eigenesVerzeichnis = null;

if (!process.env[SPERRE_ENV]) {
  eigenesVerzeichnis = mkdtempSync(join(tmpdir(), "checks-sperre-"));
  process.env[SPERRE_ENV] = join(eigenesVerzeichnis, "checks-run.lock");
  // Aufraeumen am Prozessende: Ein `finally` je Test gaebe es nicht, weil der Pfad
  // einmal je Datei gilt. Fehler werden geschluckt — ein liegengebliebenes
  // Wegwerf-Verzeichnis ist kein Befund ueber das Kit.
  process.on("exit", () => {
    try {
      rmSync(eigenesVerzeichnis, { recursive: true, force: true });
    } catch { /* schon weg oder belegt */ }
  });
}

/** Der Sperrpfad dieses Testprozesses. */
export const sperrpfad = process.env[SPERRE_ENV];
