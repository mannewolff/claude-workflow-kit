// Ablauf-Pruefung: Mit Version 5 ist Englisch die Vorgabe fuer neue Projekte (Issue #1474, Plan #1420 E2, E19).
//
// Eine leere Antwort auf die Sprachfrage legt ein englisches Projekt an; ein bestehendes Projekt
// ohne Sprachfeld bleibt deutsch, auch nach dem Update auf Version 5, weil ohne Feld in jeder
// Version `de` gilt (E2). Die Beispiel-Config unter templates/ steht auf Englisch.
//
// cwd und HOME zeigen in ein Wegwerf-Verzeichnis, dieselbe Vorkehrung wie in
// ablauf-install-flow.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { benenneUm } from "../kit/board/config-namen.mjs";
import { projektSprache } from "../kit/board/namen.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = join(repoRoot, "install.mjs");

// Dieselbe Antwortfolge wie PROJEKT_GITHUB_BESTAND in ablauf-install-flow.test.mjs.
const PROJEKT_GITHUB_BESTAND = ["projekt", "github", "j", "n", "github", "", "", "", "", "", "", ""];

function fixture(praefix) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, "home"), { recursive: true });
  return dir;
}

function szenarienFake(dir) {
  const skript = join(dir, "szenarien-fake.mjs");
  writeFileSync(skript, `console.log(JSON.stringify({ ab: 1 }));\n`);
  return skript;
}

function installiere(dir, antworten) {
  return spawnSync(process.execPath, [INSTALLER], {
    cwd: dir,
    input: antworten.join("\n") + "\n",
    encoding: "utf-8",
    env: {
      ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home"),
      INSTALL_SZENARIEN_FAKE: szenarienFake(dir),
    },
  });
}

const config = (dir) => JSON.parse(readFileSync(join(dir, ".claude", "workflow.config.json"), "utf-8"));

test("[install-1474] die Sprachfrage schlaegt en vor, eine leere Antwort schreibt language: en", () => {
  const dir = fixture("install-vorgabe-en-");
  try {
    const res = installiere(dir, ["", ...PROJEKT_GITHUB_BESTAND]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /Sprache \/ Language \[de\/en\] \(en\): /);
    assert.equal(config(dir).language, "en");
    assert.equal("sprache" in config(dir), false, "ein englisches Projekt traegt den englischen Namen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[install-1474] ein bestehendes Projekt ohne Sprachfeld bleibt deutsch", () => {
  const dir = fixture("install-vorgabe-bestand-");
  try {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "workflow.config.json"),
      JSON.stringify({ codeHost: "github", issueTracker: "github" }, null, 2), "utf-8");
    const res = installiere(dir, PROJEKT_GITHUB_BESTAND);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, /Sprache \/ Language/, "ein bestehendes Projekt wird nicht nach der Sprache gefragt");
    assert.equal("language" in config(dir), false);
    assert.equal("sprache" in config(dir), false);
    assert.equal(projektSprache(config(dir)), "de");
    assert.equal(config(dir).scenariosFrom, 1, "auch ein deutsches Projekt bekommt den englischen Namen (Issue #1728)");
    assert.equal("szenarienAb" in config(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[install-1474] templates/workflow.config.json traegt englische Schluessel und language: en", () => {
  const vorlage = JSON.parse(readFileSync(join(repoRoot, "templates", "workflow.config.json"), "utf-8"));
  assert.equal(vorlage.language, "en");
  assert.equal("sprache" in vorlage, false);
  assert.deepEqual(benenneUm(vorlage, "en").umbenannt, [], "die Vorlage traegt noch deutsche Namen");
});
