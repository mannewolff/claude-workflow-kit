// Ablauf-Pruefung: `issue-review reviewers` beruehrt keinen Adapter; Autor null statt undefined entsteht in issueReviewReviewers im Einstieg kit/board.mjs und zeigt sich nur in dessen JSON-Ausgabe auf stdout.
//
// Teil der Luecken-Tests zum lokalen Tracker und zur CLI-Achse (Issue #405). Die
// Tracker-Faelle laufen seit Issue #1217 im selben Prozess gegen kit/board/adapter.mjs,
// siehe test/board-adapter-local-luecken.test.mjs. Hier bleibt die Stelle der CLI, an
// der ein Argument fehlen darf.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

function mitProjekt(fn, config, praefix) {
  const dir = setupProjekt(config, praefix);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("issue-review reviewers ohne --author meldet autor null statt undefined", () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue-review", "reviewers"]);

    assert.equal(res.status, 0, `reviewers haette durchlaufen muessen: ${res.stderr}`);
    const daten = JSON.parse(res.stdout);
    assert.equal(daten.autor, null, "ohne --author muss der Autor null sein, nicht undefined");
    assert.ok(!res.stdout.includes("undefined"), "'undefined' steht in der JSON-Ausgabe");
  }, { ...LOKAL, issueReview: { rounds: 1, reviewers: [{ name: "fable", kind: "claude", model: "claude-fable-5" }] } },
  "board-local-roles-");
});
