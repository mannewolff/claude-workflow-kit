// Lebenszyklus der Dokument-Tickets in der Doku (Issue #299).
//
// Beschrieben war nur, wie ein fachliches Issue endet. Fuer Plandokumente stand
// nirgends etwas — eine Ticketsorte, deren Entstehung dokumentiert ist und deren
// Ende niemand beschreibt.
//
// Die Tests greifen GEZIELT den einen Lebenszyklus-Eintrag heraus und pruefen die
// Aussagen darin. Ein Wortfund ueber die ganze Datei genuegt hier nicht: Die
// Backlog-Beschraenkung des Nacht-Reviews steht bereits an anderer Stelle in
// derselben Datei, ein globaler Test waere also schon vor der Aenderung gruen
// gewesen und haette nichts belegt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");

const DOKU = lies("docs", "dokumentation.md");
const VORLAGE = lies("templates", "CLAUDE-workflow.md");

/**
 * Der eine Listeneintrag, der mit `- **Lebenszyklus:**` beginnt — bis zum naechsten
 * Eintrag derselben Ebene oder zur naechsten Ueberschrift.
 */
function lebenszyklusEintrag(text) {
  const start = text.indexOf("- **Lebenszyklus:**");
  if (start < 0) return null;
  const rest = text.slice(start);
  const ende = rest.slice(1).search(/\n- \*\*|\n#{2,} /);
  return ende < 0 ? rest : rest.slice(0, ende + 1);
}

test("es gibt genau einen Lebenszyklus-Eintrag", () => {
  // Zwei Eintraege fuer denselben Sachverhalt driften auseinander — dann steht die
  // eine Haelfte der Wahrheit an der einen und die andere an der anderen Stelle.
  const treffer = DOKU.match(/- \*\*Lebenszyklus:\*\*/g) || [];
  assert.equal(treffer.length, 1, `erwartet: 1 Lebenszyklus-Eintrag, gefunden: ${treffer.length}`);
});

test("der Lebenszyklus-Eintrag nennt beide Dokumentarten", () => {
  const eintrag = lebenszyklusEintrag(DOKU);
  assert.ok(eintrag, "kein Lebenszyklus-Eintrag gefunden");
  assert.match(eintrag, /fachlich/i, "die fachlichen Issues fehlen");
  assert.match(eintrag, /Plandokument/, "die Plandokumente fehlen");
});

// Plan #1283 (Issue #1284): Done bleibt Geste des Menschen, nach In review zieht das
// Kit die Ursprungsdokumente, sobald der Plan durch ist. Die Klammer entfaellt.
test("der Lebenszyklus-Eintrag nennt Done als Geste des Menschen und In review als Zug des Kits", () => {
  const eintrag = lebenszyklusEintrag(DOKU);
  assert.match(eintrag, /Mensch/, "wer die Karte bewegt, steht nicht da");
  assert.match(eintrag, /Backlog/, "die Ausgangsspalte fehlt");
  assert.match(eintrag, /nach Done/, "der Weg nach Done fehlt");
  assert.match(eintrag, /alles gebaut, Review dran/, "die Bedeutung von In review fehlt");
  assert.match(eintrag, /In review[^.]*setzt das Kit/, "dass das Kit In review setzt, steht nicht da");
  assert.doesNotMatch(eintrag, /Klammer/, "der Eintrag nennt noch die Klammer");
  assert.doesNotMatch(eintrag, /gleichwertig/i, "der Eintrag nennt noch zwei gleichwertige Wege");
});

// Die Falle des Verfahrens: Die Nacht-Kette (`night.mjs --kette`) liest ausschliesslich
// die Backlog-Spalte und legt ihre Pakete dort ab. Wer ein Dokument VOR seiner Kette
// als Klammer nach In review zieht, nimmt es dem Nachtlauf weg — ohne dass irgendetwas
// fehlschlaegt (Plan #638, Issue #646).
test("der Lebenszyklus-Eintrag nennt die Backlog-Beschraenkung der Kette samt Folge", () => {
  const eintrag = lebenszyklusEintrag(DOKU);
  assert.match(eintrag, /night\.mjs --kette/, "die Nacht-Kette wird nicht benannt");
  assert.match(eintrag, /Backlog/, "die Backlog-Beschraenkung fehlt");
  assert.match(eintrag, /Pakete dort ab/, "dass die Pakete im Backlog landen, steht nicht da");
  assert.match(eintrag, /kein(e)? Kandidat/i, "die Folge (kein Kandidat mehr) fehlt");
});

test("der Lebenszyklus-Eintrag nennt den interaktiven Ausweg mit seiner Eigenschaft", () => {
  const eintrag = lebenszyklusEintrag(DOKU);
  assert.match(eintrag, /\/issue-review #N/, "der interaktive Ausweg fehlt");
  // Umlaut ODER ASCII-Umschrift: docs/dokumentation.md schreibt deutsch mit
  // Umlauten, die Prozessdateien umlautfrei. Der Test darf nicht an dieser
  // Schreibkonvention haengen.
  assert.match(eintrag, /unabh(ä|ae)ngig von Spalte und (vorhandenem )?Marker/i,
    "die Eigenschaft, die ihn zum Ausweg macht, fehlt");
});

// --- Prozessdateien ---

// Nur noch die Vorlage: .claude/CLAUDE-workflow.md ist Installer-Ausgabe und nicht
// versioniert (install.mjs schreibt sie bei jedem Lauf neu).
const beide = [
  ["templates/CLAUDE-workflow.md", VORLAGE],
];

/** Der Absatz, der mit `**Plandokumente**` beginnt, bis zur naechsten Leerzeile-Gruppe. */
function planAbsatz(text) {
  const start = text.indexOf("**Plandokumente**");
  if (start < 0) return null;
  const rest = text.slice(start);
  const ende = rest.indexOf("\n**Ideen**");
  return ende < 0 ? rest : rest.slice(0, ende);
}

for (const [name, inhalt] of beide) {
  test(`${name}: der Plan-Absatz sagt, dass nur der Mensch Done setzt`, () => {
    const absatz = planAbsatz(inhalt);
    assert.ok(absatz, "kein Plandokumente-Absatz gefunden");
    assert.match(absatz, /Mensch/, "der Mensch als alleiniger Akteur fehlt");
    assert.match(absatz, /Done/, "Done wird nicht erwaehnt");
    assert.match(absatz, /In review/, "In review fehlt");
    assert.match(absatz, /Arbeitspakete/, "der Bezug auf die Arbeitspakete fehlt");
  });

  test(`${name}: In review zieht das Kit, wenn der Plan durch ist — keine Klammer mehr`, () => {
    const absatz = planAbsatz(inhalt);
    assert.match(absatz, /Done setzt der Mensch/, "Done als Geste des Menschen fehlt");
    assert.match(absatz, /zieht das Kit/, "der Zug des Kits nach In review fehlt");
    assert.match(absatz, /Plan durch ist/, "die Bedingung (Plan durch) fehlt");
    assert.match(absatz, /alles gebaut, Review dran/, "die Bedeutung von In review fehlt");
    assert.doesNotMatch(absatz, /Klammer/, "der Absatz nennt noch die Klammer");
    assert.doesNotMatch(absatz, /kein Skill bewegt es von selbst/, "der alte Satz steht noch da");
  });
}

// Kein Drift-Test mehr zwischen Vorlage und Kopie: die Kopie unter .claude/ ist
// Installer-Ausgabe und liegt nicht im Repo — in CI existiert sie gar nicht.
