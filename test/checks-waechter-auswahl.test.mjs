// Der Waechter laeuft bei jeder geaenderten Testdatei mit (Issue #1374).
//
// `test/checks-leichtigkeit.test.mjs` prueft jede Testdatei unter `test/`. Lief er nur in
// der Gruppe `test/checks-*.test.mjs`, deren Bereiche eine Testdatei unter `test/docs-*`
// nicht treffen, kam eine neue Testdatei ohne Kopfzeile `// Ablauf-Pruefung:` durch
// (Issue #1355, aufgefallen in der Nachpruefung von #1358). Der Fall unten nimmt die
// echte Config dieses Repos und belegt, dass `plan` fuer eine einzelne geaenderte
// Testdatei den Waechter auswaehlt; die Gegenprobe zeigt, dass der eigene Eintrag in
// `buildChecks` genau das traegt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mitRepo, plan, datei, kommandos } from "./helpers/checks-repo.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const WAECHTER = "node --test test/checks-leichtigkeit.test.mjs";

/** Die pruefrelevanten Teile der echten Config dieses Repos. */
function echteConfig() {
  const c = JSON.parse(readFileSync(join(repoRoot, ".claude", "workflow.config.json"), "utf-8"));
  const { buildChecks, checkAreas, ohnePruefung, nurGeruest } = c;
  return { buildChecks, checkAreas, ohnePruefung, nurGeruest };
}

function laufenFuerTestdatei(config) {
  return mitRepo({ config }, (dir) => {
    datei(dir, "test/docs-beispiel.test.mjs", 'import { test } from "node:test";\ntest("x", () => {});\n');
    return kommandos(plan(dir, "--since", "HEAD").laufen);
  });
}

test("[1374] fuer eine geaenderte Testdatei unter test/ waehlt plan den Waechter aus", () => {
  assert.ok(laufenFuerTestdatei(echteConfig()).includes(WAECHTER), "der Waechter laeuft nicht mit");
});

test("[1374] Gegenprobe: ohne den eigenen Eintrag in buildChecks laeuft der Waechter nicht mit", () => {
  const config = echteConfig();
  config.buildChecks = config.buildChecks.filter((b) => (typeof b === "string" ? b : b.cmd) !== WAECHTER);
  assert.ok(!laufenFuerTestdatei(config).includes(WAECHTER), "der Waechter liefe auch ohne den Eintrag");
});
