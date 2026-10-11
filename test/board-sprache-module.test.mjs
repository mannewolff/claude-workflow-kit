// Ablauf-Pruefung: Ob die Adapter-Auswahl englisch abweist und check-form die englische Meldung einer fehlenden Karte erkennt, zeigt nur der gestartete Prozess — fail beendet ihn.
//
// Meldungen zweisprachig: uebrige Module unter kit/board/ (Issue #1480, Teil 1 von #1446,
// Plan #1420 E13/E14).
//
// Jedes Modul traegt seine Texte an den Menschen in einer Tabelle `{ de, en }` und gibt sie
// ueber den Texthelfer aus kit/board/namen.mjs aus. Hier steht, was die Pakete zusaetzlich
// zu den deutschen Wortlaut-Tests verlangen:
//
//   - Paritaet: je Sprache dieselben Schluessel und Platzhalter.
//   - Englische Stichproben im selben Prozess, die Sprache per spracheFestlegen gesetzt.
//   - Der Maschinenvertrag (E14) bleibt: Feldnamen und Rueckmeldungen.
//
// Dieser erste Teil deckt kit/board/adapter.mjs; die folgenden Teile (#1481 bis #1483)
// ergaenzen diese Datei um ihre Module.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { TEXTE as ADAPTER_TEXTE, resolveToolboxToken, interpretToolboxCreateResponse, resolveTracker,
  resolveCodeHost, ToolboxIssueTracker, LabelFehltError } from "../kit/board/adapter.mjs";
import { BoardError, RUECKMELDUNG } from "../kit/board/grundlagen.mjs";
import { pruefeParitaet, spracheFestlegen } from "../kit/board/namen.mjs";
import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";

const ADAPTER_URL = new URL("../kit/board/adapter.mjs", import.meta.url).href;
const NAMEN_URL = new URL("../kit/board/namen.mjs", import.meta.url).href;

process.env.TBX_TOKEN = "test-token";
process.env.TBX_CONFIG_DIR = "/nicht/vorhanden";
delete process.env.KIT_AGENT_MODEL;

afterEach(() => spracheFestlegen(null));

/** Der Fehler, den `fn` wirft, oder null. */
async function wurfVon(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

/** Ein Toolbox-Tracker mit gestellter Uhr und einem `fetch`, das je Versuch `antwort` liefert. */
function toolbox(antwort) {
  const uhr = { jetzt: 0 };
  const zeilen = [];
  const alt = globalThis.fetch;
  globalThis.fetch = async () => {
    const a = antwort();
    if (a.wirf) throw a.wirf;
    return new Response(JSON.stringify(a.json ?? {}), { status: a.status, headers: { "Content-Type": "application/json" } });
  };
  const tracker = new ToolboxIssueTracker({ toolbox: { host: "http://board.test" } }, {
    jetzt: () => uhr.jetzt,
    schlaf: async (ms) => { uhr.jetzt += ms; },
    zufall: () => 0,
    melde: (zeile) => zeilen.push(zeile),
  });
  return { tracker, zeilen, aufraeumen: () => { globalThis.fetch = alt; } };
}

// --- kit/board/adapter.mjs (Issue #1480) ---------------------------------------------

test("[1480] die Texttabelle von adapter.mjs hat in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(ADAPTER_TEXTE), []);
  assert.ok(Object.keys(ADAPTER_TEXTE.de).length > 30, "die Tabelle traegt die Texte der Adapter");
});

test("[1480] englische Stichproben: Token und Create-Antwort", async () => {
  spracheFestlegen("en");
  assert.throws(
    () => resolveToolboxToken({ cfg: { toolbox: { token: "x" } }, env: {}, readFile: () => "" }),
    { message: "no plain-text token in workflow.config.json — use TBX_TOKEN or toolbox.tokenFile." },
  );
  assert.throws(
    () => resolveToolboxToken({ cfg: { toolbox: { tokenFile: "leer.txt" } }, env: {}, readFile: () => "  " }),
    { message: "toolbox.tokenFile 'leer.txt' is empty." },
  );
  assert.throws(
    () => resolveToolboxToken({ cfg: {}, env: {}, readFile: () => { throw new Error("weg"); } }),
    { message: /^No Toolbox token found\. Three ways: / },
  );
  assert.throws(() => interpretToolboxCreateResponse({}), { message: "Unexpected create response of the Kanban API (neither 'number' nor 'id'): {}" });
});

test("[1480] englisch: der Code-Host nennt den fehlenden Schutz", async () => {
  spracheFestlegen("en");
  assert.match(resolveCodeHost({ codeHost: "local" }).schutzUnterstuetzt().grund, /^With codeHost local there is no code host/);
  assert.match(resolveCodeHost({ codeHost: "gitlab" }).schutzUnterstuetzt().grund, /^With GitLab the kit sets up no protection/);
});

/** Die Adapter-Auswahl endet bei einem unbekannten Namen per `fail` — darum im eigenen Prozess. */
function auswahlAbweisung(aufruf) {
  const skript = `import * as a from ${JSON.stringify(ADAPTER_URL)};
import { spracheFestlegen } from ${JSON.stringify(NAMEN_URL)};
spracheFestlegen("en");
a.${aufruf};`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", skript], { encoding: "utf-8" });
}

test("[1480] englisch: unbekannter issueTracker und codeHost werden abgewiesen", () => {
  const tracker = auswahlAbweisung(`resolveTracker({ issueTracker: "jira" })`);
  assert.equal(tracker.status, 1);
  assert.match(tracker.stderr, /Unknown issueTracker: 'jira'\. Expected: github \| gitlab \| local \| toolbox$/m);
  const host = auswahlAbweisung(`resolveCodeHost({ codeHost: "svn" })`);
  assert.equal(host.status, 1);
  assert.match(host.stderr, /Unknown codeHost: 'svn'\. Expected: github \| gitlab \| local$/m);
});

test("[1480] englisch: der lokale Tracker meldet eine fehlende Karte, deutsch bleibt der Wortlaut", async () => {
  const dir = mkdtempSync(join(tmpdir(), "board-sprache-module-"));
  try {
    mkdirSync(join(dir, "issues"));
    const config = { issueTracker: "local", local: { issuesDir: join(dir, "issues") } };
    spracheFestlegen("en");
    const en = await wurfVon(() => resolveTracker(config).getIssue("9"));
    assert.ok(en instanceof BoardError);
    assert.match(en.message, /^Issue 9 not found: /);
    spracheFestlegen("de");
    const de = await wurfVon(() => resolveTracker(config).getIssue("9"));
    assert.match(de.message, /^Issue 9 nicht gefunden: /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1480] englisch: Toolbox-Fehler, Wiederholzeile und Ausgang unklar; die Rueckmeldung bleibt Vertrag", async () => {
  spracheFestlegen("en");
  const t401 = toolbox(() => ({ status: 401 }));
  try {
    const e = await wurfVon(() => t401.tracker._fetch("/api/x"));
    assert.equal(e.message, "Token invalid or revoked. Please run 'tbx auth login' again.");
  } finally {
    t401.aufraeumen();
  }

  const t503 = toolbox(() => ({ status: 503, json: { message: "weg" } }));
  try {
    const e = await wurfVon(() => t503.tracker._fetch("/api/x", { method: "POST" }));
    assert.match(e.message, /^Toolbox API error: HTTP 503: weg\nOutcome unclear: POST \/api\/x went out/);
    assert.match(e.message, /ran without an idempotency key/);
    assert.equal(e.rueckmeldung, RUECKMELDUNG.AUSGANG_UNKLAR);
    assert.equal(e.status, 503);
  } finally {
    t503.aufraeumen();
  }

  const tNetz = toolbox(() => ({ wirf: Object.assign(new Error("fetch failed"), { cause: { code: "ECONNRESET" } }) }));
  try {
    await wurfVon(() => tNetz.tracker._fetch("/api/x"));
    assert.ok(tNetz.zeilen.length > 0, "mindestens eine Wiederholzeile");
    assert.match(tNetz.zeilen[0], /^board: GET \/api\/x — attempt 1 ended with network error \(Error: fetch failed\), retrying in \d+ ms \(deadline \d+ s\)$/);
  } finally {
    tNetz.aufraeumen();
  }
});

test("[1480] englisch: ein am Board fehlendes Label nennt Namen und Ausweg", async () => {
  spracheFestlegen("en");
  const items = [{ id: 7, number: 5, title: "x", status: "BACKLOG", labels: [] }];
  const t = toolbox(() => ({ status: 404, json: { message: "Label not found" } }));
  t.tracker._boardItems = async () => items;
  try {
    const e = await wurfVon(() => t.tracker.labelIssue("5", "kit:clarify", "add"));
    assert.ok(e instanceof LabelFehltError);
    assert.match(e.message, /^Label 'kit:clarify' is not defined on the board\./);
  } finally {
    t.aufraeumen();
  }
});

test("[1480] englisch: check-form erkennt die unbekannte Karte an der englischen Meldung und weist ab", () => {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" }, language: "en" }, "board-sprache-module-");
  try {
    mkdirSync(join(dir, "issues"), { recursive: true });
    const res = runBoard(dir, ["issue", "check-form", "999"], { HOME: dir });
    assert.equal(res.status, 1, res.stderr);
    const json = JSON.parse(res.stdout);
    assert.equal(json.ok, false);
    assert.match(json.fehler, /^Issue 999 not found: /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
