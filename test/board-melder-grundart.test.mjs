// Der Melder ordnet den Grund eines Laufs allein ueber das strukturierte Feld `grundArt`
// ein (Issue #1426, Plan #1420, E14). Der Freitext `grund` wird uebersetzt; liest der
// Melder ihn, faellt jede Einordnung aus, sobald der Grund englisch geschrieben wird.

import { test } from "node:test";
import assert from "node:assert/strict";

import { nachtlaufMeldung } from "../kit/board/melder.mjs";

const JETZT = new Date("2026-09-16T10:10:00.000Z");

function stand(art, einheiten) {
  return { schemaFassung: 1, start: "2026-09-16T10:00:00.000Z", art, einheiten, abschluss: "regulaer", complete: true };
}

const farbe = (art, einheit) => {
  const item = nachtlaufMeldung(stand(art, [einheit]), JETZT).items[0];
  return [item.state, item.errorClass];
};

// Englischer, leerer und fehlender Text: Keiner darf an der Einordnung etwas aendern.
const TEXTE = ["Dependency #3 not met", "", undefined, "Waiting on kit:klaeren and Zeitbudget "];

const mitText = (einheit, grund) => (grund === undefined ? einheit : { ...einheit, grund });

test("[1426] zurueckgestellt: abhaengigkeit, klaeren, ohneInReview und sonst allein aus grundArt", () => {
  const faelle = [
    ["abhaengigkeit", ["GREY", "DEPENDENCY_UNMET"]],
    ["klaeren", ["RED", "AWAITING_DECISION"]],
    ["ohneInReview", ["RED", "UNEXPECTED_STATE"]],
    ["sonst", ["GREY", null]],
  ];
  for (const [grundArt, erwartet] of faelle) {
    for (const text of TEXTE) {
      const e = mitText({ id: "7", titel: "T", ausgang: "zurueckgestellt", grundArt }, text);
      assert.deepEqual(farbe("implementierung", e), erwartet, `${grundArt} mit Grund ${JSON.stringify(text)}`);
    }
  }
});

test("[1426] abgebrochen: zeitbudget allein aus grundArt, mit und ohne Dokument", () => {
  for (const text of TEXTE) {
    const mitPlan = mitText({ id: "5", titel: "F", ausgang: "abgebrochen", grundArt: "zeitbudget", stufen: { plan: { id: "12" } } }, text);
    const ohne = mitText({ id: "5", titel: "F", ausgang: "abgebrochen", grundArt: "zeitbudget", stufen: { plan: { id: null } } }, text);
    assert.deepEqual(farbe("kette", mitPlan), ["YELLOW", "TIME_BUDGET_EXCEEDED"], `mit Plan, Grund ${JSON.stringify(text)}`);
    assert.deepEqual(farbe("kette", ohne), ["RED", "TIME_BUDGET_EXCEEDED"], `ohne Dokument, Grund ${JSON.stringify(text)}`);
    const sonst = mitText({ id: "5", titel: "F", ausgang: "abgebrochen", grundArt: "sonst" }, text);
    assert.deepEqual(farbe("kette", sonst), ["RED", "HARD_ABORT"], `sonst, Grund ${JSON.stringify(text)}`);
  }
});

test("[1426] ohne grundArt (alter Lauf) gilt sonst, auch wenn der Text einen der vier Faelle nennt", () => {
  const alt = (ausgang, grund) => ({ id: "7", titel: "T", ausgang, grund });
  assert.deepEqual(farbe("implementierung", alt("zurueckgestellt", "Nachtlauf: Abhaengigkeit #3 nicht erfuellt")), ["GREY", null]);
  assert.deepEqual(farbe("implementierung", alt("zurueckgestellt", "Nachtlauf: Traegt kit:klaeren")), ["GREY", null]);
  assert.deepEqual(farbe("implementierung", alt("zurueckgestellt", "Session ohne In-review-Ergebnis beendet")), ["GREY", null]);
  assert.deepEqual(farbe("kette", alt("abgebrochen", "Zeitbudget plan erschoepft")), ["RED", "HARD_ABORT"]);
});
