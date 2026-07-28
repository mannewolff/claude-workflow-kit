// Versions-Stempel durch sync-blobs.mjs (Issue #171).
//
// Issue #170 hat die KIT_VERSION-Konstante angelegt, zunaechst von Hand gesetzt.
// Von Hand gepflegt waere sie wertlos: Man vergisst sie, und dann behauptet eine
// Datei einen Stand, den sie nicht hat — schlimmer als gar keine Angabe.
//
// sync-blobs.mjs stempelt sie deshalb selbst. Dass ausgerechnet dieses Tool
// zustaendig ist, hat einen Grund: Wuerde version.mjs stempeln, waeren nach dem
// Bump die Blobs veraltet und `sync-blobs --check` — ein buildCheck dieses Repos —
// ginge zwischenzeitlich rot. So bleibt es ein atomarer Schritt.
//
// Getestet wird gegen ein Fixture-Repo im Temp-Verzeichnis: sync-blobs.mjs loest
// seine Pfade relativ zum eigenen Ort auf (root = <tool-dir>/..), laesst sich also
// ueber ein nachgebautes Verzeichnis vollstaendig isolieren.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Minimales Repo mit allem, was sync-blobs.mjs anfasst: die vier Blob-Quellen und
// eine install.mjs mit den vier Konstanten plus VERSION.
function setupFixture(installVersion, kitVersion) {
  const dir = mkdtempSync(join(tmpdir(), "sync-stamp-"));
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "kit"), { recursive: true });
  mkdirSync(join(dir, "templates"), { recursive: true });
  mkdirSync(join(dir, "skills", "beispiel"), { recursive: true });

  copyFileSync(join(repoRoot, "tools", "sync-blobs.mjs"), join(dir, "tools", "sync-blobs.mjs"));
  writeFileSync(join(dir, "templates", "CLAUDE-workflow.md"), "# Vorlage\n");
  writeFileSync(join(dir, "skills", "beispiel", "SKILL.md"), "# Beispiel-Skill\n");
  for (const datei of ["board.mjs", "night.mjs"]) {
    writeFileSync(join(dir, "kit", datei),
      `const KIT_VERSION = "${kitVersion}";\nconsole.log("${datei}");\n`);
  }
  writeFileSync(join(dir, "install.mjs"), [
    `const VERSION = "${installVersion}";`,
    `const CLAUDE_WORKFLOW_MD_B64 = "";`,
    `const BOARD_MJS_B64 = "";`,
    `const NIGHT_MJS_B64 = "";`,
    `const SKILLS_B64 = "";`,
    "",
  ].join("\n"));
  return dir;
}

function syncBlobs(dir, ...cliArgs) {
  return spawnSync(process.execPath, [join(dir, "tools", "sync-blobs.mjs"), ...cliArgs],
    { cwd: dir, encoding: "utf-8" });
}

function stempel(dir, datei) {
  const m = readFileSync(join(dir, "kit", datei), "utf-8").match(/const KIT_VERSION = "([^"]*)";/);
  return m ? m[1] : null;
}

test("Stempel: sync-blobs schreibt die install.mjs-VERSION in beide Kit-Dateien", () => {
  const dir = setupFixture("2.5.0", "1.0.0");
  try {
    const res = syncBlobs(dir);
    assert.equal(res.status, 0, `sync-blobs schlug fehl: ${res.stderr}${res.stdout}`);

    assert.equal(stempel(dir, "board.mjs"), "2.5.0", "board.mjs wurde nicht gestempelt");
    assert.equal(stempel(dir, "night.mjs"), "2.5.0", "night.mjs wurde nicht gestempelt");
    assert.equal(syncBlobs(dir, "--check").status, 0, "--check haette danach gruen sein muessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Stempel: der Blob enthaelt die GESTEMPELTE Fassung, nicht die alte", () => {
  // Reihenfolge-Falle: wird erst der Blob gebacken und dann gestempelt, traegt
  // install.mjs die Datei mit dem alten Stempel — und jede Neuinstallation
  // verteilt eine Kopie, die eine falsche Version behauptet.
  const dir = setupFixture("2.5.0", "1.0.0");
  try {
    assert.equal(syncBlobs(dir).status, 0);

    const installSrc = readFileSync(join(dir, "install.mjs"), "utf-8");
    const b64 = installSrc.match(/const BOARD_MJS_B64 = "([^"]*)";/)[1];
    const eingebettet = Buffer.from(b64, "base64").toString("utf-8");
    assert.match(eingebettet, /const KIT_VERSION = "2\.5\.0";/,
      "der eingebettete Blob traegt noch den alten Stempel");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Stempel: --check meldet Stempel-Drift getrennt vom Blob-Drift", () => {
  const dir = setupFixture("2.5.0", "1.0.0");
  try {
    assert.equal(syncBlobs(dir).status, 0);
    // Nur den Stempel verfaelschen; die Blobs bleiben zur Datei auf Platte konsistent.
    const pfad = join(dir, "kit", "night.mjs");
    writeFileSync(pfad, readFileSync(pfad, "utf-8").replace('"2.5.0"', '"1.9.9"'));

    const res = syncBlobs(dir, "--check");
    assert.equal(res.status, 1, "--check haette bei Stempel-Drift fehlschlagen muessen");
    const meldung = res.stderr + res.stdout;
    assert.match(meldung, /night\.mjs/, "die Meldung nennt die betroffene Datei nicht");
    assert.match(meldung, /1\.9\.9/, "die Meldung nennt den vorgefundenen Wert nicht");
    assert.match(meldung, /2\.5\.0/, "die Meldung nennt den erwarteten Wert nicht");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Stempel: nach einem Versions-Bump zieht sync-blobs beide Dateien nach", () => {
  const dir = setupFixture("2.5.0", "1.0.0");
  try {
    assert.equal(syncBlobs(dir).status, 0);
    // Bump wie durch tools/version.mjs --patch.
    const install = join(dir, "install.mjs");
    writeFileSync(install, readFileSync(install, "utf-8").replace('const VERSION = "2.5.0";', 'const VERSION = "2.5.1";'));

    assert.equal(syncBlobs(dir, "--check").status, 1, "--check haette den Bump als Drift melden muessen");
    assert.equal(syncBlobs(dir).status, 0, "sync-blobs haette den Bump nachziehen muessen");
    assert.equal(stempel(dir, "board.mjs"), "2.5.1");
    assert.equal(stempel(dir, "night.mjs"), "2.5.1");
    assert.equal(syncBlobs(dir, "--check").status, 0, "--check haette danach gruen sein muessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Stempel: fehlende KIT_VERSION-Konstante ist ein harter Fehler, kein stiller Skip", () => {
  const dir = setupFixture("2.5.0", "1.0.0");
  try {
    writeFileSync(join(dir, "kit", "board.mjs"), "console.log('ohne Konstante');\n");

    const res = syncBlobs(dir);
    assert.equal(res.status, 1, "eine fehlende Konstante haette abbrechen muessen");
    assert.match(res.stderr, /KIT_VERSION/, "die Fehlermeldung nennt die Konstante nicht");
    assert.match(res.stderr, /board\.mjs/, "die Fehlermeldung nennt die Datei nicht");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
