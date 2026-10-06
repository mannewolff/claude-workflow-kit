// wurzelBelegt: Haelt ein lebender Runner eine fachliche Wurzel (Plan #1113, Baustein D,
// E5, E6; Issue #1187)?
//
// Reine Funktion ueber Karten und ihre Laufstaende. Belegt ist die Wurzel F, wenn F selbst
// oder ein Plan mit `Fachliche Quelle: Issue #F` den Laufstand `laeuft` mit lebender
// Lauf-ID traegt. Lebend heisst auf demselben Rechner: der Prozess laeuft; von einem
// anderen Rechner aus: `Stand:` ist juenger als Position mal Gesamtzeit-Obergrenze plus
// 15 Minuten.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { wurzelBelegt } from "../kit/night/kette.mjs";
import { ladeKetteBudget, ladePruefLaufBudget } from "../kit/night/session.mjs";

const HOST = "hier";
const FREMD = "dort";
const JETZT = new Date("2026-10-05T12:00:00.000Z");
const MIN = 60_000;

// Die Obergrenze ohne Config: Summe der Kettenstufen (180 Minuten), groesser als der
// Prueflauf (25 Minuten) — der Laufstand nennt seine Laufart nicht.
const KETTE = ladeKetteBudget({});
const OBERGRENZE_MIN = KETTE.planMin + KETTE.paketeMin + KETTE.reviewMin + KETTE.abdeckungMin + KETTE.umsetzungMin;

/** Eine PID, deren Prozess sicher beendet ist. */
function totePid() {
  const res = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf-8" });
  return Number(res.stdout);
}

const fachlich = { id: "10", title: "[Fachlich] Anforderung", body: "Ziel" };
const plan = { id: "20", title: "[Plan] Plan zur Anforderung", body: "Fachliche Quelle: Issue #10\n" };
const paket = { id: "30", title: "Paket zum Plan", body: "Plan: Issue #20\nFachliche Quelle: Issue #10\n" };
const ISSUES = [fachlich, plan, paket];

function laufstand(zustand, { host = HOST, pid = process.pid, stand = JETZT, position } = {}) {
  const zeilen = [`Lauf-ID: ${host}/${pid}/2026-10-05-110000`, `Stand: ${stand.toISOString()}`];
  if (position) zeilen.push(`Position: ${position.k} von ${position.n}`);
  return { zustand, text: `## Laufstand\n\nLauf angenommen\n\n${zeilen.join("\n")}\n` };
}

const vor = (minuten) => new Date(JETZT.getTime() - minuten * MIN);

test("lebender Halter auf demselben Rechner belegt die Wurzel", () => {
  const staende = new Map([["10", laufstand("laeuft")]]);
  const belegt = wurzelBelegt("10", ISSUES, staende, JETZT, HOST);
  assert.deepEqual(belegt, { karte: "10", laufId: `${HOST}/${process.pid}/2026-10-05-110000` });
});

test("toter Halter auf demselben Rechner belegt nicht, auch mit frischem Stand", () => {
  const staende = new Map([["10", laufstand("laeuft", { pid: totePid() })]]);
  assert.equal(wurzelBelegt("10", ISSUES, staende, JETZT, HOST), null);
});

test("fremder Rechner mit frischem Stand belegt, ohne dass der Prozess hier geprueft wird", () => {
  const staende = new Map([["10", laufstand("laeuft", { host: FREMD, pid: totePid(), stand: vor(5) })]]);
  assert.equal(wurzelBelegt("10", ISSUES, staende, JETZT, HOST)?.karte, "10");
});

test("fremder Rechner mit abgelaufenem Stand belegt nicht", () => {
  const staende = new Map([["10", laufstand("laeuft", { host: FREMD, stand: vor(OBERGRENZE_MIN + 16) })]]);
  assert.equal(wurzelBelegt("10", ISSUES, staende, JETZT, HOST), null);
});

test("fremder Rechner: die 15 Minuten Reserve zaehlen noch", () => {
  const staende = new Map([["10", laufstand("laeuft", { host: FREMD, stand: vor(OBERGRENZE_MIN + 14) })]]);
  assert.equal(wurzelBelegt("10", ISSUES, staende, JETZT, HOST)?.karte, "10");
});

test("ein Plan zur Wurzel belegt sie", () => {
  const staende = new Map([["20", laufstand("laeuft")]]);
  assert.equal(wurzelBelegt("10", ISSUES, staende, JETZT, HOST)?.karte, "20");
});

test("ein Arbeitspaket zur Wurzel belegt sie nicht (E6)", () => {
  const staende = new Map([["30", laufstand("laeuft")]]);
  assert.equal(wurzelBelegt("10", ISSUES, staende, JETZT, HOST), null);
});

test("ein Plan zu einer anderen Wurzel belegt sie nicht", () => {
  const fremderPlan = { id: "21", title: "[Plan] Anderer", body: "Fachliche Quelle: Issue #11\n" };
  const staende = new Map([["21", laufstand("laeuft")]]);
  assert.equal(wurzelBelegt("10", [...ISSUES, fremderPlan], staende, JETZT, HOST), null);
});

test("fremder Rechner, Position 2: zwischen einem und zwei Gesamtbudgets belegt", () => {
  const stand = vor(OBERGRENZE_MIN * 1.5);
  const an2 = new Map([["10", laufstand("laeuft", { host: FREMD, stand, position: { k: 2, n: 3 } })]]);
  assert.equal(wurzelBelegt("10", ISSUES, an2, JETZT, HOST)?.karte, "10");
  // Gegenprobe: Derselbe Stand an Position 1 ist abgelaufen.
  const an1 = new Map([["10", laufstand("laeuft", { host: FREMD, stand, position: { k: 1, n: 3 } })]]);
  assert.equal(wurzelBelegt("10", ISSUES, an1, JETZT, HOST), null);
});

test("abgebrochen und fertig belegen nicht, auch mit lebender Lauf-ID", () => {
  for (const zustand of ["abgebrochen", "fertig"]) {
    const staende = new Map([["10", laufstand(zustand)], ["20", laufstand(zustand)]]);
    assert.equal(wurzelBelegt("10", ISSUES, staende, JETZT, HOST), null, zustand);
  }
});

test("ein Laufstand ohne Lauf-ID belegt nicht", () => {
  const staende = new Map([["10", { zustand: "laeuft", text: "## Laufstand\n\nLauf angenommen\n" }]]);
  assert.equal(wurzelBelegt("10", ISSUES, staende, JETZT, HOST), null);
});

test("ohne Laufstand ist die Wurzel frei; Staende auch als einfaches Objekt", () => {
  assert.equal(wurzelBelegt("10", ISSUES, new Map(), JETZT, HOST), null);
  assert.equal(wurzelBelegt("10", ISSUES, { 20: laufstand("laeuft") }, JETZT, HOST)?.karte, "20");
});

test("die Obergrenze kommt aus den uebergebenen Budgets", () => {
  const budgets = { kette: { ...KETTE, planMin: 1, paketeMin: 1, reviewMin: 1, abdeckungMin: 1, umsetzungMin: 1 }, pruefLauf: ladePruefLaufBudget({}) };
  // Obergrenze 25 (Prueflauf) + 15 Reserve: 45 Minuten alt ist abgelaufen, 35 nicht.
  const alt = new Map([["10", laufstand("laeuft", { host: FREMD, stand: vor(45) })]]);
  assert.equal(wurzelBelegt("10", ISSUES, alt, JETZT, HOST, { budgets }), null);
  const frisch = new Map([["10", laufstand("laeuft", { host: FREMD, stand: vor(35) })]]);
  assert.equal(wurzelBelegt("10", ISSUES, frisch, JETZT, HOST, { budgets })?.karte, "10");
});
