// Die Achse `code ci-status` in kit/board.mjs, GitHub-Zweig (Issue #316).
//
// Warum der Adapter und nicht ein `gh`-Aufruf im Skill-Text: Die Skills sind
// provider-unabhaengig, und `gh run list` gibt es bei GitLab und im lokalen Modus
// nicht. Die Achse haengt deshalb am `codeHost`, nicht am `issueTracker` — genau das
// belegt der Mischfall-Test mit `issueTracker: toolbox`.
//
// Erste von zwei Dateien zur Achse (Issue #836): GitLab, der lokale Modus und die
// CLI-Form liegen in `board-ci-status-gitlab.test.mjs`, die gemeinsamen Fixtures in
// `helpers/board-ci-fixture.mjs`.
//
// gh laeuft als Fake-Binary im PATH (Muster aus test/board-github.test.mjs): kein Netz,
// keine Authentifizierung, und die abgesetzte Kommandozeile ist Teil der Pruefung.

import { test } from "node:test";
import assert from "node:assert/strict";

import { NUR_POSIX, SHA, ciStatus, ciStatusOk } from "./helpers/board-ci-fixture.mjs";

// --- GitHub ---

const GITHUB = { codeHost: "github", issueTracker: "github" };

/** gh-Regeln fuer genau einen Lauf mit den uebergebenen Jobs. */
function ghRegeln(jobs, { laeufe = [{ databaseId: 77, workflowName: "CI", conclusion: null, status: "completed" }] } = {}) {
  return [
    { match: "^run list", stdout: laeufe },
    { match: "^run view 77", stdout: { jobs } },
  ];
}

test("[board-7] github: alle Jobs gruen ergeben gruen", NUR_POSIX, () => {
  const { daten, zeilen } = ciStatusOk(GITHUB, "gh", ghRegeln([
    { name: "check (ubuntu-latest)", conclusion: "success", status: "completed" },
    { name: "check (windows-latest)", conclusion: "skipped", status: "completed" },
  ]));
  assert.deepEqual(daten, {
    status: "gruen",
    jobs: [
      { name: "check (ubuntu-latest)", ergebnis: "gruen" },
      { name: "check (windows-latest)", ergebnis: "gruen" },
    ],
  });
  // Der SHA geht als Filter an gh, und die Jobs kommen aus `run view` — `run list --json name`
  // liefert nur den Workflow-Namen, damit waere der rote Job nicht zu benennen.
  assert.match(zeilen[0], new RegExp(`run list .*--commit ${SHA}`));
  assert.match(zeilen[0], /--json \S*databaseId/);
  assert.match(zeilen[1], /run view 77 --json jobs/);
});

test("[board-7] github: ein roter Job ergibt rot und wird benannt", NUR_POSIX, () => {
  const { daten } = ciStatusOk(GITHUB, "gh", ghRegeln([
    { name: "check (ubuntu-latest)", conclusion: "success", status: "completed" },
    { name: "check (windows-latest)", conclusion: "failure", status: "completed" },
  ]));
  assert.equal(daten.status, "rot");
  assert.deepEqual(daten.jobs.find((j) => j.ergebnis === "rot"), {
    name: "check (windows-latest)", ergebnis: "rot",
  });
});

test("[board-7] github: ein laufender Job ergibt laeuft", NUR_POSIX, () => {
  const { daten } = ciStatusOk(GITHUB, "gh", ghRegeln([
    { name: "check (ubuntu-latest)", conclusion: "success", status: "completed" },
    { name: "check (windows-latest)", conclusion: null, status: "in_progress" },
  ]));
  assert.equal(daten.status, "laeuft");
  assert.deepEqual(daten.jobs[1], { name: "check (windows-latest)", ergebnis: "laeuft" });
});

test("[board-7] github: cancelled zaehlt als rot", NUR_POSIX, () => {
  const { daten } = ciStatusOk(GITHUB, "gh", ghRegeln([
    { name: "check (windows-latest)", conclusion: "cancelled", status: "completed" },
  ]));
  assert.equal(daten.status, "rot");
});

// Der Mischfall ist der Grund fuer die Vorrangregel: Waere `laeuft` staerker, hiesse
// ein roter Job „warte noch" — und das Release liefe durch.
test("[board-7] github: rot schlaegt laeuft", NUR_POSIX, () => {
  const { daten } = ciStatusOk(GITHUB, "gh", ghRegeln([
    { name: "check (ubuntu-latest)", conclusion: null, status: "in_progress" },
    { name: "check (windows-latest)", conclusion: "failure", status: "completed" },
  ]));
  assert.equal(daten.status, "rot");
});

// Unmittelbar nach einem Push ist der Lauf fuer einige Sekunden unsichtbar. Ein `keine`
// an dieser Stelle risse genau die Luecke wieder auf, die Issue #316 schliesst.
test("[board-7] github: kein Lauf zum SHA ergibt laeuft, nicht keine", NUR_POSIX, () => {
  const { daten } = ciStatusOk(GITHUB, "gh", [{ match: "^run list", stdout: [] }]);
  assert.deepEqual(daten, { status: "laeuft", jobs: [] });
});

test("[board-7] github: ein Lauf ohne Jobs ergibt laeuft", NUR_POSIX, () => {
  const { daten } = ciStatusOk(GITHUB, "gh", ghRegeln([]));
  assert.deepEqual(daten, { status: "laeuft", jobs: [] });
});

test("[board-7] github: ein CLI mit Exit 1 endet mit Exit 1", NUR_POSIX, () => {
  const { res } = ciStatus(GITHUB, "gh", [
    { match: "^run list", exit: 1, stderr: "gh: HTTP 401 Bad credentials\n" },
  ]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Fehler:/);
});

test("[board-7] github: ungueltiges JSON endet mit Exit 1", NUR_POSIX, () => {
  const { res } = ciStatus(GITHUB, "gh", [{ match: "^run list", stdout: "kein json" }]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Fehler:/);
});

// Die Achse haengt am codeHost, nicht am issueTracker: Dieses Repo faehrt toolbox als
// Tracker und github als Host.
test("[board-7] die Achse haengt am codeHost, nicht am issueTracker", NUR_POSIX, () => {
  const { daten } = ciStatusOk(
    { codeHost: "github", issueTracker: "toolbox", toolbox: { host: "https://example.invalid" } },
    "gh",
    ghRegeln([{ name: "check (ubuntu-latest)", conclusion: "success", status: "completed" }]),
  );
  assert.equal(daten.status, "gruen");
});
