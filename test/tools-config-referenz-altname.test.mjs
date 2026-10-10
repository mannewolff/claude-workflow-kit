// Ablauf-Pruefung: Die Referenz entsteht nur beim Start von tools/config-referenz.mjs als Programm gegen eine Kopie mit KIT_ROOT.
//
// Englische Einstellungs-Referenz nennt den englischen Namen und dahinter den deutschen
// Altnamen (Issue #1439, Plan #1420 E20, Kriterium 10 der fachlichen Quelle #1416). Die
// deutsche Referenz bleibt unveraendert.

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
    for (const f of ["templates/workflow.config.schema.json", "docs/dokumentation.md", "docs/en/dokumentation.md", "tools/config-referenz.en.json"]) {
      copyFileSync(join(repoRoot, f), join(dir, f));
    }
    const res = spawnSync(process.execPath, [TOOL], { encoding: "utf-8", env: { ...process.env, KIT_ROOT: dir } });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    return {
      de: readFileSync(join(dir, "docs", "dokumentation.md"), "utf-8"),
      en: readFileSync(join(dir, "docs", "en", "dokumentation.md"), "utf-8"),
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

test("die englische Referenz nennt je umbenannter Einstellung beide Namen", () => {
  const { de, en: text } = erzeugt();
  const en = abschnitt(text);
  // Nur Pfade, die die Referenz ausgibt: Ein Feld ohne Beschreibung steht in keiner Fassung.
  const umbenannt = Object.keys(SCHLUESSEL).filter((p) => englisch(p) !== p && abschnitt(de).includes("`" + p + "`"));
  assert.ok(umbenannt.length > 10);
  for (const pfad of umbenannt) {
    assert.ok(en.includes(`\`${englisch(pfad)}\` (German: \`${pfad}\`)`), `${pfad} fehlt mit beiden Namen`);
  }
  assert.match(en, /### `qualityCommands` \(German: `guetekommandos`\)/);
});

test("eine Einstellung mit gleichem Namen in beiden Sprachen steht nur einmal", () => {
  const en = abschnitt(erzeugt().en);
  assert.match(en, /### `mainBranch`\n/);
  assert.doesNotMatch(en, /`mainBranch` \(German:/);
});

test("die deutsche Referenz bleibt unveraendert", () => {
  const { de } = erzeugt();
  assert.equal(abschnitt(de), abschnitt(readFileSync(join(repoRoot, "docs", "dokumentation.md"), "utf-8")));
  assert.doesNotMatch(abschnitt(de), /German:/);
});
