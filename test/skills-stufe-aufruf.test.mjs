// Tests fuer die Stufenangabe in den Skills (Issue #759).
//
// Die Stufenauswahl steht seit Issue #757/#758 im Kommando, aber sie wirkt erst,
// wenn jemand sie mit einer anderen Stufe als der Vorgabe aufruft. Genau das
// machen die Skills: `/push-main` faehrt die Push-Stufe, `/merge-production` die
// Freigabestufe, alle uebrigen bleiben beim Default — der Paketstufe.
//
// Geprueft wird Text, nicht Verhalten — wie in
// `test/skills-implement-checks.test.mjs`. Der Wert liegt darin, dass eine
// spaetere Umformulierung auffaellt, bevor eine Release-Runde die zusaetzlichen
// Pruefungen still auslaesst.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function skill(name) {
  return readFileSync(join(repoRoot, "skills", name, "SKILL.md"), "utf-8");
}

// Fuer die Prosa-Pruefungen: Ein Umbruch mitten im Satz ist eine Formatierung,
// keine Aussage. Ohne diese Normalisierung faende ein Suchmuster mit Leerzeichen
// denselben Satz nicht mehr, sobald er im Markdown anders umbrochen wird.
function fliesstext(text) {
  return text.replaceAll(/\s+/g, " ");
}

// Alle Zeilen, die das Pruefkommando aufrufen. `/local-check` ruft es zweimal
// (einmal regulaer, einmal nach dem Format-Fix) — beide muessen dieselbe Stufe
// fahren, sonst maesse der zweite Lauf etwas anderes als der erste.
function aufrufzeilen(text) {
  const zeilen = text.split("\n").filter((z) => z.includes("checks.mjs run"));
  assert.ok(zeilen.length > 0, "der Aufruf `checks.mjs run` fehlt ganz");
  return zeilen;
}

// Die vier Skills, die beim Default bleiben. `/local-check` ist bewusst dabei:
// Der mechanische Halt vor dem Push sitzt seit skills-20 in `/push-main` selbst,
// und die lokale Pruefung vor der menschlichen Testrunde teuer zu machen naehme
// dem Vorhaben seinen Nutzen.
const PAKETSTUFE = ["local-check", "implement-next", "implement-ready", "implement-done"];

test("[skills-31] /push-main ruft die Pruefungen mit --stufe push und dem Batch-Anker auf", () => {
  const zeilen = aufrufzeilen(skill("push-main"));
  const passend = zeilen.filter((z) => z.includes("--stufe push") && z.includes("git merge-base"));
  assert.equal(passend.length, zeilen.length,
    `nicht jeder Aufruf traegt --stufe push und den merge-base-Anker: ${zeilen.join(" | ")}`);
});

test("[skills-31] /push-main nennt die vorab angekuendigten Pruefungen und die laengere Dauer", () => {
  const text = fliesstext(skill("push-main"));
  assert.match(text, /zus(ä|ae)tzlichen Pr(ü|ue)fungen vorab/,
    "der Hinweis auf die vorab genannten zusaetzlichen Pruefungen fehlt");
  assert.match(text, /l(ä|ae)nger dauern/,
    "der Hinweis auf die laengere Laufzeit fehlt");
});

test("[skills-31] /merge-production ruft die Pruefungen mit --stufe merge auf", () => {
  const zeilen = aufrufzeilen(skill("merge-production"));
  const passend = zeilen.filter((z) => z.includes("--stufe merge"));
  assert.equal(passend.length, zeilen.length,
    `nicht jeder Aufruf traegt --stufe merge: ${zeilen.join(" | ")}`);
});

test("[skills-31] /merge-production sagt, dass alle drei Stufen laufen, auch ohne neue Aenderungen", () => {
  const text = fliesstext(skill("merge-production"));
  assert.match(text, /alle drei Stufen/,
    "der Satz zu den drei Stufen fehlt");
  assert.match(text, /seit dem letzten Push nichts hinzugekommen/,
    "es fehlt, dass der volle Umfang auch ohne neue Aenderungen laeuft");
});

for (const name of PAKETSTUFE) {
  test(`[skills-31] ${name} bleibt ohne --stufe-Argument bei der Paketstufe`, () => {
    for (const zeile of aufrufzeilen(skill(name))) {
      assert.doesNotMatch(zeile, /--stufe/,
        `der Aufruf traegt eine Stufe: ${zeile}`);
    }
  });

  test(`[skills-31] ${name} benennt die Paketstufe und die Auslassung spaeterer Stufen`, () => {
    const text = fliesstext(skill(name));
    const start = text.indexOf("checks.mjs run");
    const fenster = text.slice(start, start + 1400);

    assert.match(fenster, /Paketstufe/,
      "der Skill benennt die gefahrene Stufe nicht");
    assert.match(fenster, /ausgelassen/,
      "es fehlt, dass Pruefungen spaeterer Stufen hier als ausgelassen erscheinen");
    assert.match(fenster, /kein Mangel/,
      "es fehlt, dass die Auslassung kein Mangel ist");
  });
}
