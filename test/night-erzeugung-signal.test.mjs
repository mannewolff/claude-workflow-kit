// Das Erfolgssignal einer erzeugenden Session (Issue #520, seit Plan #638 fuer die
// Nacht-Kette): Eine Session legt NEUE Karten an, und der Runner muss wissen, welche.
// Naheliegend waere `derivedFrom`, das aber nur der toolbox-Adapter auswertet. Die
// Zeilen `Fachliche Quelle: Issue #N` und `Plan: Issue #M` stehen im Body und tragen
// bei jedem Tracker. Hier die reine Funktion an Fixtures; der Lauf gegen den lokalen
// Tracker gehoert zu den Kette-Tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { stammtAusErzeugung } from "../kit/night.mjs";

// --- Die reine Funktion: stammtAusErzeugung ---

const planDoku = (body) => ({ id: "0002", title: "[Plan] Ein Weg", body });
const arbeitspaket = (body) => ({ id: "0002", title: "night.mjs: Ein Paket", body });

test("stammtAusErzeugung: ein [Plan] mit der Herkunftszeile der Quelle zaehlt bei --stufe plan", () => {
  assert.equal(stammtAusErzeugung(planDoku("## Kontext\n\nFachliche Quelle: Issue #408\n"), "408", "plan"), true);
});

test("stammtAusErzeugung: ein Arbeitspaket mit 'Plan: Issue #M' zaehlt bei --stufe issue", () => {
  assert.equal(stammtAusErzeugung(arbeitspaket("## Kontext\n\nPlan: Issue #513\n"), "513", "issue"), true);
});

test("stammtAusErzeugung: #40 trifft #408 nicht", () => {
  // Der Fund aus dem Issue-Review: Ohne Zeilenende hinter der Nummer verbuchte ein Lauf
  // zu Quelle #40 jedes Dokument aus #408 als sein eigenes Ergebnis.
  const doku = planDoku("## Kontext\n\nFachliche Quelle: Issue #408\n");
  assert.equal(stammtAusErzeugung(doku, "40", "plan"), false);
  assert.equal(stammtAusErzeugung(doku, "4080", "plan"), false);
});

test("stammtAusErzeugung: die Herkunftszeile muss eine ganze Zeile sein", () => {
  // Fettung oder Fliesstext sind keine Herkunftszeile — sonst zaehlte jede Erwaehnung.
  assert.equal(stammtAusErzeugung(planDoku("Er nennt **Fachliche Quelle: Issue #408** im Text.\n"), "408", "plan"), false);
  assert.equal(stammtAusErzeugung(planDoku("Siehe Fachliche Quelle: Issue #408\n"), "408", "plan"), false);
});

test("stammtAusErzeugung: bei --stufe plan zaehlt nur ein [Plan]-Dokument", () => {
  // Der gewichtigste Fund des Reviews: `Fachliche Quelle: Issue #N` steht auch in jedem
  // Arbeitspaket. Ohne die Praefix-Bedingung unterdrueckten Pakete eines frueheren Laufs
  // die Plan-Session, und das "vorhandene Dokument" waere ein Arbeitspaket.
  const body = "## Kontext\n\nFachliche Quelle: Issue #408\n";
  assert.equal(stammtAusErzeugung(arbeitspaket(body), "408", "plan"), false);
  assert.equal(stammtAusErzeugung({ id: "0003", title: "[Fachlich] Eine Story", body }, "408", "plan"), false);
});

test("stammtAusErzeugung: bei --stufe issue zaehlt kein [Plan], [Fachlich] oder [Idee]", () => {
  const body = "## Kontext\n\nPlan: Issue #513\n";
  for (const titel of ["[Plan] Ein Weg", "[Fachlich] Eine Story", "[Idee] Ein Einfall"]) {
    assert.equal(stammtAusErzeugung({ id: "0002", title: titel, body }, "513", "issue"), false, titel);
  }
});

test("stammtAusErzeugung: die Herkunftszeile der anderen Stufe zaehlt nicht", () => {
  // Ein Arbeitspaket traegt beide Zeilen. Bei --stufe issue ist `Plan:` massgeblich; die
  // fachliche Quelle daneben gehoert zum Plan, nicht zu diesem Lauf.
  const beide = arbeitspaket("## Kontext\n\nPlan: Issue #513\nFachliche Quelle: Issue #408\n");
  assert.equal(stammtAusErzeugung(beide, "408", "issue"), false);
  assert.equal(stammtAusErzeugung(beide, "513", "issue"), true);
});

test("stammtAusErzeugung: eine unbekannte Stufe zaehlt nichts", () => {
  assert.equal(stammtAusErzeugung(planDoku("Fachliche Quelle: Issue #408\n"), "408", "fachlich"), false);
  assert.equal(stammtAusErzeugung(planDoku("Fachliche Quelle: Issue #408\n"), "408", "constructor"), false);
});
