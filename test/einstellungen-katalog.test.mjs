// Der Rollenkatalog in kit/einstellungen.mjs gegen skills/issue-review/SKILL.md
// (Issue #722, Plan #721 E4, E5).
//
// Die Oberfläche soll zu einer Prüfstufe die Rollennamen anbieten, die es wirklich gibt.
// Woher sie stammen, steht nur im Skill — er trägt je Rolle den Prompt. Der Katalog ist
// deshalb ein Nachbau, und dieser Test hält ihn am Skill: Jeder Name des Katalogs steht
// dort wörtlich. Die beiden Vorgaberollen aus `REVIEW_STUFEN_DEFAULT` gehören nicht
// hinein — sie sind Bestandsvorgabe einer Config ohne `reviewStufen`-Block und keine
// Rolle, die der Skill kennt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ROLLEN_KATALOG } from "../kit/einstellungen.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "issue-review", "SKILL.md"), "utf-8");

test("[einstellungen-13] der Katalog kennt genau die drei Prüfstufen", () => {
  assert.deepEqual(Object.keys(ROLLEN_KATALOG).sort(), ["fachlich", "issue", "plan"]);
});

for (const [stufe, rollen] of Object.entries(ROLLEN_KATALOG)) {
  test(`[einstellungen-13] jeder Rollenname der Stufe ${stufe} steht wörtlich in skills/issue-review/SKILL.md`, () => {
    assert.ok(Array.isArray(rollen) && rollen.length > 0, `${stufe}: braucht mindestens einen Rollennamen`);
    for (const rolle of rollen) {
      assert.ok(SKILL.includes(`\`${rolle}\``), `${stufe}: '${rolle}' steht nicht im Skill`);
    }
  });
}

test("[einstellungen-13] der Katalog nennt die beiden Vorgaberollen nicht", () => {
  const alle = new Set(Object.values(ROLLEN_KATALOG).flat());
  for (const vorgabe of ["vollstaendigkeit-pruefbarkeit", "scope-risiko-bestand"]) {
    assert.ok(!alle.has(vorgabe), `'${vorgabe}' ist Bestandsvorgabe, keine Wahl`);
  }
});
