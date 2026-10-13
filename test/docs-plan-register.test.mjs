/**
 * docs-plan-register.test.mjs — Gate P13 im Plan-Register (Issue #1581).
 *
 * Zwei Folgen des Umbaus auf Englisch (Plan #1420) waeren am Plan erkennbar gewesen: der
 * Skill `/context`, der wie ein eingebautes Kommando von Claude Code heisst, und die
 * strukturgleichen Texttabellen, an denen das Quality Gate von SonarCloud fiel. P13 macht
 * beides zur Pruefung im Plan-Review. Die Pruefer lesen das Register, deshalb steht das
 * Gate in beiden Fassungen von `CLAUDE-Plan.md`; `/techplan` nennt es, damit der Autor es
 * schon beim Schreiben kennt. Skills gibt es seit Issue #1566 nur in einer Fassung.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...teile) => readFileSync(join(root, ...teile), "utf-8");

const P13 = /^## P13 — .*`\[Urteil\]`$/m;

for (const pfad of [["templates", "CLAUDE-Plan.md"], ["en", "templates", "CLAUDE-Plan.md"]]) {
  test(`${pfad.join("/")} traegt Gate P13 mit Kennzeichnung [Urteil]`, () => {
    const text = lies(...pfad);
    assert.match(text, P13, "Gate P13 fehlt oder traegt nicht die Kennzeichnung [Urteil]");
    const abschnitt = text.split(/^## P13 — /m)[1].split(/^## /m)[0];
    assert.match(abschnitt, /Claude Code/, "P13 nennt die eingebauten Kommandos von Claude Code nicht");
    assert.match(abschnitt, /`context`/, "P13 nennt den Vorfall mit dem Skill context nicht");
    assert.match(abschnitt, /sonar\.cpd\.exclusions/, "P13 nennt die Duplikatsmessung nicht");
  });
}

test("P13 steht vor dem Abschnitt 'Ausdruecklich kein Gate'", () => {
  const text = lies("templates", "CLAUDE-Plan.md");
  assert.ok(text.indexOf("## P13 — ") < text.indexOf("## Ausdruecklich kein Gate"));
});

test("/techplan nennt Gate P13", () => {
  assert.match(lies("skills", "techplan", "SKILL.md"), /\bP13\b/);
});
