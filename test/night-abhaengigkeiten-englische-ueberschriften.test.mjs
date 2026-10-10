// Der Nachtlauf liest die Formatueberschriften unter beiden Namen (Issue #1460, Plan #1420 E15):
// Abhaengigkeiten unter `## Dependencies` und die Stopp-Fragen-Abschnitte eines englischen Plans
// und Fachplans. Ausgegliedert aus test/board-testhinweise-englische-ueberschriften.test.mjs,
// damit jede Datei nur aus dem Teil ihres Bereichs laedt (test/config-teile.test.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";

import { abhaengigkeitenLesen } from "../kit/board/dokumente.mjs";
import { OFFENE_FRAGEN_UEBERSCHRIFT, PO_FRAGEN_UEBERSCHRIFT, abschnittLesen, parseDeps, wartetAufPush } from "../kit/night/abhaengigkeiten.mjs";

const PAKET_DE = "## Kontext\nAutor-Modell: claude-opus-5-5\n\n## Aufgabe\n1. `kit/x.mjs` aendern.\n\n"
  + "## Akzeptanzkriterium\n- `node --test test/x.test.mjs` ist gruen.\n\n## Abhaengigkeiten\nIssue #7\n";
const PLAN_EN = "Plan-Model: claude-opus-5-5\n\n## Goal\nGoal.\n\n## Affected areas\n- `kit/x.mjs`\n\n"
  + "## Architectural decisions\n- Keine.\n\n## Planned changes\n- `kit/x.mjs`\n\n"
  + "## Open questions\n- Keine.\n\n## Verification\n- Tests.\n";
const FACHPLAN_EN = "## Goal\nGoal.\n\nAuthor-Model: claude-opus-5-5\n\n## Business acceptance criteria\n1. One.\n\n"
  + "## Non-goals\n- Nothing.\n\n## Open questions for the PO\nKeine.\n";

// --- Nachtlauf: Abhaengigkeiten und Pflichtabschnitte ---

test("Nachtlauf: parseDeps, wartetAufPush und abhaengigkeitenLesen lesen ## Dependencies", () => {
  const body = "## Context\nx\n\n## Dependencies\nIssue #12 (wartet auf Push)\nIssue #13\n";
  assert.deepEqual(parseDeps(body), [12, 13]);
  assert.deepEqual(wartetAufPush(body), [12]);
  assert.deepEqual(abhaengigkeitenLesen(body), [12, 13]);
  assert.deepEqual(parseDeps(PAKET_DE), [7]);
});

test("Nachtlauf: die Stopp-Fragen-Abschnitte unter beiden Namen", () => {
  assert.deepEqual(abschnittLesen(PLAN_EN, OFFENE_FRAGEN_UEBERSCHRIFT)?.zeilen.filter(Boolean), ["- Keine."]);
  assert.deepEqual(abschnittLesen(FACHPLAN_EN, PO_FRAGEN_UEBERSCHRIFT)?.zeilen.filter(Boolean), ["Keine."]);
  assert.equal(abschnittLesen(FACHPLAN_EN, OFFENE_FRAGEN_UEBERSCHRIFT), null);
});
