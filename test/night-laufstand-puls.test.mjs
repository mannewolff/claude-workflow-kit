// Die Pulsfelder `art` und `phase` (Issue #1250, Plan #1243, E8).
//
// Ein Lauf, der auf die Vorbereitung der Veroeffentlichung wartet, muss andere Laeufe
// erkennen: Ein Prueflauf baut nicht, und ein Lauf, der selbst in seiner Vorbereitung
// wartet, darf nicht als bauend zaehlen. Beides traegt der Puls. Weil der Takt
// `pulsSchreiben()` ohne Angabe ruft und die Datei jedes Mal neu schreibt, sind `art` und
// `phase` Zustand des Teils, gesetzt ueber `pulsZustandSetzen`.
//
// Uhr und Prozess-Probe sind Attrappen (helpers/laufstand-attrappe.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";

import { laufstandStarten, pulsSchreiben, pulsZustandSetzen, laufLebt, LAUF_ORDNER } from "../kit/night/laufstand.mjs";
import { ZUSTAND } from "../kit/night/grundlagen.mjs";
import { mitProjekt } from "./helpers/laufstand-attrappe.mjs";

const LAUF = "2026-10-06-220000";
const FREMD = "2026-10-06-210000";
const TOTE_PID = 4_000_002;

const pulsLesen = (dir, lauf = LAUF) => JSON.parse(readFileSync(join(dir, LAUF_ORDNER, `${lauf}.puls`), "utf-8"));

/** Startet den Laufstand mit Stempel und Laufart wie im Einstieg. */
function starten(art = "kette") {
  ZUSTAND.LAUF_STEMPEL = LAUF;
  ZUSTAND.LAUF = { art };
  laufstandStarten();
}

test("[night-1250] laufstandStarten traegt die Laufart als art in den Puls", async () => {
  await mitProjekt(({ dir }) => {
    starten("pruefung");
    const puls = pulsLesen(dir);
    assert.equal(puls.art, "pruefung");
    assert.equal(puls.pid, process.pid);
    assert.ok(puls.zeit, "der Puls traegt keine Zeit mehr");
    assert.equal("phase" in puls, false, "ohne gesetzte Phase steht keine im Puls");
  });
});

test("[night-1250] pulsZustandSetzen schreibt die Phase, und sie besteht ueber den naechsten Takt fort", async () => {
  await mitProjekt(({ dir, uhr }) => {
    starten("kette");
    pulsZustandSetzen({ phase: "vorbereitung-wartet" });
    assert.equal(pulsLesen(dir).phase, "vorbereitung-wartet", "die Phase stand nicht sofort im Puls");
    uhr.vor(60_000);
    pulsSchreiben();
    const puls = pulsLesen(dir);
    assert.equal(puls.phase, "vorbereitung-wartet", "der Takt ohne Angabe hat die Phase geloescht");
    assert.equal(puls.art, "kette", "die Phase hat die Laufart verdraengt");
    assert.equal(puls.zeit, "2026-10-01T01:01:00.000Z", "der Takt hat die Zeit nicht erneuert");
  });
});

test("[night-1250] ein undefined nimmt das Feld zurueck, ein nicht genanntes bleibt", async () => {
  await mitProjekt(({ dir }) => {
    starten("kette");
    pulsZustandSetzen({ phase: "vorbereitung-wartet" });
    pulsZustandSetzen({ phase: undefined });
    pulsSchreiben();
    const puls = pulsLesen(dir);
    assert.equal("phase" in puls, false, "die Phase blieb nach dem Zuruecknehmen stehen");
    assert.equal(puls.art, "kette");
    pulsZustandSetzen({ art: undefined });
    pulsSchreiben();
    assert.equal("art" in pulsLesen(dir), false, "die Laufart blieb nach dem Zuruecknehmen stehen");
  });
});

test("[night-1250] laufLebt ist exportiert und wertet weiter allein die PID", async () => {
  await mitProjekt(({ dir }) => {
    const ordner = join(dir, LAUF_ORDNER);
    mkdirSync(ordner, { recursive: true });
    const puls = (lauf, inhalt) => writeFileSync(join(ordner, `${lauf}.puls`), inhalt, "utf-8");
    puls(LAUF, JSON.stringify({ zeit: "2026-10-06T22:00:00.000Z", pid: process.pid, art: "pruefung", phase: "vorbereitung-wartet" }));
    puls(FREMD, JSON.stringify({ zeit: "2026-10-06T21:00:00.000Z", pid: TOTE_PID }));
    puls("unlesbar", "kein json");
    assert.equal(laufLebt(dir, LAUF), true, "der lebende Lauf gilt als tot");
    assert.equal(laufLebt(dir, FREMD), false, "der tote Lauf gilt als lebend");
    assert.equal(laufLebt(dir, "unlesbar"), false, "ein unlesbarer Puls gilt als lebend");
    assert.equal(laufLebt(dir, "fehlt"), false, "ein fehlender Puls gilt als lebend");
  });
});

// --- Der Puls wird atomar geschrieben (Issue #1262) ---
//
// `writeFileSync` leert die Datei und schreibt sie dann. Stirbt der Runner dazwischen oder
// liest der Waechter genau dann, steht kein Lebenszeichen mehr da. Darum entsteht der Puls
// in einer temporaeren Datei daneben und ersetzt den alten erst mit dem Umbenennen.

const pulsOrdner = (dir) => readdirSync(join(dir, LAUF_ORDNER));

test("[night-1262] nach jedem Schreiben liegt keine temporaere Datei, der Puls ist gueltiges JSON", async () => {
  await mitProjekt(({ dir }) => {
    starten("kette");
    pulsZustandSetzen({ phase: "vorbereitung-wartet" });
    pulsSchreiben();
    pulsSchreiben();
    const reste = pulsOrdner(dir).filter((n) => n.endsWith(".tmp"));
    assert.deepEqual(reste, [], "eine temporaere Datei blieb liegen");
    const puls = pulsLesen(dir);
    assert.equal(puls.pid, process.pid);
    assert.ok(puls.zeit, "der Puls traegt keine Zeit");
    assert.equal(puls.phase, "vorbereitung-wartet");
  });
});

test("[night-1262] scheitert das Umbenennen, bleibt der alte Puls stehen und keine temporaere Datei", async () => {
  const umbenannt = [];
  let scheitern = false;
  const umbenennen = (von, nach) => {
    if (scheitern) throw Object.assign(new Error("EPERM: rename"), { code: "EPERM" });
    umbenannt.push([von, nach]);
    renameSync(von, nach);
  };
  await mitProjekt(({ dir }) => {
    starten("kette");
    const vorher = readFileSync(join(dir, LAUF_ORDNER, `${LAUF}.puls`), "utf-8");
    assert.ok(umbenannt.length > 0, "der Puls entstand nicht ueber das Umbenennen");
    assert.match(umbenannt[0][0], /\.tmp$/, "geschrieben wird zuerst in eine temporaere Datei");
    scheitern = true;
    pulsZustandSetzen({ phase: "vorbereitung-wartet" });
    assert.equal(readFileSync(join(dir, LAUF_ORDNER, `${LAUF}.puls`), "utf-8"), vorher, "der alte Puls wurde angetastet");
    assert.deepEqual(pulsOrdner(dir).filter((n) => n.endsWith(".tmp")), [], "eine temporaere Datei blieb liegen");
  }, { abh: { umbenennen } });
});
