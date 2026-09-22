// Die Achse `code ci-status` bei GitLab, im lokalen Modus und ihre CLI-Form (Issue #316).
//
// Zweite von zwei Dateien zur Achse (Issue #836): Der GitHub-Zweig liegt in
// `board-ci-status.test.mjs`, die gemeinsamen Fixtures in `helpers/board-ci-fixture.mjs`.
//
// glab laeuft als Fake-Binary im PATH (Muster aus test/board-github.test.mjs): kein Netz,
// keine Authentifizierung, und die abgesetzte Kommandozeile ist Teil der Pruefung.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";
import { NUR_POSIX, SHA, ciStatus, ciStatusOk } from "./helpers/board-ci-fixture.mjs";

// --- GitLab ---

const GITLAB = { codeHost: "gitlab", issueTracker: "gitlab" };

function glabRegeln(jobs, { pipelines = [{ id: 42, status: "running" }] } = {}) {
  return [
    { match: "^ci list", stdout: pipelines },
    { match: "^ci get", stdout: { id: 42, jobs } },
  ];
}

test("[board-7] gitlab: alle Jobs gruen ergeben gruen", NUR_POSIX, () => {
  const { daten, zeilen } = ciStatusOk(GITLAB, "glab", glabRegeln([
    { name: "test", status: "success" },
    { name: "lint", status: "skipped" },
  ]));
  assert.deepEqual(daten, {
    status: "gruen",
    jobs: [{ name: "test", ergebnis: "gruen" }, { name: "lint", ergebnis: "gruen" }],
  });
  // `glab ci status` filtert nach Branch, nicht nach SHA — deshalb list/get mit --sha.
  assert.match(zeilen[0], new RegExp(`ci list .*--sha ${SHA}`));
  assert.match(zeilen[1], /ci get .*--pipeline-id 42/);
  assert.match(zeilen[1], /--with-job-details/);
});

test("[board-7] gitlab: ein roter Job ergibt rot und wird benannt", NUR_POSIX, () => {
  const { daten } = ciStatusOk(GITLAB, "glab", glabRegeln([
    { name: "test", status: "success" },
    { name: "lint", status: "failed" },
  ]));
  assert.equal(daten.status, "rot");
  assert.deepEqual(daten.jobs.find((j) => j.ergebnis === "rot"), { name: "lint", ergebnis: "rot" });
});

test("[board-7] gitlab: ein laufender Job ergibt laeuft", NUR_POSIX, () => {
  const { daten } = ciStatusOk(GITLAB, "glab", glabRegeln([
    { name: "test", status: "running" },
  ]));
  assert.equal(daten.status, "laeuft");
});

test("[board-7] gitlab: canceled zaehlt als rot", NUR_POSIX, () => {
  const { daten } = ciStatusOk(GITLAB, "glab", glabRegeln([{ name: "test", status: "canceled" }]));
  assert.equal(daten.status, "rot");
});

test("[board-7] gitlab: rot schlaegt laeuft", NUR_POSIX, () => {
  const { daten } = ciStatusOk(GITLAB, "glab", glabRegeln([
    { name: "test", status: "running" },
    { name: "lint", status: "failed" },
  ]));
  assert.equal(daten.status, "rot");
});

test("[board-7] gitlab: keine Pipeline zum SHA ergibt laeuft, nicht keine", NUR_POSIX, () => {
  const { daten } = ciStatusOk(GITLAB, "glab", [{ match: "^ci list", stdout: [] }]);
  assert.deepEqual(daten, { status: "laeuft", jobs: [] });
});

test("[board-7] gitlab: ein CLI mit Exit 1 endet mit Exit 1", NUR_POSIX, () => {
  const { res } = ciStatus(GITLAB, "glab", [
    { match: "^ci list", exit: 1, stderr: "glab: 401 Unauthorized\n" },
  ]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Fehler:/);
});

// --- local ---

// Ein Projekt ohne CI darf nicht releaseunfaehig werden: `keine` ist kein Fehler.
test("[board-7] local liefert keine mit leerer Jobliste und Exit 0", () => {
  const { res } = ciStatus({ codeHost: "local", issueTracker: "local" }, null, []);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), { status: "keine", jobs: [] });
});

// --- CLI-Form ---

test("[board-7] ci-status ohne --commit endet mit Exit 1", () => {
  const { res } = ciStatus({ codeHost: "local", issueTracker: "local" }, null, [], { commitArg: null });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /--commit/);
});

test("[board-7] ci-status mit wertlosem --commit endet mit Exit 1", () => {
  const { res } = ciStatus({ codeHost: "local", issueTracker: "local" }, null, [], { commitArg: true });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /--commit/);
});

test("[board-7] der HELP-Text nennt code ci-status --commit", () => {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "local" }, "board-ci-");
  try {
    const res = runBoard(dir, ["--help"]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /code ci-status --commit <sha>/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
