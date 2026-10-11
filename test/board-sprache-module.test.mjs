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
// und kit/board/hook.mjs, der dritte (#1482) kit/board/geschuetzt.mjs und kit/board/schutz.mjs;
// der folgende Teil (#1483) ergaenzt diese Datei um seine Module.

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
import { TEXTE as GESCHUETZT_TEXTE, geschuetztKommentar, pruefeIssue, pruefeFachlich, pruefePlan, GESCHUETZT_ANKER,
  GESCHUETZT_LABEL_GESETZT, GESCHUETZT_ABGEWIESEN } from "../kit/board/geschuetzt.mjs";
import { zerlegeAbschnitte } from "../kit/board/dokumente.mjs";
import { TEXTE as SCHUTZ_TEXTE, SCHUTZ_AUSGESETZT, rulesetSoll, schutzZustand, anleitung, nachtSperre, probe,
  einrichten } from "../kit/board/schutz.mjs";
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


// --- kit/board/geschuetzt.mjs und kit/board/schutz.mjs (Issue #1482) -----------------

test("[1482] die Texttabellen von geschuetzt.mjs und schutz.mjs haben in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(GESCHUETZT_TEXTE), []);
  assert.deepEqual(pruefeParitaet(SCHUTZ_TEXTE), []);
  assert.ok(Object.keys(GESCHUETZT_TEXTE.de).length >= 20, "die Tabelle traegt die Texte der Formgates und des Halt-Kommentars");
  assert.ok(Object.keys(SCHUTZ_TEXTE.de).length >= 25, "die Tabelle traegt die Texte des Schutzes");
});

test("[1482] englisch: der Halt-Kommentar erklaert englisch; Anker, Label- und Abweisungszeile bleiben Vertrag", () => {
  spracheFestlegen("en");
  const kommentar = geschuetztKommentar([{ pfad: ".claude/settings.json", zeile: "- `.claude/settings.json` anpassen" }]);
  assert.ok(kommentar.startsWith(`${GESCHUETZT_ANKER}\n\n`));
  assert.match(kommentar, /^This package names files that only a human may write/m);
  assert.match(kommentar, /removes the label `kit:geschuetzt`/);
  assert.match(kommentar, /^- `\.claude\/settings\.json`$/m);
  assert.equal(GESCHUETZT_ANKER, "## Geschuetzte Datei");
  assert.equal(GESCHUETZT_LABEL_GESETZT, "Label kit:geschuetzt gesetzt");
  assert.equal(GESCHUETZT_ABGEWIESEN, "beim Schreiben abgewiesen");
  spracheFestlegen("de");
  assert.match(geschuetztKommentar([{ pfad: "x", zeile: "y" }]), /^Dieses Paket nennt Dateien, die nur ein Mensch schreiben darf/m);
});

/** Die Abschnitte eines Bodys, wie check-form sie den Gates reicht. */
const abschnitteVon = (body) => zerlegeAbschnitte(body).abschnitte;
const meldungen = (verstoesse, gate) => verstoesse.filter((v) => v.gate === gate).map((v) => v.meldung);

test("[1482] englisch: die Formgates des Arbeitspakets nennen ihren Befund englisch, die Gate-Kennungen bleiben", () => {
  spracheFestlegen("en");
  const body = [
    "## Context", "nothing", "",
    "## Task", "1. change `.claude/settings.json` and `.claude/kit/board.mjs`", "",
    "## Acceptance criteria", "- green", "",
  ].join("\n");
  const v = pruefeIssue(abschnitteVon(body), {}, "Paket", "/nicht/vorhanden");
  assert.deepEqual(meldungen(v, "I1"), ["Section '## Dependencies' is missing"]);
  assert.deepEqual(meldungen(v, "I2"), ["'Author-Model:' is not given with a value in section '## Context'"]);
  assert.match(meldungen(v, "I8")[0], /^'\.claude\/settings\.json' is protected, only a human may write the file \(line: '1\. change/);
  assert.match(meldungen(v, "I9")[0], /^'\.claude\/kit\/board\.mjs' in '## Task' \(line: .+\) — The installed copy under/);
  const ohneDatei = pruefeIssue(abschnitteVon("## Context\nAuthor-Model: x\n\n## Task\ndo it\n\n## Acceptance criteria\n- ok\n\n## Dependencies\n"), {}, "Paket", "/x");
  assert.match(meldungen(ohneDatei, "I7")[0], /^'## Task' names no file as a backtick path/);
  assert.deepEqual(meldungen(ohneDatei, "I3"), ["'## Dependencies' is empty — 'Keine.' or 'Issue #N'"]);
  spracheFestlegen("de");
  assert.deepEqual(meldungen(pruefeIssue(abschnitteVon(body), {}, "Paket", "/x"), "I1"), ["Abschnitt '## abhaengigkeiten' fehlt"]);
});

test("[1482] englisch: Fachplan- und Plan-Gates", () => {
  spracheFestlegen("en");
  const fachlich = pruefeFachlich(abschnitteVon("## Goal\n\n## Goal\nx\n"), []);
  assert.ok(meldungen(fachlich, "F1").includes("Section '## Goal' appears 2 times"), meldungen(fachlich, "F1").join(" | "));
  assert.deepEqual(meldungen(fachlich, "F2"), ["'Author-Model:' is not given with a value in section '## Goal'"]);
  assert.deepEqual(meldungen(fachlich, "F7"), ["Section '## Open questions for the PO' is missing"]);
  const plan = pruefePlan([], abschnitteVon("## Goal\nx\n\n## Extra\ny\n\n## Verification\n- Keine.\n"), []);
  assert.deepEqual(meldungen(plan, "P2"), ["additional heading '## extra' — only ### is allowed between the six sections"]);
  assert.deepEqual(meldungen(plan, "P3"), ["'Plan-Model:' is not given with a value in the header before '## Goal'"]);
  assert.deepEqual(meldungen(plan, "P6"), ["'- Keine.' is not allowed in '## Verification'"]);
});

/** Ein Code-Host, der Schutz kennt, mit Rulesets und gruenem Lauf. */
function schutzHost({ rulesets = [], admin = true } = {}) {
  return {
    schutzUnterstuetzt: () => ({ ja: true }),
    getRulesets: async () => rulesets,
    hatAdminRecht: async () => admin,
    getCiStatus: async () => ({ status: "gruen", jobs: [{ name: "check", ergebnis: "gruen" }] }),
    pushRef: async () => {},
    deleteRef: async () => {},
  };
}

test("[1482] englisch: Zustand, Soll und Nacht-Sperre des Schutzes; die Konstante bleibt deutsch", async () => {
  spracheFestlegen("en");
  assert.throws(() => rulesetSoll("main", [], "irgendwas"), { message: "Ruleset kind 'irgendwas' unknown. Expected: haupt | veroeffentlichung" });
  const haupt = { ...rulesetSoll("main", ["check"], "haupt"), requiredStatusChecks: ["check"], bypassActors: ["x"], enforcement: "disabled" };
  const zustand = await schutzZustand(schutzHost({ rulesets: [haupt] }), { mainBranch: "main" }, { kopfVon: () => null });
  assert.deepEqual(zustand.fehlt, [
    "Check before push not in the build service (pushPruefung)",
    "Main branch protection suspended",
    "Ruleset 'claude-workflow-kit: main' deviates: bypass list not empty",
    "Ruleset 'claude-workflow-kit: production' is missing",
  ]);
  assert.equal(SCHUTZ_AUSGESETZT, "Schutz des Hauptzweigs ausgesetzt");
  assert.throws(() => nachtSperre("einrichten", { KIT_AGENT_MODEL: "opus" }),
    { message: /^code schutz einrichten is blocked without supervision \(KIT_AGENT_MODEL set\): / });
  spracheFestlegen("de");
  const de = await schutzZustand(schutzHost({ rulesets: [haupt] }), { mainBranch: "main" }, { kopfVon: () => null });
  assert.ok(de.fehlt.includes(SCHUTZ_AUSGESETZT), de.fehlt.join(" | "));
});

test("[1482] englisch: Anleitung, Probe und Einrichten; die Ergebniswerte bleiben Vertrag", async () => {
  spracheFestlegen("en");
  const text = anleitung(rulesetSoll("main", ["check"], "haupt"));
  assert.match(text, /^4\. Bypass list: leave empty, no role and no user$/m);
  assert.match(text, /\(target branch: main\)/);
  assert.match(text, /^6\. Under Require status checks to pass, enter these jobs as required checks: check$/m);
  await assert.rejects(() => probe(schutzHost(), { mainBranch: "main" }, "kit-pruefung", { kopfVon: () => null }),
    { message: "origin/main is missing in the local repository — first git fetch origin main." });
  await assert.rejects(() => probe(schutzHost(), {}, "kit-pruefung", { kopfVon: () => "a", zweigBelegt: () => true }),
    { message: /^The check branch 'kit-pruefung' already exists on origin/ });
  const ohne = await einrichten(schutzHost(), { mainBranch: "main" }, "kit-pruefung", { kopfVon: () => null });
  assert.deepEqual(ohne, { ergebnis: "nicht moeglich", grund: "origin/main is missing — without a remote state there is nothing to check." });
  const ohneAdmin = await einrichten(schutzHost({ admin: false }), { mainBranch: "main" }, "kit-pruefung", {
    kopfVon: () => "a", zweigBelegt: () => false, takt: 1, schlafe: async () => {}, melde: () => {},
  });
  assert.equal(ohneAdmin.ergebnis, "anleitung");
  assert.equal(ohneAdmin.grund, "Without admin rights on the repository the kit sets up nothing.");
});
