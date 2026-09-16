// `leseKennzahlen` holt Kosten, API-Dauer und Zahl der Zuege aus dem `result`-Ereignis
// einer Session (Issue #487).
//
// Der Runner reicht `res.stdout` aus `runSession` zurueck; bei `--verbose` steht dort
// das NDJSON des Streams, und dessen letztes Ereignis traegt die Kennzahlen. `werteRunde`
// fasst stdout heute nur noch fuer die CLI-Fehlermeldung an und verwirft es danach.
//
// Geprueft wird die reine, exportierte Funktion — ohne Subprozess, Muster
// `night-parse-deps.test.mjs`. Der Einbau in den Ablauf kommt mit Issue #488.

import { test } from "node:test";
import assert from "node:assert/strict";

import { leseKennzahlen } from "../kit/night.mjs";

// --- Fixture ---
//
// Eine ECHTE `result`-Zeile aus `.claude/night-run-2026-09-06.log`, Block
// `--- Session-Output Issue #482 ---` (Session 8945efcc, claude-opus-5). Gekuerzt sind
// nur Textfelder (`result`, `session_id`, `uuid`) und die grossen Unterobjekte
// (`usage`, `modelUsage`, `permission_denials`); die FELDNAMEN sind unveraendert.
//
// Die Zeile ist die Quelle der Wahrheit ueber die Namen: Ohne sie schriebe dieselbe
// Session Fixture, Test und Funktion und prueft nur ihre eigene Annahme. Beachte, dass
// `type` in der echten Zeile weit hinten steht — eine Erkennung, die nur den Zeilenanfang
// ansieht, faellt hier durch.
const RESULT_ZEILE =
  '{"is_error":false,"duration_api_ms":296247,"num_turns":37,"stop_reason":"end_turn",' +
  '"session_id":"8945efcc","total_cost_usd":2.4124460000000005,' +
  '"usage":{"input_tokens":70,"output_tokens":17688,"service_tier":"standard"},' +
  '"modelUsage":{"claude-opus-5":{"costUSD":2.4124460000000005}},"permission_denials":[],' +
  '"result":"Abschlussbericht gekuerzt.","ttft_ms":2744,"time_to_request_ms":35,' +
  '"type":"result","duration_ms":382540,"uuid":"d967193f"}';

const ASSISTANT_ZEILE =
  '{"type":"assistant","message":{"content":[{"type":"text","text":"Ich lese das Issue."}]}}';

const ZEILEN = (...z) => z.join("\n");

// --- Der Regelfall ---

test("aus einem stdout mit result-Zeile kommen Kosten, API-Dauer und Zuege", () => {
  const stdout = ZEILEN(ASSISTANT_ZEILE, RESULT_ZEILE, "");
  assert.deepEqual(leseKennzahlen(stdout), {
    kostenUsd: 2.4124460000000005,
    apiDauerMs: 296247,
    zuege: 37,
    stopReason: "end_turn",
    isError: false,
    eingabeTokens: 70,
    ausgabeTokens: 17688,
    cacheErzeugtTokens: null,
    cacheGelesenTokens: null,
  });
});

// Die Schluessel sind verbindlich: Issue #488 uebernimmt sie in den Ergebnisstand.
test("[night-29] die Schluessel des Ergebnisses sind kostenUsd, apiDauerMs, zuege, stopReason, isError und die vier Token-Mengen", () => {
  assert.deepEqual(Object.keys(leseKennzahlen(RESULT_ZEILE)).sort(), [
    "apiDauerMs",
    "ausgabeTokens",
    "cacheErzeugtTokens",
    "cacheGelesenTokens",
    "eingabeTokens",
    "isError",
    "kostenUsd",
    "stopReason",
    "zuege",
  ]);
});

// --- Kein result-Ereignis ---

test("ohne result-Zeile liefert die Funktion null", () => {
  assert.equal(leseKennzahlen(ZEILEN(ASSISTANT_ZEILE, ASSISTANT_ZEILE)), null);
});

test("leerer stdout liefert null", () => {
  assert.equal(leseKennzahlen(""), null);
  assert.equal(leseKennzahlen(null), null);
  assert.equal(leseKennzahlen(undefined), null);
});

// Der Fall ohne `--verbose`: `claude -p` gibt dann reinen Text aus, kein NDJSON.
test("reiner Fliesstext ohne JSON liefert null", () => {
  const stdout = ZEILEN(
    "## Abschlussbericht Issue #487",
    "",
    "Alles gruen, keine offenen Punkte.",
  );
  assert.equal(leseKennzahlen(stdout), null);
});

// --- Unlesbare Zeilen ---

// Eine abgeschnittene Zeile entsteht real: Der Runner killt den Prozessbaum beim
// Zeitlimit, mitten im Schreiben der letzten Zeile.
test("eine abgeschnittene JSON-Zeile fuehrt nicht zum Wurf", () => {
  const stdout = ZEILEN(
    '{"type":"assistant","message":{"content":[{"type":"text","tex',
    RESULT_ZEILE,
  );
  assert.deepEqual(leseKennzahlen(stdout), {
    kostenUsd: 2.4124460000000005,
    apiDauerMs: 296247,
    zuege: 37,
    stopReason: "end_turn",
    isError: false,
    eingabeTokens: 70,
    ausgabeTokens: 17688,
    cacheErzeugtTokens: null,
    cacheGelesenTokens: null,
  });
});

test("unlesbare Zeilen allein liefern null statt eines Wurfs", () => {
  assert.equal(leseKennzahlen(ZEILEN("{kein json", "[1,2", "}}}")), null);
});

// --- Einzelne Felder ---

// Als gelesen gilt ein Feld nur als endliche Zahl. `null` fuer ein Feld ist etwas
// anderes als eine 0 — der Ergebnisstand darf beides nicht verwechseln.
test("ein fehlendes Kostenfeld liefert null, die anderen Werte bleiben", () => {
  const ohneKosten = '{"type":"result","duration_api_ms":143003,"num_turns":22}';
  assert.deepEqual(leseKennzahlen(ohneKosten), {
    kostenUsd: null,
    apiDauerMs: 143003,
    zuege: 22,
    stopReason: null,
    isError: null,
    eingabeTokens: null,
    ausgabeTokens: null,
    cacheErzeugtTokens: null,
    cacheGelesenTokens: null,
  });
});

// Trennscharf: Eine Umsetzung mit `|| null` bestuende jeden anderen Test hier.
test("num_turns mit dem Wert 0 wird als 0 gelesen, nicht als null", () => {
  const nullZuege =
    '{"type":"result","total_cost_usd":0,"duration_api_ms":0,"num_turns":0}';
  assert.deepEqual(leseKennzahlen(nullZuege), {
    kostenUsd: 0,
    apiDauerMs: 0,
    zuege: 0,
    stopReason: null,
    isError: null,
    eingabeTokens: null,
    ausgabeTokens: null,
    cacheErzeugtTokens: null,
    cacheGelesenTokens: null,
  });
});

test("nicht-endliche und falsch getypte Werte liefern fuer ihr Feld null", () => {
  const krumm =
    '{"type":"result","total_cost_usd":"2.41","duration_api_ms":null,"num_turns":{"a":1}}';
  assert.deepEqual(leseKennzahlen(krumm), {
    kostenUsd: null,
    apiDauerMs: null,
    zuege: null,
    stopReason: null,
    isError: null,
    eingabeTokens: null,
    ausgabeTokens: null,
    cacheErzeugtTokens: null,
    cacheGelesenTokens: null,
  });
});

// --- Mehrere result-Zeilen ---

// `subtype` bleibt unbeachtet: Auch eine abgebrochene Session hat gekostet, und ihr
// Ausgang steht ohnehin am Board. `is_error` wird seit Issue #668 gelesen — es
// unterscheidet den Abbruch von der Session, die regulaer endete, ohne fertig zu sein.
test("bei mehreren result-Zeilen zaehlt die letzte", () => {
  const frueher =
    '{"type":"result","subtype":"error_max_turns","is_error":true,' +
    '"total_cost_usd":0.5,"duration_api_ms":1000,"num_turns":2}';
  assert.deepEqual(leseKennzahlen(ZEILEN(frueher, RESULT_ZEILE)), {
    kostenUsd: 2.4124460000000005,
    apiDauerMs: 296247,
    zuege: 37,
    stopReason: "end_turn",
    isError: false,
    eingabeTokens: 70,
    ausgabeTokens: 17688,
    cacheErzeugtTokens: null,
    cacheGelesenTokens: null,
  });
  assert.deepEqual(leseKennzahlen(ZEILEN(RESULT_ZEILE, frueher)), {
    kostenUsd: 0.5,
    apiDauerMs: 1000,
    zuege: 2,
    stopReason: null,
    isError: true,
    eingabeTokens: null,
    ausgabeTokens: null,
    cacheErzeugtTokens: null,
    cacheGelesenTokens: null,
  });
});

test("Windows-Zeilenenden aendern nichts", () => {
  assert.deepEqual(leseKennzahlen(`${ASSISTANT_ZEILE}\r\n${RESULT_ZEILE}\r\n`), {
    kostenUsd: 2.4124460000000005,
    apiDauerMs: 296247,
    zuege: 37,
    stopReason: "end_turn",
    isError: false,
    eingabeTokens: 70,
    ausgabeTokens: 17688,
    cacheErzeugtTokens: null,
    cacheGelesenTokens: null,
  });
});

// --- stop_reason und is_error (Issue #668) ---
//
// Der Runner muss eine regulaer beendete Session (`end_turn`) von einem Abbruch
// (`is_error: true`) und vom Zeitlimit unterscheiden koennen. Die Felder stehen in
// derselben `result`-Zeile, aus der die Kennzahlen kommen — sie hier mitzulesen ist
// billiger als ein zweiter Durchlauf und haelt die Deutung an einer Stelle.

test("[night-2] stopReason und isError kommen aus derselben result-Zeile", () => {
  const k = leseKennzahlen(ZEILEN(ASSISTANT_ZEILE, RESULT_ZEILE));
  assert.equal(k.stopReason, "end_turn");
  assert.equal(k.isError, false);
});

test("[night-2] fehlen die Felder, stehen sie auf null statt zu fehlen", () => {
  const ohne = '{"type":"result","total_cost_usd":1.5,"num_turns":3}';
  const k = leseKennzahlen(ohne);
  assert.equal(k.stopReason, null, "ein fehlendes stop_reason ist null");
  assert.equal(k.isError, null, "ein fehlendes is_error ist null");
  assert.equal(k.kostenUsd, 1.5, "die bisherigen Felder bleiben unberuehrt");
});

test("[night-2] ein falsch getyptes stop_reason liefert null, kein Objekt", () => {
  const krumm = '{"type":"result","stop_reason":{"a":1},"is_error":"nein","num_turns":2}';
  const k = leseKennzahlen(krumm);
  assert.equal(k.stopReason, null, "nur ein String zaehlt als stop_reason");
  assert.equal(k.isError, null, "nur ein Boolean zaehlt als is_error");
});

test("[night-2] bei mehreren result-Zeilen zaehlt auch hier die letzte", () => {
  const erste = '{"type":"result","stop_reason":"end_turn","is_error":false}';
  const zweite = '{"type":"result","stop_reason":"max_tokens","is_error":true}';
  const k = leseKennzahlen(ZEILEN(erste, zweite));
  assert.equal(k.stopReason, "max_tokens");
  assert.equal(k.isError, true);
});

// --- Token-Mengen (Issue #669) ---

// Die Zahlen aus dem echten Lauf zu Issue #900 in kanban-kit (2026-09-16), wie sie im
// Issue stehen: Nur `usage` traegt die Mengen, und sie gehen unveraendert durch.
test("[night-29] die vier Token-Mengen kommen unveraendert aus usage", () => {
  const zeile = JSON.stringify({
    type: "result", total_cost_usd: 8.032575, duration_api_ms: 767636, num_turns: 81,
    usage: { input_tokens: 148, cache_creation_input_tokens: 202998, cache_read_input_tokens: 8883160, output_tokens: 62411 },
  });
  const k = leseKennzahlen(zeile);
  assert.equal(k.eingabeTokens, 148);
  assert.equal(k.ausgabeTokens, 62411);
  assert.equal(k.cacheErzeugtTokens, 202998);
  assert.equal(k.cacheGelesenTokens, 8883160);
  assert.equal(k.kostenUsd, 8.032575);
});

test("[night-29] ohne usage oder mit krummen Mengen stehen die Token-Felder auf null", () => {
  assert.equal(leseKennzahlen("{\"type\":\"result\",\"total_cost_usd\":1}").eingabeTokens, null);
  const krumm = leseKennzahlen(JSON.stringify({ type: "result", usage: { input_tokens: "5", output_tokens: null, cache_read_input_tokens: 0 } }));
  assert.equal(krumm.eingabeTokens, null);
  assert.equal(krumm.ausgabeTokens, null);
  assert.equal(krumm.cacheGelesenTokens, 0, "eine 0 bleibt eine 0");
});
