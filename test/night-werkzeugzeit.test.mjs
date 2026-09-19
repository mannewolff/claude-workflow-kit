// Der Beobachter der Werkzeugzeit am Session-Strom (Issue #748, Plan #745, E1/E2).
//
// Gemessen wird allein die Spanne zwischen der Ankunft eines `assistant`-Ereignisses mit
// `tool_use`-Bloecken und der Ankunft des letzten zugehoerigen `tool_result` — nie der
// Inhalt eines Aufrufs. Der Beobachter ist exportiert und rein, damit er hier an
// aufgezeichneten Stromzeilen prueffbar ist; dieselbe Linie wie `leseKennzahlen`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { werkzeugZeitBeobachter } from "../kit/night.mjs";

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

test("[night-43] ein Schub mit genau einem Aufruf liefert die Spanne bis zu seinem Ergebnis", () => {
  const erg = beobachte([
    [toolUse("t1"), 1000],
    [toolResult("t1"), 1250],
  ]);
  assert.equal(erg.werkzeugMs, 250);
  assert.equal(erg.schuebe, 1);
  assert.equal(erg.nebenlaeufigeSchuebe, 0);
  assert.equal(erg.offeneSchuebe, 0);
});

test("[night-43] drei parallele Aufrufe zaehlen als EIN Zeitraum bis zum letzten Ergebnis, nicht als Summe", () => {
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

test("[night-43] zwei aufeinanderfolgende Schuebe addieren ihre Spannen", () => {
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

test("[night-43] ein abgeschnittener Strom laesst den offenen Schub aussen vor und zaehlt ihn eigens", () => {
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

test("[night-43] ein offener Schub mit teilweise eingetroffenen Ergebnissen bleibt offen", () => {
  const erg = beobachte([
    [toolUse("a", "b"), 1000],
    [toolResult("a"), 1100],
  ]);
  assert.equal(erg.werkzeugMs, 0);
  assert.equal(erg.schuebe, 0);
  assert.equal(erg.offeneSchuebe, 1);
  assert.equal(erg.nebenlaeufigeSchuebe, 0);
});

test("[night-43] ein Strom ganz ohne tool_use meldet 0 — hier ist 0 gemessen und richtig", () => {
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

test("[night-43] unlesbare und nicht-JSON-Zeilen werden tolerant uebersprungen", () => {
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

test("[night-43] ein tool_use ohne Id eroeffnet keinen Schub — ihm liesse sich kein Ergebnis zuordnen", () => {
  const erg = beobachte([
    [JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read" }] } }), 1000],
  ]);
  assert.equal(erg.schuebe, 0);
  assert.equal(erg.offeneSchuebe, 0);
  assert.equal(erg.werkzeugMs, 0);
});

test("[night-43] der Beobachter nimmt auch eine bereits geparste Zeile entgegen", () => {
  const erg = beobachte([
    [JSON.parse(toolUse("t1")), 1000],
    [JSON.parse(toolResult("t1")), 1400],
  ]);
  assert.equal(erg.werkzeugMs, 400);
  assert.equal(erg.schuebe, 1);
});

test("[night-43] ergebnis() ist mehrfach abrufbar und veraendert den Zustand nicht", () => {
  const b = werkzeugZeitBeobachter();
  b.zeile(toolUse("t1"), 1000);
  b.zeile(toolResult("t1"), 1100);
  assert.deepEqual(b.ergebnis(), b.ergebnis());
  assert.equal(b.ergebnis().werkzeugMs, 100);
});

test("[night-43] der Durchsatz reicht fuer einen echten Session-Strom (5.000 Zeilen unter 1 s)", () => {
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
