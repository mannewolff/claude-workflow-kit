// Ablauf-Pruefung: `issue questions` startet kit/board.mjs am lokalen Tracker und liest den
// Grooming-Stand eines Fachplans aus stdout (Issue #1513, Plan #1510 A2, A3, A4, E1, E9).
//
// Das Kommando ist rein lesend: Body und Labels der Karte bleiben nach jedem Aufruf, wie sie
// waren. Die Faelle der reinen Funktionen stehen in test/board-grooming-*.test.mjs; hier geht
// es um den Einstieg — welche Karte er liest, was er ausgibt und wann er mit Exit 1 endet.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, board, runBoard } from "./helpers/board-fixture.mjs";
import { vermerkZeile } from "../kit/board/grooming.mjs";
import { mitSzenarien } from "./helpers/szenarien-fixture.mjs";

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };
// Mit Aufsicht: Die Fixture setzt KIT_AGENT_MODEL, und gesetzt hiesse unbeaufsichtigt (E7).
const MIT_AUFSICHT = { KIT_AGENT_MODEL: "" };

const BODY = [
  "## Ziel", "Ein Export.", "",
  "Autor-Modell: claude-opus-5-5", "",
  "## Fachliche Akzeptanzkriterien", "1. Der Export liefert CSV.", "2. Der Export nennt die Spalten.", "",
  "## Nicht-Ziele", "- Kein PDF.", "",
  "## Offene Fragen an den PO", "1. Welches Trennzeichen?", "",
].join("\n");

const ENTSCHIEDEN = BODY.replace("1. Welches Trennzeichen?", "1. Welches Trennzeichen?\n   **Antwort (PO, 2026-10-12):** Semikolon.");

function projekt(config = LOKAL) {
  const dir = setupProjekt(config, "board-fragen-");
  board(dir, "issue", "create", "--title", "[Fachlich] Export", "--body", mitSzenarien(BODY));
  return dir;
}

/** Ruft `issue questions` auf und prueft, dass Datei der Karte unveraendert bleibt. */
function fragen(dir, ...args) {
  const datei = join(dir, "issues", "0001.md");
  const vorher = readFileSync(datei, "utf-8");
  const res = runBoard(dir, ["issue", "questions", "1", ...args], MIT_AUFSICHT);
  assert.equal(readFileSync(datei, "utf-8"), vorher, "Body oder Labels geaendert");
  return { status: res.status, stderr: res.stderr, ausgabe: res.stdout ? JSON.parse(res.stdout) : null };
}

function imProjekt(lauf, config) {
  const dir = projekt(config);
  try {
    lauf(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("ohne Schalter: einstieg, fragen, stoppKommentar, vermerkVorschlag und szenarien", () => imProjekt((dir) => {
  board(dir, "issue", "label", "add", "1", "review:fertig");
  const { status, ausgabe } = fragen(dir);
  assert.equal(status, 0);
  assert.deepEqual(Object.keys(ausgabe).sort(), ["einstieg", "fragen", "stoppKommentar", "szenarien", "vermerkVorschlag"]);
  assert.deepEqual(ausgabe.einstieg, { start: true, grund: null });
  assert.equal(ausgabe.fragen.offen, 1);
  assert.equal(ausgabe.fragen.fragen[0].text, "Welches Trennzeichen?");
  assert.equal(ausgabe.stoppKommentar, null);
  assert.equal(ausgabe.vermerkVorschlag, null, "nur bei offen === 0");
}));

test("vermerkVorschlag, sobald keine Frage mehr offen ist", () => imProjekt((dir) => {
  board(dir, "issue", "label", "add", "1", "review:fertig");
  board(dir, "issue", "update", "1", "--body", ENTSCHIEDEN);
  const { ausgabe } = fragen(dir);
  assert.equal(ausgabe.fragen.offen, 0);
  assert.match(ausgabe.vermerkVorschlag, /^Keine\. Die 1 Frage hat der PO am \d{4}-\d{2}-\d{2} entschieden/);
  assert.equal(ausgabe.vermerkVorschlag, vermerkZeile(1, ausgabe.vermerkVorschlag.match(/\d{4}-\d{2}-\d{2}/)[0]));
}));

test("Abweisung am Einstieg: ohne Labels ungeprueft", () => imProjekt((dir) => {
  const { status, ausgabe } = fragen(dir);
  assert.equal(status, 0);
  assert.equal(ausgabe.einstieg.start, false);
  assert.equal(ausgabe.einstieg.grund, "ungeprueft");
}));

test("Abweisung am Einstieg: review:fertig mit Vermerk ist nichts-offen", () => imProjekt((dir) => {
  board(dir, "issue", "label", "add", "1", "review:fertig");
  const mitVermerk = ENTSCHIEDEN.replace("## Offene Fragen an den PO\n", `## Offene Fragen an den PO\n${vermerkZeile(1, "2026-10-12")}\n\n`);
  board(dir, "issue", "update", "1", "--body", mitVermerk);
  const { ausgabe } = fragen(dir);
  assert.equal(ausgabe.einstieg.start, false);
  assert.equal(ausgabe.einstieg.grund, "nichts-offen");
}));

test("unbeaufsichtigt mit gesetztem KIT_AGENT_MODEL", () => imProjekt((dir) => {
  board(dir, "issue", "label", "add", "1", "review:fertig");
  const res = runBoard(dir, ["issue", "questions", "1"], { KIT_AGENT_MODEL: "claude-opus-5-5" });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).einstieg.grund, "unbeaufsichtigt");
}));

test("kit:klaeren mit Kommentar '## Einarbeitung, Runde 1': stoppKommentar gefuellt", () => imProjekt((dir) => {
  board(dir, "issue", "label", "add", "1", "kit:klaeren");
  board(dir, "issue", "comment", "1", "--text", "## Einarbeitung, Runde 1\n\nStopp-Frage: Gilt der Export auch fuer Archive?");
  const { ausgabe } = fragen(dir);
  assert.equal(ausgabe.einstieg.start, true);
  assert.ok(ausgabe.stoppKommentar.kommentar, JSON.stringify(ausgabe.stoppKommentar));
  assert.match(ausgabe.stoppKommentar.kommentar.text, /Gilt der Export auch fuer Archive\?/);
}));

test("kit:klaeren ohne Einarbeitungs-Kommentar: stoppKommentar nennt den Grund", () => imProjekt((dir) => {
  board(dir, "issue", "label", "add", "1", "kit:klaeren");
  const { ausgabe } = fragen(dir);
  assert.equal(ausgabe.stoppKommentar.kommentar, null);
  assert.ok(ausgabe.stoppKommentar.grund);
}));

test("--body-file mit gestrichener Autor-Modell-Zeile: pruefung.ok false, Exit 1", () => imProjekt((dir) => {
  board(dir, "issue", "label", "add", "1", "review:fertig");
  const neu = join(dir, "neu.md");
  writeFileSync(neu, BODY.replace("Autor-Modell: claude-opus-5-5\n", ""), "utf-8");
  const { status, ausgabe } = fragen(dir, "--body-file", neu);
  assert.equal(status, 1);
  assert.equal(ausgabe.pruefung.ok, false);
  assert.ok(ausgabe.pruefung.verstoesse.some((v) => v.regel === "kennzeichnung"));
}));

test("--body-file mit gueltigem Body: pruefung.ok true, Exit 0", () => imProjekt((dir) => {
  board(dir, "issue", "label", "add", "1", "review:fertig");
  const neu = join(dir, "neu.md");
  writeFileSync(neu, ENTSCHIEDEN, "utf-8");
  const { status, ausgabe } = fragen(dir, "--body-file", neu);
  assert.equal(status, 0);
  assert.deepEqual(ausgabe.pruefung, { ok: true, verstoesse: [] });
}));

test("--compare liefert die aenderungen aus kriterienVergleich", () => imProjekt((dir) => {
  board(dir, "issue", "label", "add", "1", "review:fertig");
  const start = join(dir, "start.md");
  writeFileSync(start, BODY.replace("2. Der Export nennt die Spalten.", "2. Der Export nennt Spalten."), "utf-8");
  const { status, ausgabe } = fragen(dir, "--compare", start);
  assert.equal(status, 0);
  assert.deepEqual(ausgabe.aenderungen.kriterien.umformuliert,
    [{ nr: 2, vorher: "Der Export nennt Spalten.", nachher: "Der Export nennt die Spalten." }]);
  assert.deepEqual(ausgabe.aenderungen.nichtZiele, { ergaenzt: [], gestrichen: [], umformuliert: [] });
}));

test("ohne Kartennummer: Exit 1 mit Meldung", () => imProjekt((dir) => {
  const res = runBoard(dir, ["issue", "questions"], MIT_AUFSICHT);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /issue questions/);
}));

test("die Hilfe nennt issue questions", () => imProjekt((dir) => {
  const res = runBoard(dir, ["--help"]);
  assert.match(res.stdout, /issue questions <id> \[--body-file <path>\] \[--compare <path>\]/);
}));

// --- Stand der Szenarien (Issue #1592, Plan #1588 A6, A8, E13) ---

const AB_1 = { ...LOKAL, szenarienAb: 1 };
const MIT_VERMERK = ENTSCHIEDEN.replace("## Offene Fragen an den PO\n", `## Offene Fragen an den PO\n${vermerkZeile(1, "2026-10-12")}\n\n`);

test("szenarien: pflichtig mit vollstaendigem Szenario", () => imProjekt((dir) => {
  board(dir, "issue", "label", "add", "1", "review:fertig");
  const { ausgabe } = fragen(dir);
  assert.deepEqual(ausgabe.szenarien, { pflicht: true, vorhanden: true, vollstaendig: true });
}, AB_1));

test("szenarien: pflichtig ohne Abschnitt bei Vermerk Keine → einstieg startet", () => imProjekt((dir) => {
  board(dir, "issue", "label", "add", "1", "review:fertig");
  board(dir, "issue", "update", "1", "--body", MIT_VERMERK);
  const { ausgabe } = fragen(dir);
  assert.deepEqual(ausgabe.szenarien, { pflicht: true, vorhanden: false, vollstaendig: false });
  assert.equal(ausgabe.einstieg.start, true);
  assert.equal(ausgabe.einstieg.grund, "szenarien-fehlen");
}, AB_1));

test("szenarien: unter dem Stichtag nicht pflichtig", () => imProjekt((dir) => {
  board(dir, "issue", "update", "1", "--body", MIT_VERMERK);
  board(dir, "issue", "label", "add", "1", "review:fertig");
  const { ausgabe } = fragen(dir);
  assert.deepEqual(ausgabe.szenarien, { pflicht: false, vorhanden: false, vollstaendig: false });
  assert.equal(ausgabe.einstieg.grund, "nichts-offen");
}, { ...LOKAL, szenarienAb: 5 }));

test("szenarien: ohne Stichtag ein Hinweis mit dem Kommando zum Nachholen", () => imProjekt((dir) => {
  const { ausgabe } = fragen(dir);
  assert.equal(ausgabe.szenarien.pflicht, "ohne-stichtag");
  assert.equal(ausgabe.szenarien.vollstaendig, true);
  assert.match(ausgabe.szenarien.hinweis, /szenarienAb/);
  assert.match(ausgabe.szenarien.hinweis, /scenarios baseline/);
}));

test("--compare nennt ein beim Groomen ergaenztes Szenario und schlaegt /issue-review vor", () => imProjekt((dir) => {
  board(dir, "issue", "label", "add", "1", "review:fertig");
  const start = join(dir, "start.md");
  writeFileSync(start, BODY, "utf-8");
  const { ausgabe } = fragen(dir, "--compare", start);
  assert.deepEqual(ausgabe.aenderungen.szenarien.ergaenzt.map((s) => s.titel), ["Ein Anliegen"]);
  assert.equal(ausgabe.aenderungen.vorschlag, "/issue-review #1");
}, AB_1));
