// Ablauf-Pruefung: `issue triage` startet kit/board.mjs am lokalen Tracker und liest Einstieg,
// Ablage und geklaerten Stand einer Idee aus stdout (Issue #1628, Plan #1623 A2, A3, A11, E5).
//
// Ohne Option ist das Kommando rein lesend: Body, Labels und Ablage bleiben nach jedem Aufruf,
// wie sie waren. Die Faelle der reinen Funktionen stehen in test/board-triage-*.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, board, runBoard } from "./helpers/board-fixture.mjs";

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };
// Mit Aufsicht: Die Fixture setzt KIT_AGENT_MODEL, und gesetzt hiesse unbeaufsichtigt (A3).
const MIT_AUFSICHT = { KIT_AGENT_MODEL: "" };

const IDEE = "Ein Export als CSV waere praktisch.";
const BODY = `${IDEE}\n\n## Geklärter Stand\n1. Welches Format?\n   **Antwort (Manne, 2026-10-13):** CSV.\n2. Wer nutzt ihn?\n`;

function imProjekt(lauf, titel = "[Idea] Export") {
  const dir = setupProjekt(LOKAL, "board-triage-");
  try {
    board(dir, "issue", "create", "--title", titel, "--body", BODY);
    lauf(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Der Body der Karte, wie der Tracker ihn haelt — der lokale setzt `Autor-Modell:` davor. */
const kartenBody = (dir) => board(dir, "issue", "get", "1").body;

/** Ruft `issue triage` auf und prueft, dass Karte und Ablage unveraendert bleiben. */
function triage(dir, args = [], env = MIT_AUFSICHT) {
  const datei = join(dir, "issues", "0001.md");
  const vorher = readFileSync(datei, "utf-8");
  const ablageVorher = existsSync(join(dir, ".claude", "ideas", "1"));
  const res = runBoard(dir, ["issue", "triage", ...args], env);
  assert.equal(readFileSync(datei, "utf-8"), vorher, "Body oder Labels geaendert");
  assert.equal(existsSync(join(dir, ".claude", "ideas", "1")), ablageVorher, "Ablage angelegt oder geloescht");
  return { status: res.status, stderr: res.stderr, ausgabe: res.stdout ? JSON.parse(res.stdout) : null };
}

test("ohne Schalter: einstieg, ablage und stand", () => imProjekt((dir) => {
  mkdirSync(join(dir, ".claude", "ideas", "1"), { recursive: true });
  writeFileSync(join(dir, ".claude", "ideas", "1", "skizze.png"), "png");
  board(dir, "issue", "comment", "1", "--text", "Fortsetzung: Issue #9");
  const { status, ausgabe } = triage(dir, ["1"]);
  assert.equal(status, 0);
  assert.deepEqual(Object.keys(ausgabe).sort(), ["ablage", "einstieg", "stand"]);
  assert.deepEqual(ausgabe.einstieg, { start: true, grund: null, meldung: null });
  assert.deepEqual(ausgabe.ablage, {
    pfad: ".claude/ideas/1", vorhanden: true,
    dateien: [{ name: "skizze.png", gelesen: true, vorlageZiel: "design/ideas/1/skizze.png" }],
  });
  assert.equal(ausgabe.stand.offen, 1);
  assert.equal(ausgabe.stand.punkte.length, 2);
  assert.deepEqual(ausgabe.stand.ergebnis, { art: "issue", wert: "9", quelle: "kommentar" });
}));

test("fehlende Ablage wird gemeldet und nicht angelegt", () => imProjekt((dir) => {
  const { ausgabe } = triage(dir, ["1"]);
  assert.deepEqual(ausgabe.ablage, { pfad: ".claude/ideas/1", vorhanden: false, dateien: [] });
}));

test("ohne Nummer: Fehlermeldung, Exit ungleich 0", () => imProjekt((dir) => {
  const res = runBoard(dir, ["issue", "triage"], MIT_AUFSICHT);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /issue triage/);
}));

test("keine Idee: start false mit Grund keine-idee", () => imProjekt((dir) => {
  const { status, ausgabe } = triage(dir, ["1"]);
  assert.equal(status, 0);
  assert.equal(ausgabe.einstieg.start, false);
  assert.equal(ausgabe.einstieg.grund, "keine-idee");
}, "[Plan] Export"));

test("mit KIT_AGENT_MODEL: start false, Grund unbeaufsichtigt, nichts aendert sich", () => imProjekt((dir) => {
  mkdirSync(join(dir, ".claude", "ideas", "1"), { recursive: true });
  writeFileSync(join(dir, ".claude", "ideas", "1", "notiz.md"), "x");
  const { status, ausgabe } = triage(dir, ["1"], { KIT_AGENT_MODEL: "claude-opus-5-5" });
  assert.equal(status, 0);
  assert.equal(ausgabe.einstieg.start, false);
  assert.equal(ausgabe.einstieg.grund, "unbeaufsichtigt");
  assert.ok(existsSync(join(dir, ".claude", "ideas", "1", "notiz.md")));
}));

test("--body-file mit unveraendertem Idee-Text und neuer Antwort: pruefung ok, Exit 0", () => imProjekt((dir) => {
  const neu = join(dir, "neu.md");
  writeFileSync(neu, kartenBody(dir).replace("2. Wer nutzt ihn?\n", "2. Wer nutzt ihn?\n   **Antwort (Manne, 2026-10-13):** Buchhaltung.\n"));
  const { status, ausgabe } = triage(dir, ["1", "--body-file", neu]);
  assert.equal(status, 0);
  assert.deepEqual(ausgabe.pruefung, { ok: true, verstoesse: [] });
}));

test("--body-file mit veraendertem Idee-Text: Exit 1 mit Verstoss ideentext", () => imProjekt((dir) => {
  const neu = join(dir, "neu.md");
  writeFileSync(neu, kartenBody(dir).replace("praktisch", "unnoetig"));
  const { status, ausgabe } = triage(dir, ["1", "--body-file", neu]);
  assert.equal(status, 1);
  assert.equal(ausgabe.pruefung.ok, false);
  assert.deepEqual(ausgabe.pruefung.verstoesse.map((v) => v.regel), ["ideentext"]);
}));

test("--body-file mit unlesbarer Datei: Fehlermeldung", () => imProjekt((dir) => {
  const res = runBoard(dir, ["issue", "triage", "1", "--body-file", join(dir, "fehlt.md")], MIT_AUFSICHT);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /body-file/);
}));
