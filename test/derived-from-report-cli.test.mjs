// CLI des Herkunfts-Berichts (Issue #365).
//
// Getrennt von den Funktionstests, wie das Repo es bei `migrate-issues` haelt: Hier
// laeuft das Script als Kindprozess mit gefuettertem stdin, dort werden reine
// Funktionen gerufen. Die Trennung ist nicht Kosmetik — ein Fehler im CLI-Rahmen
// (Exit-Code, stdout/stderr, Stacktrace) faellt in einem Funktionstest nie auf.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { bestandsPruefung } from "../tools/derived-from-report.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(repoRoot, "tools", "derived-from-report.mjs");

/** Startet das Script mit `eingabe` auf stdin. */
function lauf(eingabe, ...argv) {
  return spawnSync(process.execPath, [SCRIPT, ...argv], {
    input: eingabe, encoding: "utf-8", cwd: repoRoot,
  });
}

const KARTEN = JSON.stringify([
  { id: "9", title: "Kind", body: "## Kontext\n\nPlan: Issue #3\n\n## Aufgabe\n" },
  { id: "3", title: "[Plan] Eltern", body: "Plan-Modell: m\n\n## Ziel\n" },
  { id: "5", title: "Waise", body: "## Kontext\n\nPlan: Issue #999\n\n## Aufgabe\n" },
]);

test("gueltiges JSON-Array: Exit 0 und die Zusammenfassung nennt die Zaehler", () => {
  const r = lauf(KARTEN);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Karten: 3/);
  assert.match(r.stdout, /vorfahr\s+1/);
  assert.match(r.stdout, /unbekannt\s+1/);
  // Die auffaellige Karte wird namentlich gemeldet, mit dem gelesenen Ziel.
  assert.match(r.stdout, /#5\s+unbekannt \(gelesen: #999\)/);
});

test("--json liefert parsebares JSON mit einem Eintrag je Karte", () => {
  const r = lauf(KARTEN, "--json");
  assert.equal(r.status, 0, r.stderr);
  const bericht = JSON.parse(r.stdout);
  assert.equal(bericht.length, 3);
  assert.deepEqual(bericht.map((e) => e.zustand), ["vorfahr", "keiner", "unbekannt"]);
});

test("kaputtes JSON: Exit 1, Meldung auf stderr, nirgends ein Stacktrace", () => {
  const r = lauf("{kein json");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /kein gueltiges JSON/);
  // Eine sprechende Meldung PLUS Stacktrace bestuende eine Pruefung nur auf stdout —
  // deshalb beide Stroeme.
  assert.doesNotMatch(r.stdout, /\n\s+at /, "kein Stacktrace auf stdout");
  assert.doesNotMatch(r.stderr, /\n\s+at /, "kein Stacktrace auf stderr");
});

test("JSON-Objekt statt Array: Exit 1 mit sprechender Meldung", () => {
  const r = lauf('{"id":"1"}');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Array/);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

test("leeres Array ist kein Fehler", () => {
  const r = lauf("[]");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Karten: 0/);
});

test("--help nennt den Pipe-Aufruf und braucht kein stdin", () => {
  const r = lauf("", "--help");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /board\.mjs issue list \| node tools\/derived-from-report\.mjs/);
  assert.match(r.stdout, /SCHREIBT NICHTS/);
});

// Das Werkzeug ist ein Trockenlauf. Legte es eine Datei an, waere der Working Tree
// unsauber — und darauf stoppt der Nacht-Runner hart.
test("ein Lauf legt keine Datei an", () => {
  const vorher = zustandVon(repoRoot);
  lauf(KARTEN);
  lauf(KARTEN, "--json");
  assert.deepEqual(zustandVon(repoRoot), vorher);
});

/** Namen und Groessen im Repo-Wurzelverzeichnis plus tools/ und test/fixtures/. */
function zustandVon(wurzel) {
  const auflisten = (ordner) => readdirSync(ordner)
    .filter((n) => !n.startsWith("."))
    .map((n) => {
      const s = statSync(join(ordner, n));
      return `${n}:${s.isDirectory() ? "d" : s.size}`;
    })
    .sort();
  return {
    wurzel: auflisten(wurzel),
    tools: auflisten(join(wurzel, "tools")),
    fixtures: auflisten(join(wurzel, "test", "fixtures")),
  };
}

// --- Regressionsanker gegen den eingefrorenen Bestand ---
//
// Der Schnappschuss ist bewusst eingefroren: Er darf sich nicht mit dem Board
// aendern, sonst prueft der Test nichts.
//
// Die Zahlen sind gegen die UNABHAENGIGE Messung vom 2026-08-27 abgeglichen, nicht
// nur aus dem eigenen Lauf notiert — sonst friere ein falscher Leser seine falschen
// Zahlen gleich mit ein. Die Messung ergab 44 Karten mit Verweis; der Schnappschuss
// entstand danach und enthaelt zusaetzlich die drei Karten #364, #365 und #366, die
// in derselben Sitzung mit `Plan: Issue #363` angelegt wurden. 44 + 3 = 47.
test("Regressionsanker: der eingefrorene Bestand ergibt die notierten Zahlen", () => {
  const karten = JSON.parse(readFileSync(join(repoRoot, "test", "fixtures", "board-snapshot-2026-08-27.json"), "utf-8"));
  const bericht = bestandsPruefung(karten);
  const zaehler = {};
  for (const e of bericht) zaehler[e.zustand] = (zaehler[e.zustand] || 0) + 1;

  assert.equal(karten.length, 77, "Schnappschuss-Groesse");
  assert.equal(bericht.filter((e) => e.zustand !== "keiner").length, 47,
    "Karten mit Verweis: 44 aus der Messung vom 2026-08-27 plus #364, #365, #366");
  assert.equal(zaehler.fehlplatziert ?? 0, 0, "die Messung ergab null fehlplatzierte Verweise");
  assert.equal(zaehler.mehrdeutig ?? 0, 0, "die Messung ergab null mehrdeutige Verweise");
  assert.equal(zaehler.selbstverweis ?? 0, 0);

  // #300 ist der einzige Verweis im Kopfbereich eines [Plan]-Dokuments. Er MUSS
  // gelesen werden — ein Leser, der nur den Kontext-Abschnitt kennt, meldete ihn als
  // `fehlplatziert` oder `keiner`.
  const p300 = bericht.find((e) => String(e.id) === "300");
  assert.equal(p300.zustand, "unbekannt", "#300 zeigt auf #285");
  assert.equal(p300.gelesen, 285, "der Kopfzeilen-Verweis von #300 wird gelesen");
});

// Der eigentliche Ertrag des Trockenlaufs: 14 Karten zeigen auf zwei Vorfahren, die
// es am Board nicht mehr gibt (`issue get 285` -> "nicht gefunden"). Eine Migration
// waere daran gescheitert, weil der Server unbekannte Nummern ablehnt.
test("Regressionsanker: die verwaisten Verweise sind benannt", () => {
  const karten = JSON.parse(readFileSync(join(repoRoot, "test", "fixtures", "board-snapshot-2026-08-27.json"), "utf-8"));
  const unbekannt = bestandsPruefung(karten).filter((e) => e.zustand === "unbekannt");
  assert.equal(unbekannt.length, 14);
  assert.deepEqual([...new Set(unbekannt.map((e) => e.gelesen))].sort((a, b) => a - b), [246, 285]);
});
