// Tests fuer die Nachtregel bei ausgefallenem Reviewer (Issue #267).
//
// Am 2026-08-08 haben vier Nacht-Sessions ihre fertige Reviewer-Arbeit verworfen,
// weil `codex` sich nicht starten liess und sie daraufhin nachgefragt haben —
// nachts antwortet niemand. Der Skill kannte die Lage nicht: Er regelte
// "Reviewer fehlt beim Vorflug" und "Reviewer faellt mitten im Lauf aus", aber
// nicht "Vorflug meldet ihn, der Start scheitert".
//
// Geprueft wird Text, nicht Verhalten. Der Wert liegt darin, dass eine spaetere
// Umformulierung auffaellt, bevor sie wieder eine Nacht kostet.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "issue-review", "SKILL.md"), "utf-8");

// Der Nachtbetriebs-Abschnitt allein — damit ein Treffer im interaktiven Teil
// (wo Rueckfragen ausdruecklich erwuenscht sind) nicht faelschlich zaehlt.
const nachtAbschnitt = SKILL.slice(SKILL.indexOf("## Im Nachtbetrieb"));

test("die Regel schliesst den Ausfall BEIM START ein, nicht nur waehrend des Laufs", () => {
  assert.match(nachtAbschnitt, /beim Start ausf/i,
    "der Ausfall beim Start ist nicht benannt — genau diese Lage trat am 2026-08-08 ein");
});

test("nachts wird in keiner Lage gefragt", () => {
  assert.match(nachtAbschnitt, /in keiner Lage/,
    "die Regel ist nicht als ausnahmslos formuliert");
});

test("der Review laeuft mit den verbleibenden Reviewern zu Ende", () => {
  assert.match(nachtAbschnitt, /verbleibenden Reviewern zu Ende/,
    "ohne diesen Satz verfaellt die Arbeit des anderen Reviewers wieder");
});

// Seit Issue #282 laeuft die Stufe `issue` mit einem einzigen Reviewer. Faellt er
// aus, bleibt niemand uebrig — die Regel oben liefe leer, und eine Session ohne
// Anschlussregel improvisiert. Genau diese Luecke hat am 2026-08-08 vier
// Naechte gekostet, nur eine Stufe hoeher.
test("der Fall 'kein Reviewer bleibt uebrig' hat eine Anschlussregel", () => {
  assert.match(nachtAbschnitt, /Bleibt keiner übrig|Bleibt kein(er)? Reviewer/i,
    "die Lage ohne verbleibenden Reviewer ist nicht geregelt");
  assert.match(nachtAbschnitt, /protokoll/i,
    "die Folge (nur noch protokollieren) fehlt");
});

test("kein Ersatz-Reviewer aus eigenem Antrieb", () => {
  assert.match(nachtAbschnitt, /Kein Ersatz-Reviewer/i);
  assert.match(nachtAbschnitt, /pairs/,
    "die Begruendung ueber die Paar-Tabelle fehlt");
});

test("die Stop-Punkte nennen beide Regeln", () => {
  const stopPunkte = SKILL.slice(SKILL.indexOf("## Stop-Punkte"));
  assert.match(stopPunkte, /nie gefragt, in keiner Lage/);
  assert.match(stopPunkte, /kein Ersatz-Reviewer/i);
});

test("der bestehende Satz zum Ausfall waehrend des Laufs bleibt erhalten", () => {
  // Er steht bei der Ausfuehrung von kind: "command" und gilt auch interaktiv —
  // die neue Nachtregel ersetzt ihn nicht, sie verschaerft ihn nur fuer die Nacht.
  assert.match(SKILL, /gilt der Reviewer als ausgefallen.*kein Abbruch/s,
    "der Bestandssatz wurde ersatzlos entfernt");
});
