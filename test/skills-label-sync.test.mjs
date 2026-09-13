/**
 * skills-label-sync.test.mjs — die Aufrufstellen von `label-sync` (Issue #385).
 *
 * Seit Issue #629 ruft `/issue-review` kein label-sync mehr; die Pakete #630 bis #632
 * nehmen die drei uebrigen Skills aus der Liste, dann entfaellt diese Datei.
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

test("issues, techplan und fachplan rufen label-sync nach issue create auf", () => {
  for (const name of ["issues", "techplan", "fachplan"]) {
    assert.match(skill(name), /label-sync/, `${name} ruft label-sync nicht auf`);
  }
});

// Ohne diese Festlegung kollidieren zwei Vorgaben: Der Anker gehoert in Zeile 1,
// der Ausfall stand bisher ebenfalls dort — beides zugleich geht nicht, und
// `reviewZustand` (Issue #381) erkennt den Ausfall dann nie.
