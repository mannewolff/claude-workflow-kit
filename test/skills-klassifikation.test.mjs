/**
 * skills-klassifikation.test.mjs — die Klassifikation der Funde (Issue #386).
 *
 * Der Schweregrad sagt, wie schwer ein Fund wiegt, aber nicht, ob eine Maschine
 * ihn anwenden darf. Genau das braucht Issue #387: `korrektur` wird angewendet,
 * `gate` und `alternativen` rufen einen Menschen.
 *
 * Geprueft wird Text, nicht Verhalten.
 *
 * **Sechs Promptbloecke, sieben Rollen:** `vollstaendigkeit-pruefbarkeit`
 * verwendet laut Skill woertlich den Prompt von `pruefbarkeit` und hat deshalb
 * keinen eigenen Block. Der Test prueft die sechs Bloecke und diesen Verweis.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEXT = readFileSync(join(root, "skills", "issue-review", "SKILL.md"), "utf-8");

test("Jeder Promptblock verlangt die Klassifikation neben dem Schweregrad", () => {
  const bloecke = TEXT.split(/^Für jeden Fund/m).slice(1);
  assert.equal(bloecke.length, 6, `${bloecke.length} Promptbloecke statt 6`);
  for (const [i, b] of bloecke.entries()) {
    const kopf = b.slice(0, 700);
    assert.match(kopf, /`gate`/, `Block ${i + 1} nennt gate nicht`);
    assert.match(kopf, /`alternativen`/, `Block ${i + 1} nennt alternativen nicht`);
    assert.match(kopf, /`korrektur`/, `Block ${i + 1} nennt korrektur nicht`);
  }
});

test("Die siebte Rolle erbt den Prompt ausdruecklich", () => {
  assert.match(TEXT, /`vollstaendigkeit-pruefbarkeit`.*verwendet woertlich den Prompt|verwendet wörtlich den Prompt der Rolle `pruefbarkeit`/);
});

// Es sind zwei Ebenen: das prozessweite Register aus Issue #380 und das
// Stufen-Register der geprueften Stufe. "Das Register" im Singular waere falsch.
test("Der Prompt verweist auf beide Register-Ebenen", () => {
  assert.match(TEXT, /CLAUDE-workflow\.md/, "das prozessweite Register fehlt");
  assert.match(TEXT, /CLAUDE-Fachplan\.md/, "das fachliche Stufen-Register fehlt");
  assert.match(TEXT, /CLAUDE-Plan\.md/, "das Plan-Stufen-Register fehlt");
});

// Fuer die Stufe `issue` gibt es kein Format-Register; die Frage ist im Plan
// ausdruecklich vertagt. Der Prompt darf dort keines vorspiegeln.
test("Fuer die Stufe issue wird das fehlende Format-Register benannt", () => {
  // \\s+ statt Leerzeichen: Der Satz steht im Prompt umgebrochen.\n  assert.match(TEXT, /kein\\s+(eigenes\\s+)?Format-Register/i);
});

test("Die Synthese hat einen dritten Ausgang", () => {
  assert.match(TEXT, /zur Entscheidung/);
});

test("Die Abbildung auf das Verhalten steht als Regel da", () => {
  assert.match(TEXT, /`korrektur`.*angewendet/is);
  assert.match(TEXT, /`gate`.*`alternativen`.*kit:klaeren|kit:klaeren.*`gate`/is);
});

// A9 hat "uebernehmbar vs. Entscheidung" ausdruecklich verworfen. Der Begriff darf
// in der Abgrenzung vorkommen, aber nicht als Klassifikation im Prompt.
test("Das verworfene Begriffspaar steht nicht als Klassifikation im Prompt", () => {
  const bloecke = TEXT.split(/^Für jeden Fund/m).slice(1);
  for (const [i, b] of bloecke.entries()) {
    assert.doesNotMatch(b.slice(0, 700), /`uebernehmbar`|`Entscheidung`/,
      `Block ${i + 1} nutzt das verworfene Begriffspaar`);
  }
});
