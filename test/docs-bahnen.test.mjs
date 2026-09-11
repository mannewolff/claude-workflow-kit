// Die dritte Bahn in Vorlage und Doku (Issue #574, Plan #562).
//
// Zwischen Kleinigkeit und vollem Vorhaben fehlte ein Weg. Mit `[Task]` sind es drei
// Bahnen — und der Abschnitt heisst in BEIDEN Dateien gleich. Zwei Namen fuer denselben
// Abschnitt waeren zwei Wahrheiten darueber, wie viele Bahnen es gibt; genau daran
// erkennt eine spaetere Sitzung nicht mehr, welche der beiden Dateien fuehrt.
//
// Geprueft wird deshalb beides: dass die Ueberschrift `## Drei Bahnen` in beiden Dateien
// als eigene ZEILE steht (nicht irgendwo im Fliesstext), und dass die alte Zaehlung
// nirgends mehr steht. Der zweite Teil ist der wichtigere: Eine ergaenzte Ueberschrift
// neben einem stehengebliebenen "Zwei Bahnen" waere schlimmer als gar keine Aenderung.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...teile) => readFileSync(join(repoRoot, ...teile), "utf-8");

const DATEIEN = [
  ["templates", "CLAUDE-workflow.md"],
  ["docs", "dokumentation.md"],
];

for (const teile of DATEIEN) {
  const pfad = teile.join("/");

  test(`[skills-7] ${pfad} traegt die Ueberschriftszeile '## Drei Bahnen'`, () => {
    const zeilen = lies(...teile).split("\n");
    assert.ok(
      zeilen.includes("## Drei Bahnen"),
      `${pfad}: keine Zeile lautet genau '## Drei Bahnen'`,
    );
  });

  test(`[skills-7] ${pfad} nennt die alte Zaehlung nirgends mehr`, () => {
    const text = lies(...teile);
    assert.doesNotMatch(
      text,
      /Zwei Bahnen|Zwei-Bahnen/,
      `${pfad}: die alte Zaehlung steht noch da — neben der neuen Ueberschrift sind das zwei Wahrheiten`,
    );
  });
}
