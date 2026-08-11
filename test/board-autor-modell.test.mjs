// Tests fuer die Autor-Modell-Leitplanke in `issue create` (Issue #266).
//
// Die Zeile `Autor-Modell:` im Kontext-Abschnitt war bis dahin reine
// Skill-Konvention: `/issues` schrieb sie vor, aber nichts erzwang sie. Wer den
// Adapter direkt aufrief, legte ein Issue ohne Autorschaft an — und der Tracker
// kann sie nicht ersetzen, weil dort immer der Token-Inhaber als author steht.
// Belegt am 2026-08-08: #247 kostete einen Nacht-Slot, weil die Zeile fehlte und
// /issue-review deshalb nachfragte.

import { test } from "node:test";
import assert from "node:assert/strict";

import { setupProjekt, runBoard, board } from "./helpers/board-fixture.mjs";

const CONFIG = {
  issueTracker: "local",
  codeHost: "local",
  local: { issuesDir: "issues" },
};

const projekt = () => setupProjekt(CONFIG, "autor-modell-");

// Der Fixture-Helper setzt KIT_AGENT_MODEL auf einen festen Wert, damit die
// Leitplanke die bestehenden Tests nicht reihenweise kippt. Fuer die Faelle, in
// denen gerade das Fehlen geprueft wird, muss die Variable ausdruecklich leer sein.
const OHNE_ENV = { KIT_AGENT_MODEL: "" };

test("issue create ohne Autor-Modell-Zeile wird abgelehnt und legt nichts an", () => {
  const dir = projekt();
  const res = runBoard(dir, ["issue", "create", "--title", "Ohne Autor", "--body", "## Kontext\nkeine Zeile hier."], OHNE_ENV);
  assert.notEqual(res.status, 0, "der Aufruf haette fehlschlagen muessen");
  assert.match(res.stderr, /Autor-Modell:/, "die Meldung muss die erwartete Zeilenform nennen");
  assert.deepEqual(board(dir, "issue", "list"), [], "trotz Fehler wurde ein Issue angelegt");
});

test("issue create mit gueltiger Autor-Modell-Zeile legt an", () => {
  const dir = projekt();
  const angelegt = board(dir, "issue", "create", "--title", "Mit Autor",
    "--body", "## Kontext\nAutor-Modell: claude-opus-5\n");
  const geholt = board(dir, "issue", "get", String(angelegt.id));
  assert.match(geholt.body, /^Autor-Modell: claude-opus-5$/m);
});

test("leerer Wert zaehlt als fehlende Zeile", () => {
  const dir = projekt();
  for (const zeile of ["Autor-Modell:", "Autor-Modell: ", "Autor-Modell:    "]) {
    const res = runBoard(dir, ["issue", "create", "--title", "Leer", "--body", `## Kontext\n${zeile}\n`], OHNE_ENV);
    assert.notEqual(res.status, 0, `'${zeile}' haette abgelehnt werden muessen`);
  }
});

test("--author-model setzt die Zeile in den Kontext-Abschnitt, genau einmal", () => {
  const dir = projekt();
  const angelegt = board(dir, "issue", "create", "--title", "Per Flag",
    "--body", "## Kontext\nWarum.\n\n## Aufgabe\nWas.\n", "--author-model", "claude-opus-5");
  const body = board(dir, "issue", "get", String(angelegt.id)).body;
  const treffer = body.match(/^Autor-Modell: .*$/gm) || [];
  assert.equal(treffer.length, 1, `genau eine Zeile erwartet, gefunden: ${treffer.length}`);
  assert.equal(treffer[0], "Autor-Modell: claude-opus-5");
  // Sie gehoert in den Kontext-Abschnitt, nicht ans Dateiende hinter die Aufgabe.
  assert.ok(body.indexOf("Autor-Modell:") < body.indexOf("## Aufgabe"),
    "die Zeile steht nicht im Kontext-Abschnitt");
});

test("--author-model neben abweichender vorhandener Zeile ist ein Fehler", () => {
  const dir = projekt();
  const res = runBoard(dir, ["issue", "create", "--title", "Konflikt",
    "--body", "## Kontext\nAutor-Modell: claude-sonnet-5\n", "--author-model", "claude-opus-5"]);
  assert.notEqual(res.status, 0, "der Widerspruch haette auffallen muessen");
  assert.deepEqual(board(dir, "issue", "list"), []);
});

test("--author-model mit identischem Wert ist kein Fehler", () => {
  const dir = projekt();
  const angelegt = board(dir, "issue", "create", "--title", "Gleich",
    "--body", "## Kontext\nAutor-Modell: claude-opus-5\n", "--author-model", "claude-opus-5");
  const treffer = board(dir, "issue", "get", String(angelegt.id)).body.match(/^Autor-Modell: .*$/gm) || [];
  assert.equal(treffer.length, 1);
});

test("ohne Zeile und ohne Flag springt KIT_AGENT_MODEL ein", () => {
  const dir = projekt();
  const res = runBoard(dir, ["issue", "create", "--title", "Aus der Umgebung", "--body", "## Kontext\nWarum.\n"],
    { KIT_AGENT_MODEL: "claude-fable-5" });
  assert.equal(res.status, 0, res.stderr);
  const geholt = board(dir, "issue", "get", String(JSON.parse(res.stdout).id));
  assert.match(geholt.body, /^Autor-Modell: claude-fable-5$/m);
});

test("ein Body ohne Kontext-Abschnitt bekommt die Zeile trotzdem", () => {
  // Nicht jedes Issue folgt dem Vier-Abschnitt-Format (Ideen, Fremd-Tracker).
  // Die Leitplanke darf daran nicht scheitern.
  const dir = projekt();
  const angelegt = board(dir, "issue", "create", "--title", "Formlos",
    "--body", "Nur ein Satz.", "--author-model", "claude-opus-5");
  assert.match(board(dir, "issue", "get", String(angelegt.id)).body, /^Autor-Modell: claude-opus-5$/m);
});

test("leerer Body wird abgelehnt, wenn nichts die Zeile liefert", () => {
  const dir = projekt();
  const res = runBoard(dir, ["issue", "create", "--title", "Ganz leer"], OHNE_ENV);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /Autor-Modell:/);
});
