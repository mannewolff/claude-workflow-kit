// `issue update` ohne die Pruefvorgabe-Leitplanke, und eine Bestandsconfig mit den
// entfallenen Feldern (Plan #638, A15; Issue #641).
//
// Bis Stufe 2 hielt `issue update` den neuen Body gegen den alten: Eine Verringerung der
// `Pruefung:`-Zeile durfte nur ein Mensch schreiben, und der Adapter setzte den
// Bezugsstand. Beides ist mit der Pruefvorgabe entfallen — der Body wird geschrieben, wie
// er kommt, und eine `Pruefung:`-Zeile ist gewoehnlicher Text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { setupProjekt, runBoard, board } from "./helpers/board-fixture.mjs";

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

function mitProjekt(fn, config = LOKAL) {
  const dir = setupProjekt(config, "board-update-ohne-vorgabe-");
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("[board-6] issue update schreibt einen Body mit Pruefung: Verzicht unveraendert durch — auch unbeaufsichtigt", () => {
  mitProjekt((dir) => {
    const alt = "## Kontext\n\nAutor-Modell: opus\nPruefung: 3\n\n## Abhaengigkeiten\n\nKeine.\n";
    const issue = board(dir, "issue", "create", "--title", "Ein Paket", "--body", alt);
    const neu = "## Kontext\n\nAutor-Modell: opus\nPruefung: Verzicht\n\n## Abhaengigkeiten\n\nKeine.\n";
    // KIT_AGENT_MODEL gesetzt: Bis Stufe 2 wies die Leitplanke genau diesen Fall ab.
    const res = runBoard(dir, ["issue", "update", String(issue.id), "--body", neu], { KIT_AGENT_MODEL: "nacht" });
    assert.equal(res.status, 0, `update haette durchlaufen muessen: ${res.stderr}`);
    const danach = board(dir, "issue", "get", String(issue.id));
    assert.equal(danach.body, neu, "der Body muss unveraendert ankommen");
    assert.doesNotMatch(danach.body, /Pruefung-Stand:/, "es wird kein Bezugsstand mehr gesetzt");
  });
});

test("[board-6] eine Bestandsconfig mit rounds und statusLabels laedt ohne Fehler und ohne Hinweis", () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue-review", "reviewers", "--author", "opus"]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stderr.trim(), "", "die entfallenen Felder duerfen keinen Laerm machen");
    const out = JSON.parse(res.stdout);
    assert.equal("rounds" in out, false);
  }, {
    ...LOKAL,
    issueReview: {
      rounds: 3,
      statusLabels: true,
      reviewers: [{ name: "opus", kind: "claude", model: "claude-opus-5" }, { name: "sonnet", kind: "claude", model: "claude-sonnet-5" }],
    },
  });
});
