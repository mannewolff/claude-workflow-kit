// Die Achse `code ci-status` bei GitLab und im lokalen Modus (Issue #316).
//
// Zweite von zwei Dateien zur Achse (Issue #836): Der GitHub-Zweig liegt in
// `board-adapter-ci-status-github.test.mjs`, die CLI-Form in
// `ablauf-board-adapter-ci-status-cli.test.mjs`, die gemeinsamen Fixtures in
// `helpers/board-ci-fixture.mjs`.
//
// Seit Issue #1217 laufen die Tests im selben Prozess gegen `getCiStatus` des CodeHosts
// aus kit/board/adapter.mjs — der Aufruf, den `code ci-status --commit <sha>` im
// Einstieg absetzt.
//
// glab laeuft als Fake-Binary im PATH (Muster aus test/board-adapter-github-lesen.test.mjs):
// kein Netz, keine Authentifizierung, und die abgesetzte Kommandozeile ist Teil der Pruefung.

import { test } from "node:test";
import assert from "node:assert/strict";

import { BoardError } from "../kit/board/grundlagen.mjs";
import {
  SHA, ciStatus, STARTZEIT, GLAB_JOBS_START,
} from "./helpers/board-ci-fixture.mjs";

// --- GitLab ---

const GITLAB = { codeHost: "gitlab", issueTracker: "gitlab" };

function glabRegeln(jobs, { pipelines = [{ id: 42, status: "running" }] } = {}) {
  return [
    { match: "^ci list", stdout: pipelines },
    { match: "^ci get", stdout: { id: 42, jobs } },
  ];
}

test("[board-7] gitlab: alle Jobs gruen ergeben gruen", async () => {
  const { daten, zeilen } = await ciStatus(GITLAB, "glab", glabRegeln([
    { name: "test", status: "success" },
    { name: "lint", status: "skipped" },
  ]));
  assert.deepEqual(daten, {
    status: "gruen",
    jobs: [
      { name: "test", ergebnis: "gruen", gestartet: null },
      { name: "lint", ergebnis: "gruen", gestartet: null },
    ],
  });
  // `glab ci status` filtert nach Branch, nicht nach SHA — deshalb list/get mit --sha.
  assert.match(zeilen[0], new RegExp(`ci list .*--sha ${SHA}`));
  assert.match(zeilen[1], /ci get .*--pipeline-id 42/);
  assert.match(zeilen[1], /--with-job-details/);
});

test("[board-7] gitlab: ein roter Job ergibt rot und wird benannt", async () => {
  const { daten } = await ciStatus(GITLAB, "glab", glabRegeln([
    { name: "test", status: "success" },
    { name: "lint", status: "failed" },
  ]));
  assert.equal(daten.status, "rot");
  assert.deepEqual(daten.jobs.find((j) => j.ergebnis === "rot"), { name: "lint", ergebnis: "rot", gestartet: null });
});

test("[board-7] gitlab: ein laufender Job ergibt laeuft", async () => {
  const { daten } = await ciStatus(GITLAB, "glab", glabRegeln([
    { name: "test", status: "running" },
  ]));
  assert.equal(daten.status, "laeuft");
});

test("[board-7] gitlab: canceled zaehlt als rot", async () => {
  const { daten } = await ciStatus(GITLAB, "glab", glabRegeln([{ name: "test", status: "canceled" }]));
  assert.equal(daten.status, "rot");
});

test("[board-7] gitlab: rot schlaegt laeuft", async () => {
  const { daten } = await ciStatus(GITLAB, "glab", glabRegeln([
    { name: "test", status: "running" },
    { name: "lint", status: "failed" },
  ]));
  assert.equal(daten.status, "rot");
});

test("[board-7] gitlab: keine Pipeline zum SHA ergibt laeuft, nicht keine", async () => {
  const { daten } = await ciStatus(GITLAB, "glab", [{ match: "^ci list", stdout: [] }]);
  assert.deepEqual(daten, { status: "laeuft", jobs: [] });
});

// Im Einstieg wird der BoardError zu "Fehler: ..." und Exit 1.
test("[board-7] gitlab: ein CLI mit Exit 1 endet mit Exit 1", async () => {
  await assert.rejects(
    ciStatus(GITLAB, "glab", [{ match: "^ci list", exit: 1, stderr: "glab: 401 Unauthorized\n" }]),
    (e) => e instanceof BoardError && /glab ci list .*401 Unauthorized/.test(e.message),
  );
});

// Startzeit je Job (Issue #1151), GitLab liest `started_at`.
test("[board-7] gitlab: ein gestarteter Job nennt seine Startzeit", async () => {
  const { daten } = await ciStatus(GITLAB, "glab", glabRegeln(GLAB_JOBS_START));
  assert.equal(daten.jobs[0].gestartet, STARTZEIT);
  assert.equal(daten.status, "laeuft");
});

test("[board-7] gitlab: ein nicht gestarteter Job traegt gestartet null", async () => {
  const { daten } = await ciStatus(GITLAB, "glab", glabRegeln(GLAB_JOBS_START));
  assert.equal(daten.jobs[1].gestartet, null);
});

// --- local ---

// Ein Projekt ohne CI darf nicht releaseunfaehig werden: `keine` ist kein Fehler, der
// Adapter wirft also nicht (im Einstieg: Exit 0).
test("[board-7] local liefert keine mit leerer Jobliste und Exit 0", async () => {
  const { daten } = await ciStatus({ codeHost: "local", issueTracker: "local" }, null, []);
  assert.deepEqual(daten, { status: "keine", jobs: [] });
});
