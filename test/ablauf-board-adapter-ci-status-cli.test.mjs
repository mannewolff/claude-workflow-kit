// Ablauf-Pruefung: Pflichtwert --commit und Hilfetext prueft nur der Dispatch im Einstieg kit/board.mjs (codeCiStatus bricht ueber fail() mit process.exit ab und ist nicht exportiert); im selben Prozess gibt es dafuer keine Funktion eines Teils.
//
// Die CLI-Form der Achse `code ci-status` (Issue #316). Bis Issue #1217 stand sie in
// `board-ci-status-gitlab.test.mjs`; das Urteil der Hosts pruefen seither
// `board-adapter-ci-status-github.test.mjs` und `board-adapter-ci-status-gitlab.test.mjs`
// im selben Prozess gegen kit/board/adapter.mjs. Hier bleibt, was nur der gestartete
// Einstieg zeigt: Exit-Code, Meldung und Hilfe.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";

const LOCAL = { codeHost: "local", issueTracker: "local" };

/** Startet `code ci-status` mit den uebergebenen Zusatzargumenten im lokalen Modus. */
function ciStatusCli(zusatz) {
  const dir = setupProjekt(LOCAL, "board-ci-");
  try {
    return runBoard(dir, ["code", "ci-status", ...zusatz]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("[board-7] ci-status ohne --commit endet mit Exit 1", () => {
  const res = ciStatusCli([]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /--commit/);
});

test("[board-7] ci-status mit wertlosem --commit endet mit Exit 1", () => {
  const res = ciStatusCli(["--commit"]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /--commit/);
});

test("[board-7] der HELP-Text nennt code ci-status --commit", () => {
  const dir = setupProjekt(LOCAL, "board-ci-");
  try {
    const res = runBoard(dir, ["--help"]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /code ci-status --commit <sha>/);
    assert.match(res.stdout, /gestartet/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
