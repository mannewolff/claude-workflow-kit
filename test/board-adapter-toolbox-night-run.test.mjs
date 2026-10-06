// Tests fuer die Laufkennung des Board-Adapters (Issue #1194).
// Ist KIT_NIGHT_RUN gesetzt (der Nacht-Runner setzt es auf den `start` des Laufs), haengt
// ToolboxIssueTracker._fetch den Header X-Night-Run an jeden Request — neben X-Agent-Model
// und X-Kanban-Token. Ohne die Variable bleibt er weg: interaktive Sessions gehoeren zu
// keinem Lauf. Zwei Ebenen: die reine Header-Funktion und ein Aufruf von _fetch mit
// abgefangenem fetch (Beweis, dass die Funktion auch verdrahtet ist).

import { test } from "node:test";
import assert from "node:assert/strict";

import { nightRunHeader, ToolboxIssueTracker } from "../kit/board/adapter.mjs";

const START = "2026-10-05T08:43:57.123Z";

test("nightRunHeader: gesetzte Variable wird zum X-Night-Run-Header", () => {
  assert.deepEqual(nightRunHeader({ KIT_NIGHT_RUN: START }), { "X-Night-Run": START });
});

test("nightRunHeader: ohne Variable kein Header", () => {
  assert.deepEqual(nightRunHeader({}), {});
});

test("nightRunHeader: leer oder nur Leerzeichen zaehlt als nicht gesetzt", () => {
  assert.deepEqual(nightRunHeader({ KIT_NIGHT_RUN: "" }), {});
  assert.deepEqual(nightRunHeader({ KIT_NIGHT_RUN: "   " }), {});
});

// Faengt fetch ab, setzt die Umgebung fuer genau einen _fetch-Aufruf und gibt die
// gesendeten Header zurueck.
async function headerEinesAufrufs(env) {
  const alt = { fetch: globalThis.fetch, run: process.env.KIT_NIGHT_RUN, modell: process.env.KIT_AGENT_MODEL };
  let gesendet = null;
  globalThis.fetch = async (_url, init) => {
    gesendet = init.headers;
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  delete process.env.KIT_NIGHT_RUN;
  delete process.env.KIT_AGENT_MODEL;
  Object.assign(process.env, env);
  try {
    const tracker = new ToolboxIssueTracker({});
    tracker._auth = () => ({ host: "https://board.invalid", token: "test-token" });
    await tracker._fetch("/api/kanban/items");
    return gesendet;
  } finally {
    globalThis.fetch = alt.fetch;
    for (const [name, wert] of [["KIT_NIGHT_RUN", alt.run], ["KIT_AGENT_MODEL", alt.modell]]) {
      if (wert === undefined) delete process.env[name];
      else process.env[name] = wert;
    }
  }
}

test("_fetch traegt X-Night-Run neben X-Agent-Model und X-Kanban-Token, ohne Variable nicht", async () => {
  const mit = await headerEinesAufrufs({ KIT_NIGHT_RUN: START, KIT_AGENT_MODEL: "claude-opus-5" });
  assert.equal(mit["X-Night-Run"], START, "die Laufkennung fehlt im Request der Nacht-Session");
  assert.equal(mit["X-Agent-Model"], "claude-opus-5", "die Modell-Angabe darf nicht verloren gehen");
  assert.equal(mit["X-Kanban-Token"], "test-token", "der Token-Header darf nicht verloren gehen");

  const ohne = await headerEinesAufrufs({});
  assert.equal("X-Night-Run" in ohne, false, "ohne KIT_NIGHT_RUN darf kein X-Night-Run gesendet werden");
  assert.equal(ohne["X-Kanban-Token"], "test-token");
});
