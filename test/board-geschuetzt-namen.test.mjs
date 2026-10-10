// Freigaberechte unter beiden Labelnamen (Issue #1424, Plan #1420 E3 und E8, Kriterium 4 der
// fachlichen Quelle #1416).
//
// `kit:geschuetzt`, `kit:klaeren` und `review:fertig` tragen Freigaberechte: Nur ein Mensch
// gibt eine geschuetzte Karte frei, ein Klaerhalt haelt den Nachtlauf an, und nur eine
// gepruefte Karte darf in die Kette. Kommt der englische Name dazu, muss jede Pruefung beide
// erkennen — sonst gibt ein Mensch unter `kit:protected` etwas frei, das das Kit nicht sieht,
// oder das Kit uebersieht einen Halt (E8).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GESCHUETZTE_PFADE, GESCHUETZT_ANKER, GESCHUETZT_LABEL, GESCHUETZT_LABEL_GESETZT, KLAEREN_LABEL, geschuetztFreigabe,
} from "../kit/board/geschuetzt.mjs";
import {
  GESCHUETZT_LABEL_GATE_TEXT, KLAEREN_LABEL as NACHT_KLAEREN_LABEL, GESCHUETZT_LABEL as NACHT_GESCHUETZT_LABEL,
  hatGeschuetztLabel, hatKlaerenLabel, pruefeIssueGates,
} from "../kit/night/wartend.mjs";
import { hatReviewFertigLabel } from "../kit/night/kette.mjs";

const PFAD = GESCHUETZTE_PFADE[0];
const TREFFER = [{ pfad: PFAD, zeile: `In \`${PFAD}\` den Eintrag ergaenzen.` }];

/** Der Halt-Kommentar mit der gegebenen Label-Zeile, wie ihn Runner oder Session schreiben. */
const haltKommentar = (labelZeile) => ({
  body: `${GESCHUETZT_ANKER}\n\nText.\n\n- \`${PFAD}\`\n  > ${TREFFER[0].zeile}\n\n${labelZeile}`,
});

// --- Die Namen kommen aus dem Register ---

test("Geschrieben wird weiter der deutsche Name; night und board fuehren dieselben Konstanten", () => {
  assert.equal(GESCHUETZT_LABEL, "kit:geschuetzt");
  assert.equal(KLAEREN_LABEL, "kit:klaeren");
  assert.equal(GESCHUETZT_LABEL_GESETZT, "Label kit:geschuetzt gesetzt");
  assert.equal(NACHT_GESCHUETZT_LABEL, GESCHUETZT_LABEL);
  assert.equal(NACHT_KLAEREN_LABEL, KLAEREN_LABEL);
});

// --- Freigabezeile ---

test("Freigabezeile: `Label kit:protected gesetzt` gibt frei wie `Label kit:geschuetzt gesetzt`", () => {
  assert.equal(geschuetztFreigabe(TREFFER, [haltKommentar("Label kit:geschuetzt gesetzt")], []), true);
  assert.equal(geschuetztFreigabe(TREFFER, [haltKommentar("Label kit:protected gesetzt")], []), true);
});

test("Freigabezeile: `nicht gesetzt` gibt unter keinem der beiden Namen frei", () => {
  for (const zeile of ["Label kit:geschuetzt nicht gesetzt", "Label kit:protected nicht gesetzt"]) {
    assert.equal(geschuetztFreigabe(TREFFER, [haltKommentar(zeile)], []), false, zeile);
  }
  // Steht neben der Freigabezeile die andere Sprache mit `nicht gesetzt`, gilt der Vorbehalt.
  const gemischt = haltKommentar("Label kit:geschuetzt gesetzt\nLabel kit:protected nicht gesetzt");
  assert.equal(geschuetztFreigabe(TREFFER, [gemischt], []), false);
});

test("Freigabe: haengt das Label unter einem der beiden Namen noch, ist nichts freigegeben", () => {
  for (const label of ["kit:geschuetzt", "kit:protected"]) {
    assert.equal(geschuetztFreigabe(TREFFER, [haltKommentar(GESCHUETZT_LABEL_GESETZT)], [label]), false, label);
  }
});

test("Freigabezeile: ein fremder Labelname gibt nicht frei", () => {
  assert.equal(geschuetztFreigabe(TREFFER, [haltKommentar("Label kit:geschützt gesetzt")], []), false);
});

// --- Klaerhalt, geschuetzte Karte, gepruefte Karte ---

test("Klaerhalt: eine Karte mit kit:clarify gilt wie eine mit kit:klaeren", () => {
  for (const label of ["kit:klaeren", "kit:clarify"]) {
    assert.equal(hatKlaerenLabel({ labels: [label] }), true, label);
    const gate = pruefeIssueGates({ id: "7", title: "Paket", labels: [label] });
    assert.match(gate.kommentar, /eine offene Entscheidung wartet/, label);
    assert.equal(gate.grundArt, "klaeren", `${label}: der Melder liest die Art, nicht den Text (Issue #1426)`);
  }
  assert.equal(hatKlaerenLabel({ labels: ["kit:geschuetzt", "kit:protected"] }), false);
  assert.equal(hatKlaerenLabel({}), false);
});

test("Geschuetzt: eine Karte mit kit:protected gilt wie eine mit kit:geschuetzt", () => {
  for (const label of ["kit:geschuetzt", "kit:protected"]) {
    assert.equal(hatGeschuetztLabel({ labels: [label] }), true, label);
    const gate = pruefeIssueGates({ id: "7", title: "Paket", labels: [label] });
    assert.equal(gate.kommentar, GESCHUETZT_LABEL_GATE_TEXT, label);
  }
  assert.equal(hatGeschuetztLabel({ labels: ["kit:klaeren", "kit:clarify"] }), false);
});

test("Geprueft: eine Karte mit review:done gilt wie eine mit review:fertig", () => {
  assert.equal(hatReviewFertigLabel({ labels: ["review:fertig"] }), true);
  assert.equal(hatReviewFertigLabel({ labels: ["review:done"] }), true);
  assert.equal(hatReviewFertigLabel({ labels: ["kit:geschuetzt"] }), false);
  assert.equal(hatReviewFertigLabel({}), false);
});
