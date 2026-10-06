// Die Zeiten je Einheit (Issue #749, Plan #745, E1/E2).
//
// Nachdenken ist `apiDauerMs` der Session, Werkzeugarbeit kommt vom Beobachter aus
// Issue #748, der Rest ist die Session-Dauer selbst — die Begriffe stammen aus Issue #737.
//
// Drei Ebenen werden geprueft: `zeitenBauen()` ist die reine Feldkonstruktion (wie
// `verbrauchAddieren`), `zeitenAddieren()` die reine Summe zweier Sessions (wie
// `kennzahlenAddieren`), beide direkt an Fixtures pruefbar. Das Schreiben auf die Einheit
// (`zeitenErfassen`, privat) ist ueber `runSession` im selben Prozess geprueft, mit einer
// Attrappe statt der Session und einer eingesetzten Uhr (Issue #1229) — mit demselben
// `findLast`-Ziel-Muster wie `verbrauchErfassen`: Ein zweiter Aufruf fuer dieselbe Karte
// (Salvage) trifft dieselbe, juengste Einheit und addiert seine Zeiten zu denen der ersten
// (Issue #820).

import { test } from "node:test";
import assert from "node:assert/strict";

import { zeitenBauen, zeitenAddieren, runSession, reviewerVorflug } from "../kit/night/session.mjs";
import { sessionAbh, uhrAttrappe, mitLauf, ARGS } from "./helpers/session-attrappe.mjs";

// ============================================================
// zeitenBauen — reine Feldkonstruktion
// ============================================================

test("[night-51] der Regelfall: nachdenkenMs aus apiDauerMs, werkzeugMs/werkzeugSchuebe/nebenlaeufigeSchuebe vom Beobachter, dauerMs durchgereicht", () => {
  const kennzahlen = { apiDauerMs: 296247, kostenUsd: 1 };
  const werkzeug = { werkzeugMs: 1234, schuebe: 3, nebenlaeufigeSchuebe: 1, offeneSchuebe: 0 };
  assert.deepEqual(zeitenBauen(50000, kennzahlen, werkzeug), {
    dauerMs: 50000,
    nachdenkenMs: 296247,
    werkzeugMs: 1234,
    werkzeugSchuebe: 3,
    nebenlaeufigeSchuebe: 1,
    offeneSchuebe: 0,
  });
});

test("[night-51] ein Schub ohne Ergebnis: werkzeugMs wird null, offeneSchuebe traegt die Zahl", () => {
  const kennzahlen = { apiDauerMs: 8000 };
  // Der Beobachter meldet die Spanne der abgeschlossenen Schuebe mit; sie ist unvollstaendig,
  // solange ein Schub ohne tool_result geblieben ist. Als Zahl gaebe sie sich als Messung aus.
  const werkzeug = { werkzeugMs: 1234, schuebe: 2, nebenlaeufigeSchuebe: 0, offeneSchuebe: 1 };
  assert.deepEqual(zeitenBauen(50000, kennzahlen, werkzeug), {
    dauerMs: 50000,
    nachdenkenMs: 8000,
    werkzeugMs: null,
    werkzeugSchuebe: 2,
    nebenlaeufigeSchuebe: 0,
    offeneSchuebe: 1,
  });
});

test("[night-51] keine Kennzahlen: nachdenkenMs bleibt null, die anderen Felder bleiben", () => {
  const werkzeug = { werkzeugMs: 500, schuebe: 1, nebenlaeufigeSchuebe: 0, offeneSchuebe: 0 };
  const z = zeitenBauen(10000, null, werkzeug);
  assert.equal(z.nachdenkenMs, null);
  assert.equal(z.werkzeugMs, 500);
  assert.equal(z.werkzeugSchuebe, 1);
  assert.equal(z.nebenlaeufigeSchuebe, 0);
  assert.equal(z.offeneSchuebe, 0);
  assert.equal(z.dauerMs, 10000);
});

test("[night-51] kein Beobachter-Ergebnis: werkzeugMs, werkzeugSchuebe, nebenlaeufigeSchuebe und offeneSchuebe bleiben null", () => {
  const kennzahlen = { apiDauerMs: 8000 };
  const z = zeitenBauen(10000, kennzahlen, null);
  assert.equal(z.nachdenkenMs, 8000);
  assert.equal(z.werkzeugMs, null);
  assert.equal(z.werkzeugSchuebe, null);
  assert.equal(z.nebenlaeufigeSchuebe, null);
  assert.equal(z.offeneSchuebe, null);
  assert.equal(z.dauerMs, 10000);
});

test("[night-51] beides fehlt: nur dauerMs bleibt eine Zahl, der Rest ist null — nie 0", () => {
  const z = zeitenBauen(5000, null, null);
  assert.deepEqual(z, {
    dauerMs: 5000, nachdenkenMs: null, werkzeugMs: null, werkzeugSchuebe: null, nebenlaeufigeSchuebe: null, offeneSchuebe: null,
  });
});

test("[night-51] eine 0 bleibt eine 0, kein `|| null`", () => {
  const kennzahlen = { apiDauerMs: 0 };
  const werkzeug = { werkzeugMs: 0, schuebe: 0, nebenlaeufigeSchuebe: 0, offeneSchuebe: 0 };
  assert.deepEqual(zeitenBauen(0, kennzahlen, werkzeug), {
    dauerMs: 0, nachdenkenMs: 0, werkzeugMs: 0, werkzeugSchuebe: 0, nebenlaeufigeSchuebe: 0, offeneSchuebe: 0,
  });
});

// ============================================================
// zeitenAddieren — reine Summe zweier Sessions derselben Einheit
// ============================================================

test("[night-51] zwei vollstaendig gemessene Sessions: jedes Feld ist die Summe", () => {
  const runde = { dauerMs: 3_600_000, nachdenkenMs: 1000, werkzeugMs: 400, werkzeugSchuebe: 3, nebenlaeufigeSchuebe: 1, offeneSchuebe: 0 };
  const salvage = { dauerMs: 120_000, nachdenkenMs: 9000, werkzeugMs: 600, werkzeugSchuebe: 2, nebenlaeufigeSchuebe: 0, offeneSchuebe: 0 };
  assert.deepEqual(zeitenAddieren(runde, salvage), {
    dauerMs: 3_720_000,
    nachdenkenMs: 10_000,
    werkzeugMs: 1000,
    werkzeugSchuebe: 5,
    nebenlaeufigeSchuebe: 1,
    offeneSchuebe: 0,
  });
});

test("[night-51] ein offener Schub auf einer Seite: die Schuebe summieren sich, die Werkzeugzeit der Einheit bleibt null", () => {
  // So kommt es aus `zeitenBauen`: Wer offene Schuebe hat, hat schon dort werkzeugMs null.
  const runde = { dauerMs: 3_600_000, nachdenkenMs: 1000, werkzeugMs: 400, werkzeugSchuebe: 3, nebenlaeufigeSchuebe: 0, offeneSchuebe: 0 };
  const salvage = { dauerMs: 120_000, nachdenkenMs: 9000, werkzeugMs: null, werkzeugSchuebe: 2, nebenlaeufigeSchuebe: 0, offeneSchuebe: 1 };
  assert.deepEqual(zeitenAddieren(runde, salvage), {
    dauerMs: 3_720_000,
    nachdenkenMs: 10_000,
    werkzeugMs: null,
    werkzeugSchuebe: 5,
    nebenlaeufigeSchuebe: 0,
    offeneSchuebe: 1,
  });
});

test("[night-51] eine unvollstaendige Messung auf einer Seite macht die Summe null, nie die andere Zahl", () => {
  const runde = { dauerMs: 3_600_000, nachdenkenMs: null, werkzeugMs: 400, werkzeugSchuebe: 3, nebenlaeufigeSchuebe: 0, offeneSchuebe: 0 };
  const salvage = { dauerMs: 120_000, nachdenkenMs: 9000, werkzeugMs: null, werkzeugSchuebe: null, nebenlaeufigeSchuebe: 0, offeneSchuebe: 0 };
  assert.deepEqual(zeitenAddieren(runde, salvage), {
    dauerMs: 3_720_000,
    nachdenkenMs: null,
    werkzeugMs: null,
    werkzeugSchuebe: null,
    nebenlaeufigeSchuebe: 0,
    offeneSchuebe: 0,
  });
});

// ============================================================
// zeitenErfassen — ueber runSession im selben Prozess (Issue #1229)
// ============================================================
//
// Die Session ist eine Attrappe (`sessionAbh`): Sie spielt ihren Strom ab und stellt dabei
// die Uhr, die `runSession` und `runProcess` eingesetzt bekommen. So ist jede Spanne genau
// bekannt, und kein Kindprozess und keine Wartezeit sind noetig.

const RESULT_ZEILE =
  '{"is_error":false,"duration_api_ms":296247,"num_turns":37,"stop_reason":"end_turn",' +
  '"total_cost_usd":2.4124460000000005,"usage":{"input_tokens":70,"output_tokens":17688},' +
  '"result":"Abschlussbericht gekuerzt.","type":"result"}';

// Ein Schub mit einem tool_use und seinem tool_result, 50 ms dazwischen.
const SCHUB = [
  '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"true"}}]}}',
  { ms: 50 },
  '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}',
];

/** Eine Session zu Karte 7 mit angefordertem Strom, wie die Runde sie faehrt. */
function session(drehbuch, uhr = uhrAttrappe()) {
  const { abh } = sessionAbh(drehbuch, { uhr });
  return runSession("7", ARGS, { stream: true }, abh);
}

test("[night-51] nach einer Session mit Kennzahlen und Beobachter-Ergebnis traegt die Einheit zeiten mit allen sechs Feldern", async () => {
  await mitLauf(["7"], async ({ einheit, stand }) => {
    await session([{ ms: 10 }, ...SCHUB, RESULT_ZEILE, { ms: 5 }]);

    const z = einheit("7").zeiten;
    assert.ok(z, "die Einheit traegt kein zeiten-Feld");
    assert.deepEqual(Object.keys(z).sort(), ["dauerMs", "nachdenkenMs", "nebenlaeufigeSchuebe", "offeneSchuebe", "werkzeugMs", "werkzeugSchuebe"]);
    assert.equal(z.nachdenkenMs, 296247, "nachdenkenMs ist apiDauerMs der Session");
    assert.equal(z.dauerMs, 65, "die Spanne der Session, gemessen an der eingesetzten Uhr");
    assert.equal(z.werkzeugMs, 50, "die Spanne zwischen tool_use und tool_result");
    assert.equal(z.werkzeugSchuebe, 1);
    assert.equal(z.nebenlaeufigeSchuebe, 0);
    assert.equal(z.offeneSchuebe, 0, "jeder Schub hat sein tool_result bekommen");
    assert.deepEqual(stand().einheiten[0].zeiten, z, "der Ergebnisstand traegt dieselben Zeiten");
  });
});

test("[night-51] keine Kennzahlen: nachdenkenMs bleibt null, Werkzeugzeit und Dauer bleiben gemessen", async () => {
  await mitLauf(["7"], async ({ einheit }) => {
    // Kein result-Ereignis: leseKennzahlen() liefert null.
    await session([...SCHUB]);

    const z = einheit("7").zeiten;
    assert.equal(z.nachdenkenMs, null, "ohne result-Ereignis bleibt nachdenkenMs null, nicht 0");
    assert.equal(z.werkzeugMs, 50, "die Werkzeugzeit bleibt gemessen");
    assert.equal(z.dauerMs, 50);
  });
});

test("[night-51] Session ohne Karte (Vorflug) schreibt keine zeiten in irgendeine Einheit", async () => {
  await mitLauf(["7"], async ({ lauf }) => {
    const { abh } = sessionAbh([...SCHUB, RESULT_ZEILE]);
    await reviewerVorflug(ARGS, [], null, abh);

    assert.equal(lauf.einheiten.length, 1, `keine Einheit fuer eine Session ohne Karte: ${JSON.stringify(lauf.einheiten)}`);
    assert.equal(lauf.einheiten[0].zeiten, undefined, "die Vorflug-Session gehoert zu keiner Karte");
  });
});

test("[night-51] laeuft dieselbe Karte mehrfach (Salvage), trifft es die juengste Einheit und addiert ihre Zeiten", async () => {
  // Regulaere Runde und Salvage-Session sind zwei Sessions derselben Karte (Issue #167);
  // beide muessen dieselbe, juengste Einheit treffen. Eine aeltere Einheit derselben Karte
  // bleibt unberuehrt.
  await mitLauf(["7", "8", "7"], async ({ lauf, einheit }) => {
    // duration_api_ms 1000: die regulaere Session, die nichts abschliesst.
    await session([...SCHUB, '{"type":"result","duration_api_ms":1000,"num_turns":1,"total_cost_usd":0.1}']);
    // duration_api_ms 9000: die Salvage-Session, deutlich verschieden von der ersten.
    await session([...SCHUB, ...SCHUB, '{"type":"result","duration_api_ms":9000,"num_turns":2,"total_cost_usd":0.2}']);

    const z = einheit("7").zeiten;
    assert.equal(z.nachdenkenMs, 10000, "1000 der Runde plus 9000 der Rettung — die Einheit hat beides gekostet");
    assert.equal(z.werkzeugSchuebe, 3, "ein Schub der Runde plus zwei der Rettung");
    assert.equal(z.offeneSchuebe, 0);
    assert.equal(z.werkzeugMs, 150);
    assert.equal(z.dauerMs, 150);
    assert.equal(lauf.einheiten[0].zeiten, undefined, "die aeltere Einheit derselben Karte bleibt unberuehrt");
  });
});

test("[night-51] misst eine der beiden Sessions unvollstaendig, bleibt das Feld in der Summe null", async () => {
  // Wie oben, nur gibt die Salvage-Session kein result-Ereignis aus: ihre apiDauerMs fehlt.
  // Die 1000 der regulaeren Runde allein stehenzulassen, gaebe einen Teil als Ganzes aus.
  await mitLauf(["7"], async ({ einheit }) => {
    await session([...SCHUB, '{"type":"result","duration_api_ms":1000,"num_turns":1,"total_cost_usd":0.1}']);
    await session([...SCHUB]);

    const z = einheit("7").zeiten;
    assert.equal(z.nachdenkenMs, null, "ohne apiDauerMs der Rettung ist die Nachdenkzeit der Einheit unbekannt");
    assert.equal(z.werkzeugSchuebe, 2, "die gezaehlten Schuebe beider Sessions bleiben eine Summe");
    assert.equal(z.dauerMs, 100, "die Dauer war auf beiden Seiten gemessen");
  });
});
