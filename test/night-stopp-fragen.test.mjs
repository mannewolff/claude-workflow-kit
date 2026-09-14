// Die Stopp-Fragen-Pruefung eines Plandokuments (Issue #519, exportiert mit Issue #640).
//
// `stoppFragenGrund` liest den Abschnitt `## Offene Fragen` und sagt, ob dort etwas
// offen ist. Die Nacht-Kette (Plan #638) endet an genau dieser Frage mit `angehalten`;
// bis dahin steht die reine Funktion hier an Fixtures. Ein FEHLENDER Abschnitt ist ein
// Ausschluss, keine Erlaubnis.

import { test } from "node:test";
import assert from "node:assert/strict";
import { stoppFragenGrund } from "../kit/night.mjs";

// Der Code-Fence als Konstante: In einem Template-Literal waeren drei Backticks nicht
// schreibbar, und die Fixtures sollen als Zeilenlisten lesbar bleiben.
const F = "```";

const KONTEXT = ["## Kontext", "", "Autor-Modell: claude-opus-5", "Plan-Review: fable (2026-09-08)", ""];
const KEINE_FRAGEN = ["## Offene Fragen", "", "- Keine. Der Plan bleibt in kit/night.mjs.", ""];
const OFFENE_FRAGE = ["## Offene Fragen", "", "- Soll der Ergebnisstand schon Einheiten tragen?", ""];
const FRAGEN_KLEIN = ["## Offene Fragen", "", "- keine.", ""];
const SCHLUSS = ["## Verifizierung", "", "- night.mjs laeuft.", ""];

const zusammen = (...teile) => teile.flat().join("\n");

test("stoppFragenGrund: '- Keine.' mit Zusatz dahinter ist keine offene Frage", () => {
  assert.equal(stoppFragenGrund(zusammen(KONTEXT, KEINE_FRAGEN, SCHLUSS)), null);
});

test("stoppFragenGrund: ein fehlender Abschnitt '## Offene Fragen' schliesst aus", () => {
  assert.equal(stoppFragenGrund(zusammen(KONTEXT, SCHLUSS)), "kein Abschnitt ## Offene Fragen");
});

test("stoppFragenGrund: ein leerer Abschnitt schliesst aus", () => {
  assert.equal(stoppFragenGrund(zusammen(KONTEXT, ["## Offene Fragen", ""], SCHLUSS)), "Abschnitt ## Offene Fragen ist leer");
});

test("stoppFragenGrund: eine offene Frage steht im Grund", () => {
  assert.equal(stoppFragenGrund(zusammen(KONTEXT, OFFENE_FRAGE, SCHLUSS)),
    "offene Stopp-Frage: - Soll der Ergebnisstand schon Einheiten tragen?");
});

test("stoppFragenGrund: der Grund kuerzt eine lange Frage auf 120 Zeichen", () => {
  const lang = ["## Offene Fragen", "", `- ${"x".repeat(300)}`, ""];
  const grund = stoppFragenGrund(zusammen(KONTEXT, lang, SCHLUSS));
  assert.ok(grund.startsWith("offene Stopp-Frage: "));
  assert.ok(grund.length <= "offene Stopp-Frage: ".length + 121, `zu lang: ${grund.length}`);
});

test("stoppFragenGrund: '- keine.' klein geschrieben gilt als offen", () => {
  assert.match(stoppFragenGrund(zusammen(KONTEXT, FRAGEN_KLEIN, SCHLUSS)), /^offene Stopp-Frage: - keine\./);
});

test("stoppFragenGrund: '- Keine.' innerhalb eines Codeblocks zaehlt nicht", () => {
  const imBlock = ["## Offene Fragen", "", F, "- Keine.", F, "- Wie heisst das Feld?", ""];
  assert.match(stoppFragenGrund(zusammen(KONTEXT, imBlock, SCHLUSS)), /^offene Stopp-Frage: - Wie heisst das Feld\?/);
});

test("stoppFragenGrund: eine '## Offene Fragen'-Ueberschrift im Codeblock zaehlt nicht", () => {
  const nurImBlock = [F, "## Offene Fragen", "", "- Keine.", F, ""];
  assert.equal(stoppFragenGrund(zusammen(KONTEXT, nurImBlock, SCHLUSS)), "kein Abschnitt ## Offene Fragen");
});

test("stoppFragenGrund haelt einen fehlenden Body aus", () => {
  for (const body of [null, undefined, ""]) {
    assert.equal(stoppFragenGrund(body), "kein Abschnitt ## Offene Fragen");
  }
});
