// Ablauf-Pruefung: Die Referenz entsteht nur beim Start von tools/config-referenz.mjs als Programm gegen eine Kopie mit KIT_ROOT.
//
// Die Einstellungs-Referenz nennt in beiden Fassungen den englischen Pfad nach
// kit/board/config-namen.mjs und keinen deutschen Namen dahinter (Plan #1652, E13).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { SCHLUESSEL } from "../kit/board/config-namen.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(repoRoot, "tools", "config-referenz.mjs");

function erzeugt() {
  const dir = mkdtempSync(join(tmpdir(), "config-referenz-altname-"));
  try {
    for (const d of ["templates", "docs", join("docs", "en"), "tools"]) mkdirSync(join(dir, d), { recursive: true });
    for (const f of ["templates/workflow.config.schema.json", "docs/einstellungen.md", "docs/en/einstellungen.md", "tools/config-referenz.en.json", "tools/config-referenz.vorgaben.json"]) {
      copyFileSync(join(repoRoot, f), join(dir, f));
    }
    const res = spawnSync(process.execPath, [TOOL], { encoding: "utf-8", env: { ...process.env, KIT_ROOT: dir } });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    return {
      de: readFileSync(join(dir, "docs", "einstellungen.md"), "utf-8"),
      en: readFileSync(join(dir, "docs", "en", "einstellungen.md"), "utf-8"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const abschnitt = (text) => text.slice(text.indexOf("<!-- einstellungen:start -->"), text.indexOf("<!-- einstellungen:ende -->"));

/** Der englische Pfad zu einem deutschen: jedes Glied nach der Tabelle. */
function englisch(pfad) {
  const glieder = pfad.split(".");
  return glieder.map((g, i) => {
    const liste = g.endsWith("[]");
    const name = SCHLUESSEL[[...glieder.slice(0, i), g.replace(/\[\]$/, "")].join(".")] ?? g.replace(/\[\]$/, "");
    return liste ? `${name}[]` : name;
  }).join(".");
}

/** Die Pfade am Zeilenanfang des erzeugten Teils. */
const pfade = (text) => [...abschnitt(text).matchAll(/^- `([^`]+)` — /gm)].map((m) => m[1]);

test("beide Fassungen nennen je umbenannter Einstellung den englischen Pfad", () => {
  const { de, en } = erzeugt();
  const umbenannt = Object.keys(SCHLUESSEL).filter((p) => englisch(p) !== p && pfade(de).includes(englisch(p)));
  assert.ok(umbenannt.length > 10);
  for (const fassung of [de, en]) {
    for (const pfad of umbenannt) assert.ok(pfade(fassung).includes(englisch(pfad)), `${englisch(pfad)} fehlt`);
    assert.ok(pfade(fassung).includes("qualityCommands"));
    assert.ok(!pfade(fassung).includes("guetekommandos"));
  }
});

test("beide Fassungen nennen dieselben Pfade in derselben Reihenfolge", () => {
  const { de, en } = erzeugt();
  assert.deepEqual(pfade(en), pfade(de));
});

test("keine Fassung traegt 'German:' oder einen deutschen Namen in Klammern", () => {
  const { de, en } = erzeugt();
  for (const fassung of [de, en]) {
    assert.doesNotMatch(fassung, /German:/);
    assert.doesNotMatch(abschnitt(fassung), /\(Deutsch: /);
  }
});
