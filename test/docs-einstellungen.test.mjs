// Die Einstellungs-Referenz der Dokumentation entsteht aus dem Schema (Issue #675,
// Plan #674 E3). Wortgleich bleibt nur, was aus einer Quelle erzeugt wird — dieser Test
// haelt `docs/dokumentation.md` gegen `templates/workflow.config.schema.json`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(repoRoot, "tools", "config-referenz.mjs");

function lauf(args, root) {
  return spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf-8", env: { ...process.env, ...(root ? { KIT_ROOT: root } : {}) } });
}

function mitKopie(fn) {
  const dir = mkdtempSync(join(tmpdir(), "config-referenz-"));
  try {
    mkdirSync(join(dir, "templates"));
    mkdirSync(join(dir, "docs"));
    copyFileSync(join(repoRoot, "templates", "workflow.config.schema.json"), join(dir, "templates", "workflow.config.schema.json"));
    copyFileSync(join(repoRoot, "docs", "dokumentation.md"), join(dir, "docs", "dokumentation.md"));
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("config-referenz --check ist im Repo gruen", () => {
  const res = lauf(["--check"]);
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
});

test("eine geaenderte description macht --check rot und nennt den Abschnitt", () => {
  mitKopie((dir) => {
    const pfad = join(dir, "templates", "workflow.config.schema.json");
    const schema = JSON.parse(readFileSync(pfad, "utf-8"));
    schema.properties.mainBranch.description = "Eine neue Beschreibung.";
    writeFileSync(pfad, JSON.stringify(schema, null, 2));
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Alle Einstellungen/);
  });
});

test("ohne --check schreibt das Werkzeug den Abschnitt, ein zweiter Lauf aendert nichts", () => {
  mitKopie((dir) => {
    const pfad = join(dir, "templates", "workflow.config.schema.json");
    const schema = JSON.parse(readFileSync(pfad, "utf-8"));
    schema.properties.mainBranch.description = "Eine neue Beschreibung.";
    writeFileSync(pfad, JSON.stringify(schema, null, 2));
    assert.equal(lauf([], dir).status, 0);
    const doku = join(dir, "docs", "dokumentation.md");
    const erst = readFileSync(doku, "utf-8");
    assert.match(erst, /Eine neue Beschreibung\./);
    assert.equal(lauf([], dir).status, 0);
    assert.equal(readFileSync(doku, "utf-8"), erst);
    assert.equal(lauf(["--check"], dir).status, 0);
  });
});

test("fehlen die Marker, endet das Werkzeug mit Exit 1 und benennt sie", () => {
  mitKopie((dir) => {
    const doku = join(dir, "docs", "dokumentation.md");
    writeFileSync(doku, readFileSync(doku, "utf-8").replace("<!-- einstellungen:start -->", ""));
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /einstellungen:start/);
  });
});

test("der Abschnitt fuehrt je Wurzelfeld ausser version eine Ueberschrift", () => {
  const schema = JSON.parse(readFileSync(join(repoRoot, "templates", "workflow.config.schema.json"), "utf-8"));
  const doku = readFileSync(join(repoRoot, "docs", "dokumentation.md"), "utf-8");
  const abschnitt = doku.slice(doku.indexOf("<!-- einstellungen:start -->"), doku.indexOf("<!-- einstellungen:ende -->"));
  for (const feld of Object.keys(schema.properties).filter((f) => f !== "version")) {
    assert.match(abschnitt, new RegExp(`^### \`${feld}\`$`, "m"), `Ueberschrift fuer ${feld} fehlt`);
  }
  assert.doesNotMatch(abschnitt, /^### `version`$/m);
});
