// Rueckverweis vom Arbeitspaket auf das Plandokument (Issue #277, fachliche
// Quelle #272).
//
// Die Kette soll an jedem Punkt lesbar sein: Vom Arbeitspaket zum Plan, vom Plan
// zur fachlichen Anforderung. Der fachliche Rueckverweis existiert seit der
// PO-Schleife; der auf den Plan fehlte, weil es das Plandokument bis Issue #275
// nicht gab.
//
// Der heikelste Teil ist die Platzierung. Beide Verweise gehoeren in den
// Kontext-Abschnitt und nie in die Abhaengigkeiten: Der Nacht-Runner wertet dort
// jede `Issue #N`-Referenz als Abhaengigkeit, und weder Plan- noch Fach-Issue
// wird waehrend der Umsetzung Done — alle Arbeitspakete blieben dauerhaft
// zurueckgestellt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");

const SKILL = lies("skills", "issues", "SKILL.md");
const DOKU = lies("docs", "dokumentation.md");

/** Der gemeinsame Rueckverweis-Absatz — ab der Ueberschrift bis zur naechsten Leerzeile-Gruppe. */
function rueckverweisAbschnitt() {
  const treffer = SKILL.split(/\n\n/).filter((a) => /\*\*Rückverweise?\b/.test(a));
  assert.equal(
    treffer.length,
    1,
    `genau ein Rueckverweis-Abschnitt erwartet, gefunden ${treffer.length} — dupliziert statt erweitert?`
  );
  // Der Abschnitt darf ueber mehrere Absaetze gehen; ab der Ueberschrift bis zur
  // naechsten fett gesetzten Konvention oder Ueberschrift.
  const idx = SKILL.indexOf(treffer[0]);
  const rest = SKILL.slice(idx);
  const marken = ["\n### ", "\n## ", "\nIssue anlegen ueber den Board-Adapter"]
    .map((m) => rest.indexOf(m))
    .filter((x) => x >= 0);
  const grenze = marken.length ? Math.min(...marken) : -1;
  return grenze >= 0 ? rest.slice(0, grenze) : rest;
}

test("es gibt genau einen gemeinsamen Rueckverweis-Abschnitt", () => {
  // Zwei getrennte Abschnitte fuer dieselbe Regel driften auseinander — deshalb
  // erweitert, nicht dupliziert.
  rueckverweisAbschnitt();
});

test("der Abschnitt nennt beide Verweiszeilen woertlich", () => {
  const a = rueckverweisAbschnitt();
  assert.match(a, /Plan: Issue #M/, "die Plan-Zeile fehlt");
  assert.match(a, /Fachliche Quelle: Issue #N/, "die fachliche Zeile fehlt");
});

test("beide Verweise gehoeren in den Kontext-Abschnitt, nie in die Abhaengigkeiten", () => {
  const a = rueckverweisAbschnitt();
  assert.match(a, /Kontext-Abschnitt/, "der Zielabschnitt ist nicht benannt");
  assert.match(a, /[Nn]iemals in den Abhängigkeiten-Abschnitt|nie in den Abhängigkeiten-Abschnitt/,
    "das Verbot fuer den Abhaengigkeiten-Abschnitt fehlt");
});

test("die Henne-Ei-Begruendung steht dabei", () => {
  const a = rueckverweisAbschnitt();
  assert.match(a, /Henne-Ei|Henne und Ei/i, "die Begruendung ist nicht als solche benannt");
  assert.match(a, /nie Done|erst Done|nicht Done/i,
    "es fehlt, dass Plan- und Fach-Issue waehrend der Umsetzung nicht Done werden");
  assert.match(a, /zurückgestellt|zurueckgestellt/i,
    "die Folge (dauerhaft zurueckgestellt) fehlt");
});

test("die Reihenfolge der beiden Zeilen ist festgelegt", () => {
  const a = rueckverweisAbschnitt();
  const plan = a.indexOf("Plan: Issue #M");
  const fach = a.indexOf("Fachliche Quelle: Issue #N");
  assert.ok(plan >= 0 && fach >= 0, "eine der beiden Zeilen fehlt");
  assert.ok(plan < fach, "die Plan-Zeile muss vor der fachlichen Quelle stehen");
});

test("Plan-Modell und Plan-Verweis sind gegeneinander abgegrenzt", () => {
  const a = rueckverweisAbschnitt();
  assert.match(a, /Plan-Modell/, "die Abgrenzung zur Plan-Modell-Konvention fehlt");
  // Urheber gegen Fundort: ohne diesen Satz liest sich die zweite Zeile wie eine
  // Dopplung der ersten.
  assert.match(a, /welches Modell|Urheber|geschrieben hat/i,
    "Plan-Modell ist nicht als Urheber des Plans beschrieben");
  assert.match(a, /wo (er|der Plan) steht|Fundort|zu finden/i,
    "die Plan-Zeile ist nicht als Fundort des Plans beschrieben");
});

test("der Fall 'Plan ohne [Plan]-Issue' ist geregelt", () => {
  const a = rueckverweisAbschnitt();
  const absatz = a.split(/\n\n/).find((x) => /derselben Session|kein `?\[Plan\]`?-Issue/i.test(x));
  assert.ok(absatz, "der Fall eines nur in der Session freigegebenen Plans fehlt");
  assert.match(absatz, /keine.{0,30}Zeile|kein.{0,20}Platzhalter/i,
    "es steht nicht, dass dann gar keine Zeile entsteht");
});

test("der Fall 'Plan ohne fachliche Quelle' ist geregelt", () => {
  const a = rueckverweisAbschnitt();
  assert.match(a, /nur `?Plan: Issue #M`?|steht nur die `?Plan`?-Zeile/i,
    "der Fall ohne fachliche Quelle fehlt");
});

test("die Doku nennt beide Rueckverweise nebeneinander", () => {
  // Der Bereich, nicht der Absatz: Der Codeblock mit den beiden Zeilen ist in
  // Markdown ein eigener Absatz, die erklaerende Regel steht darueber.
  const idx = DOKU.indexOf("## PO-Schleife");
  assert.ok(idx >= 0, "der Abschnitt zur PO-Schleife fehlt");
  const abschnitt = DOKU.slice(idx).split(/\n## /)[0];
  assert.match(abschnitt, /Plan: Issue #M/, "die Plan-Zeile fehlt in der Doku");
  assert.match(abschnitt, /Fachliche Quelle: Issue #N/, "die fachliche Zeile fehlt in der Doku");
  assert.match(abschnitt, /Kontext-Abschnitt/, "der Zielabschnitt fehlt in der Doku");
});
