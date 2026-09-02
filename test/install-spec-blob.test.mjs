// Auslieferung von kit/spec.mjs durch den Installer (Issue #441).
//
// Dieselbe Lage wie bei checks.mjs (#425): Die Skills rufen Kit-Werkzeuge ueber
// `.claude/kit/<tool>.mjs` auf. Ein Werkzeug, das nur in kit/ liegt, ist gebaut,
// aber nicht ausgeliefert — im installierten Projekt liefe der Aufruf ins Leere.
//
// Geprueft wird nicht die Konstante, sondern ihre Wirkung: dass die Datei im
// Zielverzeichnis ankommt, byteweise der Quelle entspricht und dort — ohne jeden
// Repo-Kontext — startet. Ein Blob, der die Datei zwar ablegt, sie aber abgeschnitten
// oder mit einem unaufloesbaren Import ausschreibt, faellt nur ueber den zweiten Teil
// auf.
//
// Sicherheitsvorkehrungen wie in test/install-checks-blob.test.mjs: cwd UND
// HOME/USERPROFILE zeigen ins Wegwerf-Verzeichnis, damit kein Testlauf die echte
// Konfiguration anfasst.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = join(repoRoot, "install.mjs");
const QUELLE = join(repoRoot, "kit", "spec.mjs");

// Der kuerzeste Weg durch die Fragen: projektlokal, GitHub, alle Defaults. Die letzte
// Leerzeile ist die Spec-Frage (leer = Nein, Issue #439).
const PROJEKT_GITHUB = ["projekt", "github", "github", "", "", "", "", "", ""];

function fixture(praefix) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, "home"), { recursive: true });
  return dir;
}

function installiere(dir) {
  return spawnSync(process.execPath, [INSTALLER], {
    cwd: dir,
    input: PROJEKT_GITHUB.join("\n") + "\n",
    encoding: "utf-8",
    env: { ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home") },
  });
}

test("Der Installer schreibt .claude/kit/spec.mjs byteweise identisch zur Quelle", () => {
  const dir = fixture("install-spec-blob-");
  try {
    const res = installiere(dir);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const ziel = join(dir, ".claude", "kit", "spec.mjs");
    assert.ok(existsSync(ziel), "spec.mjs wurde nicht ausgeliefert");

    // Byteweise, nicht als Text: Ein Blob, der beim Kodieren die Kodierung wechselt,
    // faellt ueber einen utf-8-Vergleich nicht auf.
    assert.ok(
      readFileSync(ziel).equals(readFileSync(QUELLE)),
      "die ausgelieferte Datei weicht von kit/spec.mjs ab — Blob nicht nachgezogen?"
    );

    // Die Bestaetigungszeile gehoert dazu: Ohne sie sieht ein Nutzer nicht, dass das
    // Werkzeug ueberhaupt angelegt wurde.
    assert.match(res.stdout, /spec\.mjs geschrieben:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Das ausgelieferte spec.mjs laeuft im Zielprojekt mit --help ohne Import-Fehler", () => {
  const dir = fixture("install-spec-help-");
  try {
    assert.equal(installiere(dir).status, 0);

    // --help ist der einzige Aufruf, der ohne Config und ohne specs/ auskommt — er
    // prueft genau das, was hier interessiert: dass die Datei als Modul laedt.
    const res = spawnSync(process.execPath, [join(dir, ".claude", "kit", "spec.mjs"), "--help"], {
      cwd: dir,
      encoding: "utf-8",
      env: { ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home") },
    });

    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(res.stderr, "", "ein Import-Fehler landet auf stderr");
    assert.match(res.stdout, /node spec\.mjs index/);
    assert.match(res.stdout, /node spec\.mjs show/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
