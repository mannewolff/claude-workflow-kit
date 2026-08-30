/**
 * skills-label-sync.test.mjs — die Aufrufstellen von `label-sync` (Issue #385).
 *
 * Geprueft wird Text, nicht Verhalten: Wann das Kommando laeuft, steht in den
 * Skills, und ein Skill wird von einer Session gelesen, nicht ausgefuehrt.
 *
 * Der Aufruf gehoert als KOMMANDO in die Skills, nicht als Prompt-Prosa "setze
 * Label X" — Leitplanken-Prinzip: vorhersehbare Entscheidungen ins Gate, nicht in
 * eine Bitte an das Modell.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skill = (name) => readFileSync(join(root, "skills", name, "SKILL.md"), "utf-8");

test("issue-review ruft label-sync an drei Stellen auf", () => {
  const text = skill("issue-review");
  const treffer = text.match(/label-sync/g) || [];
  assert.ok(treffer.length >= 3, `nur ${treffer.length} Nennungen von label-sync`);
  // Die drei Kontexte, in denen der Zustand sich aendert.
  assert.match(text, /nach dem Befunde-Kommentar/i);
  assert.match(text, /nach dem Schreiben von Body und Marker|nach Body und Marker/i);
  assert.match(text, /nach der Verzicht-Meldung/i);
});

// Ein Label ist weder Body noch Marker — es faellt nicht unter das naechtliche
// Schreibverbot fuer die Stufen fachlich und plan.
test("Der Nachtbetrieb nimmt label-sync ausdruecklich NICHT aus", () => {
  const text = skill("issue-review");
  assert.match(text, /nachts identisch|auch nachts|nachts genauso/i);
  assert.match(text, /weder Body noch Marker/i);
});

test("issues, plan und fachplan rufen label-sync nach issue create auf", () => {
  for (const name of ["issues", "plan", "fachplan"]) {
    assert.match(skill(name), /label-sync/, `${name} ruft label-sync nicht auf`);
  }
});

// Ohne diese Festlegung kollidieren zwei Vorgaben: Der Anker gehoert in Zeile 1,
// der Ausfall stand bisher ebenfalls dort — beides zugleich geht nicht, und
// `reviewZustand` (Issue #381) erkennt den Ausfall dann nie.
test("Das Ausfall-Kommentarformat ist festgelegt: Anker Zeile 1, Ausfall Zeile 2", () => {
  const text = skill("issue-review");
  assert.match(text, /zweite[nr]? Zeile/i, "die zweite Zeile wird nicht genannt");
  assert.match(text, /Runde/, "der Anker wird nicht genannt");
  assert.doesNotMatch(text, /dessen erste Zeile den Ausfall und den Grund nennt/,
    "die alte, kollidierende Vorgabe steht noch da");
});
