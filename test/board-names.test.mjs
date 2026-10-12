// Ablauf-Pruefung: `board.mjs names` liest die Projektsprache aus der Config, das zeigt nur der
// gestartete Einstieg (Issue #1558, Plan #1548, Entscheidung „Feste Zeilen der Skills über ein
// Kommando“). Die Skills sind einsprachig deutsch und nennen ihre festen Zeilen deutsch; das
// Kommando gibt je deutscher Zeile die Fassung der Projektsprache aus, aus den Registern MARKER
// und UEBERSCHRIFTEN. Die Fundblock-Zeilen stehen seit E19 in MARKER und damit in der Ausgabe.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";
import { MARKER, UEBERSCHRIFTEN } from "../kit/board/namen.mjs";

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

/** Ruft `names` in einem frischen Projekt mit der Config `config` auf. */
function names(config) {
  const dir = setupProjekt(config, "names-");
  try {
    const res = runBoard(dir, ["names"], { HOME: dir });
    assert.equal(res.status, 0, res.stderr);
    return JSON.parse(res.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("MARKER kennt die Fundblock-Zeilen mit englischer Fassung (E19)", () => {
  assert.deepEqual({ ...MARKER.gegenprobe }, { de: "Gegenprobe:", en: "Counter-check:" });
  assert.deepEqual({ ...MARKER.art }, { de: "Art:", en: "Kind:" });
  assert.deepEqual({ ...MARKER.geprueftBestaetigt }, { de: "— geprueft, bestaetigt", en: "— checked, confirmed" });
});

test("names im deutschen Projekt: jede Zeile bleibt deutsch", () => {
  const aus = names(LOKAL);
  assert.deepEqual(Object.keys(aus), ["language", "lines"]);
  assert.equal(aus.language, "de");
  assert.equal(aus.lines["## Ziel"], "## Ziel");
  for (const [de, fassung] of Object.entries(aus.lines)) assert.equal(fassung, de);
});

test("names im englischen Projekt: Überschriften und Marker englisch", () => {
  const aus = names({ ...LOKAL, language: "en" });
  assert.equal(aus.language, "en");
  assert.equal(aus.lines["## Ziel"], "## Goal");
  assert.equal(aus.lines["## Akzeptanzkriterium"], "## Acceptance criteria");
  assert.equal(aus.lines["## Einarbeitung, Runde"], "## Incorporation, Round");
  assert.equal(aus.lines["Gegenprobe:"], "Counter-check:");
  assert.equal(aus.lines["Art:"], "Kind:");
  assert.equal(aus.lines["— geprueft, bestaetigt"], "— checked, confirmed");
});

test("names nennt jeden Eintrag aus MARKER und UEBERSCHRIFTEN", () => {
  const { lines } = names({ ...LOKAL, language: "en" });
  for (const { de, en } of Object.values(MARKER)) assert.equal(lines[de], en, de);
  for (const { de, en } of Object.values(UEBERSCHRIFTEN)) assert.equal(lines[`## ${de}`], `## ${en}`, de);
});

// Die festen Zeilen der Skills, die das Register bis Issue #1568 nicht kannte: Kopf des
// Abschlussberichts und der roten Tests, Code-Review- und Reviewer-Kopf, die Zeilen der
// Vorgeschichte, der Uebernahme- und der Angabenvermerk im Fundblock und die Abschnitte des
// Tageslogs aus /document.
test("MARKER und UEBERSCHRIFTEN kennen die festen Zeilen der Skills (Issue #1568)", () => {
  const erwartet = {
    abschlussbericht: ["## Abschlussbericht Issue #", "## Completion report issue #"],
    testsGeschrieben: ["### Tests geschrieben (rot) — Issue #", "### Tests written (red) — issue #"],
    codeReview: ["## Code-Review (Schritt 7)", "## Code review (step 7)"],
    reviewer: ["### Reviewer", "### Reviewer"],
    suchbegriffe: ["Suchbegriffe:", "Search terms:"],
    dateien: ["Dateien:", "Files:"],
    uebernommen: ["Uebernahme: uebernommen", "Adoption: adopted"],
    abgelehnt: ["Uebernahme: abgelehnt", "Adoption: rejected"],
    unvollstaendig: ["Angaben: unvollstaendig", "Details: incomplete"],
  };
  for (const [sache, [de, en]] of Object.entries(erwartet)) assert.deepEqual({ ...MARKER[sache] }, { de, en }, sache);
  assert.deepEqual({ ...UEBERSCHRIFTEN.einstieg }, { de: "Einstieg", en: "Start" });
  assert.deepEqual({ ...UEBERSCHRIFTEN.offenePunkte }, { de: "Offene Punkte", en: "Open points" });
  assert.deepEqual({ ...UEBERSCHRIFTEN.zuletztAktualisiert }, { de: "Zuletzt aktualisiert", en: "Last updated" });
});
