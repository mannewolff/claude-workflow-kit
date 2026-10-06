// Die Vorbereitung wartet befristet, bis in der Nacht nichts mehr baut (Issue #1250,
// Plan #1243, E8; Kriterium 13 aus #1192).
//
// `aufVorbereitungWarten` wartet im Takt der Umsetzungssperre, bis es die Sperre haelt und
// kein fremder Lauf dieses Projekts mehr baut. Nicht gezaehlt werden der eigene Puls, ein
// Prueflauf und ein Lauf, der selbst in seiner Vorbereitung wartet. Nach Ablauf der Frist
// kommt `ok: false` mit Grund, und die Sperre bleibt frei.
//
// Geprueft im selben Prozess: Uhr und Pause ueber `ketteAbhaengigkeiten`, die Pulse in einem
// eigenen Projektverzeichnis, die Prozess-Probe aus helpers/laufstand-attrappe.mjs. Die
// Sperre ist die echte Datei — ihr Halter ist dieser Prozess.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { aufVorbereitungWarten, ketteAbhaengigkeiten, KETTE_ABHAENGIGKEITEN } from "../kit/night/kette.mjs";
import { laufstandStarten, LAUF_ORDNER } from "../kit/night/laufstand.mjs";
import { UMSETZUNG_WARTEN_MS } from "../kit/night/kitstand.mjs";
import { ZUSTAND, UMSETZUNG_LOCK } from "../kit/night/grundlagen.mjs";
import { mitProjekt } from "./helpers/laufstand-attrappe.mjs";

const LAUF = "2026-10-06-220000";
const FREMD = "2026-10-06-210000";
const FREMD_PID = 4_000_101;
const ZWEITER_PID = 4_000_102;

const pulsPfad = (dir, lauf) => join(dir, LAUF_ORDNER, `${lauf}.puls`);
const pulsLesen = (dir, lauf = LAUF) => JSON.parse(readFileSync(pulsPfad(dir, lauf), "utf-8"));

/** Legt den Puls eines fremden Laufs an. */
function fremderPuls(dir, lauf, felder) {
  mkdirSync(join(dir, LAUF_ORDNER), { recursive: true });
  writeFileSync(pulsPfad(dir, lauf), JSON.stringify({ zeit: "2026-10-06T21:00:00.000Z", ...felder }), "utf-8");
}

/**
 * Ein eigenes Projekt mit gestartetem Laufstand, eingespeister Uhr und Pause. `beimSchlafen`
 * laeuft in jeder Pause und darf die Lage aendern; jede Pause wird mit der Phase des eigenen
 * Pulses aufgezeichnet. Das blockierende `schlaf` wirft.
 */
async function mitVorbereitung(fn, { lebende = [process.pid], beimSchlafen = () => {} } = {}) {
  await mitProjekt(async (ctx) => {
    const { dir, uhr } = ctx;
    ZUSTAND.LAUF_STEMPEL = LAUF;
    ZUSTAND.LAUF = { art: "kette" };
    laufstandStarten();
    const pausen = [];
    ketteAbhaengigkeiten({
      jetzt: uhr.jetzt,
      schlafen: async (ms) => {
        pausen.push({ ms, phase: pulsLesen(dir).phase });
        uhr.vor(ms);
        await beimSchlafen(pausen.length, ctx);
      },
      schlaf: () => { throw new Error("die Vorbereitung hat das blockierende schlaf benutzt"); },
    });
    try {
      await fn({ ...ctx, kette: { repoRoot: dir, budget: { vorbereitungMin: 120 } }, pausen });
    } finally {
      ketteAbhaengigkeiten();
      rmSync(join(dir, UMSETZUNG_LOCK), { force: true });
    }
  }, { lebende });
}

test("[night-1250] KETTE_ABHAENGIGKEITEN fuehrt ein asynchrones schlafen neben dem blockierenden schlaf", async () => {
  assert.equal(typeof KETTE_ABHAENGIGKEITEN.schlaf, "function");
  const pause = KETTE_ABHAENGIGKEITEN.schlafen(0);
  assert.ok(pause instanceof Promise, "schlafen liefert kein Promise");
  await pause;
});

test("[night-1250] freie Bahn: die Sperre kommt sofort, ohne Pause, und bleibt gehalten", async () => {
  await mitVorbereitung(async ({ dir, kette, pausen }) => {
    const ergebnis = await aufVorbereitungWarten(kette, {});
    assert.equal(ergebnis.ok, true, ergebnis.grund);
    assert.equal(pausen.length, 0, "ohne Grund gewartet");
    assert.equal(existsSync(join(dir, UMSETZUNG_LOCK)), true, "die Sperre wurde nicht gehalten");
    assert.equal("phase" in pulsLesen(dir), false, "die Phase blieb nach dem Warten stehen");
    ergebnis.freigeben();
    assert.equal(existsSync(join(dir, UMSETZUNG_LOCK)), false, "freigeben raeumt die Sperre nicht");
  });
});

test("[night-1250] belegte Sperre: gewartet wird im Takt der Umsetzung, bis sie frei ist", async () => {
  await mitVorbereitung(async ({ dir, kette, pausen }) => {
    // Die Sperre prueft ihren Halter mit der echten Prozess-Probe: der Elternprozess lebt.
    writeFileSync(join(dir, UMSETZUNG_LOCK), `${process.ppid}\n`, "utf-8");
    const ergebnis = await aufVorbereitungWarten(kette, {});
    assert.equal(ergebnis.ok, true, ergebnis.grund);
    assert.deepEqual(pausen.map((p) => p.ms), [UMSETZUNG_WARTEN_MS, UMSETZUNG_WARTEN_MS]);
    assert.equal(readFileSync(join(dir, UMSETZUNG_LOCK), "utf-8").trim(), String(process.pid));
    ergebnis.freigeben();
  }, {
    beimSchlafen: (n, { dir }) => { if (n === 2) rmSync(join(dir, UMSETZUNG_LOCK)); },
  });
});

test("[night-1250] fremder lebender Lauf: gewartet wird, bis er endet; die Phase steht nur waehrenddessen im Puls", async () => {
  await mitVorbereitung(async ({ dir, kette, pausen }) => {
    fremderPuls(dir, FREMD, { pid: FREMD_PID, art: "kette" });
    const ergebnis = await aufVorbereitungWarten(kette, {});
    assert.equal(ergebnis.ok, true, ergebnis.grund);
    assert.equal(pausen.length, 3);
    assert.deepEqual(pausen.map((p) => p.phase), Array(3).fill("vorbereitung-wartet"), "waehrend des Wartens fehlte die Phase im Puls");
    assert.equal("phase" in pulsLesen(dir), false, "die Phase blieb nach dem Warten stehen");
    assert.equal(pulsLesen(dir).art, "kette", "die Laufart ging beim Zuruecknehmen der Phase verloren");
    ergebnis.freigeben();
  }, {
    lebende: [process.pid, FREMD_PID],
    beimSchlafen: (n, { lebend }) => { if (n === 3) lebend.delete(FREMD_PID); },
  });
});

test("[night-1250] ein toter fremder Puls zaehlt nicht", async () => {
  await mitVorbereitung(async ({ dir, kette, pausen }) => {
    fremderPuls(dir, FREMD, { pid: FREMD_PID, art: "implementierung" });
    const ergebnis = await aufVorbereitungWarten(kette, {});
    assert.equal(ergebnis.ok, true, ergebnis.grund);
    assert.equal(pausen.length, 0);
    ergebnis.freigeben();
  });
});

test("[night-1250] der eigene Puls zaehlt nicht", async () => {
  await mitVorbereitung(async ({ dir, kette, pausen }) => {
    assert.equal(pulsLesen(dir).pid, process.pid, "der eigene Puls fehlt");
    const ergebnis = await aufVorbereitungWarten(kette, {});
    assert.equal(ergebnis.ok, true, ergebnis.grund);
    assert.equal(pausen.length, 0, "auf den eigenen Puls gewartet");
    ergebnis.freigeben();
  });
});

test("[night-1250] ein lebender Prueflauf zaehlt nicht, er baut nicht", async () => {
  await mitVorbereitung(async ({ dir, kette, pausen }) => {
    fremderPuls(dir, FREMD, { pid: FREMD_PID, art: "pruefung" });
    const ergebnis = await aufVorbereitungWarten(kette, {});
    assert.equal(ergebnis.ok, true, ergebnis.grund);
    assert.equal(pausen.length, 0, "auf einen Prueflauf gewartet");
    ergebnis.freigeben();
  }, { lebende: [process.pid, FREMD_PID] });
});

test("[night-1250] zwei wartende Vorbereitungen verklemmen nicht: eine fremde wartende zaehlt nicht", async () => {
  await mitVorbereitung(async ({ dir, kette, pausen }) => {
    fremderPuls(dir, FREMD, { pid: FREMD_PID, art: "kette", phase: "vorbereitung-wartet" });
    const ergebnis = await aufVorbereitungWarten(kette, {});
    assert.equal(ergebnis.ok, true, ergebnis.grund);
    assert.equal(pausen.length, 0, "auf eine selbst wartende Vorbereitung gewartet");
    ergebnis.freigeben();
  }, { lebende: [process.pid, FREMD_PID] });
});

test("[night-1250] zwei Vorbereitungen laufen nacheinander: die zweite bekommt die Sperre erst nach der ersten", async () => {
  await mitVorbereitung(async ({ kette }) => {
    const folge = [];
    const erste = aufVorbereitungWarten(kette, {}).then(async (lock) => {
      folge.push("erste beginnt");
      await Promise.resolve();
      folge.push("erste endet");
      lock.freigeben();
      return lock;
    });
    const zweite = aufVorbereitungWarten(kette, {}).then((lock) => {
      folge.push("zweite beginnt");
      lock.freigeben();
      return lock;
    });
    const [a, b] = await Promise.all([erste, zweite]);
    assert.equal(a.ok, true, a.grund);
    assert.equal(b.ok, true, b.grund);
    assert.deepEqual(folge, ["erste beginnt", "erste endet", "zweite beginnt"]);
  });
});

test("[night-1250] Frist abgelaufen: ok false mit Grund, keine gehaltene Sperre, keine Phase", async () => {
  await mitVorbereitung(async ({ dir, kette, pausen }) => {
    fremderPuls(dir, FREMD, { pid: ZWEITER_PID, art: "kette" });
    const ergebnis = await aufVorbereitungWarten(kette, { fristMin: 3 });
    assert.equal(ergebnis.ok, false);
    assert.match(ergebnis.grund, new RegExp(FREMD), "der Grund nennt den bauenden Lauf nicht");
    assert.match(ergebnis.grund, /3 min/, "der Grund nennt die Frist nicht");
    assert.equal(pausen.reduce((s, p) => s + p.ms, 0), 3 * 60_000, "ueber die Frist hinaus gewartet");
    assert.equal(existsSync(join(dir, UMSETZUNG_LOCK)), false, "die Sperre blieb nach Fristablauf gehalten");
    assert.equal("phase" in pulsLesen(dir), false, "die Phase blieb nach Fristablauf stehen");
  }, { lebende: [process.pid, ZWEITER_PID] });
});

test("[night-1250] ohne Angabe gilt die Frist vorbereitungMin der Kette", async () => {
  await mitVorbereitung(async ({ dir, kette, pausen }) => {
    fremderPuls(dir, FREMD, { pid: ZWEITER_PID, art: "kette" });
    const ergebnis = await aufVorbereitungWarten({ ...kette, budget: { vorbereitungMin: 5 } }, {});
    assert.equal(ergebnis.ok, false);
    assert.equal(pausen.reduce((s, p) => s + p.ms, 0), 5 * 60_000);
  }, { lebende: [process.pid, ZWEITER_PID] });
});
