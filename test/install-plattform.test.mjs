// Der Installer weist natives Windows ab (Issue #1276, Plan #1265 E1–E3).
//
// Er ist die einzige Stelle, an der das Kit natives Windows noch erkennt (Fachplan #1264,
// Kriterien 6 und 9). Die Erkennung nimmt die Plattform als Parameter, damit sie auf
// jedem Host pruefbar ist; der Ablauf-Test taeuscht die Plattform per Vorlader vor und
// belegt, dass der Abbruch vor jeder Ausgabe und vor jedem Schreibzugriff kommt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

import { windowsAbweisung } from "../install.mjs";

const INSTALLER = join(dirname(fileURLToPath(import.meta.url)), "..", "install.mjs");

const MELDUNG = [
  "claude-workflow-kit unterstützt natives Windows ab Version 4.0.0 nicht mehr.",
  "Richte das Kit in WSL2 ein: https://docs.mwolff.org/wsl2",
];

test("[1276] die Erkennung liefert unter win32 die Abbruchmeldung", () => {
  assert.deepEqual(windowsAbweisung("win32"), MELDUNG);
});

test("[1276] unter linux und darwin bricht die Erkennung nicht ab", () => {
  assert.equal(windowsAbweisung("linux"), null, "WSL2 meldet linux und bleibt der unterstuetzte Weg");
  assert.equal(windowsAbweisung("darwin"), null);
});

test("[1276] ohne Argument gilt die Plattform des laufenden Prozesses", () => {
  assert.equal(windowsAbweisung(), windowsAbweisung(process.platform));
});

test("[1276] install.mjs bricht unter vorgetaeuschtem win32 vor jeder Ausgabe und jedem Schreibzugriff ab", () => {
  const werkzeug = mkdtempSync(join(tmpdir(), "install-plattform-vorlader-"));
  const dir = mkdtempSync(join(tmpdir(), "install-plattform-"));
  try {
    const vorlader = join(werkzeug, "win32.mjs");
    writeFileSync(vorlader, 'Object.defineProperty(process, "platform", { value: "win32" });\n', "utf-8");

    const res = spawnSync(process.execPath, ["--import", pathToFileURL(vorlader).href, INSTALLER], {
      cwd: dir, encoding: "utf-8", input: "j\n", timeout: 30_000,
    });

    assert.equal(res.status, 1, `${res.stderr}\n${res.stdout}`);
    assert.equal(res.stdout, "", "vor der Meldung erscheint keine Ausgabe");
    assert.equal(res.stderr, `${MELDUNG.join("\n")}\n`, "genau die zwei Zeilen der Meldung auf stderr");
    assert.deepEqual(readdirSync(dir), [], "das Verzeichnis bleibt unveraendert leer");
  } finally {
    rmSync(werkzeug, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1276] auch --version kommt unter win32 nicht an der Abweisung vorbei", () => {
  const werkzeug = mkdtempSync(join(tmpdir(), "install-plattform-vorlader-"));
  try {
    const vorlader = join(werkzeug, "win32.mjs");
    writeFileSync(vorlader, 'Object.defineProperty(process, "platform", { value: "win32" });\n', "utf-8");

    const res = spawnSync(process.execPath, ["--import", pathToFileURL(vorlader).href, INSTALLER, "--version"], {
      cwd: werkzeug, encoding: "utf-8", timeout: 30_000,
    });

    assert.equal(res.status, 1, `${res.stderr}\n${res.stdout}`);
    assert.equal(res.stdout, "");
    assert.equal(res.stderr, `${MELDUNG.join("\n")}\n`);
  } finally {
    rmSync(werkzeug, { recursive: true, force: true });
  }
});
