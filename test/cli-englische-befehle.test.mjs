// Ablauf-Pruefung: kit/board.mjs nimmt nur englische Namen an und weist jeden frueheren deutschen
// mit Hinweis auf den englischen ab; ob Verteiler, Optionen und Auswahlwerte das tun, zeigt nur der
// gestartete Einstieg (Issue #1557, Plan #1548, Entscheidung „Abweisung statt Uebergang“).
//
// Die Tabelle `ALTNAMEN` im Namen-Register nennt jeden frueheren deutschen Namen mit seinem
// englischen. Je Eintrag laeuft ein Aufruf mit dem deutschen Namen an seiner Stelle: Er endet mit
// Exit 1, nennt den englischen Namen und laesst die Karte und die Ablagen unberuehrt. Derselbe
// Aufruf mit dem englischen Namen wird nicht so abgewiesen. Die Hilfe ist englisch, in jedem
// Projekt (E7).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";
import { ALTNAMEN, altnameHinweis, spracheFestlegen } from "../kit/board/namen.mjs";

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };
const KARTE = [
  "---", "id: \"0005\"", "type: task", "status: ready", "title: Paket", "---", "",
  "## Kontext", "Text.", "", "## Aufgabe", "1. `kit/x.mjs` aendern.", "",
  "## Akzeptanzkriterium", "- gruen", "", "## Abhaengigkeiten", "Keine.", "",
].join("\n");

/** Ein frisches Projekt mit lokalem Tracker und einer Karte #5 in Ready. */
function projekt(config = LOKAL) {
  const dir = setupProjekt(config, "cli-en-");
  mkdirSync(join(dir, "issues"), { recursive: true });
  writeFileSync(join(dir, "issues", "0005.md"), KARTE, "utf-8");
  writeFileSync(join(dir, "stand.md"), "Lauf beginnt.\n", "utf-8");
  return dir;
}

/** Was die Karte und die Ablagen nach einem Aufruf tragen. */
function spuren(dir) {
  const karte = readFileSync(join(dir, "issues", "0005.md"), "utf-8");
  const berichte = join(dir, ".claude", "berichte");
  return { karte, berichte: existsSync(berichte) ? readdirSync(berichte) : [] };
}

/** Fuehrt einen Aufruf in einem frischen Projekt aus. */
function lauf(args, config = LOKAL) {
  const dir = projekt(config);
  try {
    const res = runBoard(dir, args, { HOME: dir, KIT_AGENT_MODEL: "" }, { input: "{}" });
    return { status: res.status, stdout: res.stdout || "", stderr: res.stderr || "", ...spuren(dir) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Je Ebene ein Aufruf, in dem der deutsche Name an seiner Stelle steht; alles andere ist englisch.
// `vorlage(name)` baut den Aufruf, `englisch` ist der Name, den die Meldung nennen muss.
const BEFEHL_REST = {
  issue: ["5"], code: [], "issue-review": [], nightrun: [], session: [], hook: [],
};
const fall = (args, englisch) => ({ args, englisch });
const FAELLE = [
  ...Object.entries(ALTNAMEN.achsen).map(([de, en]) => fall([de, "paths"], en)),
  ...Object.entries(ALTNAMEN.befehle).flatMap(([achse, befehle]) =>
    Object.entries(befehle).map(([de, en]) => fall([achse, de, ...BEFEHL_REST[achse]], en))),
  ...Object.entries(ALTNAMEN.schutz).map(([de, en]) => fall(["code", "protection", de], en)),
  ...Object.entries(ALTNAMEN.optionen).map(([de, en]) => fall(["issue", "report", "5", `--${de}`, "1", "--text", "x"], `--${en}`)),
  ...Object.entries(ALTNAMEN.werte.art).map(([de, en]) => fall(["issue", "check-form", "--body-file", "stand.md", "--title", "X", "--art", de], en)),
  ...Object.entries(ALTNAMEN.werte.state).map(([de, en]) => fall(["issue", "run-state", "5", "--state", de, "--text-file", "stand.md"], en)),
  ...Object.entries(ALTNAMEN.werte.stage).map(([de, en]) => fall(["issue-review", "roles", "--stage", de, "--author", "x"], en)),
];

test("ALTNAMEN traegt jeden frueheren deutschen Namen, auch issue fragen, --vergleich und die Werte", () => {
  assert.equal(ALTNAMEN.befehle.issue.fragen, "questions");
  assert.equal(ALTNAMEN.befehle.issue.melden, "report");
  assert.equal(ALTNAMEN.optionen.vergleich, "compare");
  assert.deepEqual(ALTNAMEN.werte.art, { fachlich: "requirement", idee: "idea", mensch: "human" });
  assert.deepEqual(ALTNAMEN.werte.state, { laeuft: "running", abgebrochen: "aborted", wartet: "waiting", fertig: "done" });
  assert.deepEqual(ALTNAMEN.werte.stage, { fachlich: "requirement" });
});

test("altnameHinweis nennt den englischen Namen in der Projektsprache", () => {
  try {
    spracheFestlegen("de");
    assert.equal(altnameHinweis("befehl", "melden", "issue"), "unbekannt: 'melden' — englischer Name: 'report'");
    assert.equal(altnameHinweis("option", "zustand"), "unbekannt: '--zustand' — englischer Name: '--state'");
    assert.equal(altnameHinweis("wert", "laeuft", "state"), "unbekannt: 'laeuft' — englischer Name: 'running'");
    spracheFestlegen("en");
    assert.equal(altnameHinweis("achse", "kontext"), "unknown: 'kontext' — English name: 'context'");
    assert.equal(altnameHinweis("schutz", "einrichten"), "unknown: 'einrichten' — English name: 'setup'");
  } finally {
    spracheFestlegen(null);
  }
  assert.equal(altnameHinweis("befehl", "report", "issue"), null);
  assert.equal(altnameHinweis("befehl", "melden", "code"), null);
  assert.equal(altnameHinweis("wert", "plan", "art"), null);
  assert.equal(altnameHinweis("option", "toString"), null);
});

test("node board.mjs issue melden 1 endet mit Exit 1 und nennt report", () => {
  const res = lauf(["issue", "melden", "1"]);
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stderr, /'melden' — englischer Name: 'report'/);
});

for (const { args, englisch } of FAELLE) {
  test(`${args.join(" ")} endet mit Exit 1 und nennt ${englisch}`, () => {
    const vorher = spuren(projekt());
    const res = lauf(args);
    assert.equal(res.status, 1, `${res.stdout}\n${res.stderr}`);
    assert.ok(res.stderr.includes(`englischer Name: '${englisch}'`), res.stderr);
    assert.equal(res.stdout, "", "die Abweisung schreibt nichts auf stdout");
    assert.equal(res.karte, vorher.karte, "die Karte blieb nicht unberuehrt");
    assert.deepEqual(res.berichte, []);
  });
}

test("jeder Eintrag aus ALTNAMEN kommt in einem Fall vor", () => {
  const genannt = new Set(FAELLE.map((f) => f.englisch));
  const alle = [
    ...Object.values(ALTNAMEN.achsen),
    ...Object.values(ALTNAMEN.befehle).flatMap(Object.values),
    ...Object.values(ALTNAMEN.schutz),
    ...Object.values(ALTNAMEN.optionen).map((o) => `--${o}`),
    ...Object.values(ALTNAMEN.werte).flatMap(Object.values),
  ];
  for (const name of alle) assert.ok(genannt.has(name), `${name} ist ungeprueft`);
});

test("die englischen Namen derselben Aufrufe werden nicht als Altname abgewiesen", () => {
  const englisch = [
    ["context", "paths", "--project", "p", "--date", "2026-10-11"],
    ["issue", "report", "5", "--part", "1", "--text", "Stueck"],
    ["issue", "run-state", "5", "--state", "running", "--text-file", "stand.md"],
    ["issue", "brief", "5", "--column", "ready", "--json"],
    ["issue", "check-form", "--body-file", "stand.md", "--title", "X", "--art", "requirement"],
    ["issue-review", "roles", "--stage", "requirement", "--author", "x"],
  ];
  for (const args of englisch) {
    const res = lauf(args);
    assert.doesNotMatch(res.stderr, /englischer Name/, args.join(" "));
  }
  const bericht = lauf(["issue", "report", "5", "--part", "1", "--text", "Stueck"]);
  assert.equal(bericht.status, 0, bericht.stderr);
  assert.deepEqual(bericht.berichte, ["5.1.md"]);
});

test("die Abweisung spricht in einem englischen Projekt englisch", () => {
  const res = lauf(["issue", "auftrag", "5"], { ...LOKAL, language: "en" });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /unknown: 'auftrag' — English name: 'brief'/);
});

function hilfe(config) {
  const dir = setupProjekt(config, "cli-en-hilfe-");
  try {
    const res = runBoard(dir, ["--help"]);
    assert.equal(res.status, 0, res.stderr);
    return res.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ENGLISCHE_ZEILEN = [
  "node board.mjs issue report <id> --text",
  "node board.mjs issue report <id> --part <n>",
  "node board.mjs issue run-state <id> --state running",
  "node board.mjs issue brief <id> [--column ready|in_progress] [--json]",
  "node board.mjs issue origin <plan>",
  "node board.mjs issue questions <id> [--body-file <path>] [--compare <path>]",
  "node board.mjs issue check-protected <id> [--path <path>]",
  "node board.mjs code protection setup --branch <b>",
  "node board.mjs code protection suspend --in <path>",
  "node board.mjs context paths",
  "node board.mjs issue-review review-brief --role <role> --file <target>",
  "node board.mjs issue-review start --reviewer <name> | --code-review --brief <file> --output <file>",
  "node board.mjs nightrun report --file",
  "node board.mjs session report [--transcript <path>]",
  "node board.mjs hook bash-check",
  "Valid status values: backlog | ready | in_progress | in_review | done",
];

test("die Hilfe ist in jedem Projekt dieselbe, englisch und ohne deutschen Namen", () => {
  const texte = [LOKAL, { ...LOKAL, language: "de" }, { ...LOKAL, language: "en" }].map(hilfe);
  assert.equal(texte[1], texte[0]);
  assert.equal(texte[2], texte[0]);
  const text = texte[0];
  assert.match(text, /^board\.mjs — board adapter for the claude-workflow-kit/);
  for (const zeile of ENGLISCHE_ZEILEN) assert.ok(text.includes(zeile), `fehlt: ${zeile}`);
  for (const name of Object.keys(ALTNAMEN.optionen)) assert.ok(!text.includes(`--${name} `), `deutsche Option --${name}`);
  assert.doesNotMatch(text, /\b(issue (melden|stand|auftrag|ursprung|fragen|vorgeschichte|check-geschuetzt)|code schutz|kontext paths|sitzung melden|bash-pruefen|pruefauftrag)\b/);
  assert.doesNotMatch(text, /Nutzung:|Gueltige Status-Werte/);
});
