// Das Commit-Gate in Registern und Doku (Issue #474, Plan #467 A12).
//
// Das Gate ist mechanisch und nicht sitzungsgebunden — es trifft deshalb mehr als
// die implement-Skills: Bahn 1, jeden Handcommit, jeden Commit aus einem Werkzeug
// ohne node im PATH. Wer das nicht hinschreibt, verschweigt den Geltungsbereich,
// den Issue #463 ausdruecklich zur Entscheidung gestellt hatte.
//
// Und die Grenzen gehoeren dazu: Eine Regel, die ihre eigenen Luecken verschweigt,
// erzeugt genau das falsche Vertrauen, gegen das #463 angetreten ist.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...teile) => readFileSync(join(repoRoot, ...teile), "utf-8");

/** Umlaut und Umschrift gelten gleich — das Repo schreibt beides. */
const beide = (wort) => new RegExp(wort.replaceAll("ue", "(ue|ü)").replaceAll("ae", "(ae|ä)"), "i");

/**
 * Der Absatz, der ein Muster enthaelt — Absaetze sind durch Leerzeilen getrennt.
 * Ueberschriften zaehlen nicht: Sie stehen als eigener Absatz und enthalten das
 * Stichwort, ohne die Aussage zu tragen.
 */
function absatzMit(text, muster) {
  return text.split(/\n\s*\n/).filter((a) => !a.trimStart().startsWith("#")).find((a) => muster.test(a));
}

test("[docs] der Bahn-1-Absatz der Vorlage nennt die Voraussetzung und beide Grenzen", () => {
  const text = lies("templates", "CLAUDE-workflow.md");
  const absatz = absatzMit(text, /Bahn 1 — Kleine/);
  assert.ok(absatz, "der Bahn-1-Absatz fehlt");
  assert.match(absatz, /checks\.mjs run/, "die Voraussetzung fehlt");
});

test("[docs] der Git-Workflow-Abschnitt nennt die Voraussetzung, und W2 bleibt zeichengleich", () => {
  const text = lies("templates", "CLAUDE-workflow.md");
  const workflow = text.slice(text.indexOf("## Git-Workflow (strikt bindend)"), text.indexOf("---", text.indexOf("Absolut bindend:")));
  assert.match(workflow, /checks\.mjs run/, "die Voraussetzung fehlt im Git-Workflow-Abschnitt");

  // Der Block "Absolut bindend" traegt weiterhin GENAU drei Saetze: W2 zitiert ihn
  // woertlich als "diese drei Saetze". Ein vierter dort machte das Gate falsch.
  const block = workflow.slice(workflow.indexOf("Absolut bindend:"));
  const punkte = block.split("\n").filter((z) => z.startsWith("- "));
  assert.equal(punkte.length, 3, "der Block 'Absolut bindend' muss drei Saetze behalten");
  assert.doesNotMatch(block, /checks\.mjs run/, "die neue Regel gehoert nicht in den zitierten Block");
});

test("[docs] beide Register-Stellen nennen die Grenzen und sagen, was interaktiv greift", () => {
  const text = lies("templates", "CLAUDE-workflow.md");
  for (const [name, muster] of [["Bahn 1", /Bahn 1 — Kleine/], ["Git-Workflow", /Claude committet lokal/]]) {
    const absatz = absatzMit(text, muster) || "";
    const umgebung = text.slice(Math.max(0, text.indexOf(absatz) - 400), text.indexOf(absatz) + absatz.length + 900);
    assert.match(umgebung, /--no-verify/, `${name}: die Grenze --no-verify fehlt`);
    assert.match(umgebung, beide("Klon|Clone|Installer"), `${name}: der frische Klon fehlt`);
  }
});

test("[docs] der Bahn-1-Absatz der Doku traegt denselben Satz", () => {
  const text = lies("docs", "dokumentation.md");
  const absatz = absatzMit(text, /\*\*Bahn 1 — Kleine Änderung\.\*\*/);
  assert.ok(absatz, "der Bahn-1-Absatz der Doku fehlt");
  assert.match(absatz, /checks\.mjs run/, "die Voraussetzung fehlt");
});

test("[docs] der Doku-Abschnitt beschreibt Prueflogik und alle vier Grenzen", () => {
  const text = lies("docs", "dokumentation.md");
  const start = text.indexOf("### Das Commit-Gate");
  assert.notEqual(start, -1, "der Abschnitt fehlt");
  const abschnitt = text.slice(start, text.indexOf("\n## ", start));
  for (const muster of [/\.githooks\//, /core\.hooksPath/, /checks-summary\.json/, /--no-verify/,
                        beide("Klon|Clone"), /Hash/, /Index/]) {
    assert.match(abschnitt, muster, `im Doku-Abschnitt fehlt ${muster}`);
  }
  // Die vierte Grenze: die Zusicherung gilt je Datei, nicht fuer den Stand.
  assert.match(abschnitt, beide("je committeter Datei|nicht fuer den Stand|einzeln"),
    "die Grenze der Zusicherung (A3) fehlt");
});

test("[docs] die Doku sagt, dass interaktiv kein Netz greift", () => {
  const text = lies("docs", "dokumentation.md");
  const start = text.indexOf("### Das Commit-Gate");
  const abschnitt = text.slice(start, text.indexOf("\n## ", start));
  assert.match(abschnitt, beide("interaktiv"), "der interaktive Fall fehlt");
  assert.match(abschnitt, /Nacht-Runner|Nachtlauf/, "der Verweis auf die nachtraegliche Wertung fehlt");
});

test("[docs] das README nennt das Gate in einem Absatz und verweist auf die Doku", () => {
  const text = lies("README.md");
  const absatz = absatzMit(text, /Commit-Gate/);
  assert.ok(absatz, "das README nennt das Gate nicht");
  assert.match(absatz, /--no-verify/, "die erste Grenze fehlt");
  assert.match(absatz, beide("Klon|Clone|Installer"), "die zweite Grenze fehlt");
  assert.match(absatz, /docs\/dokumentation\.md|dokumentation/, "der Verweis auf die Doku fehlt");
  // Kein zweiter vollstaendiger Text: Zwei Orte fuer dieselbe Aussage driften
  // auseinander — dasselbe Muster wie bei checkAreas.
  const traeger = text.split(/\n\s*\n/).filter((a) => !a.trimStart().startsWith("#") && /Commit-Gate/.test(a));
  assert.equal(traeger.length, 1, "das README fuehrt das Gate in mehr als einem Absatz");
});
