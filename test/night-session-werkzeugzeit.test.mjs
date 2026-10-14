// Der Beobachter der Werkzeugzeit am Session-Strom (Issue #748, Plan #745, E1/E2).
//
// Gemessen wird allein die Spanne zwischen der Ankunft eines `assistant`-Ereignisses mit
// `tool_use`-Bloecken und der Ankunft des letzten zugehoerigen `tool_result` — nie der
// Inhalt eines Aufrufs. Der Beobachter ist exportiert und rein, damit er hier an
// aufgezeichneten Stromzeilen prueffbar ist; dieselbe Linie wie `leseKennzahlen`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { werkzeugZeitBeobachter } from "../kit/night/session.mjs";

/** Ein `assistant`-Ereignis mit n `tool_use`-Bloecken, jeder mit eigener Id. */
function toolUse(...ids) {
  return JSON.stringify({
    type: "assistant",
    message: { content: ids.map((id) => ({ type: "tool_use", id, name: "Bash", input: { command: "true" } })) },
  });
}

/** Ein `user`-Ereignis mit einem `tool_result` zur gegebenen Id. */
function toolResult(id) {
  return JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] },
  });
}

/** Fuettert den Beobachter mit Paaren [zeile, zeitstempel] und liefert sein Ergebnis. */
function beobachte(paare) {
  const b = werkzeugZeitBeobachter();
  for (const [zeile, ts] of paare) b.zeile(zeile, ts);
  return b.ergebnis();
}

test("[night-50] ein Schub mit genau einem Aufruf liefert die Spanne bis zu seinem Ergebnis", () => {
  const erg = beobachte([
    [toolUse("t1"), 1000],
    [toolResult("t1"), 1250],
  ]);
  assert.equal(erg.werkzeugMs, 250);
  assert.equal(erg.schuebe, 1);
  assert.equal(erg.nebenlaeufigeSchuebe, 0);
  assert.equal(erg.offeneSchuebe, 0);
});

test("[night-50] drei parallele Aufrufe zaehlen als EIN Zeitraum bis zum letzten Ergebnis, nicht als Summe", () => {
  // Start 1000; die drei Ergebnisse treffen bei 1100, 1400, 1900 ein.
  // Vereinigung der Zeitraeume: 900 ms. Summe der Einzelspannen: 100+400+900 = 1400 ms.
  const erg = beobachte([
    [toolUse("a", "b", "c"), 1000],
    [toolResult("a"), 1100],
    [toolResult("b"), 1400],
    [toolResult("c"), 1900],
  ]);
  assert.equal(erg.werkzeugMs, 900, "die Vereinigung der Zeitraeume muss genau einmal zaehlen");
  assert.notEqual(erg.werkzeugMs, 1400, "die Summe der Einzelspannen waere eine dreifache Buchung derselben Wanduhr");
  assert.equal(erg.schuebe, 1);
  assert.equal(erg.nebenlaeufigeSchuebe, 1);
  assert.equal(erg.offeneSchuebe, 0);
});

test("[night-50] zwei aufeinanderfolgende Schuebe addieren ihre Spannen", () => {
  const erg = beobachte([
    [toolUse("t1"), 1000],
    [toolResult("t1"), 1200],
    [toolUse("t2"), 3000],
    [toolResult("t2"), 3350],
  ]);
  assert.equal(erg.werkzeugMs, 550);
  assert.equal(erg.schuebe, 2);
  assert.equal(erg.nebenlaeufigeSchuebe, 0);
  assert.equal(erg.offeneSchuebe, 0);
});

test("[night-50] ein abgeschnittener Strom laesst den offenen Schub aussen vor und zaehlt ihn eigens", () => {
  const erg = beobachte([
    [toolUse("t1"), 1000],
    [toolResult("t1"), 1200],
    [toolUse("t2"), 3000],
    // kein tool_result: Strom am Zeitlimit abgeschnitten
  ]);
  assert.equal(erg.werkzeugMs, 200, "die offene Spanne darf nicht eingehen");
  assert.equal(erg.schuebe, 1);
  assert.equal(erg.offeneSchuebe, 1);
});

test("[night-50] ein offener Schub mit teilweise eingetroffenen Ergebnissen bleibt offen", () => {
  const erg = beobachte([
    [toolUse("a", "b"), 1000],
    [toolResult("a"), 1100],
  ]);
  assert.equal(erg.werkzeugMs, 0);
  assert.equal(erg.schuebe, 0);
  assert.equal(erg.offeneSchuebe, 1);
  assert.equal(erg.nebenlaeufigeSchuebe, 0);
});

test("[night-50] ein Strom ganz ohne tool_use meldet 0 — hier ist 0 gemessen und richtig", () => {
  const erg = beobachte([
    [JSON.stringify({ type: "system", subtype: "init" }), 1000],
    [JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "nur Text" }] } }), 1100],
    [JSON.stringify({ type: "result", total_cost_usd: 1.25 }), 1200],
  ]);
  assert.equal(erg.werkzeugMs, 0);
  assert.equal(erg.schuebe, 0);
  assert.equal(erg.nebenlaeufigeSchuebe, 0);
  assert.equal(erg.offeneSchuebe, 0);
});

test("[night-50] unlesbare und nicht-JSON-Zeilen werden tolerant uebersprungen", () => {
  const erg = beobachte([
    ["kein JSON", 900],
    ["", 910],
    ["   ", 915],
    ["null", 920],
    ['"nur ein String"', 930],
    ["{abgeschnitten", 940],
    [undefined, 945],
    [JSON.stringify({ type: "assistant", message: {} }), 950],
    [JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read" }] } }), 960],
    [JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "unbekannt" }] } }), 970],
    [toolUse("t1"), 1000],
    [toolResult("t1"), 1300],
  ]);
  assert.equal(erg.werkzeugMs, 300, "der eine vollstaendige Schub muss trotz Muell davor gezaehlt werden");
  assert.equal(erg.schuebe, 1);
  assert.equal(erg.offeneSchuebe, 0);
});

test("[night-50] ein tool_use ohne Id eroeffnet keinen Schub — ihm liesse sich kein Ergebnis zuordnen", () => {
  const erg = beobachte([
    [JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read" }] } }), 1000],
  ]);
  assert.equal(erg.schuebe, 0);
  assert.equal(erg.offeneSchuebe, 0);
  assert.equal(erg.werkzeugMs, 0);
});

test("[night-50] der Beobachter nimmt auch eine bereits geparste Zeile entgegen", () => {
  const erg = beobachte([
    [JSON.parse(toolUse("t1")), 1000],
    [JSON.parse(toolResult("t1")), 1400],
  ]);
  assert.equal(erg.werkzeugMs, 400);
  assert.equal(erg.schuebe, 1);
});

test("[night-50] ergebnis() ist mehrfach abrufbar und veraendert den Zustand nicht", () => {
  const b = werkzeugZeitBeobachter();
  b.zeile(toolUse("t1"), 1000);
  b.zeile(toolResult("t1"), 1100);
  assert.deepEqual(b.ergebnis(), b.ergebnis());
  assert.equal(b.ergebnis().werkzeugMs, 100);
});

test("[night-50] der Durchsatz reicht fuer einen echten Session-Strom (5.000 Zeilen unter 1 s)", () => {
  // Kriterium 13: gemessen statt geschaetzt. Der Beobachter sitzt im stdout-Handler jeder
  // unbeaufsichtigten Session — was dort je Zeile zu lange braucht, bremst den ganzen Lauf.
  const zeilen = [];
  for (let i = 0; i < 1250; i++) {
    zeilen.push([toolUse(`t${i}`), i * 10]);
    zeilen.push([toolResult(`t${i}`), i * 10 + 5]);
    zeilen.push([JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: `Zwischenruf ${i}` }] } }), i * 10 + 6]);
    zeilen.push(["keine JSON-Zeile", i * 10 + 7]);
  }
  assert.ok(zeilen.length >= 5000, `der aufgezeichnete Strom ist zu kurz: ${zeilen.length}`);

  const start = process.hrtime.bigint();
  const erg = beobachte(zeilen);
  const dauerMs = Number(process.hrtime.bigint() - start) / 1e6;

  assert.equal(erg.schuebe, 1250, "der Strom wurde nicht vollstaendig ausgewertet");
  assert.ok(dauerMs < 1000, `5.000 Zeilen brauchten ${dauerMs.toFixed(1)} ms — zu langsam fuer den stdout-Handler`);
});

// --- Die echte Form des Stroms (Issue #1686, Plan #1685, E1/E2) ---
//
// Im echten Strom kommen parallele Aufrufe als getrennte `assistant`-Ereignisse mit
// derselben `message.id`, und Ereignisse eines Subagenten tragen `parent_tool_use_id`
// und laufen ein, waehrend der Agent-Aufruf der Hauptsession offen ist.

/** Ein `assistant`-Ereignis mit `message.id` und optional `parent_tool_use_id`. */
function toolUseIn(messageId, ids, parent = null) {
  return JSON.stringify({
    type: "assistant",
    message: {
      id: messageId,
      content: ids.map((id) => ({ type: "tool_use", id, name: "Bash", input: { command: "true" } })),
    },
    parent_tool_use_id: parent,
  });
}

/** Ein `user`-Ereignis mit einem `tool_result` und optional `parent_tool_use_id`. */
function toolResultIn(id, parent = null) {
  return JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] },
    parent_tool_use_id: parent,
  });
}

test("[night-50] getrennte Ereignisse mit derselben message.id ergeben einen Schub", () => {
  const erg = beobachte([
    [toolUseIn("m1", ["a"]), 1000],
    [toolUseIn("m1", ["b"]), 1010],
    [toolUseIn("m1", ["c"]), 1020],
    [toolResultIn("a"), 1100],
    [toolResultIn("b"), 1400],
    [toolResultIn("c"), 1900],
  ]);
  assert.equal(erg.schuebe, 1);
  assert.equal(erg.nebenlaeufigeSchuebe, 1);
  assert.equal(erg.offeneSchuebe, 0);
  assert.equal(erg.werkzeugMs, 900);
  assert.equal(erg.aufrufe, 3, "aufrufe zaehlt jeden Aufruf des Schubs");
});

test("[night-50] Subagenten-Ereignisse im offenen Agent-Aufruf eroeffnen und schliessen keinen Schub", () => {
  const erg = beobachte([
    [toolUseIn("m1", ["agent1"]), 1000],
    [toolUseIn("s1", ["sub-a"], "agent1"), 1100],
    [toolResultIn("sub-a", "agent1"), 1200],
    [toolUseIn("s2", ["sub-b", "sub-c"], "agent1"), 1300],
    [toolResultIn("sub-b", "agent1"), 1400],
    [toolResultIn("sub-c", "agent1"), 1500],
    [toolResultIn("agent1"), 2000],
  ]);
  assert.equal(erg.offeneSchuebe, 0, "kein Verwaister");
  assert.equal(erg.schuebe, 1);
  assert.equal(erg.werkzeugMs, 1000, "die Werkzeugzeit ist die Spanne des Agent-Aufrufs");
  assert.equal(erg.aufrufe, 1);
});

test("[night-50] eine neue message.id bei offenem Schub laesst den offenen als verwaist zaehlen (#737)", () => {
  const erg = beobachte([
    [toolUseIn("m1", ["a"]), 1000],
    [toolUseIn("m2", ["b"]), 1100],
    [toolResultIn("b"), 1300],
  ]);
  assert.equal(erg.offeneSchuebe, 1);
  assert.equal(erg.schuebe, 1);
  assert.equal(erg.werkzeugMs, 200);
});

test("[night-50] ein Strom in der Form des echten Protokolls ergibt keine offenen Schuebe und eine Werkzeugzeit", () => {
  const erg = beobachte([
    [JSON.stringify({ type: "system", subtype: "init" }), 0],
    [JSON.stringify({ type: "assistant", message: { id: "m0", content: [{ type: "text", text: "los" }] }, parent_tool_use_id: null }), 10],
    // zwei parallele Aufrufe als getrennte Ereignisse derselben Nachricht
    [toolUseIn("m1", ["r1"]), 100],
    [toolUseIn("m1", ["r2"]), 105],
    [toolResultIn("r1"), 150],
    [toolResultIn("r2"), 300],
    // ein Agent-Aufruf, in dem der Subagent selbst parallel arbeitet
    [toolUseIn("m2", ["ag"]), 1000],
    [toolUseIn("s1", ["x1"], "ag"), 1100],
    [toolUseIn("s1", ["x2"], "ag"), 1101],
    [toolResultIn("x1", "ag"), 1200],
    [toolResultIn("x2", "ag"), 1250],
    [toolUseIn("s2", ["x3"], "ag"), 1300],
    [toolResultIn("x3", "ag"), 1400],
    [toolResultIn("ag"), 1600],
    // danach ein einzelner Aufruf
    [toolUseIn("m3", ["b1"]), 2000],
    [toolResultIn("b1"), 2050],
    [JSON.stringify({ type: "result", total_cost_usd: 0.5 }), 2100],
  ]);
  assert.equal(erg.offeneSchuebe, 0);
  assert.equal(erg.schuebe, 3);
  assert.equal(erg.nebenlaeufigeSchuebe, 1);
  assert.equal(erg.werkzeugMs, 200 + 600 + 50);
  assert.equal(erg.aufrufe, 4);
});
