// Der Nachbau `waehleReviewer` in kit/einstellungen.mjs gegen das Original
// `pickReviewers` in kit/board.mjs (Issue #722, Plan #721 E3).
//
// Die Oberfläche wird als einzelne Datei ausgeliefert und hat keine Nachbardatei, aus der
// sie importieren könnte — sie muss die Regel deshalb tragen. Gleich gehalten werden die
// beiden Fassungen über einen `SYNC:`-Kommentar auf beiden Seiten und diesen Test, der
// sie an denselben Fällen gegeneinander hält: dieselbe Auswahl, dieselbe Reihenfolge,
// dieselbe `quelle`, dasselbe `unterbesetzt`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { pickReviewers } from "../kit/board.mjs";
import { waehleReviewer } from "../kit/einstellungen.mjs";

const REVIEWER = [
  { name: "opus", kind: "claude", model: "claude-opus-5" },
  { name: "fable", kind: "claude", model: "claude-fable-5.1" },
  { name: "sonnet", kind: "claude", model: "claude-sonnet-5" },
  { name: "gpt-sol", kind: "command", command: "gpt" },
];

// Je Fall: Name, Reviewer-Liste, Autor, Anzahl, pairs.
const FAELLE = [
  ["ohne Eintrag in pairs wählt die Regel die vordersten", REVIEWER, "opus", 2, {}],
  ["ein Eintrag in pairs schlägt die Regel", REVIEWER, "opus", 2, { opus: ["gpt-sol", "fable"] }],
  ["pairs wird auf die Anzahl gekürzt", REVIEWER, "opus", 1, { opus: ["gpt-sol", "fable"] }],
  ["der Autor als volle Modell-ID wird aufgelöst", REVIEWER, "claude-opus-5", 2, { opus: ["gpt-sol"] }],
  ["ein Autor, der sich selbst nennt, fällt aus seiner eigenen Liste", REVIEWER, "opus", 2, { opus: ["opus", "fable"] }],
  ["zu wenige Prüfer melden unterbesetzt", [REVIEWER[0], REVIEWER[1]], "opus", 2, {}],
  ["eine leere Reviewer-Liste meldet unterbesetzt", [], "opus", 2, {}],
  ["ohne Autor bleibt die volle Liste", REVIEWER, undefined, 2, {}],
  ["ein pairs-Eintrag mit unbekanntem Namen fällt weg", REVIEWER, "opus", 2, { opus: ["erfunden", "fable"] }],
  ["ein leerer pairs-Eintrag fällt auf die Regel zurück", REVIEWER, "opus", 2, { opus: [] }],
  ["ein pairs-Eintrag, der keine Liste ist, fällt auf die Regel zurück", REVIEWER, "opus", 2, { opus: "fable" }],
  ["ein fremder Autor, der zu keinem Reviewer passt", REVIEWER, "mensch", 2, {}],
];

for (const [name, alle, autor, anzahl, pairs] of FAELLE) {
  test(`[einstellungen-13] waehleReviewer gleicht pickReviewers: ${name}`, () => {
    const erwartet = pickReviewers(alle, autor, anzahl, pairs);
    const ist = waehleReviewer(alle, autor, anzahl, pairs);
    assert.deepEqual(ist.gewaehlt.map((r) => r.name), erwartet.gewaehlt.map((r) => r.name), "Auswahl und Reihenfolge");
    assert.equal(ist.unterbesetzt, erwartet.unterbesetzt, "unterbesetzt");
    assert.equal(ist.quelle, erwartet.quelle, "quelle");
    assert.equal(ist.autorAufgeloest, erwartet.autorAufgeloest, "autorAufgeloest");
  });
}

test("[einstellungen-13] waehleReviewer kommt ohne anzahl und ohne pairs aus wie pickReviewers", () => {
  assert.deepEqual(waehleReviewer(REVIEWER, "opus"), pickReviewers(REVIEWER, "opus"));
  assert.deepEqual(waehleReviewer(undefined, "opus", 2, undefined), pickReviewers(undefined, "opus", 2, undefined));
});

test("[einstellungen-13] waehleReviewer ändert die übergebene Liste nicht", () => {
  const eingabe = REVIEWER.map((r) => ({ ...r }));
  waehleReviewer(eingabe, "opus", 2, { opus: ["fable"] });
  assert.deepEqual(eingabe, REVIEWER);
});
