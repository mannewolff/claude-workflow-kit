// Ablauf-Pruefung: `issue ursprung` startet kit/board.mjs am lokalen Tracker und liest die
// Auswertung aus stdout.
//
// Das Kommando ist rein lesend (Issue #1285, Plan #1283 A11): Es nennt, ob der Plan durch ist
// und wohin Plandokument und fachliche Anforderung gehoeren, und bewegt keine Karte. Die Faelle
// der Auswertung selbst stehen in test/board-ursprung.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { setupProjekt, board } from "./helpers/board-fixture.mjs";

test("issue ursprung gibt die Auswertung als JSON aus und bewegt nichts", () => {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } }, "board-ursprung-");
  try {
    board(dir, "issue", "create", "--title", "[Fachlich] Anforderung", "--body", "## Ziel\nz");
    board(dir, "issue", "create", "--title", "[Plan] Plan", "--body", "Fachliche Quelle: Issue #0001\n\n## Ziel\nz");
    board(dir, "issue", "create", "--title", "Paket", "--body", "Plan: Issue #0002\n\n## Aufgabe\na");
    board(dir, "issue", "move", "0003", "in_review");
    const e = board(dir, "issue", "ursprung", "0002");
    assert.equal(e.plan, "2");
    assert.equal(e.durch, true);
    assert.deepEqual(e.dokumente.map((d) => [d.id, d.art, d.aktion]), [["2", "plan", "wandert"], ["1", "fachlich", "wandert"]]);
    assert.equal(board(dir, "issue", "get", "0002").status, "backlog");
    assert.equal(board(dir, "issue", "get", "0001").status, "backlog");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
