// Formgates und Abschnittsparser erkennen die Formatueberschriften unter beiden Namen
// (Issue #1460, Plan #1420 E15).
//
// Bevor ein englischer Skill `## Context`, `## Task`, `## Acceptance criteria` und
// `## Dependencies` schreibt, muessen `issue check-form`, die Formgates, `issue auftrag` und
// der Nachtlauf sie verstehen — sonst faellt jedes englische Paket an I1 durch, und der
// Nachtlauf liest seine Abhaengigkeiten nicht. Die Namen stehen im Register
// kit/board/namen.mjs; ein Dokument darf beide Sprachen mischen.
//
// Die Faelle des Nachtlaufs stehen in test/night-abhaengigkeiten-englische-ueberschriften.test.mjs,
// `issue auftrag` in test/ablauf-board-englische-ueberschriften.test.mjs: Ein Import aus
// kit/night/ oder ein Start des Board-Einstiegs hier zoege bei jeder Aenderung an den
// Testhinweisen fremde Gruppen mit (test/config-teile.test.mjs, Kriterien 4 und 7).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  UEBERSCHRIFTEN, erkenneUeberschrift, leseUeberschrift, ueberschriftName, ueberschriftZeile,
} from "../kit/board/namen.mjs";
import { zerlegeAbschnitte } from "../kit/board/dokumente.mjs";
import { GESCHUETZTE_PFADE, geschuetzteTreffer } from "../kit/board/geschuetzt.mjs";
import { pruefeForm } from "../kit/board/testhinweise.mjs";

// --- Dokumente in beiden Sprachen ---

const PAKET_DE = "## Kontext\nAutor-Modell: claude-opus-5-5\n\n## Aufgabe\n1. `kit/x.mjs` aendern.\n\n"
  + "## Akzeptanzkriterium\n- `node --test test/x.test.mjs` ist gruen.\n\n## Abhaengigkeiten\nIssue #7\n";
const PAKET_EN = "## Context\nAuthor-Model: claude-opus-5-5\n\n## Task\n1. Change `kit/x.mjs`.\n\n"
  + "## Acceptance criteria\n- `node --test test/x.test.mjs` is green.\n\n## Dependencies\nIssue #7\n";
const PAKET_GEMISCHT = "## Context\nAutor-Modell: claude-opus-5-5\n\n## Aufgabe\n1. `kit/x.mjs` aendern.\n\n"
  + "## Acceptance criteria\n- gruen\n\n## Abhängigkeiten\nIssue #7\n";

const PLAN_DE = "Plan-Modell: claude-opus-5-5\n\n## Ziel\nZiel.\n\n## Betroffene Bereiche\n- `kit/x.mjs`\n\n"
  + "## Architektonische Entscheidungen\n- Keine.\n\n## Geplante Änderungen\n- `kit/x.mjs`\n\n"
  + "## Offene Fragen\n- Keine.\n\n## Verifizierung\n- Tests.\n";
const PLAN_EN = "Plan-Model: claude-opus-5-5\n\n## Goal\nGoal.\n\n## Affected areas\n- `kit/x.mjs`\n\n"
  + "## Architectural decisions\n- Keine.\n\n## Planned changes\n- `kit/x.mjs`\n\n"
  + "## Open questions\n- Keine.\n\n## Verification\n- Tests.\n";

const FACHPLAN_DE = "## Ziel\nZiel.\n\nAutor-Modell: claude-opus-5-5\n\n## Fachliche Akzeptanzkriterien\n1. Eins.\n\n"
  + "## Nicht-Ziele\n- Nichts.\n\n## Offene Fragen an den PO\nKeine.\n";
const FACHPLAN_EN = "## Goal\nGoal.\n\nAuthor-Model: claude-opus-5-5\n\n## Business acceptance criteria\n1. One.\n\n"
  + "## Non-goals\n- Nothing.\n\n## Open questions for the PO\nKeine.\n";

// --- Register ---

test("Register: jede Formatueberschrift hat einen deutschen und einen englischen Namen, keiner doppelt", () => {
  const gesehen = new Map();
  for (const [sache, { de, en }] of Object.entries(UEBERSCHRIFTEN)) {
    assert.ok(de && en, sache);
    for (const name of new Set([de, en])) {
      assert.equal(erkenneUeberschrift(name), sache, name);
      const schluessel = name.toLowerCase();
      assert.ok(!gesehen.has(schluessel), `${name} steht bei ${gesehen.get(schluessel)} und ${sache}`);
      gesehen.set(schluessel, sache);
    }
  }
  assert.equal(ueberschriftName("abhaengigkeiten", "en"), "Dependencies");
  assert.equal(ueberschriftName("abhaengigkeiten", "de"), "Abhaengigkeiten");
});

test("Register: Umlaute in beiden Schreibweisen, Gross- und Kleinschreibung gleichgueltig", () => {
  assert.equal(erkenneUeberschrift("Abhängigkeiten"), "abhaengigkeiten");
  assert.equal(erkenneUeberschrift("  ACCEPTANCE   criteria "), "akzeptanzkriterium");
  assert.equal(erkenneUeberschrift("Geplante Änderungen"), "geplanteAenderungen");
  assert.equal(erkenneUeberschrift("Dependencies extra"), null);
  assert.equal(erkenneUeberschrift("Offene Fragen an den PO"), "poFragen");
  assert.equal(leseUeberschrift("Manual check (human, not part of the session close)")?.sache, "manuellePruefung");
  assert.equal(leseUeberschrift("Manuelle Prüfung (Mensch)")?.sache, "manuellePruefung");
  assert.equal(leseUeberschrift("Manual checks")?.sache, undefined);
});

test("ueberschriftZeile: nur die eigene Ebene, beide Namen", () => {
  const deps = ueberschriftZeile("abhaengigkeiten");
  assert.ok(deps.test("## Dependencies"));
  assert.ok(deps.test("## Abhaengigkeiten"));
  assert.ok(deps.test("   ##Abhängigkeiten  "));
  assert.ok(!deps.test("### Dependencies"));
  assert.ok(!deps.test("## Dependencies (wartet auf Push)"));
  assert.ok(ueberschriftZeile("entscheidungen", 3).test("### Decisions"));
});

// --- issue check-form: dieselben Gates ---

for (const [name, body, titel] of [
  ["Arbeitspaket", PAKET_EN, "Paket"],
  ["Arbeitspaket gemischt", PAKET_GEMISCHT, "Paket"],
  ["Plan", PLAN_EN, "[Plan] Weg"],
  ["Fachplan", FACHPLAN_EN, "[Requirement] Anlass"],
]) {
  test(`check-form: ${name} mit englischen Ueberschriften besteht`, () => {
    const ergebnis = pruefeForm(body, titel);
    assert.deepEqual(ergebnis.verstoesse, []);
    assert.equal(ergebnis.ok, true);
  });
}

test("check-form: die deutschen Fassungen bestehen weiter", () => {
  assert.deepEqual(pruefeForm(PAKET_DE, "Paket").verstoesse, []);
  assert.deepEqual(pruefeForm(PLAN_DE, "[Plan] Weg").verstoesse, []);
  assert.deepEqual(pruefeForm(FACHPLAN_DE, "[Fachlich] Anlass").verstoesse, []);
});

test("check-form: die Gates greifen an englischen Abschnitten wie an deutschen", () => {
  const ohneDeps = PAKET_EN.replace("Issue #7", "");
  assert.deepEqual(pruefeForm(ohneDeps, "Paket").verstoesse.map((v) => v.gate), ["I3"]);
  const verdreht = "## Task\n1. `kit/x.mjs`.\n\n## Context\nAuthor-Model: x\n\n## Acceptance criteria\n- ja\n\n## Dependencies\nKeine.\n";
  assert.ok(pruefeForm(verdreht, "Paket").verstoesse.some((v) => v.gate === "I1"));
  const leererPlan = PLAN_EN.replace("## Verification\n- Tests.\n", "## Verification\n");
  assert.deepEqual(pruefeForm(leererPlan, "[Plan] Weg").verstoesse.map((v) => v.gate), ["P6"]);
  const ohnePo = FACHPLAN_EN.replace(/## Open questions for the PO[\s\S]*$/, "");
  assert.ok(pruefeForm(ohnePo, "[Requirement] Anlass").verstoesse.some((v) => v.gate === "F7"));
});

test("zerlegeAbschnitte: englische Titel tragen den Namen des Registers, unbekannte bleiben", () => {
  const { abschnitte } = zerlegeAbschnitte(PAKET_EN + "## Something else\nx\n");
  assert.deepEqual(abschnitte.map((a) => a.titel), ["kontext", "aufgabe", "akzeptanzkriterium", "abhaengigkeiten", "something else"]);
});

// --- Der Block der manuellen Pruefung ---

const GUETE = "npx stryker run";
const mitManuellemBlock = (kopf) => PAKET_EN.replace("## Dependencies",
  `${kopf}\n- \`${GUETE}\` laeuft einmal durch.\n\n## Dependencies`);

test("I6: eine Guetemessung im englischen Block der manuellen Pruefung zaehlt nicht", () => {
  const config = { mutationCommand: GUETE };
  for (const kopf of ["### Manual check (human, not part of the session close)", "### Manuelle Pruefung (Mensch, nicht Teil des Session-Abschlusses)"]) {
    assert.deepEqual(pruefeForm(mitManuellemBlock(kopf), "Paket", config).verstoesse, [], kopf);
  }
  const ohneBlock = PAKET_EN.replace("is green.", `is green.\n- \`${GUETE}\` laeuft.`);
  assert.deepEqual(pruefeForm(ohneBlock, "Paket", config).verstoesse.map((v) => v.gate), ["I6"]);
});

test("Nachtlauf und auftrag: geschuetzte Pfade unter Task und Acceptance criteria samt Block der manuellen Pruefung", () => {
  const pfad = GESCHUETZTE_PFADE[0];
  const body = PAKET_EN.replace("## Dependencies",
    `### Manual check (human, not part of the session close)\n- \`${pfad}\` von Hand pruefen.\n\n## Dependencies`);
  assert.deepEqual(geschuetzteTreffer(body, "Paket", ".").map((t) => t.pfad), [pfad]);
  const imKontext = PAKET_EN.replace("Author-Model: claude-opus-5-5", `Author-Model: x\nSiehe \`${pfad}\`.`);
  assert.deepEqual(geschuetzteTreffer(imKontext, "Paket", "."), []);
});
