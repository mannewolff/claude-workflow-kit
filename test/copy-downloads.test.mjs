// Download-Kopien fuer die Doku-Site (Issue #176).
//
// docs.mwolff.org liefert zwei Dateien zum Herunterladen aus: install.mjs und
// board-ui.mjs. Beide sind im Repo genau einmal getrackt; die Fassung unter
// docs/public/ ist ein Generat und steht in .gitignore. Zwei getrackte Kopien
// derselben Datei driften auseinander — am 09.07. war genau das die Ursache
// des Blob-Drifts ueber board-ui.mjs.
//
// Getestet wird wie bei sync-blobs gegen ein Fixture-Repo im Temp-Verzeichnis:
// das Script loest seine Pfade relativ zum eigenen Ort auf (root = <tool-dir>/..)
// und laesst sich ueber ein nachgebautes Verzeichnis vollstaendig isolieren.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Minimales Repo: die beiden Quellen und das Script. docs/public/ fehlt bewusst —
// das Script muss es selbst anlegen (frischer Clone).
function setupFixture(installInhalt, boardUiInhalt) {
  const dir = mkdtempSync(join(tmpdir(), "copy-downloads-"));
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "kit"), { recursive: true });

  copyFileSync(join(repoRoot, "tools", "copy-downloads-for-docs.mjs"),
    join(dir, "tools", "copy-downloads-for-docs.mjs"));
  writeFileSync(join(dir, "install.mjs"), installInhalt);
  writeFileSync(join(dir, "kit", "board-ui.mjs"), boardUiInhalt);
  return dir;
}

function copyDownloads(dir) {
  return spawnSync(process.execPath, [join(dir, "tools", "copy-downloads-for-docs.mjs")],
    { cwd: dir, encoding: "utf-8" });
}

// Byte-Vergleich statt Text: eine Kopie, die sich in der Kodierung unterscheidet,
// ist keine Kopie — der Downloader bekaeme eine andere Datei als das Repo haelt.
function gleicheBytes(dir, quelle, ziel) {
  return readFileSync(join(dir, ...quelle)).equals(readFileSync(join(dir, ...ziel)));
}

test("Kopien: beide Download-Dateien landen byte-gleich unter docs/public/", () => {
  const dir = setupFixture("// install\nconst VERSION = \"9.9.9\";\n", "// board-ui\nconst VERSION = \"1.0.1\";\n");
  try {
    const res = copyDownloads(dir);
    assert.equal(res.status, 0, `Script schlug fehl: ${res.stderr}${res.stdout}`);

    assert.ok(gleicheBytes(dir, ["install.mjs"], ["docs", "public", "install.mjs"]),
      "docs/public/install.mjs weicht von der Quelle ab");
    assert.ok(gleicheBytes(dir, ["kit", "board-ui.mjs"], ["docs", "public", "board-ui.mjs"]),
      "docs/public/board-ui.mjs weicht von der Quelle ab");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Kopien: ein zweiter Lauf zieht eine geaenderte Quelle nach", () => {
  // Ohne Ueberschreiben lieferte die Site nach einem Update der Quelle weiter
  // den alten Stand aus — der Fehler faellt erst beim Nutzer auf.
  const dir = setupFixture("// install v1\n", "// board-ui v1\n");
  try {
    assert.equal(copyDownloads(dir).status, 0);
    writeFileSync(join(dir, "kit", "board-ui.mjs"), "// board-ui v2\n");

    const res = copyDownloads(dir);
    assert.equal(res.status, 0, `zweiter Lauf schlug fehl: ${res.stderr}${res.stdout}`);
    assert.equal(readFileSync(join(dir, "docs", "public", "board-ui.mjs"), "utf-8"), "// board-ui v2\n",
      "die Kopie traegt noch den alten Stand");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
