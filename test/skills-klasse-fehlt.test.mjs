/**
 * skills-klasse-fehlt.test.mjs — die Regel fuer Funde ohne Klassenangabe (Issue #392).
 *
 * Seit Issue #386 traegt jeder Fund eine Klasse, seit #387 haengt das Verhalten
 * daran. Was fehlte, war die Regel fuer den Fall, dass die Angabe **nicht** kommt —
 * und damit hing der ganze Automatismus daran, dass ein Prompt befolgt wird.
 *
 * Die Richtung ist die Entscheidung: Im Zweifel ruft der Fund einen Menschen. Die
 * Gegenrichtung waere bequemer und genau falsch — sie machte das Auslassen der
 * Angabe zur billigsten Variante.
 *
 * Geprueft wird Text, nicht Verhalten.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(root, "skills", "issue-review", "SKILL.md"), "utf-8");

test("Der Nachtbetrieb behandelt einen Fund ohne Klasse wie gate", () => {
  assert.match(SKILL, /ohne Klassenangabe|ohne Klasse/i, "die Regel fehlt ganz");
  // Die drei Wirkungen, die `gate` ausmachen — jede einzeln, damit nicht eine
  // halbe Regel gruen wird.
  const stelle = SKILL.slice(SKILL.search(/ohne Klassenangabe|ohne Klasse/i));
  const block = stelle.slice(0, 900);
  assert.match(block, /wie `gate`|als `gate`/i, "die Gleichsetzung mit gate fehlt");
  assert.match(block, /kit:klaeren/, "das Zeichnen fehlt");
  assert.match(block, /kein[en]? Marker|Marker bleibt aus/i, "das Ausbleiben des Markers fehlt");
});

test("Die Promptbloecke weisen die Klasse als Pflicht aus und nennen die Folge", () => {
  const bloecke = SKILL.split(/^Für jeden Fund/m).slice(1);
  assert.equal(bloecke.length, 6, `${bloecke.length} Promptbloecke statt 6`);
  for (const [i, b] of bloecke.entries()) {
    const kopf = b.slice(0, 1100);
    assert.match(kopf, /Pflicht|verpflichtend|immer anzugeben/i,
      `Block ${i + 1} weist die Klasse nicht als Pflicht aus`);
    assert.match(kopf, /ohne (die )?Angabe|laesst du sie aus|lässt du sie aus|fehlt sie/i,
      `Block ${i + 1} nennt die Folge des Fehlens nicht`);
  }
});

// Ein klassenloser Fund und ein echter `gate`-Fund fuehren zum selben Verhalten,
// bedeuten aber Verschiedenes: "der Reviewer sah eine Regel beruehrt" gegen "der
// Reviewer sagte nichts". Wer die Synthese liest, muss das unterscheiden koennen.
test("Die Synthese kennt die fehlende Klasse als eigenen Ausloeser", () => {
  const syn = SKILL.slice(SKILL.indexOf("zur Entscheidung"));
  assert.match(syn.slice(0, 1600), /fehlende[rn]? Klasse|ohne Klassenangabe|keine Klasse genannt/i,
    "die Synthese nennt die fehlende Klasse nicht als eigenen Ausloeser");
});

// Die Gegenrichtung darf nirgends stehen: Ein klassenloser Fund als `korrektur`
// zu behandeln hiesse, die Maschine unbeaufsichtigt schreiben zu lassen, ohne dass
// jemand die Klasse geprueft hat.
test("Ein klassenloser Fund gilt nirgends als korrektur", () => {
  assert.doesNotMatch(SKILL, /ohne Klasse[^.]{0,80}(gilt|zaehlt|behandelt)[^.]{0,40}`korrektur`/i);
  assert.doesNotMatch(SKILL, /fehlt die Klasse[^.]{0,80}`korrektur`/i);
});
