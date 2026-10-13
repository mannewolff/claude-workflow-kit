// Szenarien-Pruefung und Stichtag-Hinweis sind in pruefeForm zwei Schalter (Issue #1606).
//
// Vorher trug ein Parameter `szenarien` drei Werte (true, false, "ohne-stichtag"); Sonar las aus
// dem Vorgabewert einen reinen Boolean und hielt den Vergleich mit "ohne-stichtag" fuer immer
// falsch (javascript:S3403). Jetzt sagt `szenarien`, ob Gate F12 prueft, und `stichtagHinweis`,
// ob der Hinweis `szenarien-stichtag` kommt — beide Booleans.

import { test } from "node:test";
import assert from "node:assert/strict";

import { pruefeForm } from "../kit/board/testhinweise.mjs";

const FACHPLAN = `## Ziel
Wer plant, sieht etwas Neues.

Autor-Modell: fixture-modell

## Fachliche Akzeptanzkriterien
1. Der Mensch sieht es.

## Nicht-Ziele
- Nichts anderes.

## Offene Fragen an den PO
Keine.
`;

const PLAN = `Plan-Modell: fixture-modell
Fachliche Quelle: Issue #1

## Ziel
Etwas bauen.

## Betroffene Bereiche
- Navigation

## Geplante Aenderungen
- Nichts Genanntes

## Architektonische Entscheidungen
- Keine.

## Offene Fragen
- Keine.

## Verifizierung
- node --test
`;

const PAKET = `## Kontext
Ein Paket.

Autor-Modell: fixture-modell

## Aufgabe
- \`src/app.mjs\` aendern.

## Akzeptanzkriterium
- \`node --test\` ist gruen.

## Abhängigkeiten
Keine.
`;

const stichtag = (ergebnis) => (ergebnis.hinweise ?? []).filter((h) => h.art === "szenarien-stichtag");

test("[board-1606] stichtagHinweis an einem Fachplan meldet den Hinweis und keinen Verstoss", () => {
  const ergebnis = pruefeForm(FACHPLAN, "[Requirement] Etwas Neues", {}, [], ".", { szenarien: false, stichtagHinweis: true });
  assert.equal(stichtag(ergebnis).length, 1);
  assert.deepEqual(ergebnis.verstoesse.filter((v) => v.gate === "F12"), []);
});

test("[board-1606] ohne beide Schalter kein Hinweis szenarien-stichtag", () => {
  const ergebnis = pruefeForm(FACHPLAN, "[Requirement] Etwas Neues", {}, [], ".", { szenarien: false, stichtagHinweis: false });
  assert.deepEqual(stichtag(ergebnis), []);
});

test("[board-1606] bei einem Plan oder Paket nie ein Hinweis szenarien-stichtag", () => {
  for (const [body, titel] of [[PLAN, "[Plan] Etwas bauen"], [PAKET, "Ein Paket"]]) {
    const ergebnis = pruefeForm(body, titel, {}, [], ".", { stichtagHinweis: true });
    assert.deepEqual(stichtag(ergebnis), [], `${titel} meldet den Stichtag-Hinweis`);
  }
});
