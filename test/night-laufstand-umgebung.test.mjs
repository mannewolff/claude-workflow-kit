// Umgebung oder Paket: ein Versuch fuer Umgebungsfehler des lebenden Laufs, im selben
// Prozess (Issue #1088, Plan #1079 E13, E15; seit Issue #1225 gegen den Teil
// kit/night/laufstand.mjs, Plan #1199 E6).
//
// Ein gescheiterter Board-Aufruf bekommt nach der Pause `night.stand.pauseMin` genau einen
// zweiten Versuch, und die Karte traegt den Vermerk "2. Versuch". Scheitert auch er, haelt
// der Lauf an: Die laufende Karte steht auf `abgebrochen`, jede Karte, die er als naechste
// aufgenommen haette, zeigt "nicht begonnen" mit Grund und Zeitpunkt.
//
// Die Pause ist eine eingesetzte Uhr; `board()` der Grundlagen startet eine Attrappe statt
// board.mjs. Dass Sitzungsstart, Umsetzungsschleife und Kette des Einstiegs diesen Weg
// gehen, zeigt ablauf-night-laufstand-umgebung.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import {
  zweiterVersuch, vermerkAnDieKarte, anhaltenVermerken, laufAnhalten, anhaltenLaeuft, hatSitzungsereignis,
  sitzungsStartGescheitert, exitText, standSetzen, journalLesen, LAUF_KONTEXT, LAUF_ORDNER, ABBRUCH_BUDGET_MS,
} from "../kit/night/laufstand.mjs";
import { ZUSTAND, board } from "../kit/night/grundlagen.mjs";
import { mitProjekt, Ende } from "./helpers/laufstand-attrappe.mjs";

const LAUF = "2026-10-01-010000";
const journal = (dir) => journalLesen(join(dir, LAUF_ORDNER, `${LAUF}.jsonl`));

/** Ein Start von board.mjs, der die ersten `mal` Aufrufe scheitern laesst. */
function boardStart(mal) {
  const aufrufe = [];
  const spawn = (_befehl, args) => {
    aufrufe.push(args.slice(1).join(" "));
    if (aufrufe.length <= mal) return { status: 1, stdout: "", stderr: "Board-Timeout: keine Antwort binnen 120000 ms" };
    return { status: 0, stdout: JSON.stringify({ id: "7" }), stderr: "" };
  };
  return { spawn, aufrufe };
}

test("zweiterVersuch: Journalzeile, Pause aus night.stand.pauseMin, Vermerk an jedem weiteren Stand der Karte", async () => {
  await mitProjekt(({ dir, schlaefe, staende }) => {
    ZUSTAND.LAUF_STEMPEL = LAUF;
    LAUF_KONTEXT.karte = "7";
    zweiterVersuch("board.mjs issue get 7 schlug fehl\nzweite Zeile");
    assert.deepEqual(schlaefe, [30_000]);
    assert.equal(journal(dir).lauf.at(-1).text, "2. Versuch: board.mjs issue get 7 schlug fehl");

    standSetzen("7", "laeuft", "Zuletzt begonnen: Umsetzung");
    standSetzen("8", "laeuft", "Zuletzt begonnen: Plan");
    const [sieben, acht] = staende();
    assert.match(sieben.text, /^Zuletzt begonnen: Umsetzung\n\n2\. Versuch nach Umgebungsfehler um 2026-10-01T01:00:00\.000Z: board\.mjs issue get 7 schlug fehl\n/);
    assert.doesNotMatch(acht.text, /2\. Versuch/, "nur die laufende Karte traegt den Vermerk");

    standSetzen("7", "fertig", sieben.text.split("\n\nLauf-ID")[0]);
    assert.equal(staende()[2].text.match(/2\. Versuch/g).length, 1, "der Vermerk steht hoechstens einmal");
  }, { config: { night: { stand: { pauseMin: 0.5 } } } });
});

test("ein unbrauchbarer Block night.stand faellt fuer die Pause auf die Vorgabe zurueck", async () => {
  await mitProjekt(({ schlaefe }) => {
    zweiterVersuch("x");
    assert.deepEqual(schlaefe, [5 * 60_000]);
  }, { config: { night: { stand: { pauseMin: 20 } } } });
});

test("[#1026] scheitert ein Board-Aufruf einmal: Pause, zweiter Versuch, Vermerk an der Karte, der Lauf geht weiter", async () => {
  await mitProjekt(({ schlaefe, staende }) => {
    ZUSTAND.LAUF_STEMPEL = LAUF;
    LAUF_KONTEXT.karte = "7";
    standSetzen("7", "laeuft", "Zuletzt begonnen: Umsetzung");
    const { spawn, aufrufe } = boardStart(1);
    assert.deepEqual(board("issue", "get", "7", { spawn }), { id: "7" });
    assert.deepEqual(aufrufe, ["issue get 7", "issue get 7"]);
    assert.equal(schlaefe.length, 1);
    const neu = staende().at(-1);
    assert.equal(neu.zustand, "laeuft", "der letzte Stand wird mit Vermerk erneut geschrieben");
    assert.match(neu.text, /^Zuletzt begonnen: Umsetzung\n\n2\. Versuch nach Umgebungsfehler um [^:]+:\d\d:\d\d\.\d+Z: board\.mjs issue get 7 schlug fehl/);
    assert.equal(anhaltenLaeuft(), false);
  }, { config: { night: { stand: { pauseMin: 1 } } } });
});

test("[E15] scheitert auch der zweite Versuch, haelt der Lauf an: abgebrochen und 'nicht begonnen'", async () => {
  await mitProjekt(({ staende }) => {
    ZUSTAND.LAUF_STEMPEL = LAUF;
    ZUSTAND.LAUF = { abschluss: null };
    Object.assign(LAUF_KONTEXT, { karte: "7", kandidaten: () => [7, 8, 9] });
    const { spawn } = boardStart(2);
    assert.throws(() => board("issue", "get", "7", { spawn }), (err) => err instanceof Ende && err.code === 1);
    assert.equal(anhaltenLaeuft(), true);
    assert.equal(ZUSTAND.LAUF.fehlerklasse, "tracker");
    assert.match(ZUSTAND.LAUF.fehlerText, /^Lauf angehalten: board\.mjs issue get 7 schlug fehl.*\(auch im 2\. Versuch\)/s);

    const nachKarte = Object.groupBy(staende(), (s) => s.karte);
    assert.equal(nachKarte["7"][0].zustand, "abgebrochen");
    assert.equal(nachKarte["7"][0].budgetMs, ABBRUCH_BUDGET_MS);
    assert.match(nachKarte["7"][0].text, /^abgebrochen, Umgebungsfehler um \S+: board\.mjs issue get 7 .*Board-Timeout/s);
    assert.match(nachKarte["7"][0].text, /2\. Versuch/);
    for (const id of ["8", "9"]) {
      assert.equal(nachKarte[id].length, 1);
      assert.equal(nachKarte[id][0].zustand, "wartet");
      assert.match(nachKarte[id][0].text, /^nicht begonnen: der Lauf hielt um \d{4}-\d\d-\d\dT\d\d:\d\d[^ ]* an — .*Board-Timeout/s);
    }

    // Was danach am Board scheitert, wirft nur noch: kein zweiter Versuch, kein zweites Anhalten.
    assert.throws(() => board("issue", "get", "8", { spawn: boardStart(1).spawn }), (err) => !(err instanceof Ende) && /schlug fehl/.test(err.message));
  }, { config: { night: { stand: { pauseMin: 1 } } } });
});

test("lassen sich die naechsten Karten nicht bestimmen, bleibt es beim Stand der laufenden", async () => {
  await mitProjekt(({ staende }) => {
    ZUSTAND.LAUF_STEMPEL = LAUF;
    Object.assign(LAUF_KONTEXT, { karte: "7", kandidaten: () => { throw new Error("Board schweigt"); } });
    anhaltenVermerken("Sitzungsstart gescheitert");
    assert.deepEqual(staende().map((s) => `${s.karte} ${s.zustand}`), ["7 abgebrochen"]);
  });
});

test("laufAnhalten haelt mit der Klasse umgebung an, wenn keine genannt ist", async () => {
  await mitProjekt(() => {
    ZUSTAND.LAUF = { abschluss: null };
    assert.throws(() => laufAnhalten("Sitzungsstart zu #7 auch im 2. Versuch gescheitert (Exit 1)"), Ende);
    assert.equal(ZUSTAND.LAUF.fehlerklasse, "umgebung");
    assert.equal(ZUSTAND.LAUF.abschluss, "harterStopp");
  });
});

test("vermerkAnDieKarte: ohne Karte, ohne Stand oder bei abgegebener Karte geschieht nichts", async () => {
  await mitProjekt(({ aufrufe }) => {
    ZUSTAND.LAUF_STEMPEL = LAUF;
    vermerkAnDieKarte();
    LAUF_KONTEXT.karte = "7";
    vermerkAnDieKarte();
    assert.deepEqual(aufrufe, []);
  });
});

test("[E13] Umgebung oder Paket: nur ein Start ohne Sitzungsereignis ist Umgebung", () => {
  const ereignis = '{"type":"system","subtype":"init"}\n';
  assert.equal(hatSitzungsereignis(ereignis), true);
  assert.equal(hatSitzungsereignis("Failed to start\n{kaputt\n{\"ohne\":\"typ\"}\n"), false);
  assert.equal(hatSitzungsereignis(undefined), false);

  assert.equal(sitzungsStartGescheitert({ status: 1, stdout: "" }), true);
  assert.equal(sitzungsStartGescheitert({ error: { code: "ENOENT" }, stdout: "" }), true);
  assert.equal(sitzungsStartGescheitert({ status: 1, stdout: ereignis }), false, "die Sitzung kam zustande: Paketfehler");
  assert.equal(sitzungsStartGescheitert({ status: 0, stdout: "" }), false);
  assert.equal(sitzungsStartGescheitert({ status: null, signal: "SIGTERM", stdout: "" }), false, "das Zeitlimit ist kein Umgebungsfehler");
  assert.equal(sitzungsStartGescheitert({ error: { code: "ETIMEDOUT" }, stdout: "" }), false);
  assert.equal(sitzungsStartGescheitert({ status: 1, stdout: "" }, "make test"), false, "die Kommando-Stufe meldet keine Ereignisse");

  assert.equal(exitText({ status: 2 }), "Exit 2");
  assert.equal(exitText({ status: null, signal: "SIGKILL" }), "Exit SIGKILL");
  assert.equal(exitText({ error: { code: "ENOENT" } }), "ENOENT");
  assert.equal(exitText({ error: { message: "kaputt" } }), "kaputt");
});
