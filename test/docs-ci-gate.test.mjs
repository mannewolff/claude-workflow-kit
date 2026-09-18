// Das CI-Gate in der Doku (Issue #316), nach dem Muster von test/docs-commit-gate.test.mjs.
//
// Ein Gate, das nur im Skill steht, ist fuer den Leser der Doku unsichtbar — und genau
// dieser Leser ist es, der sich beim naechsten Release fragt, warum kein PR entstand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOKU = readFileSync(join(repoRoot, "docs", "dokumentation.md"), "utf-8");

/** Der Abschnitt `### /merge-production` bis zur naechsten Ueberschrift derselben Ebene. */
function abschnitt() {
  const start = DOKU.indexOf("### /merge-production");
  assert.notEqual(start, -1, "der Abschnitt `### /merge-production` fehlt");
  const ende = DOKU.indexOf("\n### ", start + 1);
  return DOKU.slice(start, ende === -1 ? undefined : ende);
}

test("[docs] der merge-production-Abschnitt nennt den Aufruf vor dem PR", () => {
  const text = abschnitt();
  assert.match(text, /code ci-status/, "der Aufruf `code ci-status` fehlt");
  assert.match(text, /vor .*(PR|Release)/i, "es steht nicht, dass der Aufruf vor dem PR kommt");
});

test("[docs] der merge-production-Abschnitt sagt, dass bei rot kein PR entsteht", () => {
  const text = abschnitt();
  assert.match(text, /\brot\b/, "der Fall `rot` fehlt");
  assert.match(text, /kein(en)? (PR|Pull Request)/i, "es steht nicht, dass bei `rot` kein PR entsteht");
});

test("[docs] der merge-production-Abschnitt begruendet das Gate mit der Luecke der buildChecks", () => {
  const text = abschnitt();
  assert.match(text, /buildChecks/, "die lokalen `buildChecks` werden nicht genannt");
  assert.match(text, /CI/, "die CI wird nicht genannt");
  assert.match(
    text,
    /messen nicht|misst nicht|nicht, was die CI/i,
    "die Begruendung (lokale buildChecks messen nicht, was die CI misst) fehlt",
  );
});
