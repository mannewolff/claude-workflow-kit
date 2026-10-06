// Messen ohne zu protokollieren (Issue #748, Plan #745, Fund B1).
//
// Der Strom wird in jedem unbeaufsichtigten Lauf angefordert (`stream: true`), bisher aber
// nur bei `--verbose` zeilenweise verarbeitet. Damit waere die Werkzeugzeit in jedem
// normalen Nachtlauf dauerhaft "nicht gemessen". `useStream` einfach immer wahr zu machen
// waere der andere Fehler: Dann liefe `emitVerbose()` in jedem Lauf und schriebe jedes
// Stream-Ereignis in Konsole UND Tagesprotokoll. Hier wird beides getrennt geprueft —
// gemessen wird immer, wenn der Strom angefordert ist, ausgegeben nur bei `--verbose`.
//
// Alles im selben Prozess (Issue #1229, Plan #1199, E6): Die Session ist eine Attrappe, die
// ihren Strom abspielt und die eingesetzte Uhr stellt. Wie `--verbose no` zu
// `args.verbose: false` wird, prueft test/ablauf-night-session-verbose.test.mjs am Runner.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runSession } from "../kit/night/session.mjs";
import { sessionAbh, mitLauf, stdoutFangen, ARGS } from "./helpers/session-attrappe.mjs";

/** Ein Schub aus einem `tool_use` und seinem `tool_result`, 200 ms dazwischen. */
const SCHUB = [
  '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"mvn -q verify"}}]}}',
  { ms: 200 },
  '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}',
];

/** Die Session zu Karte 748 mit der Attrappe; die Ausgabe auf stdout wird gefangen. */
async function session(args, opts) {
  const { abh } = sessionAbh(SCHUB);
  return stdoutFangen(() => runSession("748", args, opts, abh));
}

test("[night-50] ohne --verbose misst die Session die Werkzeugzeit, sobald sie den Strom anfordert", async () => {
  const { ergebnis: res } = await session(ARGS, { stream: true });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(res.werkzeugzeit, "ohne --verbose fehlt das Beobachter-Ergebnis");
  assert.equal(res.werkzeugzeit.werkzeugMs, 200, "die Spanne zwischen tool_use und tool_result");
  assert.equal(res.werkzeugzeit.schuebe, 1);
  assert.equal(res.werkzeugzeit.offeneSchuebe, 0);
});

test("[night-50] mit --verbose wird ebenso gemessen", async () => {
  const { ergebnis: res } = await session({ ...ARGS, verbose: true }, { stream: true });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.werkzeugzeit.werkzeugMs, 200, "mit --verbose muss dieselbe Messung laufen");
  assert.equal(res.werkzeugzeit.schuebe, 1);
});

test("[night-50] ein Lauf, der den Strom gar nicht anfordert, traegt kein Beobachter-Ergebnis — nicht etwa eines mit Nullen", async () => {
  const { ergebnis: res } = await session(ARGS, {});
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.werkzeugzeit, null, "ohne angeforderten Strom ist nichts gemessen, und das muss unterscheidbar bleiben");
});

// Seit Issue #867 ist das Verlaufsprotokoll die Vorbelegung; abgeschaltet wird mit
// `--verbose no`. Geprueft wird derselbe Punkt wie zuvor: Der Strom wird auch dann
// angefordert und gemessen, wenn nichts davon ausgegeben wird.
test("[night-50] ohne --verbose bleiben Konsole und Tagesprotokoll frei von Stream-Ereignissen", async () => {
  await mitLauf(["748"], async ({ protokoll }) => {
    const { ergebnis: res, text } = await session(ARGS, { stream: true });
    assert.equal(res.werkzeugzeit.schuebe, 1, "gemessen wird trotzdem");

    const ereignis = /#748 > /;
    assert.doesNotMatch(text, ereignis, "ohne --verbose duerfen keine Ereigniszeilen auf der Konsole stehen");
    assert.doesNotMatch(protokoll(), ereignis, "ohne --verbose duerfen keine Ereigniszeilen im Tagesprotokoll stehen");
    assert.match(protokoll(), /--- Session-Output Issue #748 ---/, "die Ausgabe der Session steht weiterhin im Protokoll");
  });
});

test("[night-50] mit --verbose tragen Konsole und Tagesprotokoll die Stream-Ereignisse weiterhin", async () => {
  await mitLauf(["748"], async ({ protokoll }) => {
    const { text } = await session({ ...ARGS, verbose: true }, { stream: true });

    const ereignis = /#748 > Bash: mvn -q verify/;
    assert.match(text, ereignis, "mit --verbose fehlt die Ereigniszeile auf der Konsole");
    assert.match(protokoll(), ereignis, "mit --verbose fehlt die Ereigniszeile im Tagesprotokoll");
  });
});
