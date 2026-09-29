// Stufen der Pruefung: reviewStufen-Config und `issue-review roles` (Issue #278).
//
// Die Pruefung hat drei Stufen mit unterschiedlichen Blickwinkeln und unterschiedlicher
// Besetzung: fachlich und Plan je zwei Reviewer, das Arbeitspaket nur noch einen. Wer
// wie stark besetzt ist, gehoert in die Konfiguration — fest verdrahtet waere es weder
// pro Projekt anpassbar noch ablesbar.
//
// Der Kern dieser Datei ist die Kuerzung: `pickReviewers` kuerzte bisher nur im
// Regel-Zweig auf die Anzahl, der pairs-Zweig lieferte alle genannten Reviewer. Fuer die
// Stufe `issue` mit `reviewer: 1` waeren damit trotzdem zwei gelaufen — der eine
// Reviewer, um den es geht, waere stillschweigend zwei geblieben.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard, repoRoot } from "./helpers/board-fixture.mjs";
import { pickReviewers } from "../kit/board.mjs";

const OPUS = { name: "opus", kind: "claude", model: "claude-opus-5" };
const SONNET = { name: "sonnet", kind: "claude", model: "claude-sonnet-5" };
const FABLE = { name: "fable", kind: "claude", model: "claude-fable-5" };
const CODEX = { name: "codex", kind: "command", command: "codex exec --model gpt-5" };
const ALLE = [OPUS, SONNET, FABLE, CODEX];

const BASIS = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };
const REVIEW = { reviewers: ALLE, pairs: { opus: ["codex", "sonnet"], sonnet: ["opus", "codex"] } };

const STUFEN = {
  fachlich: { reviewer: 2, rollen: ["form-beobachtbarkeit", "abgrenzung"] },
  plan: { reviewer: 2, rollen: ["architektur-bestand", "schnitt-abhaengigkeiten"] },
  issue: { reviewer: 1, rollen: ["pruefbarkeit"] },
};

/** Fixture mit issueReview- und (optional) reviewStufen-Block. */
function mitStufen(reviewStufen, fn, issueReview = REVIEW) {
  const config = { ...BASIS, issueReview };
  if (reviewStufen !== null) config.reviewStufen = reviewStufen;
  const dir = setupProjekt(config, "board-stufen-");
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- pickReviewers: Kuerzung auch im pairs-Zweig ---

test("pickReviewers: ein pairs-Eintrag wird auf die Anzahl gekuerzt", () => {
  // Ohne diese Kuerzung liefe die Stufe `issue` mit zwei Reviewern statt mit einem.
  const { gewaehlt, quelle, unterbesetzt } = pickReviewers(ALLE, "opus", 1, { opus: ["codex", "sonnet"] });
  assert.deepEqual(gewaehlt.map((r) => r.name), ["codex"]);
  assert.equal(quelle, "pairs");
  assert.equal(unterbesetzt, false);
});

test("pickReviewers: die Kuerzung haelt die konfigurierte Reihenfolge ein", () => {
  const { gewaehlt } = pickReviewers(ALLE, "sonnet", 1, { sonnet: ["fable", "codex"] });
  assert.deepEqual(gewaehlt.map((r) => r.name), ["fable"]);
});

// --- CLI: roles ---

test("issue-review roles: die Stufe issue laeuft mit genau einem Reviewer", () => {
  mitStufen(STUFEN, (dir) => {
    const res = runBoard(dir, ["issue-review", "roles", "--stufe", "issue", "--author", "claude-opus-5"]);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.stufe, "issue");
    assert.equal(out.reviewer, 1);
    assert.deepEqual(out.rollen, ["pruefbarkeit"]);
    // Der Punkt des Vorhabens: pairs.opus nennt zwei Namen, gewaehlt wird genau einer.
    assert.equal(out.gewaehlt.length, 1);
    assert.deepEqual(out.gewaehlt.map((r) => r.name), ["codex"]);
  });
});

test("issue-review roles: fachlich und plan laufen mit zwei Reviewern", () => {
  mitStufen(STUFEN, (dir) => {
    for (const [stufe, rollen] of [["fachlich", STUFEN.fachlich.rollen], ["plan", STUFEN.plan.rollen]]) {
      const out = JSON.parse(runBoard(dir, ["issue-review", "roles", "--stufe", stufe, "--author", "opus"]).stdout);
      assert.equal(out.reviewer, 2, stufe);
      assert.deepEqual(out.rollen, rollen, stufe);
      assert.equal(out.gewaehlt.length, 2, stufe);
    }
  });
});

test("issue-review roles: die Modell-ID des Autors wird aufgeloest und schliesst ihn aus", () => {
  mitStufen(STUFEN, (dir) => {
    const out = JSON.parse(runBoard(dir, ["issue-review", "roles", "--stufe", "fachlich", "--author", "claude-opus-5"]).stdout);
    assert.equal(out.autor, "claude-opus-5");
    assert.equal(out.autorAufgeloest, true);
    assert.equal(out.quelle, "pairs", "pairs.opus greift ueber die aufgeloeste Modell-ID");
    assert.ok(!out.gewaehlt.some((r) => r.name === "opus"), "der Autor darf nicht sein eigener Reviewer sein");
  });
});

test("issue-review roles: quelle bleibt die Auswahlquelle, stufenQuelle ist ein eigenes Feld", () => {
  mitStufen(STUFEN, (dir) => {
    const ausPairs = JSON.parse(runBoard(dir, ["issue-review", "roles", "--stufe", "plan", "--author", "opus"]).stdout);
    assert.equal(ausPairs.quelle, "pairs");
    assert.equal(ausPairs.stufenQuelle, "stufen");
    // fable steht nicht in pairs -> die Reihenfolge-Regel waehlt.
    const ausRegel = JSON.parse(runBoard(dir, ["issue-review", "roles", "--stufe", "plan", "--author", "fable"]).stdout);
    assert.equal(ausRegel.quelle, "regel");
    assert.equal(ausRegel.stufenQuelle, "stufen");
  });
});

test("issue-review roles: ohne reviewStufen-Block gilt fuer jede Stufe die Rueckfallebene", () => {
  // Ein Kit-Update darf keinem Bestandsprojekt den Review umbauen — dieselbe Vorsicht
  // wie bei requiredBeforeReady, das per Default aus ist.
  mitStufen(null, (dir) => {
    for (const stufe of ["fachlich", "plan", "issue"]) {
      const res = runBoard(dir, ["issue-review", "roles", "--stufe", stufe, "--author", "opus"]);
      assert.equal(res.status, 0, res.stderr);
      const out = JSON.parse(res.stdout);
      assert.equal(out.reviewer, 2, stufe);
      assert.deepEqual(out.rollen, ["vollstaendigkeit-pruefbarkeit", "scope-risiko-bestand"], stufe);
      assert.equal(out.stufenQuelle, "default", stufe);
      assert.equal(out.gewaehlt.length, 2, stufe);
    }
  });
});

test("issue-review roles: eine unbekannte Stufe bricht ab", () => {
  mitStufen(STUFEN, (dir) => {
    const res = runBoard(dir, ["issue-review", "roles", "--stufe", "unbekannt", "--author", "opus"]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /unbekannt/);
  });
});

test("issue-review roles: --stufe ohne Wert und ohne Option brechen ab", () => {
  mitStufen(STUFEN, (dir) => {
    const ohneWert = runBoard(dir, ["issue-review", "roles", "--stufe", "--author", "opus"]);
    assert.notEqual(ohneWert.status, 0);
    assert.match(ohneWert.stderr, /--stufe/);
    const ohneOption = runBoard(dir, ["issue-review", "roles", "--author", "opus"]);
    assert.notEqual(ohneOption.status, 0);
    assert.match(ohneOption.stderr, /--stufe/);
  });
});

test("issue-review roles: --author ist verpflichtend", () => {
  // pickReviewers braucht den Autor fuer pairs und fuer den Selbstausschluss; ohne ihn
  // koennte das Kommando genau das nicht leisten, wofuer es da ist.
  mitStufen(STUFEN, (dir) => {
    const ohneOption = runBoard(dir, ["issue-review", "roles", "--stufe", "issue"]);
    assert.notEqual(ohneOption.status, 0);
    assert.match(ohneOption.stderr, /--author/);
    const ohneWert = runBoard(dir, ["issue-review", "roles", "--stufe", "issue", "--author"]);
    assert.notEqual(ohneWert.status, 0);
    assert.match(ohneWert.stderr, /--author/);
  });
});

// --- Validierung des Config-Blocks ---
//
// Hart wie im uebrigen Config-Bereich: validateReviewers und validatePairs brechen bei
// Tippfehlern ab, weil ein stiller Skip einen Tippfehler in einen unsichtbaren
// Ein-Reviewer-Lauf verwandelt. Fuer die Stufenbesetzung gilt dasselbe.

test("reviewStufen: rollen.length ungleich reviewer bricht mit genau dieser Meldung ab", () => {
  const kaputt = { ...STUFEN, issue: { reviewer: 1, rollen: ["pruefbarkeit", "zuviel"] } };
  mitStufen(kaputt, (dir) => {
    const res = runBoard(dir, ["issue-review", "roles", "--stufe", "issue", "--author", "opus"]);
    assert.equal(res.status, 1);
    assert.ok(
      res.stderr.includes("reviewStufen.issue: rollen.length (2) stimmt nicht mit reviewer (1) ueberein."),
      `unerwartete Meldung: ${res.stderr}`,
    );
    assert.equal(res.stdout, "", "im Fehlerfall darf kein JSON auf stdout stehen");
  });
});

for (const [was, stufe] of [
  ["reviewer: 0", { reviewer: 0, rollen: [] }],
  ["negativem reviewer", { reviewer: -1, rollen: ["a"] }],
  ["nicht ganzzahligem reviewer", { reviewer: 1.5, rollen: ["a"] }],
  ["reviewer als Text", { reviewer: "2", rollen: ["a", "b"] }],
  ["fehlendem reviewer", { rollen: ["a", "b"] }],
  ["rollen als Nicht-Array", { reviewer: 1, rollen: "pruefbarkeit" }],
  ["fehlenden rollen", { reviewer: 1 }],
  ["leerem Rollennamen", { reviewer: 2, rollen: ["a", ""] }],
  ["doppeltem Rollennamen", { reviewer: 2, rollen: ["a", "a"] }],
  ["Rollenname als Nicht-Text", { reviewer: 1, rollen: [7] }],
]) {
  test(`reviewStufen: Stufe mit ${was} bricht mit Config-Pfad ab`, () => {
    mitStufen({ ...STUFEN, issue: stufe }, (dir) => {
      const res = runBoard(dir, ["issue-review", "roles", "--stufe", "issue", "--author", "opus"]);
      assert.equal(res.status, 1);
      assert.match(res.stderr, /reviewStufen\.issue/);
      assert.equal(res.stdout, "");
    });
  });
}

test("reviewStufen: eine fehlende Stufe im vorhandenen Block bricht ab", () => {
  // Defaults greifen ausschliesslich, wenn der GESAMTE Block fehlt — sonst waere ein
  // vergessener Eintrag von einer bewussten Rueckfallebene nicht zu unterscheiden.
  const { issue, ...ohneIssue } = STUFEN;
  mitStufen(ohneIssue, (dir) => {
    const res = runBoard(dir, ["issue-review", "roles", "--stufe", "fachlich", "--author", "opus"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /reviewStufen\.issue/);
  });
});

test("reviewStufen: ein Block, der kein Objekt ist, bricht ab", () => {
  mitStufen(["fachlich"], (dir) => {
    const res = runBoard(dir, ["issue-review", "roles", "--stufe", "fachlich", "--author", "opus"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /reviewStufen/);
  });
});

// --- Bestandsverhalten ---

test("issue-review reviewers, check und matrix laufen mit reviewStufen unveraendert", () => {
  mitStufen(STUFEN, (dir) => {
    const reviewers = JSON.parse(runBoard(dir, ["issue-review", "reviewers", "--author", "opus"]).stdout);
    assert.deepEqual(reviewers.gewaehlt.map((r) => r.name), ["codex", "sonnet"]);
    assert.equal(reviewers.quelle, "pairs");
    assert.equal(reviewers.stufenQuelle, undefined, "reviewers kennt keine Stufen");

    const check = JSON.parse(runBoard(dir, ["issue-review", "check", "--nur-pfad"]).stdout);
    assert.equal(check.reviewers.length, 4);

    const { matrix } = JSON.parse(runBoard(dir, ["issue-review", "matrix"]).stdout);
    assert.deepEqual(matrix.find((m) => m.autor === "opus").reviewer, ["codex", "sonnet"]);
  });
});

// --- Hilfe und Kopfkommentar ---

const SYNTAX = "issue-review roles --stufe <fachlich|plan|issue> --author <modell>";

test("Die Hilfe nennt die volle Syntax von issue-review roles", () => {
  mitStufen(STUFEN, (dir) => {
    const res = runBoard(dir, ["--help"]);
    assert.ok(res.stdout.includes(SYNTAX), `Syntax fehlt in der Hilfe:\n${res.stdout}`);
  });
});

test("Der Kopfkommentar von board.mjs nennt dieselbe Syntax", () => {
  // Wer die Datei oeffnet, liest den Kopf — driftet er, beschreibt die Datei ein
  // Kommando, das es nicht gibt, oder verschweigt eines, das es gibt.
  const kopf = readFileSync(join(repoRoot, "kit", "board.mjs"), "utf-8").split("*/")[0];
  assert.ok(kopf.includes(SYNTAX), "Syntax fehlt im Kopfkommentar von kit/board.mjs");
});
