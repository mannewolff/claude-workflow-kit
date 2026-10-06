// Pruefzahl der Stufe plan aus dem Lauf (Issue #1245, Plan #1243, A8 und E2), im selben
// Prozess gegen den Teil kit/board/issue-review.mjs.
//
// Ein Lauf setzt die Pruefzahl der Stufe plan ueber KIT_PLAN_REVIEWER, ohne die Config
// des Projekts zu aendern. Die Bestimmung ist eine reine Funktion: Sie wirft einen
// BoardError, und erst der Befehl macht daraus fail — den Ausgang ueber den Prozess
// prueft test/ablauf-board-issue-review-roles.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { planReviewerAusLauf, issueReviewRoles } from "../kit/board/issue-review.mjs";
import { BoardError } from "../kit/board/grundlagen.mjs";

const EINER = { reviewer: 1, rollen: ["architektur-bestand"] };
const ZWEI = { reviewer: 2, rollen: ["architektur-bestand", "schnitt-abhaengigkeiten"] };

test("ohne KIT_PLAN_REVIEWER gibt es keinen Wert aus dem Lauf", () => {
  assert.equal(planReviewerAusLauf({ env: {}, eintrag: ZWEI, verfuegbar: 2 }), null);
  assert.equal(planReviewerAusLauf({ env: { KIT_PLAN_REVIEWER: "" }, eintrag: ZWEI, verfuegbar: 2 }), null);
});

test("KIT_PLAN_REVIEWER=2 gegen Config 1 fuellt die Rollen aus der Konstante auf", () => {
  const erg = planReviewerAusLauf({ env: { KIT_PLAN_REVIEWER: "2" }, eintrag: EINER, verfuegbar: 2 });
  assert.deepEqual(erg, { reviewer: 2, rollen: ["architektur-bestand", "schnitt-abhaengigkeiten"], stufenQuelle: "lauf" });
});

test("KIT_PLAN_REVIEWER=1 gegen Config 2 kuerzt die Rollen in Config-Reihenfolge", () => {
  const erg = planReviewerAusLauf({ env: { KIT_PLAN_REVIEWER: "1" }, eintrag: ZWEI, verfuegbar: 2 });
  assert.deepEqual(erg, { reviewer: 1, rollen: ["architektur-bestand"], stufenQuelle: "lauf" });
});

test("KIT_PLAN_REVIEWER gleich der Config laesst die Rollen stehen", () => {
  assert.deepEqual(planReviewerAusLauf({ env: { KIT_PLAN_REVIEWER: "1" }, eintrag: EINER, verfuegbar: 2 }).rollen, ["architektur-bestand"]);
  assert.deepEqual(planReviewerAusLauf({ env: { KIT_PLAN_REVIEWER: "2" }, eintrag: ZWEI, verfuegbar: 2 }).rollen, ZWEI.rollen);
});

test("aufgefuellt wird nur mit Rollen, die noch fehlen", () => {
  // Die Bestandsvorgabe traegt andere Rollennamen; gekuerzt wird sie trotzdem in ihrer Reihenfolge.
  const eigen = { reviewer: 1, rollen: ["schnitt-abhaengigkeiten"] };
  const erg = planReviewerAusLauf({ env: { KIT_PLAN_REVIEWER: "2" }, eintrag: eigen, verfuegbar: 2 });
  assert.deepEqual(erg.rollen, ["schnitt-abhaengigkeiten", "architektur-bestand"]);
});

for (const wert of ["3", "0", "zwei", "1.5", " 2"]) {
  test(`ungueltiger Wert '${wert}' wirft einen BoardError mit Grund`, () => {
    assert.throws(
      () => planReviewerAusLauf({ env: { KIT_PLAN_REVIEWER: wert }, eintrag: ZWEI, verfuegbar: 2 }),
      (err) => err instanceof BoardError && /KIT_PLAN_REVIEWER/.test(err.message) && err.message.includes(`'${wert}'`) && /1 oder 2/.test(err.message),
    );
  });
}

test("KIT_PLAN_REVIEWER=2 bei nur einem verfuegbaren Reviewer wirft einen BoardError", () => {
  assert.throws(
    () => planReviewerAusLauf({ env: { KIT_PLAN_REVIEWER: "2" }, eintrag: EINER, verfuegbar: 1 }),
    (err) => err instanceof BoardError && err.message === "planreview:2 verlangt zwei Reviewer, verfügbar ist einer",
  );
});

test("KIT_PLAN_REVIEWER=1 bei nur einem verfuegbaren Reviewer ist besetzt", () => {
  assert.equal(planReviewerAusLauf({ env: { KIT_PLAN_REVIEWER: "1" }, eintrag: ZWEI, verfuegbar: 1 }).reviewer, 1);
});

// --- Einbindung in issueReviewRoles ---

const CONFIG = {
  issueReview: {
    reviewers: [
      { name: "opus", kind: "claude", model: "claude-opus-5" },
      { name: "sonnet", kind: "claude", model: "claude-sonnet-5" },
      { name: "fable", kind: "claude", model: "claude-fable-5.1" },
    ],
  },
  reviewStufen: {
    fachlich: { reviewer: 2, rollen: ["form-beobachtbarkeit", "abgrenzung"] },
    plan: EINER,
    issue: { reviewer: 1, rollen: ["pruefbarkeit"] },
  },
};

test("roles --stufe plan uebernimmt KIT_PLAN_REVIEWER mit stufenQuelle lauf", () => {
  const erg = issueReviewRoles({ stufe: "plan", author: "opus" }, CONFIG, { KIT_PLAN_REVIEWER: "2" });
  assert.equal(erg.reviewer, 2);
  assert.deepEqual(erg.rollen, ["architektur-bestand", "schnitt-abhaengigkeiten"]);
  assert.equal(erg.stufenQuelle, "lauf");
  assert.deepEqual(erg.gewaehlt.map((r) => r.name), ["sonnet", "fable"]);
  assert.equal(erg.unterbesetzt, false);
});

test("roles ohne KIT_PLAN_REVIEWER bleibt unveraendert", () => {
  const erg = issueReviewRoles({ stufe: "plan", author: "opus" }, CONFIG, {});
  assert.equal(erg.reviewer, 1);
  assert.deepEqual(erg.rollen, ["architektur-bestand"]);
  assert.equal(erg.stufenQuelle, "stufen");
});

test("roles anderer Stufen beachtet KIT_PLAN_REVIEWER nicht", () => {
  const erg = issueReviewRoles({ stufe: "issue", author: "opus" }, CONFIG, { KIT_PLAN_REVIEWER: "2" });
  assert.equal(erg.reviewer, 1);
  assert.equal(erg.stufenQuelle, "stufen");
});

test("roles --stufe plan wirft bei Unterbesetzung den BoardError durch", () => {
  const knapp = { ...CONFIG, issueReview: { reviewers: CONFIG.issueReview.reviewers.slice(0, 2) } };
  assert.throws(
    () => issueReviewRoles({ stufe: "plan", author: "opus" }, knapp, { KIT_PLAN_REVIEWER: "2" }),
    (err) => err instanceof BoardError && /verfügbar ist einer/.test(err.message),
  );
});
