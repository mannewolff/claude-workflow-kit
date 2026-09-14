// `issue-review roles` und `reviewers` nach Stufe 2 des Prozess-Umbaus (Plan #638, A15;
// Issue #641).
//
// Die Pruefvorgabe am Ticket und die Synthese-Pruefung sind entfallen. `roles` kennt
// nur noch `--stufe` und `--author`; `--issue`, `--rolle` und `--ausschluss` werden
// abgewiesen statt still uebergangen, und die Antwort traegt weder `runden` noch
// `verzicht` noch `vorgabeQuelle`. `reviewers` gibt kein `rounds` mehr aus. Die
// entfallenen Kommandos `label-sync` und `synthese-check` sind unbekannte Befehle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";

const REVIEWERS = [
  { name: "opus", kind: "claude", model: "claude-opus-5" },
  { name: "sonnet", kind: "claude", model: "claude-sonnet-5" },
  { name: "fable", kind: "claude", model: "claude-fable-5.1" },
];

const STUFEN = {
  fachlich: { reviewer: 2, rollen: ["form-beobachtbarkeit", "abgrenzung"] },
  plan: { reviewer: 1, rollen: ["architektur-bestand"] },
  issue: { reviewer: 1, rollen: ["pruefbarkeit"] },
};

function mitProjekt(fn, extra = {}) {
  const dir = setupProjekt({
    codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" },
    issueReview: { reviewers: REVIEWERS },
    reviewStufen: STUFEN,
    ...extra,
  }, "board-roles-ohne-issue-");
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("[board-6] roles liefert Stufe, Besetzung, Rollen und Auswahl — ohne runden, verzicht und vorgabeQuelle", () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue-review", "roles", "--stufe", "plan", "--author", "claude-opus-5"]);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.stufe, "plan");
    assert.equal(out.reviewer, 1);
    assert.deepEqual(out.rollen, ["architektur-bestand"]);
    assert.equal(out.stufenQuelle, "stufen");
    assert.equal(out.autor, "claude-opus-5");
    assert.deepEqual(out.gewaehlt.map((r) => r.name), ["sonnet"]);
    assert.equal(out.autorAufgeloest, true);
    for (const feld of ["runden", "verzicht", "vorgabeQuelle", "entfall", "ausschlussUnbekannt"]) {
      assert.equal(feld in out, false, `${feld} darf nicht mehr ausgegeben werden`);
    }
  });
});

for (const [option, wert] of [["--issue", "1"], ["--rolle", "synthese"], ["--ausschluss", "fable"]]) {
  test(`[board-6] roles weist ${option} mit Exit 1 ab und nennt die beiden bleibenden Optionen`, () => {
    mitProjekt((dir) => {
      const res = runBoard(dir, ["issue-review", "roles", "--stufe", "issue", "--author", "claude-opus-5", option, wert]);
      assert.equal(res.status, 1, `${option} haette abgewiesen werden muessen: ${res.stdout}`);
      assert.match(res.stderr, new RegExp(`${option} gibt es seit Stufe 2 des Prozess-Umbaus nicht mehr`));
      assert.match(res.stderr, /nur --stufe und --author/);
    });
  });
}

test("[board-6] reviewers gibt kein rounds mehr aus", () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue-review", "reviewers", "--author", "opus"]);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.deepEqual(out.gewaehlt.map((r) => r.name), ["sonnet", "fable"]);
    assert.equal("rounds" in out, false);
  });
});

for (const kommando of ["label-sync", "synthese-check"]) {
  test(`[board-6] ${kommando} ist ein unbekannter issue-review-Befehl`, () => {
    mitProjekt((dir) => {
      const res = runBoard(dir, ["issue-review", kommando, "1"]);
      assert.equal(res.status, 1);
      assert.match(res.stderr, new RegExp(`Unbekannter issue-review-Befehl: '${kommando}'`));
    });
  });
}

test("[board-6] die Hilfe nennt weder --issue noch label-sync noch synthese-check", () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["--help"]);
    for (const wort of ["--issue <N>", "--rolle", "--ausschluss", "label-sync", "synthese-check"]) {
      assert.ok(!res.stdout.includes(wort), `die Hilfe nennt '${wort}' noch`);
    }
    assert.ok(res.stdout.includes("issue-review roles --stufe <fachlich|plan|issue> --author <modell>"));
  });
});
