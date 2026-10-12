// Vorlage und Dokumentation beschreiben kit:protected, das Gate vor dem Start, den Halt an
// einer geschuetzten Datei und die Formgates I7 bis I9 (Issue #1055, Plan #987, Verifizierung
// 13; fachliche Quelle #868).
//
// Ohne diese Texte findet ein Mensch am Board ein Label, das nirgends erklaert ist, und weiss
// nicht, dass er es je Board einmal anlegen muss. Label und Anker kommen aus den Konstanten
// des Runners, nicht als Literal: Eine Abschrift bliebe gruen, waehrend Runner und Text
// auseinanderliefen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { GESCHUETZT_ANKER } from "../kit/night/wartend.mjs";
import { LABELS } from "../kit/board/namen.mjs";

// Das Kit schreibt das Label seit Issue #1552 englisch; der Regeltext nennt es seit Issue
// #1571, die Doku seit Issue #1572 unter diesem Namen.
const GESCHUETZT_LABEL = LABELS.geschuetzt.en;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (pfad) => readFileSync(join(repoRoot, pfad), "utf-8");

const TEXTE = {
  "templates/CLAUDE-workflow.md": lies("templates/CLAUDE-workflow.md"),
  "docs/dokumentation.md": lies("docs/dokumentation.md"),
};
// Je Text die Sprache, in der er die Labels nennt.
const SPRACHE = { "templates/CLAUDE-workflow.md": "en", "docs/dokumentation.md": "en" };

for (const [name, text] of Object.entries(TEXTE)) {
  const label = LABELS.geschuetzt[SPRACHE[name]];
  const klaeren = LABELS.klaeren[SPRACHE[name]];
  test(`[docs-1055] ${name} nennt ${label} samt „je Board einmal anzulegen“ und den Anker`, () => {
    assert.ok(text.includes(`\`${label}\``), `${name}: das Label ${label} fehlt`);
    assert.match(text, /je Board einmal anzulegen/, `${name}: der Satz „je Board einmal anzulegen“ fehlt`);
    assert.ok(text.includes(GESCHUETZT_ANKER), `${name}: der Anker ${GESCHUETZT_ANKER} fehlt`);
  });

  test(`[docs-1055] ${name} sagt, dass ${label} allein der Mensch abnimmt`, () => {
    const absatz = text.split("\n").find((z) => z.includes(`\`${label}\``) && /je Board einmal anzulegen/.test(z));
    assert.ok(absatz, `${name}: kein Absatz nennt Label und „je Board einmal anzulegen“ zusammen`);
    assert.ok(absatz.includes(klaeren), `${name}: der Absatz grenzt nicht gegen ${klaeren} ab`);
    assert.match(absatz, /nur der Mensch|allein (der|ein) Mensch/, `${name}: die Abnahme durch den Menschen fehlt`);
  });
}

test("[docs-1055] die Dokumentation nennt I7, I8, I9, issue check-protected samt --path und die Halt-Art geschuetzt", () => {
  const doku = TEXTE["docs/dokumentation.md"];
  for (const gate of ["I7", "I8", "I9"]) assert.match(doku, new RegExp(`\\b${gate}\\b`), `das Formgate ${gate} fehlt`);
  assert.match(doku, /`issue check-protected <id>`/, "das Kommando issue check-protected fehlt");
  assert.match(doku, /--path/, "der Schalter --path fehlt");
  assert.match(doku, /Halt-Art „geschuetzt“|Art `geschuetzt`/, "die Halt-Art geschuetzt fehlt");
});

test("[docs-1055] die Pruefung wird rot, wenn ein Text das Label oder den Satz nicht nennt", () => {
  const ohneLabel = TEXTE["docs/dokumentation.md"].replaceAll(GESCHUETZT_LABEL, "kit:anders");
  assert.ok(!ohneLabel.includes(`\`${GESCHUETZT_LABEL}\``));
  const ohneSatz = TEXTE["templates/CLAUDE-workflow.md"].replaceAll("je Board einmal anzulegen", "irgendwo anzulegen");
  assert.doesNotMatch(ohneSatz, /je Board einmal anzulegen/);
});
