// Ablauf-Pruefung: Die Ablehnung von `issue epics` und `code pr` im lokalen Modus setzt allein der Dispatch in kit/board.mjs (fail mit Exit 1 und Meldung auf stderr); der Adapter hat dafuer weder Methode noch Wortlaut.
//
// Teil der Tests zum lokalen Datei-Tracker (Issue #188). Die uebrigen laufen seit
// Issue #1217 im selben Prozess gegen kit/board/adapter.mjs, siehe
// test/board-adapter-local.test.mjs. Hier bleiben die zwei Faelle, deren Meldung die
// Kommandozeile formuliert: `fail()` beendet den Prozess und laesst sich darum nicht
// im Testprozess ausloesen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

function mitProjekt(fn, config = LOKAL) {
  const dir = setupProjekt(config);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Der lokale Modus kennt keine Pull Requests: codePr bricht ab, bevor der CodeHost
// gefragt wird — mit dem Hinweis auf den lokalen Merge.
test("code pr im lokalen Modus verweist auf den git-Merge", () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["code", "pr", "--from", "feature", "--to", "main"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /keine Pull Requests.*lokalen git-Merge/);
  });
});

// --- epics nur im lokalen Modus ---

test("epics wird fuer Tracker ohne Epic-Begriff sauber abgelehnt", () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "epics"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /epics wird von diesem Tracker nicht unterstuetzt/);
    assert.match(res.stderr, /local, toolbox/);
  }, { codeHost: "local", issueTracker: "gitlab" });
});
