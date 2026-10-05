// Die Wiederholschleife des Toolbox-Adapters (Issue #834): Wiederholung, Idempotenz-
// Schluessel und die drei Rueckmeldungen, im selben Prozess gegen `ToolboxIssueTracker`
// mit gestellter Uhr und gestelltem `fetch`. Nur so laesst sich eine Schleife pruefen, die
// real Sekunden wartet: `schlaf` schreibt die Uhr weiter, statt zu warten.
//
// Die Entscheidungen, die die Schleife der Reihe nach trifft, stehen als reine Funktionen
// im Board-Teil wiederholung und werden in test/board-wiederholung-entscheidungen.test.mjs
// geprueft (Issue #1215). Die Schleife
// selbst gehoert zum Toolbox-Adapter, der noch im Einstieg steht; mit seinem Teil
// (Plan #1199, E17) wechselt auch der Import dieser Datei.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ToolboxIssueTracker, BoardError, RUECKMELDUNG, TOOLBOX_UEBERLAST_TYPE, rueckmeldungFuer } from "../kit/board.mjs";

// Der Token kommt aus der Umgebung dieses Testprozesses. node:test startet je
// Datei einen eigenen Prozess, deshalb ist das kein Uebergriff auf andere Tests.
process.env.TBX_TOKEN = "test-token";
process.env.TBX_CONFIG_DIR = "/nicht/vorhanden";
delete process.env.KIT_AGENT_MODEL;

const HOST = "http://board.test";

/**
 * Baut einen Tracker mit gestellter Uhr, gestelltem Zufall (keine Streuung) und
 * einem `fetch`, das eine vorgegebene Antwortfolge abspult.
 *
 * `antworten` ist eine Funktion (versuch, request) => { status, json, headers }
 * oder ein Wurf-Objekt { wirf: Error }. Alle Requests werden mitgeschrieben.
 */
function stelleTracker(antworten, { agentModel = null } = {}) {
  const uhr = { jetzt: 0 };
  const geschlafen = [];
  const zeilen = [];
  const requests = [];
  const alt = globalThis.fetch;
  const altModell = process.env.KIT_AGENT_MODEL;
  if (agentModel) process.env.KIT_AGENT_MODEL = agentModel;
  else delete process.env.KIT_AGENT_MODEL;

  globalThis.fetch = async (url, opts = {}) => {
    requests.push({ url, method: (opts.method || "GET").toUpperCase(), headers: opts.headers || {}, signal: opts.signal });
    const ergebnis = antworten(requests.length, requests.at(-1));
    if (ergebnis?.wirf) throw ergebnis.wirf;
    const kopf = { "Content-Type": "application/json", ...ergebnis.headers };
    return new Response(JSON.stringify(ergebnis.json ?? {}), { status: ergebnis.status, headers: kopf });
  };

  const tracker = new ToolboxIssueTracker({ toolbox: { host: HOST } }, {
    jetzt: () => uhr.jetzt,
    schlaf: async (ms) => { geschlafen.push(ms); uhr.jetzt += ms; },
    zufall: () => 0,
    melde: (zeile) => zeilen.push(zeile),
  });

  const aufraeumen = () => {
    globalThis.fetch = alt;
    if (altModell === undefined) delete process.env.KIT_AGENT_MODEL;
    else process.env.KIT_AGENT_MODEL = altModell;
  };
  return { tracker, uhr, geschlafen, zeilen, requests, aufraeumen };
}

/** Ruft _fetch auf und liefert den geworfenen BoardError (oder null bei Erfolg). */
async function fehlerVon(tracker, pfad, optionen) {
  try {
    await tracker._fetch(pfad, optionen);
    return null;
  } catch (e) {
    return e;
  }
}

function netzfehler(code, name = "Error") {
  const e = new Error(`fetch failed (${code})`);
  e.name = name;
  e.cause = { code };
  return e;
}
// ============================================================
// Die Schleife: gestellte Uhr, gestelltes fetch
// ============================================================

test("429 mit Ueberlast-type wird wiederholt und gelingt danach", async () => {
  const s = stelleTracker((n) =>
    n < 3
      ? { status: 429, json: { type: TOOLBOX_UEBERLAST_TYPE, message: "zu viele Befehle" }, headers: { "Retry-After": "2" } }
      : { status: 200, json: { ok: true } }
  );
  try {
    const res = await s.tracker._fetch("/api/kanban/items");
    assert.equal(res.status, 200);
    assert.equal(s.requests.length, 3);
    // Retry-After in Sekunden schlaegt die eigene Staffel.
    assert.deepEqual(s.geschlafen, [2000, 2000]);
  } finally {
    s.aufraeumen();
  }
});

test("429 ohne Ueberlast-type wird nicht wiederholt", async () => {
  const s = stelleTracker(() => ({ status: 429, json: { message: "rate limit" } }));
  try {
    const e = await fehlerVon(s.tracker, "/api/kanban/items");
    assert.ok(e instanceof BoardError);
    assert.equal(s.requests.length, 1);
    assert.equal(e.rueckmeldung, RUECKMELDUNG.NICHT_AUSGEFUEHRT);
  } finally {
    s.aufraeumen();
  }
});

test("5xx wird bei GET, PUT und DELETE wiederholt", async () => {
  for (const method of ["GET", "PUT", "DELETE"]) {
    const s = stelleTracker((n) => (n === 1 ? { status: 503, json: {} } : { status: 200, json: {} }));
    try {
      await s.tracker._fetch("/api/kanban/items/1/move", { method });
      assert.equal(s.requests.length, 2, method);
    } finally {
      s.aufraeumen();
    }
  }
});

test("5xx wird bei POST mit Schluessel wiederholt, ohne Schluessel nicht", async () => {
  const mit = stelleTracker((n) => (n === 1 ? { status: 502, json: {} } : { status: 200, json: {} }));
  try {
    await mit.tracker._fetch("/api/kanban/items", { method: "POST", idempotencyKey: "k-1" });
    assert.equal(mit.requests.length, 2);
  } finally {
    mit.aufraeumen();
  }

  const ohne = stelleTracker(() => ({ status: 502, json: {} }));
  try {
    const e = await fehlerVon(ohne.tracker, "/api/kanban/night-runs", { method: "POST" });
    assert.equal(ohne.requests.length, 1, "eine Nachtlauf-Meldung darf sich nach 502 nicht doppeln");
    assert.equal(e.rueckmeldung, RUECKMELDUNG.AUSGANG_UNKLAR);
  } finally {
    ohne.aufraeumen();
  }
});

test("403, 404 und 409 brechen sofort ab", async () => {
  for (const status of [403, 404, 409]) {
    const s = stelleTracker(() => ({ status, json: { message: "nein" } }));
    try {
      const e = await fehlerVon(s.tracker, "/api/kanban/items", { method: "PUT" });
      assert.equal(s.requests.length, 1, String(status));
      assert.match(e.message, new RegExp(`HTTP ${status}`));
      assert.equal(e.rueckmeldung, RUECKMELDUNG.NICHT_AUSGEFUEHRT);
    } finally {
      s.aufraeumen();
    }
  }
});

test("401 behaelt seine Sonderbehandlung und wird nie wiederholt", async () => {
  const s = stelleTracker(() => ({ status: 401, json: { message: "nope" } }));
  try {
    const e = await fehlerVon(s.tracker, "/api/kanban/items", { method: "POST", idempotencyKey: "k" });
    assert.equal(s.requests.length, 1);
    assert.match(e.message, /Token ungueltig oder widerrufen/);
    assert.equal(e.rueckmeldung, RUECKMELDUNG.NICHT_AUSGEFUEHRT);
  } finally {
    s.aufraeumen();
  }
});

test("Zeitablauf wird wiederholt, jeder Versuch traegt ein Abbruch-Signal", async () => {
  const s = stelleTracker((n) =>
    n < 2 ? { wirf: netzfehler("UND_ERR_HEADERS_TIMEOUT", "TimeoutError") } : { status: 200, json: {} }
  );
  try {
    await s.tracker._fetch("/api/kanban/items");
    assert.equal(s.requests.length, 2);
    for (const r of s.requests) assert.ok(r.signal, "AbortSignal.timeout fehlt");
  } finally {
    s.aufraeumen();
  }
});

test("ECONNREFUSED ist keine Wiederholung wert und behaelt seine Meldung", async () => {
  const s = stelleTracker(() => ({ wirf: netzfehler("ECONNREFUSED") }));
  try {
    const e = await fehlerVon(s.tracker, "/api/kanban/items");
    assert.equal(s.requests.length, 1);
    assert.match(e.message, /Toolbox-API nicht erreichbar/);
    assert.equal(e.rueckmeldung, RUECKMELDUNG.NICHT_AUSGEFUEHRT);
  } finally {
    s.aufraeumen();
  }
});

test("Gesamtfrist: 30 Sekunden interaktiv, 120 im Nachtbetrieb", async () => {
  const tag = stelleTracker(() => ({ status: 503, json: {} }));
  let tagVersuche = 0;
  try {
    await fehlerVon(tag.tracker, "/api/kanban/items");
    tagVersuche = tag.requests.length;
    assert.ok(tag.uhr.jetzt <= 30_000, `Frist ueberschritten: ${tag.uhr.jetzt}`);
    assert.ok(tagVersuche > 1);
  } finally {
    tag.aufraeumen();
  }

  const nacht = stelleTracker(() => ({ status: 503, json: {} }), { agentModel: "claude-opus-5" });
  try {
    await fehlerVon(nacht.tracker, "/api/kanban/items");
    assert.ok(nacht.uhr.jetzt <= 120_000, `Frist ueberschritten: ${nacht.uhr.jetzt}`);
    assert.ok(nacht.uhr.jetzt > 30_000, "das groessere Budget wurde nicht genutzt");
    assert.ok(nacht.requests.length > tagVersuche);
  } finally {
    nacht.aufraeumen();
  }
});

test("Der Idempotenz-Schluessel bleibt ueber alle Versuche gleich", async () => {
  const s = stelleTracker((n) => (n < 4 ? { status: 502, json: {} } : { status: 200, json: { id: 1, number: 9 } }));
  try {
    await s.tracker._fetch("/api/kanban/items", { method: "POST", idempotencyKey: "fest-1" });
    assert.equal(s.requests.length, 4);
    for (const r of s.requests) assert.equal(r.headers["Idempotency-Key"], "fest-1");
  } finally {
    s.aufraeumen();
  }
});

test("Jeder Wiederholversuch schreibt eine Zeile auf die Meldespur", async () => {
  const s = stelleTracker((n) => (n < 3 ? { status: 503, json: {} } : { status: 200, json: {} }));
  try {
    await s.tracker._fetch("/api/kanban/items");
    assert.equal(s.zeilen.length, 2);
    assert.match(s.zeilen[0], /GET \/api\/kanban\/items/);
    assert.match(s.zeilen[0], /Versuch 1/);
    assert.match(s.zeilen[0], /HTTP 503/);
    assert.match(s.zeilen[0], /500 ms/);
  } finally {
    s.aufraeumen();
  }
});

test("Der Erfolgsfall meldet nichts", async () => {
  const s = stelleTracker(() => ({ status: 200, json: {} }));
  try {
    await s.tracker._fetch("/api/kanban/items");
    assert.deepEqual(s.zeilen, []);
  } finally {
    s.aufraeumen();
  }
});

test("Ausgang unklar nennt Befehl, Schluessel und Wiederholkommando", async () => {
  const s = stelleTracker(() => ({ wirf: netzfehler("UND_ERR_HEADERS_TIMEOUT", "TimeoutError") }));
  try {
    const e = await fehlerVon(s.tracker, "/api/kanban/items/7/comments", { method: "POST", idempotencyKey: "schluessel-42" });
    assert.equal(e.rueckmeldung, RUECKMELDUNG.AUSGANG_UNKLAR);
    assert.match(e.message, /Ausgang unklar/i);
    assert.match(e.message, /POST \/api\/kanban\/items\/7\/comments/);
    assert.match(e.message, /schluessel-42/);
    assert.match(e.message, /--idempotency-key schluessel-42/);
  } finally {
    s.aufraeumen();
  }
});

test("Ausgang unklar ohne Schluessel sagt genau das", async () => {
  const s = stelleTracker(() => ({ status: 502, json: {} }));
  try {
    const e = await fehlerVon(s.tracker, "/api/kanban/night-runs", { method: "POST" });
    assert.equal(e.rueckmeldung, RUECKMELDUNG.AUSGANG_UNKLAR);
    assert.match(e.message, /ohne Idempotenz-Schluessel/);
    assert.doesNotMatch(e.message, /--idempotency-key/);
  } finally {
    s.aufraeumen();
  }
});

test("Die Rueckmeldung ausgefuehrt gehoert dem gelungenen Aufruf", async () => {
  const s = stelleTracker(() => ({ status: 200, json: { ok: true } }));
  try {
    const res = await s.tracker._fetch("/api/kanban/items", { method: "POST", idempotencyKey: "k" });
    assert.equal(res.status, 200);
    assert.equal(rueckmeldungFuer({ ok: true, status: res.status, method: "POST" }), RUECKMELDUNG.AUSGEFUEHRT);
  } finally {
    s.aufraeumen();
  }
});

test("BoardError traegt ohne Angabe die Rueckmeldung 'nicht ausgefuehrt'", () => {
  assert.equal(new BoardError("irgendwas").rueckmeldung, RUECKMELDUNG.NICHT_AUSGEFUEHRT);
});
