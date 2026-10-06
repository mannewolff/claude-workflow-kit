// Ablauf-Pruefung: Die Nachbardatei preise.mjs wird beim Laden des Moduls gesucht, und Exit-Code und Fehlerzeile setzt nur die Kommandozeile.
//
// Die uebrigen Tests von kit/aufwand.mjs rufen das Werkzeug im selben Prozess ueber
// `aufrufen` (Issue #1213, Plan #1199 E6). Zwei Dinge belegt nur ein echter Prozess:
//
//   - Fehlt kit/preise.mjs neben aufwand.mjs, entfaellt die Kostenteilung mit Vermerk.
//     Ob die Datei daneben liegt, entscheidet das Modul einmal beim Laden — die Frage
//     laesst sich darum nur an einer Kopie ohne Nachbarn stellen.
//   - Der Start als Kommandozeile setzt den Exit-Code und schreibt den Fehler nach stderr.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { mitProjekt, lauf, einheit, bericht } from "./helpers/aufwand-fixture.mjs";

const AUFWAND = join(dirname(fileURLToPath(import.meta.url)), "..", "kit", "aufwand.mjs");

function cli(programm, dir, ...cliArgs) {
  return spawnSync(process.execPath, [programm, ...cliArgs], { cwd: dir, encoding: "utf-8" });
}

test("[aufwand-1] fehlt kit/preise.mjs als Nachbardatei, entfaellt die Kostenteilung mit Vermerk", () => {
  const laeufe = [lauf("2026-09-01-100000", {
    einheiten: [einheit(1, { kostenUsd: 4.25 })],
  })];
  mitProjekt({ laeufe }, (dir) => {
    const kopie = join(dir, "kit-ohne-preise");
    mkdirSync(kopie, { recursive: true });
    copyFileSync(AUFWAND, join(kopie, "aufwand.mjs"));
    const res = cli(join(kopie, "aufwand.mjs"), dir, "auswerten");

    assert.equal(res.status, 0, `ohne Preistabelle darf nichts abstuerzen: ${res.stderr}`);
    const e = JSON.parse(res.stdout);
    assert.equal(e.kosten.preistabelle, null, "ohne Nachbardatei gibt es keinen Stand der Tabelle");
    assert.equal(e.kosten.lesenUsd.wert, null, "ohne Preise darf kein Satz geraten werden");
    assert.equal(e.kosten.schreibenUsd.wert, null);
    assert.equal(e.kosten.gesamtUsd.wert, 4.25, "der gemeldete Betrag bleibt bestimmbar");
    assert.equal(e.kosten.nichtZuordenbarUsd.wert, 4.25);
    assert.match(bericht(dir), /Preistabelle/i, "der Bericht nennt die fehlende Preistabelle nicht");
  });
});

test("[aufwand-1213] die Kommandozeile gibt JSON aus und setzt bei einem Fehler Exit 1 mit Fehlerzeile", () => {
  mitProjekt({ laeufe: [] }, (dir) => {
    const gut = cli(AUFWAND, dir, "auswerten");
    assert.equal(gut.status, 0, gut.stderr);
    assert.equal(JSON.parse(gut.stdout).laeufe.gefunden, 0);

    const schlecht = cli(AUFWAND, dir, "befund", "--zuviel");
    assert.equal(schlecht.status, 1);
    assert.equal(schlecht.stdout, "");
    assert.match(schlecht.stderr, /^Fehler: 'befund' nimmt keine Argumente/);
  });
});
