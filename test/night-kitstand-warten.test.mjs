// Eine Kette wartet auf eine belegte Umsetzung, statt sie auszulassen (Plan #1113, E10;
// Issue #1185).
//
// Findet die Stufe umsetzung die Sperre belegt, versucht sie es alle 60 Sekunden erneut,
// bis ihr eigenes Umsetzungsbudget verbraucht ist. Die Wartezeit zaehlt zum Budget, der
// Laufstand bleibt `laeuft`, und ein Schreibfehler wartet nicht.
//
// Geprueft an `aufUmsetzungWarten` mit eingespeister Uhr, Sperre und Schlaf — ohne echte
// Minuten und ohne Lock-Datei.

import { test } from "node:test";
import assert from "node:assert/strict";
import { aufUmsetzungWarten, UMSETZUNG_WARTEN_MS } from "../kit/night/kitstand.mjs";

const BELEGT = { ok: false, art: "belegt", grund: "eine andere Umsetzung haelt .claude/night-umsetzung.lock (Prozess 4711)" };
const SCHREIBFEHLER = { ok: false, art: "schreibfehler", grund: ".claude/night-umsetzung.lock liess sich nicht schreiben (EACCES)" };
const FREI = { ok: true, hinweis: null, freigeben: () => {} };

/** Eine Uhr, die nur der eingespeiste Schlaf vorstellt, und die Aufzeichnung aller Aufrufe. */
function umgebung(antworten, { budgetMs = 5 * UMSETZUNG_WARTEN_MS, start = Date.UTC(2026, 9, 5, 22, 0, 0) } = {}) {
  let uhr = start;
  const versuche = [];
  const geschlafen = [];
  const staende = [];
  return {
    versuche, geschlafen, staende, start,
    args: {
      nehmen: () => {
        versuche.push(uhr);
        return antworten[Math.min(versuche.length - 1, antworten.length - 1)];
      },
      jetzt: () => uhr,
      schlafen: async (ms) => {
        geschlafen.push(ms);
        uhr += ms;
      },
      budgetMs,
      standSetzen: (zustand, text) => staende.push({ zustand, text }),
    },
  };
}

test("[night-1185] die Sperre wird vor Budgetende frei: die Umsetzung bekommt sie", async () => {
  const u = umgebung([BELEGT, BELEGT, FREI]);
  const lock = await aufUmsetzungWarten(u.args);
  assert.equal(lock, FREI, "die freie Sperre kam nicht zurueck");
  assert.equal(u.versuche.length, 3);
  assert.deepEqual(u.geschlafen, [UMSETZUNG_WARTEN_MS, UMSETZUNG_WARTEN_MS], "nicht im 60-Sekunden-Takt erneut versucht");
});

test("[night-1185] das Budget laeuft ab: ok false, belegt, mit Grund und Wartezeit — die Stufe endet unvollstaendig", async () => {
  const budgetMs = 2.5 * UMSETZUNG_WARTEN_MS;
  const u = umgebung([BELEGT], { budgetMs });
  const lock = await aufUmsetzungWarten(u.args);
  assert.equal(lock.ok, false);
  assert.equal(lock.art, "belegt");
  assert.match(lock.grund, /Prozess 4711/, "der Grund nennt die haltende Sperre nicht");
  assert.match(lock.grund, /gewartet/, "der Grund nennt das Warten nicht");
  // Die Wartezeit zaehlt zum Budget: Geschlafen wird hoechstens bis zu seinem Ende.
  assert.equal(u.geschlafen.reduce((a, b) => a + b, 0), budgetMs);
  assert.deepEqual(u.geschlafen, [UMSETZUNG_WARTEN_MS, UMSETZUNG_WARTEN_MS, 0.5 * UMSETZUNG_WARTEN_MS]);
  assert.equal(u.versuche.length, 4, "nach dem letzten Schlaf fehlt der letzte Versuch");
});

test("[night-1185] ein Schreibfehler wartet nicht: sofort zurueck, kein Schlaf, kein Laufstand", async () => {
  const u = umgebung([SCHREIBFEHLER, FREI]);
  const lock = await aufUmsetzungWarten(u.args);
  assert.equal(lock, SCHREIBFEHLER);
  assert.equal(u.versuche.length, 1);
  assert.deepEqual(u.geschlafen, []);
  assert.deepEqual(u.staende, []);
});

test("[night-1185] waehrend des Wartens bleibt der Laufstand laeuft, mit dem Text der Wartezeit", async () => {
  const u = umgebung([BELEGT, BELEGT, BELEGT, FREI]);
  await aufUmsetzungWarten(u.args);
  assert.equal(u.staende.length, 1, "der Laufstand wurde nicht genau einmal gesetzt");
  const [s] = u.staende;
  assert.equal(s.zustand, "laeuft", "eine wartende Kette steht nicht auf wartet — das ist der Zustand eines Halts");
  assert.equal(s.text, `wartet auf die Umsetzung seit ${new Date(u.start).toISOString()}`);
});

test("[night-1185] eine freie Sperre beim ersten Versuch setzt keinen Laufstand und schlaeft nicht", async () => {
  const u = umgebung([FREI]);
  assert.equal(await aufUmsetzungWarten(u.args), FREI);
  assert.deepEqual(u.geschlafen, []);
  assert.deepEqual(u.staende, []);
});
