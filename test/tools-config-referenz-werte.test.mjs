// Ablauf-Pruefung: Die Referenz entsteht nur beim Start von tools/config-referenz.mjs als Programm gegen eine Kopie mit KIT_ROOT.
//
// Die Einstellungszeile nennt den Wertebereich aus minimum, maximum und const des Schemas,
// und die Vorgaben von reviewStages sagen, dass sie nur gelten, wenn der ganze Block fehlt
// (Issue #1669, Code-Review zu #1653).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(repoRoot, "tools", "config-referenz.mjs");
const DATEIEN = ["templates/workflow.config.schema.json", "docs/einstellungen.md", "docs/en/einstellungen.md", "tools/config-referenz.en.json", "tools/config-referenz.vorgaben.json"];

function erzeugt(tabelleAendern) {
  const dir = mkdtempSync(join(tmpdir(), "config-referenz-werte-"));
  try {
    for (const d of ["templates", "docs", join("docs", "en"), "tools"]) mkdirSync(join(dir, d), { recursive: true });
    for (const f of DATEIEN) copyFileSync(join(repoRoot, f), join(dir, f));
    if (tabelleAendern) {
      const pfad = join(dir, "tools", "config-referenz.vorgaben.json");
      writeFileSync(pfad, JSON.stringify(tabelleAendern(JSON.parse(readFileSync(pfad, "utf-8")))));
    }
    const res = spawnSync(process.execPath, [TOOL], { encoding: "utf-8", env: { ...process.env, KIT_ROOT: dir } });
    return {
      res,
      de: res.status === 0 ? readFileSync(join(dir, "docs", "einstellungen.md"), "utf-8") : "",
      en: res.status === 0 ? readFileSync(join(dir, "docs", "en", "einstellungen.md"), "utf-8") : "",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Die Zeile einer Einstellung im erzeugten Teil. */
const zeile = (text, pfad) => text.split("\n").find((z) => z.startsWith(`- \`${pfad}\` — `)) ?? "";

test("Wertebereich aus minimum und maximum steht in der Zeile", () => {
  const { res, de, en } = erzeugt();
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.match(zeile(de, "buildChecks[].quality.marker"), /Werte: 0 bis 100\./);
  assert.match(zeile(en, "buildChecks[].quality.marker"), /Values: 0 to 100\./);
});

test("nur minimum wird als untere Grenze genannt", () => {
  const { de, en } = erzeugt();
  assert.match(zeile(de, "reviewStages.requirement.reviewer"), /Werte: ab 1\./);
  assert.match(zeile(en, "reviewStages.requirement.reviewer"), /Values: from 1\./);
});

test("const wird als einziger Wert genannt", () => {
  const { de, en } = erzeugt();
  const de_ = de.split("\n").filter((z) => /^- `[^`]*\.defaults` — /.test(z));
  const en_ = en.split("\n").filter((z) => /^- `[^`]*\.defaults` — /.test(z));
  assert.ok(de_.length > 0, "keine Zeile mit const gefunden");
  for (const z of de_) assert.match(z, /Wert: `true`\./);
  for (const z of en_) assert.match(z, /Value: `true`\./);
});

test("reviewStages nennt die Bedingung: Vorgabe nur, wenn der ganze Block fehlt", () => {
  const { de, en } = erzeugt();
  assert.match(zeile(de, "reviewStages"), /nur, wenn der ganze Block fehlt/);
  assert.match(zeile(en, "reviewStages"), /only if the whole block is missing/);
  for (const stufe of ["requirement", "plan", "issue"]) {
    for (const feld of ["reviewer", "roles"]) {
      assert.match(zeile(de, `reviewStages.${stufe}.${feld}`), /nur, wenn der ganze Block `reviewStages` fehlt/, `${stufe}.${feld}`);
      assert.match(zeile(en, `reviewStages.${stufe}.${feld}`), /only if the whole `reviewStages` block is missing/, `${stufe}.${feld}`);
    }
  }
});

test("eine Bedingung ohne englische Fassung ist ein Fehler der Tabelle", () => {
  const { res } = erzeugt((t) => ({ ...t, reviewStufen: { ...t.reviewStufen, bedingung: { de: "nur so" } } }));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /reviewStufen: bedingung braucht de und en/);
});
