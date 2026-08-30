/**
 * board-reviewzustand.test.mjs — die Ableitung des Pruefzustands (Issue #381).
 *
 * `reviewZustand(body, comments, stufe)` ist die EINE Wahrheit darueber, wie weit
 * die Pruefung eines Dokuments ist. Sie schreibt nichts und kennt kein Label; das
 * Label aus Issue #384 ist ihr erster Leser, nicht ihre Definition.
 *
 * Geprueft werden alle drei Stufen ueber alle vier Zustaende, dazu die drei
 * Faelle, an denen eine naive Implementierung falsch liegt: der verfallene
 * Verzicht, der Marker einer fremden Stufe und der Ausfall-Kommentar.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { reviewZustand, pruefvorgabeStand } from "../kit/board.mjs";

const STUFEN = [
  ["fachlich", "Fachplan-Review", "## Ziel"],
  ["plan", "Plan-Review", "## Ziel"],
  ["issue", "Issue-Review", "## Kontext"],
];

const komm = (...texte) => texte.map((body) => ({ author: "wer", body, createdAt: "2026-08-29" }));

// --- Die vier Zustaende, je Stufe ---

for (const [stufe, marker, abschnitt] of STUFEN) {
  test(`${stufe}: ohne Marker und ohne Kommentar -> offen`, () => {
    assert.equal(reviewZustand(`${abschnitt}\n\nText.\n`, [], stufe), "offen");
  });

  test(`${stufe}: Review-Kommentar der Stufe -> befunde`, () => {
    const c = komm(`## ${marker}, Runde 1\n\nReviewer: fable\n\nEin Befund.`);
    assert.equal(reviewZustand(`${abschnitt}\n\nText.\n`, c, stufe), "befunde");
  });

  test(`${stufe}: gesetzter Marker der eigenen Stufe -> fertig`, () => {
    const body = `${abschnitt}\n\n${marker}: fable (2026-08-29)\n`;
    assert.equal(reviewZustand(body, [], stufe), "fertig");
  });

  test(`${stufe}: Ausfall-Vermerk in Zeile 2 -> ausgefallen, nicht befunde`, () => {
    const c = komm(`## ${marker}, Runde 1\nReviewer fable ausgefallen: nicht startbar.\n\nKeine Befunde.`);
    assert.equal(reviewZustand(`${abschnitt}\n\nText.\n`, c, stufe), "ausgefallen");
  });
}

// --- Die drei Fallen ---

test("Ein Marker der FREMDEN Stufe zaehlt nicht", () => {
  const body = "## Kontext\n\nPlan-Review: fable (2026-08-29)\n";
  assert.equal(reviewZustand(body, [], "issue"), "offen");
  assert.equal(reviewZustand(body, [], "plan"), "fertig");
});

test("Ein Review-Kommentar der FREMDEN Stufe zaehlt nicht", () => {
  const c = komm("## Plan-Review, Runde 1\n\nEin Befund.");
  assert.equal(reviewZustand("## Kontext\n\nText.\n", c, "issue"), "offen");
  assert.equal(reviewZustand("## Kontext\n\nText.\n", c, "plan"), "befunde");
});

test("Gueltiger Pruefung: Verzicht -> fertig", () => {
  const roh = "## Kontext\n\nPruefung: Verzicht\nAutor-Modell: claude-opus-5\n";
  const body = roh.replace("Autor-Modell", `Pruefung-Stand: ${pruefvorgabeStand(roh)}\nAutor-Modell`);
  assert.equal(reviewZustand(body, [], "issue"), "fertig");
});

test("Verfallener Verzicht ist nicht fertig", () => {
  const body = `## Kontext\n\nPruefung: Verzicht\nPruefung-Stand: ${"a".repeat(64)}\n`;
  assert.notEqual(reviewZustand(body, [], "issue"), "fertig");
  assert.equal(reviewZustand(body, [], "issue"), "offen");
});

test("Verzicht ohne Stand gilt weiter — ohne Bezug kein Verfall", () => {
  assert.equal(reviewZustand("## Kontext\n\nPruefung: Verzicht\n", [], "issue"), "fertig");
});

// --- Vorrang der Regeln ---

test("Marker schlaegt Befunde-Kommentar", () => {
  const c = komm("## Issue-Review, Runde 1\n\nEin Befund.");
  const body = "## Kontext\n\nIssue-Review: fable (2026-08-29)\n";
  assert.equal(reviewZustand(body, c, "issue"), "fertig");
});

test("Ein spaeterer Befunde-Kommentar schlaegt einen frueheren Ausfall", () => {
  const c = komm(
    "## Issue-Review, Runde 1\nReviewer fable ausgefallen: nicht startbar.",
    "## Issue-Review, Runde 2\n\nEin Befund."
  );
  assert.equal(reviewZustand("## Kontext\n\nText.\n", c, "issue"), "befunde");
});

// --- Alt-Bestand und Robustheit ---

test("Ein Kommentar ohne Stufen-Anker aendert nichts (Alt-Bestand)", () => {
  const c = komm("Reviewer ausgefallen: nicht startbar.", "Irgendein Kommentar.");
  assert.equal(reviewZustand("## Kontext\n\nText.\n", c, "issue"), "offen");
});

test("Fehlende oder leere Eingaben ergeben offen, ohne zu werfen", () => {
  assert.equal(reviewZustand("", [], "issue"), "offen");
  assert.equal(reviewZustand(undefined, undefined, "issue"), "offen");
  assert.equal(reviewZustand("## Kontext\n", [{}], "issue"), "offen");
});

test("Eine unbekannte Stufe ergibt offen, ohne zu werfen", () => {
  const body = "## Kontext\n\nIssue-Review: fable (2026-08-29)\n";
  assert.equal(reviewZustand(body, [], "gibtsnicht"), "offen");
});

// Ein Marker im Codeblock ist ein Beispiel, kein Nachweis — dieselbe Fence-Regel,
// die auch die Gate-Register fuehren (Issue #308).
test("Ein Marker innerhalb eines Codeblocks zaehlt nicht", () => {
  const body = "## Kontext\n\n```\nIssue-Review: fable (2026-08-29)\n```\n";
  assert.equal(reviewZustand(body, [], "issue"), "offen");
});

test("reviewZustand schreibt nicht — dieselbe Eingabe bleibt unveraendert", () => {
  const body = "## Kontext\n\nText.\n";
  const c = komm("## Issue-Review, Runde 1\n\nBefund.");
  const kopie = JSON.parse(JSON.stringify(c));
  reviewZustand(body, c, "issue");
  assert.equal(body, "## Kontext\n\nText.\n");
  assert.deepEqual(c, kopie);
});
