// Die Achse `code ci-status` in kit/board.mjs (Issue #316).
//
// Warum der Adapter und nicht ein `gh`-Aufruf im Skill-Text: Die Skills sind
// provider-unabhaengig, und `gh run list` gibt es bei GitLab und im lokalen Modus
// nicht. Die Achse haengt deshalb am `codeHost`, nicht am `issueTracker` — genau das
// belegt der Mischfall-Test mit `issueTracker: toolbox`.
//
// gh und glab laufen als Fake-Binaries im PATH (Muster aus test/board-github.test.mjs):
// kein Netz, keine Authentifizierung, und die abgesetzte Kommandozeile ist Teil der
// Pruefung.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { setupProjekt, fakeCli, runBoard, aufrufZeilen } from "./helpers/board-fixture.mjs";

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Das Fake-CLI liegt als .cmd im PATH; Node wirft dafuer EINVAL ohne shell:true (CVE-2024-27980), und board.mjs startet seit #196 bewusst ohne Shell. Siehe Issue #197." }
  : {};

const SHA = "0123456789abcdef0123456789abcdef01234567";

/** Legt ein Fixture mit Fake-CLI an, ruft `code ci-status` auf und raeumt auf. */
function ciStatus(config, cliName, regeln, { commitArg = SHA } = {}) {
  const dir = setupProjekt(config, "board-ci-");
  if (cliName) fakeCli(dir, cliName, regeln);
  try {
    const args = ["code", "ci-status"];
    if (commitArg !== null) args.push("--commit");
    if (typeof commitArg === "string") args.push(commitArg);
    const res = runBoard(dir, args);
    return { res, zeilen: cliName ? aufrufZeilen(dir, cliName) : [] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Erwartet Exit 0 und liefert die geparste Ausgabe samt Aufrufzeilen. */
function ciStatusOk(config, cliName, regeln) {
  const { res, zeilen } = ciStatus(config, cliName, regeln);
  assert.equal(res.status, 0, `Exit ${res.status}: ${res.stderr}`);
  return { daten: JSON.parse(res.stdout), zeilen };
}

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
