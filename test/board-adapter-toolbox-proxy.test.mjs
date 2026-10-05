// Die Meldung des Toolbox-Adapters hinter dem Sandbox-Proxy (Issue #998).
//
// Nodes eingebautes `fetch` nutzt HTTPS_PROXY nur, wenn beim Start
// NODE_USE_ENV_PROXY=1 gesetzt ist. Scheitert ein Board-Aufruf am Netz und ist eine
// Proxy-Variable gesetzt, nennt die Meldung am Ende der Wiederholschleife den Schalter.
// Im selben Prozess gegen den Board-Teil kit/board/adapter.mjs, mit gestelltem `fetch` und
// gestellter Uhr (Issue #1217, Plan #1199, E6). Der Neustart ueber die CLI und die Umgebung
// der Nacht-Session stehen in test/board-proxy.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ToolboxIssueTracker } from "../kit/board/adapter.mjs";

process.env.TBX_TOKEN = "test-token";
process.env.TBX_CONFIG_DIR = "/nicht/vorhanden";
delete process.env.KIT_AGENT_MODEL;

const PROXY = "http://127.0.0.1:9";

// ============================================================
// 3. Die Meldung
// ============================================================

function netzfehler(code) {
  const e = new Error("fetch failed");
  e.cause = { code };
  return e;
}

async function meldung(antwort, env) {
  const alt = globalThis.fetch;
  const gemerkt = {};
  for (const k of ["HTTPS_PROXY", "https_proxy"]) gemerkt[k] = process.env[k];
  delete process.env.HTTPS_PROXY;
  delete process.env.https_proxy;
  Object.assign(process.env, env);
  globalThis.fetch = async () => {
    if (antwort.wirf) throw antwort.wirf;
    return new Response("{}", { status: antwort.status, headers: { "Content-Type": "application/json" } });
  };
  const tracker = new ToolboxIssueTracker({ toolbox: { host: "http://board.test" } }, {
    jetzt: () => 0, schlaf: async () => {}, zufall: () => 0, melde: () => {},
  });
  try {
    await tracker._fetch("/api/kanban/items", { method: "POST" });
    return null;
  } catch (e) {
    return e.message;
  } finally {
    globalThis.fetch = alt;
    for (const [k, v] of Object.entries(gemerkt)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("Meldung: Netzfehler hinter einem Proxy nennt NODE_USE_ENV_PROXY=1", async () => {
  const text = await meldung({ wirf: netzfehler("ENOTFOUND") }, { HTTPS_PROXY: PROXY });
  assert.match(text, /Toolbox-API nicht erreichbar/);
  assert.match(text, /NODE_USE_ENV_PROXY=1/);
  assert.match(text, /nicht das Verlassen der Sandbox/);
});

test("Meldung: auch die kleine Proxy-Variable loest den Satz aus", async () => {
  const text = await meldung({ wirf: netzfehler("ECONNREFUSED") }, { https_proxy: PROXY });
  assert.match(text, /NODE_USE_ENV_PROXY=1/);
});

test("Meldung: ohne Proxy-Variable fehlt der Satz", async () => {
  const text = await meldung({ wirf: netzfehler("ENOTFOUND") }, {});
  assert.match(text, /Toolbox-API nicht erreichbar/);
  assert.doesNotMatch(text, /NODE_USE_ENV_PROXY/);
});

test("Meldung: ein HTTP-Fehlerstatus bekommt den Satz nicht", async () => {
  const text = await meldung({ status: 503 }, { HTTPS_PROXY: PROXY });
  assert.match(text, /HTTP 503/);
  assert.doesNotMatch(text, /NODE_USE_ENV_PROXY/);
});
