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
const KOPIE = lies(".claude", "CLAUDE-workflow.md");

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

test("der Lebenszyklus-Eintrag nennt beide Board-Wege als Bewegung des Menschen", () => {
  const eintrag = lebenszyklusEintrag(DOKU);
  assert.match(eintrag, /Mensch/, "wer die Karte bewegt, steht nicht da");
  assert.match(eintrag, /Backlog/, "die Ausgangsspalte fehlt");
  assert.match(eintrag, /direkt nach Done/i, "der direkte Weg nach Done fehlt");
  assert.match(eintrag, /In review/, "der Weg ueber In review als Klammer fehlt");
  assert.match(eintrag, /gleichwertig/i, "die Gleichwertigkeit der beiden Wege steht nicht da");
});

// Die Falle des Verfahrens: `night.mjs --review` liest ausschliesslich die
// Backlog-Spalte. Wer ein Dokument VOR seiner Pruefung als Klammer nach In review
// zieht, nimmt es dem Nachtlauf weg — ohne dass irgendetwas fehlschlaegt.
test("der Lebenszyklus-Eintrag nennt die Backlog-Beschraenkung samt Folge", () => {
  const eintrag = lebenszyklusEintrag(DOKU);
  assert.match(eintrag, /night\.mjs --review/, "der Nacht-Review wird nicht benannt");
  assert.match(eintrag, /Backlog/, "die Backlog-Beschraenkung fehlt");
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

const beide = [
  ["templates/CLAUDE-workflow.md", VORLAGE],
  [".claude/CLAUDE-workflow.md", KOPIE],
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
    assert.match(absatz, /In review/, "die Klammer in In review fehlt");
    assert.match(absatz, /Arbeitspakete/, "der Bezug auf die Arbeitspakete fehlt");
  });
}

// Die Vorlage ist der Blob, den install.mjs ausliefert; die Kopie ist die gelebte
// Datei dieses Repos. Driften sie, bekommt jedes neue Projekt einen anderen Prozess
// als das Kit selbst — und zwar ohne dass irgendetwas fehlschlaegt.
test("Vorlage und Kopie der Prozessdatei sind byte-identisch", () => {
  assert.equal(KOPIE, VORLAGE, "templates/CLAUDE-workflow.md und .claude/CLAUDE-workflow.md sind gedriftet");
});
