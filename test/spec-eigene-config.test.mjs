// Prueft die EIGENE Config dieses Repos, nicht die Vorlage.
//
// test/config-schema-checks.test.mjs validiert `templates/workflow.config.json` —
// die Datei, die ein neues Projekt bekommt. Die Config, mit der dieses Repo
// tatsaechlich arbeitet, prueft dort niemand. Seit Issue #453 traegt sie den
// spec-Block, und an dessen Feldern haengt das Gate aus Issue #451: `seit`
// entscheidet, welche Pakete gewertet werden, `bereiche` bildet die Bereichsnamen
// auf Code-Globs ab. Ein Tippfehler in einem der beiden faellt sonst erst beim
// naechsten Push auf.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { pruefe } from "./helpers/mini-validator.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const eigeneConfig = JSON.parse(readFileSync(join(repoRoot, ".claude/workflow.config.json"), "utf-8"));
const schema = JSON.parse(readFileSync(join(repoRoot, "templates/workflow.config.schema.json"), "utf-8"));

const DATUM = /^\d{4}-\d{2}-\d{2}$/;

test("eigene Config: validiert vollstaendig gegen das Schema", () => {
  assert.deepEqual(pruefe(schema, eigeneConfig), [], "die eigene Config ist schemawidrig");
});

test("eigene Config: der spec-Block ist gesetzt", () => {
  assert.ok(eigeneConfig.spec, "kein spec-Block — das Kit ist nicht eingeschaltet");
});

test("eigene Config: spec.seit hat das Format JJJJ-MM-TT", () => {
  assert.match(eigeneConfig.spec.seit, DATUM);
});

test("eigene Config: spec.bereiche hat mindestens einen Eintrag", () => {
  const namen = Object.keys(eigeneConfig.spec.bereiche);
  assert.ok(namen.length >= 1, "spec.bereiche ist leer");
});

test("eigene Config: jeder Bereich traegt mindestens ein Glob", () => {
  // Ein Bereich ohne Muster waere einer, den das Gate nie zuordnen kann —
  // das Schema verbietet es (Issue #438), hier wird es am echten Wert belegt.
  for (const [name, globs] of Object.entries(eigeneConfig.spec.bereiche)) {
    assert.ok(Array.isArray(globs) && globs.length >= 1, `Bereich '${name}' hat kein Glob`);
    for (const g of globs) assert.ok(typeof g === "string" && g !== "", `Bereich '${name}' hat ein leeres Glob`);
  }
});

test("eigene Config: spec.testPattern traegt den Platzhalter <ID>", () => {
  // Ohne den Platzhalter faende die Suche in kit/spec.mjs jede ID oder keine.
  // spec.mjs lehnt so ein Muster ab; hier faellt es schon im Test auf.
  assert.ok(eigeneConfig.spec.testPattern.includes("<ID>"), "spec.testPattern ohne Platzhalter <ID>");
});
