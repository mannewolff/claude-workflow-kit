// Die Push-Stufe faehrt den vollen Umfang (Issue #849, Plan #843, E9).
//
// Vor dem Push gilt seit Fachplan #837 (AK 11) dasselbe wie vor der Freigabe:
// Gemessen wird der Stand, der veroeffentlicht wird, und der besteht aus mehr
// als dem letzten Arbeitspaket. Frueher greifen an dieser Stufe das leere Paket
// und die Bereichsauswahl — beide zeigten auf den falschen Vergleich.
//
// Der Fehler ginge in die stille Richtung: Ein Push, der wegen unberuehrten
// Bereichs oder leeren Pakets nichts prueft, meldet Exit 0 und sieht im Bericht
// aus wie ein vollstaendiger Lauf. Deshalb prueft jeder Test hier nicht nur, WAS
// laeuft, sondern auch den Grund — und die Gegenprobe an der Paketstufe, damit
// die Eingrenzung dort nicht mit verschwindet.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mitRepo, plan, run, zusammenfassung, datei, eintrag, kommandos,
} from "./helpers/checks-repo.mjs";

const BEREICHE = { frontend: ["frontend/**"], backend: ["backend/**"] };

const GRUND = "Veroeffentlichungsstufe: voller Umfang";

/** Je eine Pruefung an jeder Stufe, zwei davon an einen Bereich gebunden. */
const CONFIG = {
  buildChecks: [
    { cmd: "echo build", areas: ["frontend"] },
    { cmd: "echo verify", areas: ["backend"] },
    { cmd: "echo e2e", areas: ["backend"], stufe: "push" },
    { cmd: "echo release", stufe: "merge" },
  ],
  checkAreas: BEREICHE,
};

test("[checks-7] die Push-Stufe faehrt jede faellige Pruefung, auch im unberuehrten Bereich", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir, "--stufe", "push");

    assert.deepEqual(ergebnis.bereiche, ["frontend"], "der Bereich ist beruehrt");
    assert.deepEqual(kommandos(ergebnis.laufen), ["echo build", "echo verify", "echo e2e"]);
    for (const cmd of ["echo build", "echo verify", "echo e2e"]) {
      assert.equal(eintrag(ergebnis.laufen, cmd).grund, GRUND);
    }
    // Die spaetere Stufe bleibt aus — die Kumulation aendert sich nicht.
    assert.deepEqual(kommandos(ergebnis.ausgelassen), ["echo release"]);
    assert.equal(eintrag(ergebnis.ausgelassen, "echo release").grund, "Stufe merge, gefahren wird push");
  });
});

test("[checks-7] die Push-Stufe faehrt jede faellige Pruefung, auch wenn das Paket leer ist", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    const ergebnis = plan(dir, "--stufe", "push");

    assert.equal(ergebnis.leeresPaket, false, "an der Push-Stufe greift die Leerpaket-Auslassung nicht");
    assert.deepEqual(ergebnis.geaendert, [], "das Paket ist trotzdem leer, und das steht auch so da");
    assert.deepEqual(kommandos(ergebnis.laufen), ["echo build", "echo verify", "echo e2e"]);
    assert.deepEqual(kommandos(ergebnis.ausgelassen), ["echo release"]);
  });
});

test("[checks-7] vollerUmfang bleibt an der Push-Stufe false — sie ist eine Entscheidung, kein Zweifel", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir, "--stufe", "push");

    assert.equal(ergebnis.vollerUmfang, false);
  });
});

test("[checks-7] die Paketstufe grenzt unveraendert ein", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir);

    assert.deepEqual(kommandos(ergebnis.laufen), ["echo build"]);
    assert.equal(eintrag(ergebnis.laufen, "echo build").grund, "Bereich frontend beruehrt");
    assert.equal(eintrag(ergebnis.ausgelassen, "echo verify").grund, "Bereich backend unberuehrt");
    assert.equal(eintrag(ergebnis.ausgelassen, "echo e2e").grund, "Stufe push, gefahren wird paket");
    assert.equal(eintrag(ergebnis.ausgelassen, "echo release").grund, "Stufe merge, gefahren wird paket");
  });
});

test("[checks-7] die Paketstufe laesst bei leerem Paket unveraendert jede Pruefung aus", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    const ergebnis = plan(dir);

    assert.equal(ergebnis.leeresPaket, true);
    assert.deepEqual(ergebnis.laufen, []);
  });
});

test("[checks-7] die Freigabestufe faehrt weiterhin alles, mit demselben Grund", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir, "--stufe", "merge");

    assert.deepEqual(kommandos(ergebnis.laufen), ["echo build", "echo verify", "echo e2e", "echo release"]);
    assert.deepEqual(ergebnis.ausgelassen, []);
    for (const cmd of kommandos(ergebnis.laufen)) {
      assert.equal(eintrag(ergebnis.laufen, cmd).grund, GRUND);
    }
  });
});

test("[checks-7] die Push-Stufe bestimmt basis, geaendert und hashes wie ein Lauf ohne das Flag", () => {
  // Der Nachweis, gegen den das Commit-Gate den Index prueft (gate-1), bleibt
  // aus dem Anker bestimmt — nur die Auswahl ist eine andere.
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    assert.equal(run(dir).status, 0);
    const ohneFlag = zusammenfassung(dir);
    assert.equal(run(dir, "--stufe", "push").status, 0);
    const mitFlag = zusammenfassung(dir);

    assert.equal(mitFlag.basis, ohneFlag.basis);
    assert.deepEqual(mitFlag.geaendert, ohneFlag.geaendert);
    assert.deepEqual(mitFlag.hashes, ohneFlag.hashes);
    assert.deepEqual(kommandos(ohneFlag.laufen), ["echo build"]);
    assert.deepEqual(kommandos(mitFlag.laufen), ["echo build", "echo verify", "echo e2e"]);
  });
});
