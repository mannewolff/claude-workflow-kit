// Ablauf-Pruefung: Englische Unterkommandos und Optionen von kit/board.mjs wirken wie die deutschen; ob
// Verteiler, Optionen und Hilfe zusammenpassen, zeigt nur der gestartete Einstieg (Issue #1461, Plan #1420 E18).
//
// Die deutschen Namen (`issue melden`, `issue auftrag`, `--zustand` …) bekommen englische
// dazu, die alten bleiben gueltig. Die Namenstabelle `BEFEHLSNAMEN` im Namen-Register ist die eine
// Quelle fuer die Optionen und die Hilfe; die Verteiler tragen die englischen Befehle als
// zusaetzliche Eintraege. Geprueft wird ueber das echte CLI: Je Namenspaar laufen der deutsche
// und der englische Aufruf in je einem frischen Projekt, und beide liefern dasselbe Ergebnis —
// Exitcode, stdout, stderr und die Dateien, die der Aufruf anlegt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";
import { BEFEHLSNAMEN } from "../kit/board/namen.mjs";

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };
const MIT_VORGESCHICHTE = { ...LOKAL, vorgeschichte: true };
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
  writeFileSync(join(dir, "hook.json"), JSON.stringify({ tool_input: { command: "ls" } }), "utf-8");
  return dir;
}

/** Was die Karte und die Ablagen nach einem Aufruf tragen — ohne Zeitstempel-Dateien. */
function spuren(dir) {
  const karte = readFileSync(join(dir, "issues", "0005.md"), "utf-8").replaceAll(/\d{4}-\d\d-\d\d[T ][\d:.]+Z?/g, "<ZEIT>");
  const berichte = join(dir, ".claude", "berichte");
  const stuecke = existsSync(berichte)
    ? readdirSync(berichte).sort().map((n) => `${n}:${readFileSync(join(berichte, n), "utf-8")}`)
    : [];
  return { karte, stuecke };
}

/** Fuehrt einen Aufruf in einem frischen Projekt aus; Pfade des Projekts werden neutral. */
function lauf(args, env = {}, config = LOKAL) {
  const dir = projekt(config);
  try {
    const res = runBoard(dir, args, { HOME: dir, ...env }, { input: readFileSync(join(dir, "hook.json"), "utf-8") });
    const neutral = (s) => (s || "").replaceAll(dir, "<DIR>").replaceAll(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, "<ZEIT>");
    return { status: res.status, stdout: neutral(res.stdout), stderr: neutral(res.stderr), ...spuren(dir) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const en = (achse) => BEFEHLSNAMEN.achsen[achse];
const befehl = (achse, de) => BEFEHLSNAMEN.befehle[achse][de];
const option = (de) => `--${BEFEHLSNAMEN.optionen[de]}`;

// Je Namenspaar ein Aufruf: der deutsche mit deutschen Namen, der englische mit englischen.
// Die Argumente sind so gewaehlt, dass eine nicht erkannte Option das Ergebnis aendert.
const FAELLE = [
  { de: ["issue", "melden", "5", "--teil", "1", "--text", "Stueck"],
    en: ["issue", befehl("issue", "melden"), "5", option("teil"), "1", "--text", "Stueck"] },
  { de: ["issue", "stand", "5", "--zustand", "laeuft", "--text-file", "stand.md"],
    en: ["issue", befehl("issue", "stand"), "5", option("zustand"), "laeuft", "--text-file", "stand.md"] },
  { de: ["issue", "auftrag", "5", "--spalte", "in_progress", "--json"],
    en: ["issue", befehl("issue", "auftrag"), "5", option("spalte"), "in_progress", "--json"] },
  { de: ["issue", "ursprung", "5"], en: ["issue", befehl("issue", "ursprung"), "5"] },
  { de: ["issue", "check-geschuetzt", "5", "--pfad", ".claude/settings.json"],
    en: ["issue", befehl("issue", "check-geschuetzt"), "5", option("pfad"), ".claude/settings.json"] },
  // Der lokale Tracker fuehrt keine Suche: beide Namen enden mit tracker-ohne-suche (Issue #1539).
  // --dateien ohne Wert und --ohne mit einer Nicht-Nummer brechen ab — eine nicht erkannte
  // englische Option bliebe dagegen unbeachtet und endete mit tracker-ohne-suche.
  { de: ["issue", "vorgeschichte", "--begriffe", "x"], en: ["issue", befehl("issue", "vorgeschichte"), option("begriffe"), "x"],
    config: MIT_VORGESCHICHTE },
  { de: ["issue", "vorgeschichte", "--dateien"], en: ["issue", befehl("issue", "vorgeschichte"), option("dateien")],
    config: MIT_VORGESCHICHTE },
  { de: ["issue", "vorgeschichte", "--ohne", "keine-nummer"], en: ["issue", befehl("issue", "vorgeschichte"), option("ohne"), "keine-nummer"],
    config: MIT_VORGESCHICHTE },
  ...Object.keys(BEFEHLSNAMEN.schutz).map((aktion) => ({
    de: ["code", "schutz", aktion, "--zweig", "probe"],
    en: ["code", befehl("code", "schutz"), BEFEHLSNAMEN.schutz[aktion], option("zweig"), "probe"],
  })),
  { de: ["kontext", "paths", "--project", "p", "--date", "2026-10-11"],
    en: [en("kontext"), "paths", "--project", "p", "--date", "2026-10-11"] },
  { de: ["kontext", "last-log"], en: [en("kontext"), "last-log"] },
  { de: ["issue-review", "pruefauftrag", "--rolle", "fehlt", "--datei", "a.md", "--material-datei", "m.md"],
    en: ["issue-review", befehl("issue-review", "pruefauftrag"), option("rolle"), "fehlt", option("datei"), "a.md", option("material-datei"), "m.md"] },
  { de: ["issue-review", "roles", "--stufe", "fachlich", "--author", "x"],
    en: ["issue-review", "roles", option("stufe"), "fachlich", "--author", "x"] },
  { de: ["issue-review", "check", "--nur-pfad"], en: ["issue-review", "check", option("nur-pfad")] },
  { de: ["issue-review", "start", "--code-review", "--auftrag", "fehlt.md", "--ausgabe", "aus.md"],
    en: ["issue-review", "start", "--code-review", option("auftrag"), "fehlt.md", option("ausgabe"), "aus.md"] },
  { de: ["nightrun", "melden", "--datei", "x.json"], en: ["nightrun", befehl("nightrun", "melden"), option("datei"), "x.json"] },
  { de: ["sitzung", "melden", "--protokoll", "p.jsonl"], en: [en("sitzung"), befehl("sitzung", "melden"), option("protokoll"), "p.jsonl"],
    env: { KIT_AGENT_MODEL: "" } },
  { de: ["hook", "bash-pruefen"], en: ["hook", befehl("hook", "bash-pruefen")] },
];

for (const fall of FAELLE) {
  test(`${fall.en.join(" ")} wirkt wie ${fall.de.join(" ")}`, () => {
    assert.notDeepEqual(fall.en, fall.de, "das Paar unterscheidet sich nicht");
    const deutsch = lauf(fall.de, fall.env, fall.config);
    const englisch = lauf(fall.en, fall.env, fall.config);
    assert.deepEqual(englisch, deutsch);
  });
}

test("jeder englische Name, der vom deutschen abweicht, kommt in einem Fall vor", () => {
  const benutzt = new Set(FAELLE.flatMap((f) => f.en));
  const abweichend = [
    ...Object.entries(BEFEHLSNAMEN.achsen),
    ...Object.values(BEFEHLSNAMEN.befehle).flatMap((b) => Object.entries(b)),
    ...Object.entries(BEFEHLSNAMEN.schutz),
  ].filter(([de, englisch]) => de !== englisch).map(([, englisch]) => englisch);
  const optionen = Object.values(BEFEHLSNAMEN.optionen).map((o) => `--${o}`);
  for (const name of [...abweichend, ...optionen]) assert.ok(benutzt.has(name), `${name} ist ungeprueft`);
});

test("die englischen Namen sind je Ebene eindeutig und kollidieren mit keinem deutschen", () => {
  const ebenen = [BEFEHLSNAMEN.achsen, ...Object.values(BEFEHLSNAMEN.befehle), BEFEHLSNAMEN.schutz, BEFEHLSNAMEN.optionen];
  for (const ebene of ebenen) {
    const englisch = Object.values(ebene);
    assert.equal(new Set(englisch).size, englisch.length, `doppelt: ${englisch.join(", ")}`);
    for (const [de, name] of Object.entries(ebene)) {
      if (de !== name) assert.ok(!Object.hasOwn(ebene, name), `${name} ist zugleich ein deutscher Name`);
    }
  }
});

test("die deutschen Namen bleiben gueltig, auch gemischt mit englischen", () => {
  const gemischt = lauf(["issue", befehl("issue", "stand"), "5", "--zustand", "laeuft", "--text-file", "stand.md"]);
  const deutsch = lauf(["issue", "stand", "5", "--zustand", "laeuft", "--text-file", "stand.md"]);
  assert.equal(deutsch.status, 0, deutsch.stderr);
  assert.deepEqual(gemischt, deutsch);
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
  "node board.mjs issue run-state <id> --state laeuft",
  "node board.mjs issue brief <id> [--column ready|in_progress] [--json]",
  "node board.mjs issue origin <plan>",
  "node board.mjs issue check-protected <id> [--path <pfad>]",
  "node board.mjs code protection setup --branch <z>",
  "node board.mjs code protection suspend --in <pfad>",
  "node board.mjs context paths",
  "node board.mjs issue-review review-brief --role <rolle> --file <ziel>",
  "node board.mjs issue-review start --reviewer <name> | --code-review --brief <datei> --output <datei>",
  "node board.mjs nightrun report --file",
  "node board.mjs session report [--transcript <pfad>]",
  "node board.mjs hook bash-check",
];
const DEUTSCHE_ZEILEN = [
  "node board.mjs issue melden <id> --text",
  "node board.mjs issue melden <id> --teil <n>",
  "node board.mjs issue stand <id> --zustand laeuft",
  "node board.mjs issue auftrag <id> [--spalte ready|in_progress] [--json]",
  "node board.mjs issue ursprung <plan>",
  "node board.mjs issue check-geschuetzt <id> [--pfad <pfad>]",
  "node board.mjs code schutz einrichten --zweig <z>",
  "node board.mjs code schutz aussetzen --in <pfad>",
  "node board.mjs kontext paths",
  "node board.mjs issue-review pruefauftrag --rolle <rolle> --datei <ziel>",
  "node board.mjs issue-review start --reviewer <name> | --code-review --auftrag <datei> --ausgabe <datei>",
  "node board.mjs nightrun melden --datei",
  "node board.mjs sitzung melden [--protokoll <pfad>]",
  "node board.mjs hook bash-pruefen",
];

test("die Hilfe nennt in einem englischen Projekt die englischen Namen", () => {
  const text = hilfe({ ...LOKAL, language: "en" });
  for (const zeile of ENGLISCHE_ZEILEN) assert.ok(text.includes(zeile), `fehlt: ${zeile}`);
  for (const zeile of DEUTSCHE_ZEILEN) assert.ok(!text.includes(zeile), `deutsch: ${zeile}`);
  assert.doesNotMatch(text, /--(zustand|teil|spalte|pfad|zweig|stufe|rolle|datei|auftrag|ausgabe|protokoll|nur-pfad|material-datei)\b/);
});

test("die Hilfe nennt in einem deutschen Projekt die deutschen Namen", () => {
  for (const config of [LOKAL, { ...LOKAL, language: "de" }]) {
    const text = hilfe(config);
    for (const zeile of DEUTSCHE_ZEILEN) assert.ok(text.includes(zeile), `fehlt: ${zeile}`);
    for (const zeile of ENGLISCHE_ZEILEN) assert.ok(!text.includes(zeile), `englisch: ${zeile}`);
  }
});
