// Die Sperre der Nacht-Kette gegen fachliche Anforderungen mit offenen Fragen (Issue #916).
//
// `review:fertig` bezeugt die Pruefung durch fremde Modelle; es sagt nichts darueber, ob
// der PO seine Fragen beantwortet hat. `offeneFragenGrund` liest den Abschnitt
// `## Offene Fragen an den PO` und sagt, ob dort noch etwas offen ist; `kettenAusschluss`
// haelt die Karte dann zurueck, hinter der Pruefsperre.
//
// Anders als beim Plandokument ist ein FEHLENDER Abschnitt hier kein Ausschluss: Das
// Format der fachlichen Anforderung prueft Gate F7 in board.mjs, und die Kette soll die
// Karte nicht ein zweites Mal daran messen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { offeneFragenGrund, waehleKettenKandidaten, UNGEPRUEFT_PRAEFIX, REVIEW_FERTIG_LABEL } from "../kit/night.mjs";

// Der Code-Fence als Konstante: In einem Template-Literal waeren drei Backticks nicht
// schreibbar, und die Fixtures sollen als Zeilenlisten lesbar bleiben.
const F = "```";

const ZIEL = ["## Ziel", "", "Die Kette nimmt keine Anforderung mit offenen Fragen auf.", ""];
const SCHLUSS = ["## Nicht-Ziele", "", "- Plandokumente.", ""];

const zusammen = (...teile) => teile.flat().join("\n");

test("offeneFragenGrund: ein fehlender Abschnitt laesst die Anforderung laufen", () => {
  assert.equal(offeneFragenGrund(zusammen(ZIEL, SCHLUSS)), null);
});

test("offeneFragenGrund: ein leerer Abschnitt laesst die Anforderung laufen", () => {
  assert.equal(offeneFragenGrund(zusammen(ZIEL, ["## Offene Fragen an den PO", ""], SCHLUSS)), null);
});

test("offeneFragenGrund: 'Keine.' als Fliesstext mit Zusatz dahinter ist keine offene Frage", () => {
  const abschnitt = ["## Offene Fragen an den PO", "",
    "Keine. Die vier Fragen der bisherigen Fassungen hat der PO entschieden.", ""];
  assert.equal(offeneFragenGrund(zusammen(ZIEL, abschnitt, SCHLUSS)), null);
});

test("offeneFragenGrund: '- Keine.' als Listenzeile ist keine offene Frage", () => {
  assert.equal(offeneFragenGrund(zusammen(ZIEL, ["## Offene Fragen an den PO", "", "- Keine.", ""], SCHLUSS)), null);
});

test("offeneFragenGrund: eine nummerierte Frage steht als Zitat im Grund", () => {
  const abschnitt = ["## Offene Fragen an den PO", "", "1. Soll der Lauf das Label abnehmen?", "2. Und danach?", ""];
  assert.equal(offeneFragenGrund(zusammen(ZIEL, abschnitt, SCHLUSS)),
    "offene Frage an den PO: 1. Soll der Lauf das Label abnehmen?");
});

test("offeneFragenGrund: eine Frage nur innerhalb eines Codeblocks laesst die Anforderung laufen", () => {
  const abschnitt = ["## Offene Fragen an den PO", "", F, "1. Soll der Lauf das Label abnehmen?", F, ""];
  assert.equal(offeneFragenGrund(zusammen(ZIEL, abschnitt, SCHLUSS)), null);
});

test("offeneFragenGrund: der Grund kuerzt eine lange Frage auf 120 Zeichen", () => {
  const abschnitt = ["## Offene Fragen an den PO", "", `1. ${"x".repeat(300)}`, ""];
  const grund = offeneFragenGrund(zusammen(ZIEL, abschnitt, SCHLUSS));
  assert.ok(grund.startsWith("offene Frage an den PO: "));
  assert.ok(grund.length <= "offene Frage an den PO: ".length + 121, `zu lang: ${grund.length}`);
});

test("[night-916] eine gepruefte Anforderung mit offener Frage geht mit Grund in uebersprungen", () => {
  const offen = zusammen(ZIEL, ["## Offene Fragen an den PO", "", "1. Wer nimmt das Label ab?", ""], SCHLUSS);
  const beantwortet = zusammen(ZIEL, ["## Offene Fragen an den PO", "", "Keine.", ""], SCHLUSS);
  const karten = [
    { id: "1", title: "[Fachlich] Beantwortet", status: "backlog", labels: ["kit:night", REVIEW_FERTIG_LABEL], body: beantwortet },
    { id: "2", title: "[Fachlich] Offen", status: "backlog", labels: ["kit:night", REVIEW_FERTIG_LABEL], body: offen },
  ];
  const r = waehleKettenKandidaten(karten, "kit:night", 5);
  assert.deepEqual(r.kandidaten.map((a) => a.karte.id), ["1"], "die beantwortete Karte laeuft, die offene nicht");
  assert.deepEqual(r.uebersprungen.map((u) => u.id), ["2"]);
  const grund = r.uebersprungen[0].grund;
  assert.match(grund, /^offene Frage an den PO: 1\. Wer nimmt das Label ab\?/);
  assert.match(grund, /Offene Fragen an den PO/);
  assert.match(grund, /Keine/);
});

test("[night-916] die fehlende Pruefung gewinnt ueber die offene Frage", () => {
  const offen = zusammen(ZIEL, ["## Offene Fragen an den PO", "", "1. Wer nimmt das Label ab?", ""], SCHLUSS);
  const karten = [{ id: "3", title: "[Fachlich] Ungeprueft", status: "backlog", labels: ["kit:night"], body: offen }];
  const r = waehleKettenKandidaten(karten, "kit:night", 5);
  assert.equal(r.kandidaten.length, 0);
  const grund = r.uebersprungen[0].grund;
  assert.ok(grund.startsWith(UNGEPRUEFT_PRAEFIX), `nicht der Pruefgrund: ${grund}`);
});
