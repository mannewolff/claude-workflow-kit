// Gegentest der Wachstumsprobe (Issue #1080).
//
// Eine Probe, die nicht rot werden kann, prueft nichts. Die Laufzeitproben der Suite
// verlassen sich auf `waechstLinear`; hier steht, dass sie eine quadratische Funktion
// tatsaechlich erkennt und eine lineare durchlaesst.

import { test } from "node:test";
import assert from "node:assert/strict";

import { wachstum, waechstLinear, pruefeLinear, SCHRANKE, BODEN_MS } from "./helpers/wachstum.mjs";

// Kubisch statt quadratisch (Issue #1080): Unter der Last des vollen Prueflaufs wird die
// kleine Messung gebremst, und eine quadratische Funktion (Verhaeltnis ~64) kam nur auf
// 15,7. Katastrophales Backtracking liegt weit darueber; die Probe muss das erkennen,
// nicht eine knappe Quadratik. Kubisch ergibt ~512.
function kubisch(text) {
  let summe = 0;
  for (let i = 0; i < text.length; i++) {
    for (let j = 0; j < text.length; j++) {
      for (let k = 0; k < text.length; k++) summe += (text.charCodeAt(k) & i) ^ j;
    }
  }
  return summe;
}

// Linear: einmal ueber den Text.
function linear(text) {
  let summe = 0;
  for (let i = 0; i < text.length; i++) summe += text.charCodeAt(i);
  return summe;
}

test("eine stark ueberlineare Funktion macht die Wachstumsprobe rot", () => {
  // Gross genug, dass die grosse Messung ueber dem Boden liegt (Issue #1080: 250 ms).
  const e = wachstum(kubisch, (n) => "x".repeat(n), { gross: 768, wiederholungen: 3 });
  assert.ok(e.grossMs >= BODEN_MS, `die Probe muss ueber dem Boden messen, sonst prueft sie nichts: ${e.grossMs} ms`);
  assert.ok(e.verhaeltnis > SCHRANKE, `Verhaeltnis ${e.verhaeltnis.toFixed(1)} — erwartet ueber ${SCHRANKE}`);
  assert.equal(waechstLinear(e), false);
  assert.throws(() => pruefeLinear("kubisch", kubisch, (n) => "x".repeat(n), { gross: 768, wiederholungen: 3 }), /Verhaeltnis/);
});

test("eine lineare Funktion laesst die Wachstumsprobe gruen", () => {
  // 256 KiB wie die echten Proben. Geprueft wird das Urteil, nicht das rohe Verhaeltnis:
  // Das kippt unter Cache-Last auch bei linearen Funktionen (bei 8 MiB 44,9, Issue #1080).
  // Dass die Probe unterscheiden kann, belegt der quadratische Fall oben.
  const e = wachstum(linear, (n) => "x".repeat(n), { gross: 256 * 1024 });
  assert.equal(waechstLinear(e), true, `Verhaeltnis ${e.verhaeltnis.toFixed(1)}, ${e.grossMs.toFixed(2)} ms`);
});

test("unter dem Boden zaehlt das Verhaeltnis nicht", () => {
  assert.equal(waechstLinear({ grossMs: BODEN_MS / 2, verhaeltnis: 500 }), true);
  assert.equal(waechstLinear({ grossMs: BODEN_MS * 10, verhaeltnis: SCHRANKE + 1 }), false);
});
