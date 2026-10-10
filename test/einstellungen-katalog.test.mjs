// Der Rollenkatalog in kit/einstellungen.mjs gegen die Rollendateien unter kit/rollen/
// (Issue #722, Plan #721 E4, E5; seit Issue #1383 die Rollendateien statt des Skilltexts).
//
// Die Oberfläche soll zu einer Prüfstufe die Rollennamen anbieten, die es wirklich gibt.
// Woher sie stammen, steht unter kit/rollen/ — je Rolle eine Datei mit ihrem Prompt. Der
// Katalog ist deshalb ein Nachbau, und dieser Test hält ihn an den Dateien: Zu jedem Namen
// des Katalogs gibt es `kit/rollen/<rolle>.md`. Die beiden Vorgaberollen aus
// `REVIEW_STUFEN_DEFAULT` gehören nicht hinein — sie sind Bestandsvorgabe einer Config ohne
// `reviewStufen`-Block und keine Rolle mit eigener Datei.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ROLLEN_KATALOG } from "../kit/einstellungen.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("[einstellungen-13] der Katalog kennt genau die drei Prüfstufen", () => {
  assert.deepEqual(Object.keys(ROLLEN_KATALOG).sort(), ["fachlich", "issue", "plan"]);
});

for (const [stufe, rollen] of Object.entries(ROLLEN_KATALOG)) {
  test(`[einstellungen-13] jeder Rollenname der Stufe ${stufe} hat eine Datei kit/rollen/<rolle>.md`, () => {
    assert.ok(Array.isArray(rollen) && rollen.length > 0, `${stufe}: braucht mindestens einen Rollennamen`);
    for (const rolle of rollen) {
      assert.ok(existsSync(join(repoRoot, "kit", "rollen", `${rolle}.md`)), `${stufe}: kit/rollen/${rolle}.md fehlt`);
    }
  });
}

test("[einstellungen-1383] der SYNC-Kommentar am Katalog zeigt auf kit/rollen/", () => {
  const quelle = readFileSync(join(repoRoot, "kit", "einstellungen.mjs"), "utf-8");
  const vor = quelle.slice(0, quelle.indexOf("export const ROLLEN_KATALOG"));
  const kommentar = vor.slice(vor.lastIndexOf("/**"));
  assert.match(kommentar, /SYNC:[^\n]*kit\/rollen\//, "der SYNC-Kommentar zeigt nicht auf kit/rollen/");
  assert.doesNotMatch(kommentar, /skills\/issue-review\/SKILL\.md/, "der Kommentar zeigt noch auf den Skill");
});
