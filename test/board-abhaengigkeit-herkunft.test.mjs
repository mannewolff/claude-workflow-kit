// `abhaengigkeitenMitHerkunft` — je Nummer im Abschnitt `## Abhaengigkeiten` ihre Herkunft
// und Textstelle (Issue #1058, Plan #1057 E1, E2, E3).
//
// Verweiszeile ist eine Zeile, die nach optionalem Leerraum und Listenzeichen mit
// `Issue #N` beginnt und keine weitere lokale Nummer traegt. Alles andere ist Text, auch
// eine Nummer im Codeblock des Abschnitts. Die Stelle ist die getrimmte Zeile, hoechstens
// 100 Zeichen, mit `…` am Schnitt.

import { test } from "node:test";
import assert from "node:assert/strict";

import { abhaengigkeitenMitHerkunft } from "../kit/board.mjs";

const lesen = (...zeilen) => abhaengigkeitenMitHerkunft(`## Kontext\nText #99.\n\n## Abhängigkeiten\n${zeilen.join("\n")}\n`);

test("Issue #12 allein ist eine Verweiszeile", () => {
  assert.deepEqual(lesen("Issue #12"), [{ nummer: 12, herkunft: "verweiszeile", stelle: "Issue #12" }]);
});

test("ein Nachsatz ohne weitere Nummer und ein Listenzeichen stoeren die Verweiszeile nicht", () => {
  assert.deepEqual(lesen("- Issue #12 muss vorher fertig sein"),
    [{ nummer: 12, herkunft: "verweiszeile", stelle: "- Issue #12 muss vorher fertig sein" }]);
  assert.deepEqual(lesen("  * Issue #13"), [{ nummer: 13, herkunft: "verweiszeile", stelle: "* Issue #13" }]);
  assert.deepEqual(lesen("+ Issue #14"), [{ nummer: 14, herkunft: "verweiszeile", stelle: "+ Issue #14" }]);
});

test("eine nummerierte Liste traegt Verweiszeilen", () => {
  assert.deepEqual(lesen("1. Issue #12"), [{ nummer: 12, herkunft: "verweiszeile", stelle: "1. Issue #12" }]);
});

test("eine Nummer im Erlaeuterungssatz ist Text, mit Stelle", () => {
  assert.deepEqual(lesen("Nicht #724: das ist nur ein Hinweis."),
    [{ nummer: 724, herkunft: "text", stelle: "Nicht #724: das ist nur ein Hinweis." }]);
});

test("eine Zeile mit zwei Nummern ist keine Verweiszeile", () => {
  assert.deepEqual(lesen("Issue #12 und #13"), [
    { nummer: 12, herkunft: "text", stelle: "Issue #12 und #13" },
    { nummer: 13, herkunft: "text", stelle: "Issue #12 und #13" },
  ]);
});

test("ein Projektname vor der Nummer macht sie zu Text", () => {
  assert.deepEqual(lesen("kanban-kit #12"), [{ nummer: 12, herkunft: "text", stelle: "kanban-kit #12" }]);
});

test("owner/repo#12 ist kein lokaler Verweis", () => {
  assert.deepEqual(lesen("owner/repo#12"), []);
  assert.deepEqual(lesen("`owner/repo`#12"), []);
});

test("eine Nummer im Codeblock des Abschnitts ist Text, auch in Verweiszeilen-Form", () => {
  assert.deepEqual(lesen("```", "Issue #12", "```"), [{ nummer: 12, herkunft: "text", stelle: "Issue #12" }]);
});

test("eine Stelle ueber 100 Zeichen wird mit … gekuerzt", () => {
  const zeile = "Nicht #724: " + "x".repeat(200);
  const [treffer] = lesen("   " + zeile + "   ");
  assert.equal(treffer.stelle.length, 100);
  assert.ok(treffer.stelle.endsWith("…"));
  assert.equal(treffer.stelle, zeile.slice(0, 99) + "…");
  const genau = "Nicht #724: " + "y".repeat(88);
  assert.equal(genau.length, 100);
  assert.equal(lesen(genau)[0].stelle, genau);
});

test("eine doppelte Nummer kommt einmal vor, als Verweiszeile, sobald eine sie traegt", () => {
  assert.deepEqual(lesen("Siehe #12 weiter unten.", "Issue #12"),
    [{ nummer: 12, herkunft: "verweiszeile", stelle: "Issue #12" }]);
  assert.deepEqual(lesen("Issue #12", "Siehe #12."),
    [{ nummer: 12, herkunft: "verweiszeile", stelle: "Issue #12" }]);
});

test("eine doppelte Nummer nur im Text behaelt ihre erste Stelle", () => {
  assert.deepEqual(lesen("Erst #12.", "Dann #12."), [{ nummer: 12, herkunft: "text", stelle: "Erst #12." }]);
});

test("die Reihenfolge folgt dem ersten Vorkommen", () => {
  assert.deepEqual(lesen("Siehe #5.", "Issue #3", "Issue #5").map((t) => [t.nummer, t.herkunft]),
    [[5, "verweiszeile"], [3, "verweiszeile"]]);
});

test("Abschnittslesung wie abhaengigkeitenLesen: letzte Ueberschrift, Fence an beiden Enden", () => {
  assert.deepEqual(abhaengigkeitenMitHerkunft(""), []);
  assert.deepEqual(abhaengigkeitenMitHerkunft("## Kontext\n#5\n"), []);
  assert.deepEqual(abhaengigkeitenMitHerkunft("## Abhängigkeiten\n#16\n\n## Abhängigkeiten\nIssue #17\n"),
    [{ nummer: 17, herkunft: "verweiszeile", stelle: "Issue #17" }]);
  assert.deepEqual(abhaengigkeitenMitHerkunft("## Abhängigkeiten\n```\n## Aufgabe\n#11\n```\nIssue #12\n\n## Nachtrag\n#9\n"), [
    { nummer: 11, herkunft: "text", stelle: "#11" },
    { nummer: 12, herkunft: "verweiszeile", stelle: "Issue #12" },
  ]);
});
