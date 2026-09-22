// Wiederholung, Idempotenz-Schluessel und die drei Rueckmeldungen des
// Toolbox-Adapters (Issue #834).
//
// Zwei Ebenen, mit Absicht getrennt:
//
//  1. IN-PROCESS gegen `ToolboxIssueTracker` mit gestellter Uhr und gestelltem
//     `fetch`. Nur so laesst sich eine Wiederholschleife pruefen, die real
//     Sekunden wartet: `schlaf` schreibt die Uhr weiter, statt zu warten. Ein
//     Subprozess-Test mit echtem Server koennte dasselbe nur durch echtes Warten
//     belegen — 30 Sekunden je Fall.
//  2. UEBER DIE CLI gegen den Mock-Server aus board-fixture. Dort wird geprueft,
//     was auf der Leitung ankommt: welcher Aufruf einen `Idempotency-Key` traegt
//     und dass `--idempotency-key` unveraendert durchgeht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, mkdtempSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import {
  ToolboxIssueTracker,
  BoardError,
  RUECKMELDUNG,
  TOOLBOX_UEBERLAST_TYPE,
  toolboxBudgetMs,
  darfWiederholen,
  rueckmeldungFuer,
  wartezeitMs,
  wiederholKommando,
} from "../kit/board.mjs";
import { setupProjekt, runBoardAsync, starteServer, repoRoot } from "./helpers/board-fixture.mjs";

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
// Reine Funktionen: die Entscheidungen hinter der Schleife
// ============================================================

test("toolboxBudgetMs: 30 Sekunden interaktiv, 120 mit KIT_AGENT_MODEL", () => {
  assert.equal(toolboxBudgetMs({}), 30_000);
  assert.equal(toolboxBudgetMs({ KIT_AGENT_MODEL: "" }), 30_000);
  assert.equal(toolboxBudgetMs({ KIT_AGENT_MODEL: "claude-opus-5" }), 120_000);
});

test("darfWiederholen: 429 nur mit Ueberlast-type, dann aber bei jeder Methode", () => {
  for (const method of ["GET", "POST", "PUT", "DELETE"]) {
    assert.equal(darfWiederholen({ method, status: 429, typ: TOOLBOX_UEBERLAST_TYPE }), true, method);
    assert.equal(darfWiederholen({ method, status: 429, typ: null }), false, method);
    assert.equal(darfWiederholen({ method, status: 429, typ: "urn:fremd:limit" }), false, method);
  }
});

test("darfWiederholen: 5xx bei GET/PUT/DELETE und bei POST nur mit Schluessel", () => {
  assert.equal(darfWiederholen({ method: "GET", status: 503 }), true);
  assert.equal(darfWiederholen({ method: "PUT", status: 502 }), true);
  assert.equal(darfWiederholen({ method: "DELETE", status: 500 }), true);
  assert.equal(darfWiederholen({ method: "POST", status: 502, hatSchluessel: true }), true);
  assert.equal(darfWiederholen({ method: "POST", status: 502, hatSchluessel: false }), false);
});

test("darfWiederholen: 401 und die uebrigen 4xx nie", () => {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert.equal(darfWiederholen({ method: "GET", status }), false, String(status));
  }
});

test("darfWiederholen: Zeitablauf und Abbruch ja, aktive Ablehnung nein", () => {
  assert.equal(darfWiederholen({ method: "GET", netz: "zeitablauf" }), true);
  assert.equal(darfWiederholen({ method: "POST", netz: "abbruch" }), true);
  assert.equal(darfWiederholen({ method: "GET", netz: "endgueltig" }), false);
});

test("rueckmeldungFuer: die drei Faelle", () => {
  assert.equal(rueckmeldungFuer({ ok: true, status: 200, method: "POST" }), RUECKMELDUNG.AUSGEFUEHRT);
  assert.equal(rueckmeldungFuer({ status: 403, method: "POST" }), RUECKMELDUNG.NICHT_AUSGEFUEHRT);
  assert.equal(rueckmeldungFuer({ netz: "endgueltig", method: "POST" }), RUECKMELDUNG.NICHT_AUSGEFUEHRT);
  assert.equal(rueckmeldungFuer({ netz: "zeitablauf", method: "POST" }), RUECKMELDUNG.AUSGANG_UNKLAR);
  assert.equal(rueckmeldungFuer({ status: 502, method: "POST" }), RUECKMELDUNG.AUSGANG_UNKLAR);
  // Lesend veraendert nichts — auch ein abgebrochener GET ist "nicht ausgefuehrt".
  assert.equal(rueckmeldungFuer({ netz: "zeitablauf", method: "GET" }), RUECKMELDUNG.NICHT_AUSGEFUEHRT);
  assert.equal(rueckmeldungFuer({ status: 503, method: "GET" }), RUECKMELDUNG.NICHT_AUSGEFUEHRT);
});

test("wartezeitMs: waechst, deckelt, streut und folgt Retry-After", () => {
  assert.equal(wartezeitMs(1, null, () => 0), 500);
  assert.equal(wartezeitMs(2, null, () => 0), 1000);
  assert.equal(wartezeitMs(5, null, () => 0), 8000);
  assert.equal(wartezeitMs(9, null, () => 0), 8000);
  // Streuung: voller Zufallswert schlaegt oben auf, nie nach unten.
  assert.ok(wartezeitMs(1, null, () => 1) > 500);
  // Retry-After gewinnt gegen die eigene Staffel, 0 faellt auf die Untergrenze.
  assert.equal(wartezeitMs(1, 3, () => 0), 3000);
  assert.equal(wartezeitMs(4, 0, () => 0), 100);
});

test("wiederholKommando: setzt den Schalter, ohne ihn zu doppeln", () => {
  const argv = ["/usr/bin/node", ".claude/kit/board.mjs", "issue", "comment", "7", "--text", "hallo welt"];
  const kommando = wiederholKommando("abc-123", argv);
  assert.match(kommando, /node .claude\/kit\/board\.mjs issue comment 7/);
  assert.match(kommando, /--text 'hallo welt'/);
  assert.match(kommando, /--idempotency-key abc-123$/);
  // Ein vorhandener Schalter wird ersetzt, nicht ergaenzt.
  const nochmal = wiederholKommando("neu", [...argv, "--idempotency-key", "alt"]);
  assert.equal(nochmal.match(/--idempotency-key/g).length, 1);
  assert.match(nochmal, /--idempotency-key neu$/);
});

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

// ============================================================
// Ueber die CLI: was auf der Leitung ankommt
// ============================================================

const KARTE = { id: 700, number: 7, title: "Karte 7", body: "Body", column: "BACKLOG", position: 0 };

async function mitBoard(fn) {
  const { server, requests, host } = await starteServer((req) => {
    if (req.url === "/api/kanban/items" && req.method === "GET") return { status: 200, json: { BACKLOG: [KARTE] } };
    if (req.url === "/api/kanban/items" && req.method === "POST") return { status: 200, json: { id: 700, number: 7 } };
    if (/^\/api\/kanban\/items\/\d+\/comments$/.test(req.url)) return { status: 200, json: [] };
    if (/^\/api\/kanban\/items\/\d+\/move$/.test(req.url)) return { status: 200, json: { ok: true } };
    if (/^\/api\/kanban\/items\/\d+\/labels/.test(req.url)) return { status: 204, text: "" };
    return null;
  });
  const dir = setupProjekt({ codeHost: "local", issueTracker: "toolbox", toolbox: { host } }, "board-wdh-");
  try {
    return await fn(dir, requests);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    server.close();
  }
}

const MIT_TOKEN = { TBX_TOKEN: "test-token" };

test("Nur create und comment tragen einen Idempotency-Key", async () => {
  await mitBoard(async (dir, requests) => {
    const create = await runBoardAsync(dir, ["issue", "create", "--title", "Neu", "--body", "## Kontext\n\nAutor-Modell: x\n"], MIT_TOKEN);
    assert.equal(create.status, 0, create.stderr);
    const kommentar = await runBoardAsync(dir, ["issue", "comment", "7", "--text", "Hallo"], MIT_TOKEN);
    assert.equal(kommentar.status, 0, kommentar.stderr);
    const move = await runBoardAsync(dir, ["issue", "move", "7", "ready"], MIT_TOKEN);
    assert.equal(move.status, 0, move.stderr);
    const label = await runBoardAsync(dir, ["issue", "label", "add", "7", "kit:test"], MIT_TOKEN);
    assert.equal(label.status, 0, label.stderr);

    const mitSchluessel = requests.filter((r) => r.headers["idempotency-key"]);
    assert.deepEqual(
      mitSchluessel.map((r) => `${r.method} ${r.url.replaceAll(/\d+/g, "N")}`),
      ["POST /api/kanban/items", "POST /api/kanban/items/N/comments"]
    );
    for (const r of mitSchluessel) assert.match(r.headers["idempotency-key"], /^[0-9a-f-]{36}$/);
  });
});

test("--idempotency-key erreicht den Aufruf unveraendert", async () => {
  await mitBoard(async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "comment", "7", "--text", "Hallo", "--idempotency-key", "von-aussen-1"], MIT_TOKEN);
    assert.equal(res.status, 0, res.stderr);
    const post = requests.find((r) => r.method === "POST");
    assert.equal(post.headers["idempotency-key"], "von-aussen-1");
  });
});

test("--idempotency-key wirkt auch bei issue create", async () => {
  await mitBoard(async (dir, requests) => {
    const res = await runBoardAsync(
      dir,
      ["issue", "create", "--title", "Neu", "--body", "## Kontext\n\nAutor-Modell: x\n", "--idempotency-key", "create-9"],
      MIT_TOKEN
    );
    assert.equal(res.status, 0, res.stderr);
    const post = requests.find((r) => r.method === "POST" && r.url === "/api/kanban/items");
    assert.equal(post.headers["idempotency-key"], "create-9");
  });
});

// Der neue Import `node:crypto` ist ein Builtin und darf die Einzeldatei-Tauglichkeit
// nicht antasten (Issue #834): board.mjs bleibt allein kopierbar, ohne Repo, ohne
// node_modules, ohne Nachbardateien.
test("board.mjs bleibt allein kopierbar", () => {
  const ziel = mkdtempSync(join(tmpdir(), "board-allein-"));
  try {
    copyFileSync(join(repoRoot, "kit", "board.mjs"), join(ziel, "board.mjs"));
    const res = spawnSync(process.execPath, ["board.mjs", "--help"], { cwd: ziel, encoding: "utf-8" });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /--idempotency-key/);
  } finally {
    rmSync(ziel, { recursive: true, force: true });
  }
});

test("--idempotency-key ohne Wert wird abgewiesen, bevor irgendetwas hinausgeht", async () => {
  await mitBoard(async (dir, requests) => {
    const res = await runBoardAsync(dir, ["issue", "comment", "7", "--text", "Hallo", "--idempotency-key"], MIT_TOKEN);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /--idempotency-key braucht einen Wert/);
    assert.equal(requests.length, 0);
  });
});
