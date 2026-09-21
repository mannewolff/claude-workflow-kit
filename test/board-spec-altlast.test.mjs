// Der spec-Block als nicht mehr ausgewertete Altlast in board.mjs (Issue #828).
//
// Seit dem Rueckbau von Spec-Driven Development (Idee #813, Plan #825) liest kein
// Werkzeug den `spec`-Block mehr. Die Leitplanke, die bei gesetztem Block jedes
// `issue create` und `issue update` ohne Abschnitt `## Spec-Wirkung` abwies
// (Issue #443, #526), ist entfernt — ein Zielprojekt, das den Block noch traegt,
// legt seine Arbeitspakete an wie eines ohne ihn (Plan #825, A4).
//
// Gemessen wird an der Wirkung, mit derselben Fixture-Bauart wie die geloeschten
// Tests in test/board-spec-wirkung.test.mjs: echtes kit/board.mjs, cwd im
// Wegwerf-Verzeichnis, Config mit gesetztem spec-Block.

import { test } from "node:test";
import assert from "node:assert/strict";

import { setupProjekt, board } from "./helpers/board-fixture.mjs";

const BASIS = {
  issueTracker: "local",
  codeHost: "local",
  local: { issuesDir: "issues" },
};

// Der Block, wie ihn ein Zielprojekt aus der Zeit vor dem Rueckbau traegt. Sein
// Vorhandensein war der Schalter der Leitplanke — genau deshalb steht er hier.
const SPEC = { seit: "2026-09-02", bereiche: { board: ["kit/board.mjs"] } };

const mitSpec = () => setupProjekt({ ...BASIS, spec: SPEC }, "spec-altlast-");

// Kopf mit Autor-Modell-Zeile: Die Leitplanke aus Issue #266 gilt weiter und
// wuerde sonst zuerst abbrechen — die Probe misst dann den falschen Grund.
const KOPF = "## Kontext\nAutor-Modell: claude-opus-5\n\n## Aufgabe\nWas.\n";

test("issue create legt ein Paket ohne ## Spec-Wirkung auch bei gesetztem spec-Block an", () => {
  const dir = mitSpec();
  const angelegt = board(dir, "issue", "create", "--title", "Ohne Wirkung", "--body", KOPF);
  const geholt = board(dir, "issue", "get", String(angelegt.id));
  // Byte-Vergleich statt "kein Fehler": Ein Adapter, der den Abschnitt still
  // ergaenzt oder den Body sonstwie anfasst, faellt nur so auf.
  assert.equal(geholt.body, KOPF, "der Body muss unveraendert ankommen");
});

test("issue update schreibt einen Body ohne ## Spec-Wirkung auch bei gesetztem spec-Block", () => {
  const dir = mitSpec();
  const angelegt = board(dir, "issue", "create", "--title", "Traeger", "--body", KOPF);
  const neu = `${KOPF}\nMehr Text nach dem Update.\n`;
  board(dir, "issue", "update", String(angelegt.id), "--body", neu);
  assert.equal(board(dir, "issue", "get", String(angelegt.id)).body, neu);
});
