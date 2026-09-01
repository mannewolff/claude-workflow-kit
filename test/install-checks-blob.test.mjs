// Auslieferung von kit/checks.mjs durch den Installer (Issue #425).
//
// Die Skills rufen Kit-Werkzeuge ueber `.claude/kit/<tool>.mjs` auf. Ein Werkzeug,
// das nur in kit/ liegt, ist damit gebaut, aber nicht ausgeliefert — und der Aufruf
// im installierten Projekt liefe ins Leere. Genau dieser Zustand war nach den Issues
// #423 und #424 erreicht.
//
// Geprueft wird nicht die Konstante, sondern ihre Wirkung: dass die Datei im
// Zielverzeichnis ankommt, byteweise der Quelle entspricht und dort — ohne jeden
// Repo-Kontext — startet. Ein Blob, der die Datei zwar ablegt, sie aber abgeschnitten
// oder mit einem unaufloesbaren Import ausschreibt, faellt nur ueber den zweiten Teil
// auf.
//
// Sicherheitsvorkehrungen wie in test/install-flow.test.mjs: cwd UND HOME/USERPROFILE
// zeigen ins Wegwerf-Verzeichnis, damit kein Testlauf die echte Konfiguration anfasst.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = join(repoRoot, "install.mjs");
const QUELLE = join(repoRoot, "kit", "checks.mjs");

// Der kuerzeste Weg durch die Fragen: projektlokal, GitHub, alle Defaults.
const PROJEKT_GITHUB = ["projekt", "github", "github", "", "", "", ""];

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

test("Der Installer schreibt .claude/kit/checks.mjs byteweise identisch zur Quelle", () => {
  const dir = fixture("install-checks-blob-");
  try {
    const res = installiere(dir);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const ziel = join(dir, ".claude", "kit", "checks.mjs");
    assert.ok(existsSync(ziel), "checks.mjs wurde nicht ausgeliefert");

    // Byteweise, nicht als Text: Ein Blob, der beim Kodieren die Kodierung wechselt,
    // faellt ueber einen utf-8-Vergleich nicht auf.
    assert.ok(
      readFileSync(ziel).equals(readFileSync(QUELLE)),
      "die ausgelieferte Datei weicht von kit/checks.mjs ab — Blob nicht nachgezogen?"
    );

    // Die Bestaetigungszeile gehoert dazu: Ohne sie sieht ein Nutzer nicht, dass das
    // Werkzeug ueberhaupt angelegt wurde.
    assert.match(res.stdout, /checks\.mjs geschrieben:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Das ausgelieferte checks.mjs laeuft im Zielprojekt mit --help ohne Import-Fehler", () => {
  const dir = fixture("install-checks-help-");
  try {
    assert.equal(installiere(dir).status, 0);

    // --help ist der einzige Aufruf, der ohne Config auskommt — er prueft genau das,
    // was hier interessiert: dass die Datei als Modul laedt.
    const res = spawnSync(process.execPath, [join(dir, ".claude", "kit", "checks.mjs"), "--help"], {
      cwd: dir,
      encoding: "utf-8",
      env: { ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home") },
    });

    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(res.stderr, "", "ein Import-Fehler landet auf stderr");
    assert.match(res.stdout, /node checks\.mjs plan/);
    assert.match(res.stdout, /node checks\.mjs run/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
