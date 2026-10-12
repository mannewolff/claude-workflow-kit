// Ablauf-Pruefung: `issue create` und `issue check-form` fuehrt der Einstieg, und der Befund
// ist Ausgabe und Exitcode des Prozesses. Die Regel selbst prueft
// test/board-dokumente-art.test.mjs ohne Prozess.
//
// `issue create --art` und `issue check-form --art` (Issue #1427, Plan #1420 E6): Das Kit
// stellt das Titel-Praefix voran (seit Issue #1552 englisch, in jedem Projekt), statt dass die Skills es in den
// Titel schreiben. Faellt das Praefix aus dem Titel, waehlt `check-form` die Pruefstufe
// ueber dieselbe Option — sonst pruefte es einen Fachplan mit den Paket-Gates. Ein Titel
// mit Praefix bleibt gueltig und wird nie umgeschrieben; `--art` daneben ist ein Fehler.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard, board } from "./helpers/board-fixture.mjs";

const CONFIG = { issueTracker: "local", codeHost: "local", local: { issuesDir: "issues" } };
const projekt = (language) => setupProjekt(language ? { ...CONFIG, language } : CONFIG, "board-art-");

const BODY = "## Kontext\nAutor-Modell: fixture-modell\n";

const FACHLICH = `## Ziel
Der Nutzer sieht etwas.

Autor-Modell: fixture-modell

## Fachliche Akzeptanzkriterien
- Der Nutzer sieht es.

## Nicht-Ziele
- Nichts weiter.

## Offene Fragen an den PO
- Keine.
`;

const PLAN = `Plan-Modell: fixture-modell
Fachliche Quelle: Issue #12

## Ziel
Etwas bauen.

## Betroffene Bereiche
- kit/board.mjs

## Architektonische Entscheidungen
- Keine. Die Richtung steht im Fachplan.

## Geplante Änderungen
- kit/board.mjs: neues Kommando

## Offene Fragen
- Keine.

## Verifizierung
- node --test
`;

function anlegen(dir, args) {
  return runBoard(dir, ["issue", "create", "--body", BODY, ...args]);
}

function titelVon(dir, res) {
  assert.equal(res.status, 0, res.stderr);
  return board(dir, "issue", "get", String(JSON.parse(res.stdout).id)).title;
}

function checkForm(dir, body, title, extra = []) {
  const datei = join(dir, "eingabe.md");
  writeFileSync(datei, body);
  const res = runBoard(dir, ["issue", "check-form", "--body-file", datei, "--title", title, ...extra]);
  return { res, ergebnis: JSON.parse(res.stdout) };
}

test("[board-1552] issue create --art stellt das englische Praefix voran, auch in einem deutschen Projekt", () => {
  for (const language of [undefined, "de", "en"]) {
    const dir = projekt(language);
    assert.equal(titelVon(dir, anlegen(dir, ["--title", "Etwas", "--art", "fachlich"])), "[Requirement] Etwas", language);
    assert.equal(titelVon(dir, anlegen(dir, ["--title", "Etwas", "--art", "idee"])), "[Idea] Etwas", language);
    assert.equal(titelVon(dir, anlegen(dir, ["--title", "Step", "--art", "mensch"])), "[Human] Step", language);
    assert.equal(titelVon(dir, anlegen(dir, ["--title", "Do it", "--art", "task"])), "[Task] Do it", language);
  }
});

test("[board-1427] issue create ohne --art laesst den Titel unveraendert", () => {
  const dir = projekt("en");
  assert.equal(titelVon(dir, anlegen(dir, ["--title", "[Fachlich] Bleibt"])), "[Fachlich] Bleibt");
  assert.equal(titelVon(dir, anlegen(dir, ["--title", "Ohne Praefix"])), "Ohne Praefix");
});

test("[board-1427] issue create --art neben einem Titel mit Praefix ist ein Fehler und legt nichts an", () => {
  const dir = projekt();
  for (const titel of ["[Fachlich] Doppelt", "[Requirement] Doppelt", " [plan] Doppelt"]) {
    const res = anlegen(dir, ["--title", titel, "--art", "fachlich"]);
    assert.notEqual(res.status, 0, titel);
    assert.match(res.stderr, /--art/);
  }
  assert.deepEqual(board(dir, "issue", "list"), []);
});

test("[board-1427] issue create --art mit unbekannter Art oder ohne Wert ist ein Fehler", () => {
  const dir = projekt();
  const unbekannt = anlegen(dir, ["--title", "X", "--art", "epos"]);
  assert.notEqual(unbekannt.status, 0);
  assert.match(unbekannt.stderr, /fachlich\|idee\|mensch\|plan\|task/);
  const leer = runBoard(dir, ["issue", "create", "--body", BODY, "--title", "X", "--art"]);
  assert.notEqual(leer.status, 0);
  assert.deepEqual(board(dir, "issue", "list"), []);
});

test("[board-1427] issue check-form --art plan prueft mit den Plan-Gates", () => {
  const dir = projekt();
  const { res, ergebnis } = checkForm(dir, PLAN, "Etwas bauen", ["--art", "plan"]);
  assert.equal(ergebnis.stufe, "plan");
  assert.equal(res.status, 0, res.stdout);
});

test("[board-1427] issue check-form --art fachlich prueft mit den Fachplan-Gates, auch englisch", () => {
  for (const language of ["de", "en"]) {
    const dir = projekt(language);
    const { res, ergebnis } = checkForm(dir, FACHLICH, "Der Nutzer sieht etwas", ["--art", "fachlich"]);
    assert.equal(ergebnis.stufe, "fachlich", language);
    assert.equal(res.status, 0, res.stdout);
  }
});

test("[board-1427] issue check-form ohne --art leitet die Stufe wie bisher aus dem Titel ab", () => {
  const dir = projekt();
  assert.equal(checkForm(dir, FACHLICH, "[Fachlich] Etwas").ergebnis.stufe, "fachlich");
  assert.equal(checkForm(dir, PLAN, "[Plan] Etwas").ergebnis.stufe, "plan");
  const ohne = checkForm(dir, FACHLICH, "Etwas");
  assert.equal(ohne.ergebnis.stufe, "issue");
  assert.equal(ohne.res.status, 1);
});

test("[board-1427] issue check-form --art neben einem Titel mit Praefix weist den Aufruf ab", () => {
  const dir = projekt();
  const { res, ergebnis } = checkForm(dir, FACHLICH, "[Fachlich] Etwas", ["--art", "fachlich"]);
  assert.equal(res.status, 1);
  assert.equal(ergebnis.ok, false);
  assert.match(ergebnis.fehler, /--art/);
});
