// Journal und Laufstand des Nachtlaufs im selben Prozess (Issue #1084, Plan #1079 E5, E6;
// seit Issue #1225 gegen den Teil kit/night/laufstand.mjs, Plan #1199 E6).
//
// Jeder Standwechsel geht zuerst als Zeile ins Journal `.claude/lauf/<lauf>.jsonl` und
// danach als `issue stand` ans Board. Was das Board nicht annimmt, bleibt "offen" und wird
// beim naechsten Start nachgetragen — aber nie aus dem Journal eines Laufs, der noch lebt.
//
// Board, Uhr und Prozess-Probe sind Attrappen (helpers/laufstand-attrappe.mjs). Dass der
// Einstieg den Nachtrag beim Start auch ausloest, zeigt
// ablauf-night-laufstand-prozess.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";

import {
  standSetzen, abgeben, laufendeKarten, journalLesen, staendeNachtragen, nightStandLaden, nightStandPruefen,
  laufPositionSetzen, LAUF_ORDNER,
} from "../kit/night/laufstand.mjs";
import { ZUSTAND, LETZTES_PROTOKOLL } from "../kit/night/grundlagen.mjs";
import { mitProjekt, zeilen, Ende } from "./helpers/laufstand-attrappe.mjs";

const LAUF = "2026-10-01-010000";
const LAUF_ALT = "2026-09-30-010000";
const TOTE_PID = 4_000_001;

const journalPfad = (dir, lauf = LAUF) => join(dir, LAUF_ORDNER, `${lauf}.jsonl`);

/** Ein Journal eines frueheren Laufs mit offenen Zeilen, wie es ein Board-Ausfall hinterlaesst. */
function altesJournal(dir, eintraege, { pid = TOTE_PID, lauf = LAUF_ALT } = {}) {
  const ordner = join(dir, LAUF_ORDNER);
  mkdirSync(ordner, { recursive: true });
  const text = eintraege.map(([k, zustand, t], i) => JSON.stringify({ art: "stand", nr: i + 1, zeit: `2026-09-30T01:0${i}:00.000Z`, karte: k, zustand, text: t, status: "offen" })).join("\n");
  writeFileSync(join(ordner, `${lauf}.jsonl`), `${text}\n`, "utf-8");
  writeFileSync(join(ordner, `${lauf}.puls`), JSON.stringify({ zeit: "2026-09-30T01:05:00.000Z", pid }), "utf-8");
  return join(ordner, `${lauf}.jsonl`);
}

test("standSetzen schreibt erst die Journalzeile, dann den Laufstand, und quittiert ihn", async () => {
  let journalBeimAufruf = null;
  await mitProjekt(({ dir, aufrufe, staende }) => {
    const ergebnis = standSetzen("7", "laeuft", "Zuletzt begonnen: Umsetzung um 01:00", { lauf: LAUF, repoRoot: dir });
    assert.equal(ergebnis, "geschrieben");
    assert.deepEqual(journalBeimAufruf.map((z) => [z.art, z.karte, z.zustand]), [["stand", "7", "laeuft"]], "die Journalzeile stand vor dem Board-Aufruf");
    assert.deepEqual(aufrufe[0].args.slice(0, 5), ["issue", "stand", "7", "--zustand", "laeuft"]);
    assert.equal(aufrufe[0].opts.cwd, dir);
    assert.match(staende()[0].text, /^Zuletzt begonnen: Umsetzung um 01:00\n/);
    const journal = journalLesen(journalPfad(dir));
    assert.equal(journal.staende.length, 1);
    assert.equal(journal.staende[0].status, "geschrieben");
    assert.deepEqual(zeilen(journalPfad(dir)).map((z) => z.art), ["stand", "quittung"]);
  }, { antwort: () => { journalBeimAufruf = zeilen(journalPfad(process.cwd())); } });
});

test("scheitert der Board-Aufruf, bleibt die Journalzeile offen", async () => {
  await mitProjekt(({ dir }) => {
    const ergebnis = standSetzen("4711", "abgebrochen", "abgebrochen, Test", { lauf: LAUF, repoRoot: dir });
    assert.equal(ergebnis, "offen");
    const roh = zeilen(journalPfad(dir));
    assert.equal(roh.length, 1, "keine Quittung fuer einen gescheiterten Aufruf");
    assert.equal(roh[0].status, "offen");
    assert.equal(journalLesen(journalPfad(dir)).staende[0].status, "offen");
  }, { antwort: () => ({ status: 1, json: null, text: "Board-Timeout" }) });
});

test("ohne Lauf schreibt standSetzen nichts — der Trockenlauf hat keinen Stempel", async () => {
  await mitProjekt(({ dir, aufrufe }) => {
    assert.equal(standSetzen("7", "laeuft", "x"), null);
    abgeben("7");
    assert.deepEqual(aufrufe, []);
    assert.deepEqual(journalLesen(journalPfad(dir)).staende, []);
  });
});

test("der Laufstand traegt Lauf-ID, Stand, Position und das Protokoll des Schritts", async () => {
  await mitProjekt(({ dir, staende }) => {
    LETZTES_PROTOKOLL.set("7", ".claude/protokolle/x/7-umsetzung.log");
    standSetzen("7", "laeuft", "Lauf angenommen", { lauf: LAUF, repoRoot: dir, position: { k: 2, n: 3 } });
    const zeile = journalLesen(journalPfad(dir)).staende[0];
    const text = staende()[0].text;
    const host = hostname().split(".")[0];
    assert.ok(!host.includes("."));
    assert.ok(text.startsWith("Lauf angenommen\n\nProtokoll: .claude/protokolle/x/7-umsetzung.log\n\n"), text);
    assert.ok(text.includes(`Lauf-ID: ${host}/${process.pid}/${LAUF}\n`), text);
    assert.ok(text.includes(`Stand: ${zeile.zeit}\n`), text);
    assert.match(text, /\nPosition: 2 von 3\s*$/);
  });
});

test("die gemerkte Position gilt fuer jeden spaeteren Stand der Karte", async () => {
  await mitProjekt(({ dir, staende }) => {
    ZUSTAND.LAUF_STEMPEL = LAUF;
    laufPositionSetzen(7, { k: 1, n: 2 });
    standSetzen("7", "laeuft", "x", { repoRoot: dir });
    assert.match(staende()[0].text, /\nPosition: 1 von 2\s*$/);
  });
});

test("jeder Stufenwechsel erneuert Stand:", async () => {
  await mitProjekt(({ dir, staende, uhr }) => {
    const opts = { lauf: LAUF, repoRoot: dir, position: { k: 1, n: 1 } };
    standSetzen("7", "laeuft", "zuletzt begonnen: Plan", opts);
    uhr.vor(60_000);
    standSetzen("7", "laeuft", "zuletzt begonnen: Umsetzung", opts);
    const [erste, zweite] = journalLesen(journalPfad(dir)).staende;
    assert.equal(erste.zeit, "2026-10-01T01:00:00.000Z");
    assert.equal(zweite.zeit, "2026-10-01T01:01:00.000Z");
    assert.equal(zweite.nr, 2);
    const letzter = staende().at(-1).text;
    assert.ok(letzter.includes(`Stand: ${zweite.zeit}\n`), letzter);
    assert.match(letzter, /zuletzt begonnen: Umsetzung/);
  });
});

test("staendeNachtragen laesst das Journal eines lebenden Laufs liegen", async () => {
  await mitProjekt(({ dir, aufrufe }) => {
    const pfad = altesJournal(dir, [["7", "laeuft", "Zuletzt begonnen: Plan"]], { pid: process.pid });
    assert.deepEqual(staendeNachtragen(dir), []);
    assert.equal(journalLesen(pfad).staende[0].status, "offen");
    assert.deepEqual(aufrufe, []);
  });
});

test("ein Puls ohne lesbare PID gilt als tot, EPERM als lebend", async () => {
  await mitProjekt(({ dir, aufrufe }) => {
    const pfad = altesJournal(dir, [["7", "laeuft", "x"]]);
    writeFileSync(join(dir, LAUF_ORDNER, `${LAUF_ALT}.puls`), "kein json", "utf-8");
    assert.equal(staendeNachtragen(dir).length, 1);
    assert.equal(journalLesen(pfad).staende[0].status, "geschrieben");
    assert.equal(aufrufe.length, 1);
  });
  await mitProjekt(({ dir, aufrufe }) => {
    altesJournal(dir, [["7", "laeuft", "x"]], { pid: 4242 });
    assert.deepEqual(staendeNachtragen(dir), []);
    assert.deepEqual(aufrufe, []);
  }, { abh: { kill: () => { throw Object.assign(new Error("EPERM"), { code: "EPERM" }); } } });
});

test("ein spaeter geschriebener Stand derselben Karte ueberholt eine offene Zeile", async () => {
  await mitProjekt(({ dir, aufrufe }) => {
    const pfad = altesJournal(dir, [["7", "laeuft", "alt"]]);
    writeFileSync(pfad, `${readFileSync(pfad, "utf-8")}${JSON.stringify({ art: "stand", nr: 2, zeit: "2026-09-30T01:09:00.000Z", karte: "7", zustand: "fertig", text: "neu", status: "offen" })}\n${JSON.stringify({ art: "quittung", nr: 2 })}\n`);
    assert.deepEqual(staendeNachtragen(dir), [], "die alte Zeile darf den neueren Stand nicht ueberschreiben");
    assert.equal(journalLesen(pfad).staende[0].status, "ueberholt");
    assert.deepEqual(aufrufe, []);
  });
});

test("eine unlesbare Zeile — die halbe letzte nach einem Absturz — wird uebergangen", async () => {
  await mitProjekt(({ dir }) => {
    const pfad = altesJournal(dir, [["7", "laeuft", "x"]]);
    writeFileSync(pfad, `${readFileSync(pfad, "utf-8")}{"art":"lauf","zeit":"2026\n\n${JSON.stringify({ art: "lauf", text: "begonnen" })}\n`);
    const { lauf, staende } = journalLesen(pfad);
    assert.deepEqual(lauf.map((z) => z.text), ["begonnen"]);
    assert.equal(staende.length, 1);
    assert.deepEqual(journalLesen(join(dir, "gibt-es-nicht.jsonl")), { lauf: [], staende: [] });
  });
});

test("eine abgegebene Karte gilt nicht als laufend und wird nicht nachgetragen", async () => {
  await mitProjekt(({ dir, aufrufe }) => {
    const pfad = altesJournal(dir, [["7", "laeuft", "Lauf angenommen"]]);
    abgeben("7", { lauf: LAUF_ALT, repoRoot: dir });
    const staende = journalLesen(pfad).staende;
    assert.equal(staende.at(-1).zustand, "abgegeben");
    assert.equal(staende.at(-1).nr, 2);
    assert.deepEqual(laufendeKarten(staende), []);
    assert.deepEqual(staendeNachtragen(dir), []);
    assert.deepEqual(aufrufe, [], "abgegeben schreibt nichts ans Board, auch nicht nachtraeglich");
    assert.ok(!zeilen(pfad).some((z) => z.art === "quittung"));
  });
});

test("der Nachtrag geht die Journale nach Namen und darin die Zeilen in ihrer Folge durch", async () => {
  await mitProjekt(({ dir, staende }) => {
    const spaeter = altesJournal(dir, [["9", "fertig", "spaeter"]], { lauf: "2026-09-30-020000" });
    const frueher = altesJournal(dir, [["8", "abgebrochen", "abgebrochen, SIGINT"], ["7", "laeuft", "Zuletzt begonnen: Plan"]]);
    const nachgetragen = staendeNachtragen(dir);
    assert.deepEqual(nachgetragen.map((n) => `${n.lauf} ${n.nr} #${n.karte} ${n.zustand}`), [
      `${LAUF_ALT} 1 #8 abgebrochen`,
      `${LAUF_ALT} 2 #7 laeuft`,
      "2026-09-30-020000 1 #9 fertig",
    ]);
    assert.deepEqual(staende().map((s) => s.karte), ["8", "7", "9"]);
    assert.deepEqual(zeilen(frueher).filter((z) => z.art === "quittung").map((z) => z.nr), [1, 2]);
    assert.ok(journalLesen(spaeter).staende.every((s) => s.status === "geschrieben"));
    assert.equal(staende()[0].text, "abgebrochen, SIGINT", "eine Zeile ohne Lauf-ID bleibt ohne Kopf");
  });
});

test("ohne Ordner .claude/lauf gibt es nichts nachzutragen", async () => {
  await mitProjekt(({ dir }) => {
    assert.deepEqual(staendeNachtragen(dir), []);
  });
});

test("night.stand: Vorgaben, Feldnamen im Befund, pauseMin unter fristMin", () => {
  assert.deepEqual(nightStandLaden({}), { fristMin: 10, pauseMin: 5 });
  assert.deepEqual(nightStandLaden({ night: { stand: { fristMin: 20 } } }), { fristMin: 20, pauseMin: 5 });
  assert.match(nightStandLaden({ night: { stand: { fristMin: 5, pauseMin: 5 } } }).fehler, /night\.stand\.pauseMin.*night\.stand\.fristMin/);
  assert.match(nightStandLaden({ night: { stand: { fristMin: 0 } } }).fehler, /night\.stand\.fristMin/);
  assert.match(nightStandLaden({ night: { stand: { pauseMin: "5" } } }).fehler, /night\.stand\.pauseMin/);
});

test("nightStandPruefen haelt einen unbrauchbaren Block als harten Stopp an", async () => {
  await mitProjekt(() => {
    ZUSTAND.LAUF = { abschluss: null };
    assert.throws(() => nightStandPruefen({ night: { stand: { fristMin: 4, pauseMin: 6 } } }), (err) => err instanceof Ende && err.code === 1);
    assert.match(ZUSTAND.LAUF.fehlerText, /night\.stand\.pauseMin \(6\) muss kleiner sein als night\.stand\.fristMin \(4\)/);
    assert.equal(ZUSTAND.LAUF.fehlerklasse, "zustand");
    assert.equal(ZUSTAND.LAUF.abschluss, "harterStopp");
  });
  await mitProjekt(() => {
    assert.doesNotThrow(() => nightStandPruefen({}));
  });
});
