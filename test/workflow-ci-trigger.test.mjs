// Tests fuer die Trigger der CI-Workflows (Issue #891, #1274, #1411, #1414, #1578).
//
// Der Guard blob-sync-check lief dreimal auf demselben Inhalt: Push auf main, PR
// main -> production und Push auf production. Geblieben sind der Push auf main und
// der PR nach main. Seit #1274 faehrt der Job nur noch auf Ubuntu, ohne Matrix und
// ohne Vorab-Zweig (Plan #1265, E14).
//
// Seit #1411 ist der Job das Gate vor dem Push ueber den Pruefzweig kit-pruefung
// (Plan #1405, A12): Push nur auf kit-pruefung, Pull Request auf main und
// production, kein Push auf production. Der Push-Ausloeser auf main fiel nach dem
// Einrichtungspaket weg (Issue #1414, E11). Er faehrt den vollen Lauf der Stufe push
// gegen den Anker `git merge-base HEAD origin/main` — dafuer braucht der Checkout
// die volle Historie und vorab `git fetch origin main`.
//
// Geprueft wird die Workflow-Datei als Text, nicht ueber einen YAML-Parser: js-yaml
// liegt nur transitiv unter node_modules und steht in keiner devDependency der
// package.json — ein Test darf sich darauf nicht verlassen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const lies = (name) => readFileSync(join(repoRoot, ".github", "workflows", name), "utf8");

// Schneidet den on-Block heraus: ab der Zeile "on:" bis zur naechsten Zeile, die am
// Zeilenanfang beginnt und nicht eingerueckt ist (in beiden Dateien "jobs:").
function onBlock(text) {
  const zeilen = text.split(/\r?\n/);
  const start = zeilen.findIndex((z) => z === "on:");
  assert.notEqual(start, -1, "kein on:-Block gefunden");
  const rest = zeilen.slice(start + 1);
  const ende = rest.findIndex((z) => z.length > 0 && !/^\s/.test(z));
  return rest.slice(0, ende === -1 ? rest.length : ende).join("\n");
}

test("[ci-trigger] blob-sync-check triggert bei Push nur auf kit-pruefung, bei PR auf main und production", () => {
  const block = onBlock(lies("blob-sync-check.yml"));
  assert.match(block, /push:[ \t]*\n[ \t]*branches: \[kit-pruefung\]/);
  assert.match(block, /pull_request:[ \t]*\n[ \t]*branches: \[main, production\]/);
});

test("[ci-trigger] blob-sync-check hat keinen Push-Ausloeser auf production", () => {
  const block = onBlock(lies("blob-sync-check.yml"));
  const push = block.match(/push:[ \t]*\n[ \t]*branches: \[([^\]]*)\]/);
  assert.ok(push, `kein Push-Ausloeser gefunden:\n${block}`);
  assert.ok(!push[1].includes("production"), `Push-Ausloeser nennt production: ${push[1]}`);
});

test("[ci-trigger] blob-sync-check holt die volle Historie und origin/main vor dem Lauf der Stufe push", () => {
  const text = lies("blob-sync-check.yml");
  assert.match(text, /fetch-depth: 0/, "der Checkout holt nicht die volle Historie");
  const holen = text.indexOf("git fetch origin main");
  const lauf = text.search(/checks\.mjs run --stage push --since "\$\(git merge-base HEAD origin\/main\)"/);
  assert.notEqual(holen, -1, "git fetch origin main fehlt");
  assert.notEqual(lauf, -1, "der Lauf der Stufe push mit dem Anker merge-base fehlt");
  assert.ok(holen < lauf, "git fetch origin main steht nicht vor dem Lauf der Stufe push");
});

test("[ci-trigger] blob-sync-check nennt weder Windows noch eine Matrix (Issue #1274)", () => {
  const text = lies("blob-sync-check.yml");
  assert.doesNotMatch(text, /windows/i, "die Workflow-Datei nennt noch Windows");
  assert.doesNotMatch(text, /matrix/i, "die Workflow-Datei nennt noch eine Matrix");
  assert.match(text, /runs-on: ubuntu-latest/, "der Job laeuft nicht fest auf ubuntu-latest");
});

// Seit #1578 (Idee #1546) laeuft Sonar auch auf kit-pruefung, als kurzlebiger Zweig
// gegen main; den Zweig erkennt der Scanner selbst, sonar.branch.name=main faellt weg.
test("[ci-trigger] sonarqube triggert bei Push genau auf main und kit-pruefung", () => {
  const block = onBlock(lies("sonarqube.yml"));
  assert.match(block, /push:[ \t]*\n[ \t]*branches: \[main, kit-pruefung\]/);
  assert.ok(!block.includes("production"), `production steht im on-Block:\n${block}`);
});

test("[ci-trigger] sonarqube setzt sonar.branch.name=main nicht mehr", () => {
  assert.doesNotMatch(lies("sonarqube.yml"), /sonar\.branch\.name=main/);
});

// Mit gesetztem Ziel verlangt der Scanner den Namen ausdruecklich (Lauf vom 2026-10-14,
// Issue #1682): Name und Ziel stehen gemeinsam in der Zeile, die nur auf kit-pruefung greift.
test("[ci-trigger] sonarqube setzt auf kit-pruefung Zweigname und Ziel in derselben Zeile", () => {
  const zeilen = lies("sonarqube.yml").split("\n").filter((z) => z.includes("sonar.branch.name"));
  assert.equal(zeilen.length, 1, `sonar.branch.name steht nicht in genau einer Zeile:\n${zeilen.join("\n")}`);
  assert.match(zeilen[0], /github\.ref_name == 'kit-pruefung'/);
  // Im ${{ }}-Ausdruck setzt format() den Zweignamen ein; geschachteltes ${{ }} geht dort nicht.
  assert.match(zeilen[0], /format\('-Dsonar\.branch\.name=\{0\} [^']*', github\.ref_name\)/);
  assert.match(zeilen[0], /-Dsonar\.branch\.target=main/);
});

// Die SonarCloud-Organisation darf keine Nicht-Hauptzweige auswerten ("Organization is not
// allowed to access data from non main branches", Issue #1683): Auf kit-pruefung laeuft der
// Scan nur mit, ohne Gate, und faerbt den Job nicht rot. Auf main wartet er weiter (Issue #395).
test("[ci-trigger] sonarqube wartet nur ausserhalb von kit-pruefung auf das Quality Gate", () => {
  const zeilen = lies("sonarqube.yml").split("\n").filter((z) => z.includes("sonar.qualitygate.wait"));
  assert.equal(zeilen.length, 1, `sonar.qualitygate.wait steht nicht in genau einer Zeile:\n${zeilen.join("\n")}`);
  assert.match(zeilen[0], /\$\{\{ github\.ref_name != 'kit-pruefung' && '[^']*-Dsonar\.qualitygate\.wait=true[^']*' \|\| '' \}\}/);
  assert.match(zeilen[0], /-Dsonar\.qualitygate\.timeout=300/);
});

test("[ci-trigger] sonarqube-Scan laeuft auf kit-pruefung mit continue-on-error", () => {
  const text = lies("sonarqube.yml");
  const schritt = text.slice(text.indexOf("- name: SonarQube-Scan")).split("\n").map((z) => z.trim());
  assert.ok(
    schritt.includes("continue-on-error: ${{ github.ref_name == 'kit-pruefung' }}"),
    "Der Scan-Schritt traegt kein continue-on-error fuer kit-pruefung",
  );
});
