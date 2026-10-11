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
// Der erste Teil deckt kit/board/adapter.mjs, der zweite (#1481) kit/board/issue-review.mjs
// und kit/board/hook.mjs; die folgenden Teile (#1482, #1483) ergaenzen diese Datei um ihre Module.

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
import { TEXTE as ISSUE_REVIEW_TEXTE, planReviewerAusLauf, probelauf, issueReviewCheck, issueReviewStart,
  issueReviewPruefauftrag } from "../kit/board/issue-review.mjs";
import { TEXTE as HOOK_TEXTE, pruefeBashZeile, pruefeHintergrund, hookBashPruefen } from "../kit/board/hook.mjs";
import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";

const ADAPTER_URL = new URL("../kit/board/adapter.mjs", import.meta.url).href;
const ISSUE_REVIEW_URL = new URL("../kit/board/issue-review.mjs", import.meta.url).href;
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


// --- kit/board/issue-review.mjs und kit/board/hook.mjs (Issue #1481) -------------------

test("[1481] die Texttabellen von issue-review.mjs und hook.mjs haben in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(ISSUE_REVIEW_TEXTE), []);
  assert.deepEqual(pruefeParitaet(HOOK_TEXTE), []);
  assert.ok(Object.keys(ISSUE_REVIEW_TEXTE.de).length > 30, "die Tabelle traegt die Texte der Issue-Review-Achse");
  assert.ok(Object.keys(HOOK_TEXTE.de).length >= 4, "die Tabelle traegt die Texte des Hooks");
});

test("[1481] englisch: der Hook weist Pipe und Hintergrund ab und laesst bei eigenem Fehler durch", () => {
  spracheFestlegen("en");
  const pipe = pruefeBashZeile("node werkzeug.mjs issue list | head", ["node werkzeug.mjs*"]);
  assert.equal(pipe.abweisen, true);
  assert.match(pipe.grund, /^Rejected: "node werkzeug\.mjs\*" is listed in sandbox\.excludedCommands, but a pipe/);
  assert.match(pipe.grund, /\(2>&1 is allowed\)/);
  const hintergrund = pruefeHintergrund({ run_in_background: true }, { KIT_AGENT_MODEL: "opus" });
  assert.match(hintergrund.grund, /^Rejected: run_in_background is blocked without supervision \(KIT_AGENT_MODEL set\)\./);
  const kaputt = hookBashPruefen({ eingabeLesen: () => "{", env: {}, cwd: "/nicht/vorhanden" });
  assert.equal(kaputt.exitCode, 0);
  assert.match(kaputt.stderr, /^board\.mjs hook bash-pruefen: input not readable \(.+\) — call let through\n$/);
  spracheFestlegen("de");
  assert.match(pruefeBashZeile("node werkzeug.mjs x | head", ["node werkzeug.mjs*"]).grund, /^Abgewiesen: /);
});

test("[1481] englisch: Pruefzahl des Laufs und Probelauf", () => {
  spracheFestlegen("en");
  const eintrag = { reviewer: 1, rollen: ["architektur-bestand"] };
  assert.throws(() => planReviewerAusLauf({ env: { KIT_PLAN_REVIEWER: "3" }, eintrag, verfuegbar: 2 }),
    { message: "KIT_PLAN_REVIEWER '3' is invalid — allowed are 1 or 2." });
  assert.throws(() => planReviewerAusLauf({ env: { KIT_PLAN_REVIEWER: "2" }, eintrag, verfuegbar: 1 }),
    { message: "planreview:2 requires two reviewers, one is available" });
  const zeit = probelauf("x", "/x", { spawn: () => ({ status: null, signal: "SIGTERM" }), timeoutMs: 5 });
  assert.deepEqual(zeit, { ok: false, grund: "Time limit of 5 ms exceeded" });
  const signal = probelauf("x", "/x", { spawn: () => ({ status: null, signal: "SIGKILL" }) });
  assert.deepEqual(signal, { ok: false, grund: "Ended by signal SIGKILL" });
  assert.deepEqual(probelauf("x", "/x", { spawn: () => ({ status: 3, stderr: "" }) }), { ok: false, grund: "Exit 3" });
});

test("[1481] englisch: check nennt fehlende Reviewer und Werkzeuge; die Vertragswerte bleiben", () => {
  spracheFestlegen("en");
  const leer = issueReviewCheck({}, { config: {} });
  assert.match(leer.grund, /^issueReview\.reviewers is empty or missing — copy the block from \.claude\/workflow\.config\.example\.json$/);
  const config = { issueReview: { reviewers: [
    { name: "fremd", kind: "command", command: "fremdwerkzeug" },
    { name: "astra", kind: "command", command: "codex exec" },
  ] } };
  const { reviewers } = issueReviewCheck({}, { config, verfuegbar: () => ({ datei: "codex", ok: false, pfad: null }) });
  assert.equal(reviewers[0].geprueft, "lesegrenze");
  assert.equal(reviewers[0].grund, "no read boundary");
  assert.equal(reviewers[1].geprueft, "pfad");
  assert.equal(reviewers[1].grund, "codex not in PATH");
});

test("[1481] englisch: start und pruefauftrag weisen ab; fehler bleibt Vertrag", async () => {
  spracheFestlegen("en");
  const config = { issueReview: { reviewers: [{ name: "astra", kind: "command", command: "codex exec --full-auto" }] } };
  const aufgehoben = issueReviewStart({ reviewer: "astra", auftrag: "a", ausgabe: "b" }, { config });
  assert.equal(aufgehoben.fehler, "lesegrenze-aufgehoben");
  assert.equal(aufgehoben.grund, "'--full-auto' lifts the read boundary");
  assert.throws(() => issueReviewStart({ auftrag: "a", ausgabe: "b" }, { config }),
    { message: "issue-review start: specify either --reviewer <name> or --code-review" });
  assert.throws(() => issueReviewStart({ reviewer: "weg", auftrag: "a", ausgabe: "b" }, { config }),
    { message: "issue-review start: 'weg' is not listed in issueReview.reviewers" });
  await assert.rejects(() => issueReviewPruefauftrag({ rolle: "abgrenzung" }, { config: {} }),
    { message: "issue-review pruefauftrag: --datei missing" });
});

/** Die Pruefung der Config endet per `fail` — darum im eigenen Prozess. */
function issueReviewAbweisung(aufruf) {
  const skript = `import * as r from ${JSON.stringify(ISSUE_REVIEW_URL)};
import { spracheFestlegen } from ${JSON.stringify(NAMEN_URL)};
spracheFestlegen("en");
await r.${aufruf};`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", skript], { encoding: "utf-8" });
}

test("[1481] englisch: die Config-Pruefung und roles weisen ab", () => {
  const kind = issueReviewAbweisung(`issueReviewMatrix({ issueReview: { reviewers: [{ name: "x", kind: "agent" }] } })`);
  assert.equal(kind.status, 1);
  assert.match(kind.stderr, /issueReview\.reviewers\[0\] \('x'\): 'kind' must be claude or command, is 'agent'\./);
  const selbst = issueReviewAbweisung(`issueReviewMatrix({ issueReview: { reviewers: [{ name: "x", kind: "claude", model: "m" }], pairs: { x: ["x"] } } })`);
  assert.match(selbst.stderr, /issueReview\.pairs\['x'\]: names 'x' itself — the author must not be their own reviewer\./);
  const stufe = issueReviewAbweisung(`issueReviewRoles({ stufe: "code", author: "x" }, {})`);
  assert.match(stufe.stderr, /--stufe 'code' is not a known stage\. Expected: fachlich \| plan \| issue/);
  const unbekannt = issueReviewAbweisung(`dispatchIssueReview("weg", {}, "")`);
  assert.match(unbekannt.stderr, /Unknown issue-review command: 'weg'/);
});
