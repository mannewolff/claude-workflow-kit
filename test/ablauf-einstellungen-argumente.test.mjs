// Ablauf-Pruefung: der Abbruch mit Meldung bei einem falschen Argument entsteht erst in main() von kit/einstellungen.mjs, also nur beim Start als Programm.
//
// Die Argumente der Oberflaeche: `leseArgumente` aus kit/einstellungen.mjs (Issue #1096).
//
// Direkt aufgerufen, ohne Server: Geprueft wird der Rueckgabewert. Nur der fehlerhafte Port
// geht zusaetzlich einmal durch die Kommandozeile, weil der Abbruch mit Meldung erst in
// main() entsteht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { leseArgumente } from "../kit/einstellungen.mjs";

const EINSTELLUNGEN = join(dirname(fileURLToPath(import.meta.url)), "..", "kit", "einstellungen.mjs");

test("[einstellungen-1096] ein Ordner als Argument wird der Ordner der Oberflaeche", () => {
  const args = leseArgumente(["/ein/projekt"]);
  assert.deepEqual(args, { ordner: "/ein/projekt", port: 0, version: false, hilfe: false });
});

test("[einstellungen-1096] ohne Ordner gilt das Arbeitsverzeichnis, mit --port <n> der Port", () => {
  const args = leseArgumente(["--port", "8123"]);
  assert.equal(args.ordner, process.cwd());
  assert.equal(args.port, 8123);
  assert.equal("fehler" in args, false, "ein gueltiger Port traegt keinen Fehler");
});

test("[einstellungen-1096] ein fehlerhafter Port fuehrt zum Abbruch mit Meldung", () => {
  for (const wert of ["abc", "70000", "-1", "1.5"]) {
    assert.equal(leseArgumente(["--port", wert]).fehler, "--port braucht eine Zahl zwischen 0 und 65535",
      `--port ${wert} haette abgewiesen werden muessen`);
  }
  assert.ok(leseArgumente(["--port"]).fehler, "--port ohne Wert haette abgewiesen werden muessen");

  const res = spawnSync(process.execPath, [EINSTELLUNGEN, "--port", "abc"], { encoding: "utf-8" });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /^Fehler: --port braucht eine Zahl zwischen 0 und 65535$/m);
  assert.equal(res.stdout, "", "bei einem Fehler startet kein Server");
});

test("[einstellungen-1096] --version setzt die Versionsabfrage", () => {
  const args = leseArgumente(["--version"]);
  assert.equal(args.version, true);
  assert.equal(args.hilfe, false);
});

test("[einstellungen-1096] --help und -h setzen die Hilfe", () => {
  assert.equal(leseArgumente(["--help"]).hilfe, true);
  assert.equal(leseArgumente(["-h"]).hilfe, true);
  assert.equal(leseArgumente(["--help"]).version, false);
});

test("[einstellungen-1096] ein unbekanntes Argument gilt als Ordner", () => {
  // Es gibt keine Liste bekannter Optionen: Was keine ist, nimmt leseArgumente als Ordner,
  // und erst main() weist einen Ordner ab, den es nicht gibt.
  const args = leseArgumente(["--unbekannt"]);
  assert.equal(args.ordner, "--unbekannt");
  assert.equal("fehler" in args, false);

  const res = spawnSync(process.execPath, [EINSTELLUNGEN, "--unbekannt"], { encoding: "utf-8" });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /^Fehler: Ordner --unbekannt gibt es nicht$/m);
});
