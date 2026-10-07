// Tests fuer die Trigger der CI-Workflows (Issue #891, #1274).
//
// Der Guard blob-sync-check lief dreimal auf demselben Inhalt: Push auf main, PR
// main -> production und Push auf production. Geblieben sind der Push auf main und
// der PR nach main. Seit #1274 faehrt der Job nur noch auf Ubuntu, ohne Matrix und
// ohne Vorab-Zweig (Plan #1265, E14).
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

test("[ci-trigger] blob-sync-check triggert weder auf Push noch auf PR nach production", () => {
  const block = onBlock(lies("blob-sync-check.yml"));
  assert.ok(!block.includes("production"), `production steht noch im on-Block:\n${block}`);
});

test("[ci-trigger] blob-sync-check triggert auf main, bei Push und bei Pull Request", () => {
  const block = onBlock(lies("blob-sync-check.yml"));
  assert.match(block, /push:[ \t]*\n[ \t]*branches: \[main\]/);
  assert.match(block, /pull_request:[ \t]*\n[ \t]*branches: \[main\]/);
});

test("[ci-trigger] blob-sync-check nennt weder Windows noch eine Matrix (Issue #1274)", () => {
  const text = lies("blob-sync-check.yml");
  assert.doesNotMatch(text, /windows/i, "die Workflow-Datei nennt noch Windows");
  assert.doesNotMatch(text, /matrix/i, "die Workflow-Datei nennt noch eine Matrix");
  assert.match(text, /runs-on: ubuntu-latest/, "der Job laeuft nicht fest auf ubuntu-latest");
});

test("[ci-trigger] sonarqube triggert unveraendert nur auf main", () => {
  const block = onBlock(lies("sonarqube.yml"));
  assert.match(block, /push:[ \t]*\n[ \t]*branches: \[main\]/);
  assert.ok(!block.includes("production"), `production steht im on-Block:\n${block}`);
});
