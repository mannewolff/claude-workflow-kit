// Die englischen Prüfrollen unter en/kit/rollen/ tragen dieselben Formwörter der Befunde wie
// die deutschen (Issue #1509, Plan #1420 E14, E17).
//
// `kit/findings.mjs check|buchen` liest die Funde der Prüfer in beiden Projektsprachen mit
// denselben deutschen Formwörtern: den Marken, `Gegenprobe:` mit seinem Stand und `Art:`.
// Eine englische Rolle, die sie übersetzte, brächte ihre Prüfer dazu, Funde zu schreiben, die
// die Formprüfung abweist. Dazu müssen die Platzhalter, die die Montage einsetzt, dieselben sein.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const deDir = join(repoRoot, "kit", "rollen");
const enDir = join(repoRoot, "en", "kit", "rollen");
const rollen = readdirSync(deDir).filter((d) => d.endsWith(".md")).sort();

// Die Formwörter, die findings.mjs liest (E14), in der Schreibweise, die die Rollen vorgeben.
const FORMWOERTER = [
  "KRITISCH",
  "BLOCKER",
  "WICHTIG",
  "HINWEIS",
  "Gegenprobe:",
  "— geprueft, bestaetigt",
  "— nicht geprueft",
  "Art:",
];

// findings.mjs nimmt den Stand mit und ohne Umlaute an (`geprüft, bestätigt`); verglichen
// wird darum in der Kit-üblichen ASCII-Schreibweise.
function lies(dir, name) {
  return readFileSync(join(dir, name), "utf8").replaceAll("ü", "ue").replaceAll("ä", "ae");
}

function platzhalter(text) {
  return [...new Set(text.match(/\{\{[#/]?[A-Z_]+\}\}/g) ?? [])].sort();
}

test("jede deutsche Rolle hat eine englische Fassung unter en/kit/rollen/", () => {
  assert.ok(rollen.length > 0);
  for (const name of rollen) assert.ok(existsSync(join(enDir, name)), `en/kit/rollen/${name} fehlt`);
});

test("die englischen Rollen tragen dieselben Formwörter der Befunde wie die deutschen (E14)", () => {
  for (const name of rollen) {
    const de = lies(deDir, name);
    const en = lies(enDir, name);
    for (const wort of FORMWOERTER) {
      assert.equal(en.includes(wort), de.includes(wort), `${name}: Formwort "${wort}" weicht ab`);
    }
  }
});

test("die englischen Rollen tragen dieselben Platzhalter wie die deutschen", () => {
  for (const name of rollen) {
    assert.deepEqual(platzhalter(lies(enDir, name)), platzhalter(lies(deDir, name)), name);
  }
});

test("en/agents/kit-pruefer.md behält Namen und Werkzeuge des Agenten", () => {
  const kopf = (text) => text.split("---")[1];
  const de = kopf(readFileSync(join(repoRoot, "agents", "kit-pruefer.md"), "utf8"));
  const en = kopf(readFileSync(join(repoRoot, "en", "agents", "kit-pruefer.md"), "utf8"));
  for (const feld of ["name", "tools"]) {
    const wert = (t) => t.match(new RegExp(`^${feld}: (.*)$`, "m"))?.[1];
    assert.equal(wert(en), wert(de), feld);
  }
});
