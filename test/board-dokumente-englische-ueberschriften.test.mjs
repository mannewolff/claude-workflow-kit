// Ablauf-Pruefung: `issue auftrag` liest Plan, Fachplan und Voraussetzungen ueber das echte
// CLI von board.mjs, das nur ein Programmstart zeigt.
//
// Formgates und Abschnittsparser erkennen die Formatueberschriften unter beiden Namen
// (Issue #1460, Plan #1420 E15).
//
// Bevor ein englischer Skill `## Context`, `## Task`, `## Acceptance criteria` und
// `## Dependencies` schreibt, muessen `issue check-form`, die Formgates, `issue auftrag` und
// der Nachtlauf sie verstehen — sonst faellt jedes englische Paket an I1 durch, und der
// Nachtlauf liest seine Abhaengigkeiten nicht. Die Namen stehen im Register
// kit/board/namen.mjs; ein Dokument darf beide Sprachen mischen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  UEBERSCHRIFTEN, erkenneUeberschrift, leseUeberschrift, ueberschriftName, ueberschriftZeile,
} from "../kit/board/namen.mjs";
import { abhaengigkeitenLesen, zerlegeAbschnitte } from "../kit/board/dokumente.mjs";
import { GESCHUETZTE_PFADE, geschuetzteTreffer } from "../kit/board/geschuetzt.mjs";
import { pruefeForm } from "../kit/board/testhinweise.mjs";
import { OFFENE_FRAGEN_UEBERSCHRIFT, PO_FRAGEN_UEBERSCHRIFT, abschnittLesen, parseDeps, wartetAufPush } from "../kit/night/abhaengigkeiten.mjs";
import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";

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

// --- issue auftrag mit englischen Dokumenten ---

const lokalDatei = (nr, status, titel, body) =>
  `---\nid: "${String(nr).padStart(4, "0")}"\ntype: task\nstatus: ${status}\ntitle: ${titel}\n---\n\n${body}`;

test("issue auftrag: Plan-Entscheidungen, fachlicher Anlass und Voraussetzungen aus englischen Dokumenten", () => {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } }, "board-englisch-");
  try {
    mkdirSync(join(dir, "issues"));
    const plan = PLAN_EN.replace("- Keine.\n\n## Planned", "- E1: Which?\n  Chosen: A.\n\n## Planned");
    const paket = PAKET_EN.replace("Author-Model: claude-opus-5-5", "Author-Model: x\nPlan: Issue #2\nRequirement: Issue #3")
      .replace("Issue #7", "Issue #4");
    writeFileSync(join(dir, "issues", "0001.md"), lokalDatei(1, "ready", "Paket", paket));
    writeFileSync(join(dir, "issues", "0002.md"), lokalDatei(2, "backlog", "[Plan] Weg", `Requirement: Issue #3\n\n${plan}`));
    writeFileSync(join(dir, "issues", "0003.md"), lokalDatei(3, "backlog", "[Requirement] Anlass", FACHPLAN_EN));
    writeFileSync(join(dir, "issues", "0004.md"), lokalDatei(4, "ready", "Voraussetzung", PAKET_DE));
    const res = runBoard(dir, ["issue", "auftrag", "1", "--json"]);
    assert.equal(res.status, 0, res.stderr);
    const a = JSON.parse(res.stdout);
    assert.deepEqual(a.planEntscheidungen.eintraege, [{ id: "E1", text: "- E1: Which?\n  Chosen: A." }]);
    assert.equal(a.fachlicherAnlass.ziel, "Goal.\n\nAuthor-Model: claude-opus-5-5");
    assert.equal(a.fachlicherAnlass.kriterien, "1. One.");
    assert.deepEqual(a.voraussetzungen.map((v) => v.id), ["4"]);
    assert.equal(a.urteil.folge, "bleibt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
