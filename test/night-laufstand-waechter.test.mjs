// Der Waechter eines Nachtlaufs im selben Prozess (Issue #1085, Plan #1079 E7; seit Issue
// #1225 gegen den Teil kit/night/laufstand.mjs, Plan #1199 E6).
//
// Ein Lauf, der ohne Abschied stirbt, kann selbst nichts mehr schreiben. Der Waechter gilt
// ihn als verstummt, wenn der Puls aelter als die Frist ist UND die PID des Runners nicht
// mehr lebt, setzt dann jede laufende Karte auf `abgebrochen`, traegt offene Journalzeilen
// nach und schreibt `abschluss: "verstummt"` in den Laufbericht.
//
// Takt, Uhr, Prozess-Probe und Start sind Attrappen (helpers/laufstand-attrappe.mjs). Dass
// der abgekoppelte Waechter nach SIGKILL auf den Runner wirklich anspringt, zeigt
// ablauf-night-laufstand-prozess.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  waechterStartOptionen, waechterStarten, waechterBeenden, waechterLaufen, verwaisteLaeufeAbschliessen, laufAbbrechen,
  laufstandAbhaengigkeiten, journalLesen, LAUF_ORDNER, ABBRUCH_BUDGET_MS,
} from "../kit/night/laufstand.mjs";
import { ZUSTAND } from "../kit/night/grundlagen.mjs";
import { mitProjekt, zeilen, Ende } from "./helpers/laufstand-attrappe.mjs";

const LAUF = "2026-09-30-010000";
const TOTE_PID = 4_000_001;
const STAND = { night: { stand: { fristMin: 10, pauseMin: 5 } } };

const berichtPfad = (dir) => join(dir, ".claude", `night-run-${LAUF}.json`);
const bericht = (dir) => JSON.parse(readFileSync(berichtPfad(dir), "utf-8"));

/** Ein Lauf, wie ihn ein gestorbener Runner hinterlaesst: Journal, Puls, offener Laufbericht. */
function hinterlassenerLauf(dir, eintraege, { pid = TOTE_PID, quittiert = [], puls = "2026-09-30T01:05:00.000Z" } = {}) {
  const ordner = join(dir, LAUF_ORDNER);
  mkdirSync(ordner, { recursive: true });
  const text = [
    JSON.stringify({ art: "lauf", zeit: "2026-09-30T01:00:00.000Z", pid, text: "begonnen" }),
    ...eintraege.map(([k, zustand, t], i) => JSON.stringify({ art: "stand", nr: i + 1, zeit: `2026-09-30T01:0${i}:00.000Z`, karte: k, zustand, text: t, status: "offen" })),
    ...quittiert.map((nr) => JSON.stringify({ art: "quittung", nr })),
  ].join("\n");
  writeFileSync(join(ordner, `${LAUF}.jsonl`), `${text}\n`, "utf-8");
  writeFileSync(join(ordner, `${LAUF}.puls`), JSON.stringify({ zeit: puls, pid }), "utf-8");
  writeFileSync(berichtPfad(dir), JSON.stringify({
    schemaFassung: 1, start: "2026-09-30T01:00:00.000Z", art: "implementierung",
    einheiten: [{ id: "7", ausgang: null }, { id: "8", ausgang: "erfolg" }], abschluss: null, complete: false,
  }, null, 2), "utf-8");
  return join(ordner, `${LAUF}.jsonl`);
}

/** Ein Takt, der mitzaehlt und vor jedem Schlag `vorher(n)` ausfuehrt. */
function taktAttrappe(uhr, vorher = () => {}) {
  const schlaege = [];
  const warten = async (ms) => {
    schlaege.push(ms);
    uhr.vor(ms);
    vorher(schlaege.length);
    if (schlaege.length > 20) throw new Error("der Waechter endet nicht");
  };
  return { warten, schlaege };
}

/** Ein Start, der seine Argumente festhaelt und ein Kind mit PID liefert. */
function startAttrappe(pid = 4242) {
  const starts = [];
  const spawn = (befehl, args, optionen) => {
    starts.push({ befehl, args, optionen });
    return { pid, on: () => {}, unref: () => {} };
  };
  return { spawn, starts };
}

test("der Waechter startet abgekoppelt und ohne Fenster", () => {
  // `detached` auch unter Windows: Dort endete ein nicht abgekoppeltes Kind mit dem
  // Job-Objekt des Runners, also genau dann, wenn der Waechter gebraucht wird.
  assert.deepEqual(waechterStartOptionen("/repo"), { cwd: "/repo", detached: true, stdio: "ignore", windowsHide: true });
});

test("waechterStarten startet den Einstieg mit --waechter und merkt die PID im Journal", async () => {
  const { spawn, starts } = startAttrappe(4242);
  await mitProjekt(({ dir }) => {
    ZUSTAND.LAUF_STEMPEL = LAUF;
    waechterStarten();
    assert.equal(starts.length, 1);
    const { befehl, args, optionen } = starts[0];
    assert.equal(befehl, process.execPath);
    assert.match(args[0], /[\\/]kit[\\/]night\.mjs$/, "der Waechter ist ein Modus des Einstiegs, nicht des Teils");
    assert.deepEqual(args.slice(1), ["--waechter", LAUF]);
    assert.equal(optionen.detached, true);
    const zeile = journalLesen(join(dir, LAUF_ORDNER, `${LAUF}.jsonl`)).lauf.at(-1);
    assert.equal(zeile.waechterPid, 4242);
    assert.equal(zeile.text, "Waechter gestartet");
  }, { abh: { spawn } });
});

test("ohne Stempel, mit KIT_NIGHT_WAECHTER=0 oder bei gescheitertem Start entsteht kein Waechter", async () => {
  const { spawn, starts } = startAttrappe();
  await mitProjekt(() => {
    waechterStarten();
  }, { abh: { spawn } });
  const vorher = process.env.KIT_NIGHT_WAECHTER;
  process.env.KIT_NIGHT_WAECHTER = "0";
  try {
    await mitProjekt(() => {
      ZUSTAND.LAUF_STEMPEL = LAUF;
      waechterStarten();
    }, { abh: { spawn } });
  } finally {
    if (vorher === undefined) delete process.env.KIT_NIGHT_WAECHTER;
    else process.env.KIT_NIGHT_WAECHTER = vorher;
  }
  assert.equal(starts.length, 0);
  await mitProjekt(({ dir, signale }) => {
    ZUSTAND.LAUF_STEMPEL = LAUF;
    waechterStarten();
    waechterBeenden();
    assert.deepEqual(journalLesen(join(dir, LAUF_ORDNER, `${LAUF}.jsonl`)).lauf, []);
    assert.deepEqual(signale, []);
  }, { abh: { spawn: () => { throw new Error("EAGAIN"); } } });
});

test("waechterBeenden schickt dem Waechter SIGTERM, genau einmal — auch aus dem Abbruch", async () => {
  const { spawn } = startAttrappe(4242);
  await mitProjekt(({ signale }) => {
    ZUSTAND.LAUF_STEMPEL = LAUF;
    waechterStarten();
    waechterBeenden();
    waechterBeenden();
    assert.deepEqual(signale, [[4242, "SIGTERM"]]);
  }, { abh: { spawn } });
  await mitProjekt(({ signale }) => {
    ZUSTAND.LAUF_STEMPEL = LAUF;
    waechterStarten();
    assert.throws(() => laufAbbrechen("SIGINT", { exitCode: 130 }), Ende);
    assert.deepEqual(signale, [[4242, "SIGTERM"]]);
  }, { abh: { spawn } });
});

test("alter Puls, aber lebende PID: der Waechter setzt nichts auf abgebrochen", async () => {
  await mitProjekt(async ({ dir, uhr, aufrufe }) => {
    hinterlassenerLauf(dir, [["7", "laeuft", "Zuletzt begonnen: Umsetzung"]], { pid: process.pid, quittiert: [1] });
    // Nach dem dritten Schlag endet der Lauf regulaer; bis dahin lebte er, mit altem Puls.
    const { warten, schlaege } = taktAttrappe(uhr, (n) => {
      if (n === 3) writeFileSync(berichtPfad(dir), JSON.stringify({ abschluss: "regulaer" }), "utf-8");
    });
    uhr.ms = Date.parse("2026-10-01T09:00:00.000Z");
    laufstandAbhaengigkeiten({ warten });
    await waechterLaufen(LAUF, dir);
    assert.deepEqual(schlaege, [60_000, 60_000, 60_000]);
    assert.deepEqual(aufrufe, []);
    assert.ok(zeilen(join(dir, LAUF_ORDNER, `${LAUF}.jsonl`)).every((z) => z.zustand !== "abgebrochen"));
  }, { config: STAND });
});

test("ein frischer Puls gilt als lebend, auch wenn die PID nicht mehr lebt", async () => {
  await mitProjekt(async ({ dir, uhr, aufrufe }) => {
    hinterlassenerLauf(dir, [["7", "laeuft", "x"]], { puls: "2026-10-01T01:00:00.000Z" });
    const { warten, schlaege } = taktAttrappe(uhr, (n) => {
      if (n === 2) rmSync(join(dir, LAUF_ORDNER, `${LAUF}.jsonl`));
    });
    uhr.ms = Date.parse("2026-10-01T01:00:00.000Z");
    laufstandAbhaengigkeiten({ warten });
    await waechterLaufen(LAUF, dir);
    assert.equal(schlaege.length, 2, "ohne Journal ist der Lauf beendet");
    assert.deepEqual(aufrufe, []);
  }, { config: STAND });
});

test("der Waechter traegt offene Journalzeilen nach und schliesst den Lauf als verstummt", async () => {
  await mitProjekt(async ({ dir, uhr, staende }) => {
    const pfad = hinterlassenerLauf(dir, [["7", "laeuft", "Zuletzt begonnen: Umsetzung"], ["8", "fertig", "Zuletzt abgeschlossen: Umsetzung"]], { quittiert: [1] });
    const { warten, schlaege } = taktAttrappe(uhr);
    uhr.ms = Date.parse("2026-10-01T09:00:00.000Z");
    laufstandAbhaengigkeiten({ warten });
    await waechterLaufen(LAUF, dir);
    assert.equal(schlaege.length, 1);
    assert.equal(ZUSTAND.LOG_KENNUNG, `${LAUF}-waechter`);

    const [abbruch, nachtrag] = staende();
    assert.equal(abbruch.karte, "7");
    assert.equal(abbruch.zustand, "abgebrochen");
    assert.equal(abbruch.budgetMs, ABBRUCH_BUDGET_MS);
    assert.match(abbruch.text, /^nicht beendet, letztes Lebenszeichen 2026-09-30T01:05:00\.000Z, Frist 10 min\n/);
    assert.match(abbruch.text, new RegExp(`Lauf-ID: [^/]+/${process.pid}/${LAUF}`), "der Waechter schreibt mit seiner eigenen Prozess-Id");
    assert.equal(nachtrag.karte, "8");
    assert.equal(nachtrag.zustand, "fertig");
    assert.equal(nachtrag.text, "Zuletzt abgeschlossen: Umsetzung");

    const stand = bericht(dir);
    assert.equal(stand.abschluss, "verstummt");
    assert.match(stand.fehlerText, /^nicht beendet/);
    assert.deepEqual(stand.einheiten.map((e) => e.ausgang), ["verstummt", "erfolg"], "nur eine Einheit ohne Ausgang wird verstummt");
    assert.ok(zeilen(pfad).some((z) => z.art === "lauf" && /^verstummt, nicht beendet/.test(z.text)));
    assert.ok(journalLesen(pfad).staende.every((s) => s.status !== "offen"));
  }, { config: STAND });
});

test("KIT_NIGHT_WAECHTER_FRIST_S setzt die Frist in Sekunden", async () => {
  const vorher = process.env.KIT_NIGHT_WAECHTER_FRIST_S;
  process.env.KIT_NIGHT_WAECHTER_FRIST_S = "1";
  try {
    await mitProjekt(async ({ dir, uhr, staende }) => {
      hinterlassenerLauf(dir, [["7", "laeuft", "x"]]);
      const { warten, schlaege } = taktAttrappe(uhr);
        laufstandAbhaengigkeiten({ warten });
      await waechterLaufen(LAUF, dir);
      assert.deepEqual(schlaege, [1000], "bei kuerzerer Frist ist der Takt die Frist selbst");
      assert.match(staende()[0].text, /Frist 1 s\n/);
    });
  } finally {
    if (vorher === undefined) delete process.env.KIT_NIGHT_WAECHTER_FRIST_S;
    else process.env.KIT_NIGHT_WAECHTER_FRIST_S = vorher;
  }
});

test("ohne Lauf-Stempel tut der Waechter nichts", async () => {
  await mitProjekt(async () => {
    await waechterLaufen(undefined);
    assert.equal(ZUSTAND.LOG_FILE, null);
  });
});

test("Rueckfall beim Start: nur ein verwaister Lauf ohne lebenden Runner und ohne Abschluss wird abgeschlossen", async () => {
  await mitProjekt(({ dir, staende }) => {
    hinterlassenerLauf(dir, [["7", "laeuft", "Zuletzt begonnen: Umsetzung"]], { quittiert: [1] });
    assert.deepEqual(verwaisteLaeufeAbschliessen(dir), [LAUF]);
    assert.equal(staende()[0].zustand, "abgebrochen");
    assert.match(staende()[0].text, /^nicht beendet, letztes Lebenszeichen 2026-09-30T01:05:00\.000Z, Frist 10 min/);
    assert.equal(bericht(dir).abschluss, "verstummt");
    assert.deepEqual(verwaisteLaeufeAbschliessen(dir), [], "ein abgeschlossener Lauf bleibt, wie er ist");
  }, { config: STAND });
  await mitProjekt(({ dir, aufrufe }) => {
    hinterlassenerLauf(dir, [["7", "laeuft", "x"]], { pid: process.pid });
    assert.deepEqual(verwaisteLaeufeAbschliessen(dir), [], "der Runner lebt");
    assert.deepEqual(aufrufe, []);
  });
  await mitProjekt(({ dir, aufrufe }) => {
    hinterlassenerLauf(dir, [["7", "laeuft", "x"]]);
    rmSync(berichtPfad(dir));
    assert.deepEqual(verwaisteLaeufeAbschliessen(), [], "ohne Laufbericht bleibt das Journal dem Nachtrag");
    assert.deepEqual(aufrufe, []);
  });
  await mitProjekt(({ dir }) => {
    assert.deepEqual(verwaisteLaeufeAbschliessen(dir), []);
  });
});
