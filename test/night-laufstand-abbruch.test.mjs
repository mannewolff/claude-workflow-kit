// Puls und Abbruch des Nachtlaufs im selben Prozess (Issue #1084, Plan #1079 E6, E8; seit
// Issue #1225 gegen den Teil kit/night/laufstand.mjs, Plan #1199 E6).
//
// Der Runner erneuert seine Puls-Datei im Takt. Ein Abbruch, den der Prozess noch bemerkt —
// Signal, Exception, fail() —, geht einen Weg: Journalzeile "abgebrochen, <Grund>", jede
// laufende Karte auf `abgebrochen` mit kurzem Budget, Laufbericht mit Abschluss, Ende.
//
// Die Handler haengen hier an einem Ersatzprozess, das Ende wirft (helpers/laufstand-
// attrappe.mjs). Dass ein echtes SIGTERM denselben Weg nimmt, zeigt
// ablauf-night-laufstand-prozess.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  laufstandStarten, pulsSchreiben, laufAbbrechen, abbruchHandlerSetzen, standSetzen, journalLesen, LAUF_ORDNER,
  ABBRUCH_BUDGET_MS,
} from "../kit/night/laufstand.mjs";
import { ZUSTAND, fail } from "../kit/night/grundlagen.mjs";
import { mitProjekt, zeilen, Ende } from "./helpers/laufstand-attrappe.mjs";

const LAUF = "2026-10-01-010000";

const pfad = (dir, endung) => join(dir, LAUF_ORDNER, `${LAUF}.${endung}`);
const puls = (dir) => JSON.parse(readFileSync(pfad(dir, "puls"), "utf-8"));

/** Ein laufender Lauf mit Laufbericht und einer Karte, deren Stand `laeuft` ist. */
function laufenderLauf(dir) {
  ZUSTAND.LAUF_STEMPEL = LAUF;
  ZUSTAND.ERGEBNIS_FILE = join(dir, ".claude", `night-run-${LAUF}.json`);
  ZUSTAND.LAUF = { schemaFassung: 1, art: "implementierung", einheiten: [], abschluss: null, complete: false };
  laufstandStarten();
  standSetzen("7", "laeuft", "Zuletzt begonnen: Umsetzung");
}

test("ohne Stempel legt laufstandStarten weder Journal noch Puls an", async () => {
  await mitProjekt(({ dir }) => {
    laufstandStarten();
    pulsSchreiben();
    assert.ok(!existsSync(join(dir, LAUF_ORDNER)));
  });
});

test("laufstandStarten legt Journal und Puls an, und jeder Schlag erneuert den Puls", async () => {
  await mitProjekt(({ dir, uhr }) => {
    ZUSTAND.LAUF_STEMPEL = LAUF;
    laufstandStarten();
    assert.deepEqual(zeilen(pfad(dir, "jsonl")), [{ art: "lauf", zeit: "2026-10-01T01:00:00.000Z", pid: process.pid, text: "begonnen" }]);
    assert.deepEqual(puls(dir), { zeit: "2026-10-01T01:00:00.000Z", pid: process.pid });
    uhr.vor(60_000);
    pulsSchreiben();
    assert.equal(puls(dir).zeit, "2026-10-01T01:01:00.000Z");
  });
});

test("ein Abbruch schreibt Journalzeile, Kartenstand und Laufbericht und endet mit dem Exit-Code", async () => {
  await mitProjekt(({ dir, staende }) => {
    laufenderLauf(dir);
    assert.throws(() => laufAbbrechen("SIGTERM", { budgetMs: ABBRUCH_BUDGET_MS, exitCode: 143 }), (err) => err instanceof Ende && err.code === 143);

    const eintraege = zeilen(pfad(dir, "jsonl"));
    assert.ok(eintraege.some((z) => z.art === "lauf" && z.text === "abgebrochen, SIGTERM"), JSON.stringify(eintraege));
    const abbruch = staende().at(-1);
    assert.equal(abbruch.karte, "7");
    assert.equal(abbruch.zustand, "abgebrochen");
    assert.equal(abbruch.budgetMs, ABBRUCH_BUDGET_MS, "der Abbruch wartet nicht auf ein langsames Board");
    assert.match(abbruch.text, /^abgebrochen, SIGTERM \(um 2026-10-01T01:00:00\.000Z\)/);
    const bericht = JSON.parse(readFileSync(ZUSTAND.ERGEBNIS_FILE, "utf-8"));
    assert.equal(bericht.abschluss, "abgebrochen");
    assert.equal(bericht.fehlerText, "abgebrochen, SIGTERM");
  });
});

test("ein zweiter Abbruch beginnt keinen zweiten, er endet nur", async () => {
  await mitProjekt(({ dir, aufrufe }) => {
    laufenderLauf(dir);
    assert.throws(() => laufAbbrechen("SIGINT", { exitCode: 130 }), Ende);
    const vorher = aufrufe.length;
    assert.throws(() => laufAbbrechen("SIGTERM", { exitCode: 143 }), (err) => err.code === 143);
    assert.equal(aufrufe.length, vorher, "der zweite Abbruch rief das Board noch einmal");
    assert.equal(zeilen(pfad(dir, "jsonl")).filter((z) => z.art === "lauf" && z.text.startsWith("abgebrochen")).length, 1);
  });
});

test("fail() nimmt denselben Weg und laesst den Abschluss harterStopp", async () => {
  await mitProjekt(({ dir, staende }) => {
    laufenderLauf(dir);
    assert.throws(() => fail("board.mjs schweigt", "tracker"), (err) => err instanceof Ende && err.code === 1);
    assert.equal(ZUSTAND.LAUF.abschluss, "harterStopp");
    assert.equal(ZUSTAND.LAUF.fehlerText, "board.mjs schweigt", "der Grund des harten Stopps bleibt der von fail()");
    assert.equal(ZUSTAND.LAUF.fehlerklasse, "tracker");
    assert.equal(staende().at(-1).zustand, "abgebrochen");
    assert.equal(journalLesen(pfad(dir, "jsonl")).lauf.at(-1).text, "abgebrochen, board.mjs schweigt");
  });
});

test("die Handler: SIGINT, SIGTERM, Exception und Ende des Prozesses", async () => {
  for (const [ereignis, argument, code, grund] of [
    ["SIGINT", undefined, 130, "abgebrochen, SIGINT"],
    ["SIGTERM", undefined, 143, "abgebrochen, SIGTERM"],
    ["uncaughtException", new Error("kaputt\nzweite Zeile"), 1, "abgebrochen, uncaughtException: kaputt"],
    ["unhandledRejection", "nur Text", 1, "abgebrochen, unhandledRejection: nur Text"],
  ]) {
    await mitProjekt(({ dir }) => {
      laufenderLauf(dir);
      const prozess = new EventEmitter();
      let freigegeben = 0;
      abbruchHandlerSetzen({ prozess, beimEnde: () => { freigegeben++; } });
      const stderr = process.stderr.write;
      process.stderr.write = () => true;
      try {
        assert.throws(() => prozess.emit(ereignis, argument), (err) => err instanceof Ende && err.code === code, ereignis);
      } finally {
        process.stderr.write = stderr;
      }
      assert.equal(journalLesen(pfad(dir, "jsonl")).lauf.at(-1).text, grund);
      assert.equal(freigegeben, 0);
      prozess.emit("exit");
      assert.equal(freigegeben, 1, "beimEnde laeuft beim Ende des Prozesses");
    });
  }
});
