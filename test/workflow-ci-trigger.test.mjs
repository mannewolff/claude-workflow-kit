// Tests fuer die Trigger der CI-Workflows (Issue #891, #1152).
//
// Der Guard blob-sync-check lief dreimal auf demselben Inhalt: Push auf main, PR
// main -> production und Push auf production. Mit der Matrix aus zwei Plattformen
// waren das sechs Jobs, von denen vier nichts Neues finden konnten. Geblieben sind
// der Push auf main (beide Plattformen) und der PR nach main (nur Ubuntu).
// Seit #1152 kommt der Push auf den Vorab-Zweig windows-vorab dazu, ebenfalls mit
// beiden Plattformen: Dort laeuft Windows vor der Veroeffentlichung auf main (#1147).
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
  assert.match(block, /push:[ \t]*\n[ \t]*branches: \[main, windows-vorab\]/);
  assert.match(block, /pull_request:[ \t]*\n[ \t]*branches: \[main\]/);
});

test("[ci-trigger] blob-sync-check triggert auf Pushes nach windows-vorab, nicht auf PRs dorthin", () => {
  const block = onBlock(lies("blob-sync-check.yml"));
  const push = block.match(/push:[ \t]*\n[ \t]*branches: \[([^\]]*)\]/);
  assert.ok(push, `kein push.branches im on-Block:\n${block}`);
  assert.ok(push[1].split(",").map((b) => b.trim()).includes("windows-vorab"), `windows-vorab fehlt in push.branches: [${push[1]}]`);
  const pr = block.match(/pull_request:[ \t]*\n[ \t]*branches: \[([^\]]*)\]/);
  assert.ok(pr && !pr[1].includes("windows-vorab"), `windows-vorab steht in pull_request.branches:\n${block}`);
});

test("[ci-trigger] die Matrix faehrt Windows bei jedem Push, Pull Requests nur Ubuntu", () => {
  const text = lies("blob-sync-check.yml");
  const osZeile = text.split(/\r?\n/).find((z) => z.trim().startsWith("os:"));
  assert.ok(osZeile, "keine os:-Zeile gefunden");
  // Bedingung allein am Ereignis, nicht am Zweig: dann gilt sie fuer main und windows-vorab.
  assert.match(
    osZeile,
    /github\.event_name == 'push' && fromJSON\('\["ubuntu-latest","windows-latest"\]'\) \|\| fromJSON\('\["ubuntu-latest"\]'\)/,
  );
  assert.ok(!osZeile.includes("github.ref"), `die Matrix haengt am Zweig: ${osZeile}`);
});

test("[ci-trigger] sonarqube triggert unveraendert nur auf main", () => {
  const block = onBlock(lies("sonarqube.yml"));
  assert.match(block, /push:[ \t]*\n[ \t]*branches: \[main\]/);
  assert.ok(!block.includes("production"), `production steht im on-Block:\n${block}`);
});
