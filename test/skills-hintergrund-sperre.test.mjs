// Die Texte nennen die Hintergrundsperre (Issue #1081).
//
// Der Hook `bash-pruefen` weist `run_in_background` ab, sobald `KIT_AGENT_MODEL` gesetzt
// ist. Die Regel dahinter stand vorher allein im Text und wurde gebrochen; jetzt sagen die
// Texte, dass das Werkzeug sie durchsetzt — damit eine Session die Abweisung versteht,
// statt einen Umweg zu suchen. Interaktiv bleibt Hintergrundarbeit erlaubt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (pfad) => readFileSync(join(wurzel, pfad), "utf-8");

const TEXTE = [
  "skills/local-check/SKILL.md",
  "skills/implement-next/SKILL.md",
  "skills/implement-ready/SKILL.md",
  "skills/implement-done/SKILL.md",
  "skills/implement-test/SKILL.md",
  "docs/dokumentation.md",
];

/** Die Sperre ist genannt: das Feld, die Bedingung und dass interaktiv erlaubt bleibt. */
function nenntSperre(text) {
  return /run_in_background/.test(text) && /KIT_AGENT_MODEL/.test(text) && /interaktiv/i.test(text)
    && /hook bash-pruefen|Hook `bash-pruefen`|Hook bash-pruefen/.test(text);
}

for (const pfad of TEXTE) {
  test(`${pfad} nennt die Hintergrundsperre ohne Aufsicht`, () => {
    assert.ok(nenntSperre(lies(pfad)), `${pfad} nennt run_in_background, KIT_AGENT_MODEL, den Hook oder die interaktive Ausnahme nicht`);
  });
}

test("die Pruefung wird rot, wenn ein Text die Sperre nicht nennt", () => {
  const ohne = lies("skills/implement-next/SKILL.md").replaceAll("run_in_background", "im Hintergrund");
  assert.equal(nenntSperre(ohne), false);
});
