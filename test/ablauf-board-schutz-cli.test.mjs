// Ablauf-Pruefung: Exit-Code, Nacht-Sperre und Hilfe von `code schutz` zeigt nur der gestartete Einstieg kit/board.mjs (codeSchutz bricht ueber fail() mit process.exit ab und ist nicht exportiert); im selben Prozess gibt es dafuer keine Funktion eines Teils.
//
// Die CLI `code schutz status|einrichten|aussetzen|wiederherstellen|nachpruefen`
// (Issue #1408, Plan #1405, A10). Die Logik dahinter pruefen `board-schutz.test.mjs` mit
// gefaelschtem Host und `board-adapter-schutz-github.test.mjs` mit gefaelschtem `gh`. Hier
// laeuft der Einstieg mit derselben `gh`-Faelschung wie in
// `board-adapter-ci-status-github.test.mjs` (E12), dazu ein gefaelschtes `git`: kein Netz,
// kein Token, kein Remote. Der Lauf der Probe ist beim ersten Blick schon abgeschlossen —
// so wartet kein Test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { setupProjekt, fakeCli, aufrufZeilen, runBoard } from "./helpers/board-fixture.mjs";
import { aufrufEingaben } from "./helpers/adapter-fixture.mjs";

const SHA = "c".repeat(40);
const REPO = "o/r";
const CONFIG = {
  codeHost: "github",
  issueTracker: "github",
  mainBranch: "main",
  productionBranch: "production",
  pushPruefung: { ort: "buildDienst", zweig: "kit-pruefung" },
};
const OHNE_NACHT = { KIT_AGENT_MODEL: "" };

/** git: Kopf von origin/main bekannt, Pruefzweig frei (oder `belegt`), Push gelingt. */
function gitRegeln({ belegt = false } = {}) {
  return [
    { match: "^rev-parse ", stdout: `${SHA}\n` },
    belegt
      ? { match: "^ls-remote ", stdout: `${SHA}\trefs/heads/kit-pruefung\n` }
      : { match: "^ls-remote ", exit: 2 },
    { match: "^push ", stdout: "" },
  ];
}

/**
 * gh: Admin-Recht, ein abgeschlossener Lauf auf dem Pruefzweig und ein fremder Lauf mit
 * anderem `headBranch` am selben Commit, noch keine Rulesets.
 */
function ghRegeln({ runList = null, rulesets = [] } = {}) {
  return [
    { match: "^repo view", stdout: `${REPO}\n` },
    { match: `^api repos/${REPO}$`, stdout: { permissions: { admin: true } } },
    runList ?? { match: "^run list", stdout: [
      { databaseId: 1, workflowName: "CI", headBranch: "kit-pruefung", conclusion: "success", status: "completed" },
      { databaseId: 2, workflowName: "SonarQube", headBranch: "main", conclusion: "success", status: "completed" },
    ] },
    { match: "^run view 1 ", stdout: { jobs: [{ name: "check", conclusion: "success", status: "completed" }] } },
    { match: "^run view 2 ", stdout: { jobs: [{ name: "sonar", conclusion: "success", status: "completed" }] } },
    { match: `^api repos/${REPO}/rulesets --method POST`, stdout: { id: 7 } },
    { match: `^api repos/${REPO}/rulesets/\\d+ --method PUT`, stdout: {} },
    { match: `^api repos/${REPO}/rulesets$`, stdout: rulesets },
  ];
}

/** Startet `code schutz <args>` im Fixture und liefert Ergebnis samt Mitschrift. */
function schutz(args, { git = gitRegeln(), gh = ghRegeln(), env = OHNE_NACHT } = {}) {
  const dir = setupProjekt(CONFIG, "board-schutz-cli-");
  fakeCli(dir, "git", git);
  fakeCli(dir, "gh", gh);
  try {
    const res = runBoard(dir, ["code", "schutz", ...args], env);
    return { res, git: aufrufZeilen(dir, "git"), gh: aufrufZeilen(dir, "gh"), ghEingaben: aufrufEingaben(dir, "gh"), dir };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("[schutz-cli] einrichten: scharf, Probe nur mit den Jobs des Pruefzweigs, Zweig danach geloescht", () => {
  const { res, git, gh, ghEingaben } = schutz(["einrichten"]);
  assert.equal(res.status, 0, res.stderr);
  const daten = JSON.parse(res.stdout);
  assert.equal(daten.ergebnis, "scharf");
  // Der Lauf mit headBranch main am selben Commit liefert keinen Pflichtjob.
  assert.deepEqual(daten.jobs, ["check"]);
  const koerper = ghEingaben.filter(Boolean).map((e) => JSON.parse(e));
  assert.equal(koerper.length, 2);
  for (const k of koerper) {
    const pruefregel = k.rules.find((r) => r.type === "required_status_checks");
    assert.deepEqual(pruefregel.parameters.required_status_checks.map((c) => c.context), ["check"]);
  }
  assert.ok(gh.some((z) => /^run list .*--branch kit-pruefung .*--commit c{40}/.test(z)), gh.join("\n"));
  assert.deepEqual(git.filter((z) => z.startsWith("push ")),
    [`push origin ${SHA}:refs/heads/kit-pruefung`, "push origin --delete kit-pruefung"]);
});

test("[schutz-cli] einrichten --zweig nimmt den genannten Pruefzweig", () => {
  const { res, git } = schutz(["einrichten", "--zweig", "probe-x"], {
    gh: ghRegeln({ runList: { match: "^run list", stdout: [
      { databaseId: 1, workflowName: "CI", headBranch: "probe-x", conclusion: "success", status: "completed" },
    ] } }),
  });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(git.includes(`push origin ${SHA}:refs/heads/probe-x`), git.join("\n"));
});

test("[schutz-cli] einrichten: ein schon vorhandener Pruefzweig bricht ohne Push ab", () => {
  const { res, git, gh } = schutz(["einrichten"], { git: gitRegeln({ belegt: true }) });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /kit-pruefung.*schon vorhanden/);
  assert.equal(git.some((z) => z.startsWith("push ")), false);
  assert.equal(gh.some((z) => z.includes("--method")), false);
});

test("[schutz-cli] einrichten: der Pruefzweig wird auch bei einem Fehlschlag der Probe geloescht", () => {
  const { res, git, gh } = schutz(["einrichten"], {
    gh: ghRegeln({ runList: { match: "^run list", exit: 1, stderr: "gh: HTTP 502\n" } }),
  });
  assert.equal(res.status, 0, res.stderr);
  const daten = JSON.parse(res.stdout);
  assert.equal(daten.ergebnis, "nicht moeglich");
  assert.match(daten.grund, /HTTP 502/);
  assert.ok(git.includes("push origin --delete kit-pruefung"), git.join("\n"));
  assert.equal(gh.some((z) => z.includes("--method")), false);
});

test("[schutz-cli] aussetzen ohne gruene Zusammenfassung der Stufe push aendert kein Ruleset, Exit ungleich 0", () => {
  const dir = setupProjekt(CONFIG, "board-schutz-leer-");
  try {
    const { res, gh } = schutz(["aussetzen", "--in", dir]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /push/);
    assert.equal(gh.some((z) => z.includes("--method")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[schutz-cli] wiederherstellen: scheitert es, Exit ungleich 0 mit dem Kommando zum Wiederholen", () => {
  const { res } = schutz(["wiederherstellen"], { gh: ghRegeln({ rulesets: [] }) });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /code schutz wiederherstellen/);
});

test("[schutz-cli] wiederherstellen setzt das Ruleset des Hauptzweigs auf active", () => {
  const { res, ghEingaben } = schutz(["wiederherstellen"], {
    gh: ghRegeln({ rulesets: [{ id: 3, name: "claude-workflow-kit: main" }] }),
  });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(ghEingaben.filter(Boolean).map((e) => JSON.parse(e)), [{ enforcement: "active" }]);
});

for (const aktion of ["einrichten", "aussetzen", "nachpruefen"]) {
  test(`[schutz-cli] ${aktion} bricht mit gesetztem KIT_AGENT_MODEL ab, ohne git und gh`, () => {
    const args = aktion === "aussetzen" ? [aktion, "--in", "."] : [aktion];
    const { res, git, gh } = schutz(args, { env: { KIT_AGENT_MODEL: "claude-sonnet-5-5" } });
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /ohne Aufsicht gesperrt/);
    assert.deepEqual(git, []);
    assert.deepEqual(gh, []);
  });
}

test("[schutz-cli] status laeuft auch mit gesetztem KIT_AGENT_MODEL und endet bei geschuetzt false mit Exit 0", () => {
  const { res } = schutz(["status"], { env: { KIT_AGENT_MODEL: "claude-sonnet-5-5" } });
  assert.equal(res.status, 0, res.stderr);
  const daten = JSON.parse(res.stdout);
  assert.equal(daten.geschuetzt, false);
  assert.ok(daten.fehlt.some((f) => /claude-workflow-kit: main/.test(f)), daten.fehlt.join("\n"));
  assert.equal(daten.ungeprueft, null);
});

test("[schutz-cli] nachpruefen pusht den Kopf erneut und loescht den Pruefzweig", () => {
  const { res, git } = schutz(["nachpruefen"]);
  assert.equal(res.status, 0, res.stderr);
  const daten = JSON.parse(res.stdout);
  assert.equal(daten.commit, SHA);
  assert.equal(daten.status, "gruen");
  assert.deepEqual(git.filter((z) => z.startsWith("push ")),
    [`push origin ${SHA}:refs/heads/kit-pruefung`, "push origin --delete kit-pruefung"]);
});

test("[schutz-cli] eine unbekannte Aktion endet mit Exit 1 und nennt die fuenf Aktionen", () => {
  const { res } = schutz(["loeschen"]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /status \| einrichten \| aussetzen \| wiederherstellen \| nachpruefen/);
});

test("[schutz-cli] der HELP-Text nennt code schutz mit allen fuenf Aktionen", () => {
  const dir = setupProjekt(CONFIG, "board-schutz-help-");
  try {
    const res = runBoard(dir, ["--help"]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /code schutz/);
    for (const aktion of ["status", "einrichten --zweig", "aussetzen --in", "wiederherstellen", "nachpruefen"]) {
      assert.match(res.stdout, new RegExp(`code schutz ${aktion}`));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
