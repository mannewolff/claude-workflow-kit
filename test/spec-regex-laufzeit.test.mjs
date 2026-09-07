// Laufzeitwaechter fuer die vier Ausdruecke aus kit/spec.mjs, die SonarCloud als
// super-linear meldet (S8786, Issue #496).
//
// Die Wahl der Eingabe ist der Kern jeder dieser Proben, und sie ist schon einmal
// danebengegangen: Issue #406 mass mit Texten, die SOFORT treffen — die blieben
// auch gegen die quadratische Fassung gruen und bewiesen das Gegenteil dessen,
// was sie behaupteten. Gebraucht wird die Form, die die alte Fassung zum
// Ruecksetzen zwingt: Praefix, dann ein Feld aus Leerraum, dann ein
// abschliessendes Nicht-Leerzeichen. Erst dann probiert die Engine jede
// Aufteilung zwischen `(.+?)` und `\s*` durch.
//
// Warum 32 KiB und nicht die 16 KiB des Vorbilds: Bei 16 KiB brauchte die ALTE
// Fassung auf der Entwicklungsmaschine 90–97 ms — die Probe waere gegen sie
// gruen gewesen und damit wertlos, derselbe Fehlgriff wie in #406, nur in Zahlen
// statt in der Form. Bei 32 KiB liegt sie bei 323–397 ms (vierfache Zeit bei
// doppelter Eingabe, also quadratisch) und die Probe ist rot, wie sie es sein
// muss. Die neue Fassung bleibt bei denselben Eingaben unter 1 ms.
//
// Gemessen wird direkt gegen die EXPORTIERTEN Ausdruecke, nicht ueber die CLI:
// Ein Lauf ueber `spec check` maesse den Parser mit, und die Grenze von 100 ms
// verlore ihre Aussage. Die Ausdruecke sind allein dafuer exportiert.

import { test } from "node:test";
import assert from "node:assert/strict";

import { AUSSAGE_RE, ENTFALLEN_RE, NEU_RE, GEAENDERT_RE } from "../kit/spec.mjs";

const GROSS = 32 * 1024;
const GRENZE_MS = 100;

function dauer(fn) {
  const t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

// Je Ausdruck die Form, an der die alte Fassung zurueckgesetzt hat. Bei den drei
// Aussage-Ausdruecken ist es das Paar `(.+?)` / `\s*$`: Der Leerraum steht
// zwischen zwei Nicht-Leerzeichen, das letzte laesst `$` zunaechst scheitern.
// Bei ENTFALLEN_RE ist es das Paar `(.*?)` / `\s*` vor der Klammer — dort bleibt
// die Klammer bewusst unvollstaendig, damit der Ausdruck ueberhaupt nicht trifft
// und jede Aufteilung durchprobiert wird.
const WORST_CASE = [
  ["AUSSAGE_RE", AUSSAGE_RE, (n) => `- board-1 — x${" ".repeat(n)}z`],
  ["ENTFALLEN_RE", ENTFALLEN_RE, (n) => `x${" ".repeat(n)}(entfallen 2026-01-01, Paket #5`],
  ["NEU_RE", NEU_RE, (n) => `NEU board board-1 — x${" ".repeat(n)}z`],
  ["GEAENDERT_RE", GEAENDERT_RE, (n) => `GEAENDERT board-1 — x${" ".repeat(n)}z`],
];

for (const [name, re, bau] of WORST_CASE) {
  test(`${name} bleibt beim Worst-Case unter ${GRENZE_MS} ms`, (t) => {
    const text = bau(GROSS);
    const ms = dauer(() => re.test(text));
    t.diagnostic(`${name}: ${ms.toFixed(2)} ms bei 32 KiB`);
    assert.ok(ms < GRENZE_MS, `${name}: ${ms.toFixed(1)} ms bei 32 KiB — erwartet unter ${GRENZE_MS} ms`);
  });
}
