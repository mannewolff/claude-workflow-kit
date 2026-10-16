// Ablauf-Pruefung: Das Update schreibt die geteilte Einstellungsdatei mit englischen Namen und
// erhaelt jeden Wert (Issue #1728, Plan #1710 A2, A4, A10, A12, E1).
//
// Gefahren wird das echte install.mjs im Update-Modus an einer Kopie eines bestehenden Projekts;
// cwd und HOME zeigen in ein Wegwerf-Verzeichnis, dieselbe Vorkehrung wie in
// ablauf-install-flow.test.mjs. Die Umstellung `--language` liest das Board ueber die Attrappe
// INSTALL_BOARD_FAKE, kein Netz.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = join(repoRoot, "install.mjs");

// Dieselbe Antwortfolge wie PROJEKT_GITHUB_BESTAND in ablauf-install-flow.test.mjs.
const PROJEKT_GITHUB_BESTAND = ["projekt", "github", "j", "n", "github", "", "", "", "", "", "", ""];

// Ein deutsches Projekt aus dem Bestand: deutsche Schluessel, deutsche Aufzaehlungswerte, das
// alte Sprachfeld, der alte Anbieter und der entfallene Schalter des Ideen-Speichers.
const BESTAND = {
  sprache: "de",
  provider: "github",
  mainBranch: "main",
  buildChecks: [{ cmd: "npm test", areas: ["kern"], stufe: "paket" }, { cmd: "npm run lint", always: true, art: "hinweis" }],
  checkAreas: { kern: ["src/**"] },
  ohnePruefung: [{ muster: "docs/**", grund: "nur Text" }],
  pushPruefung: { ort: "buildDienst", zweig: "kit-pruefung" },
  szenarienAb: 5,
  vorgeschichte: true,
  toolbox: { ideaStored: true },
  night: { kette: { label: "kit:durchziehen", planMin: 30 } },
  eigenesFeld: { frei: "bleibt" },
};

function projekt(praefix, config) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), praefix)));
  mkdirSync(join(dir, "home"), { recursive: true });
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(config, null, 2) + "\n");
  return dir;
}

function attrappe(dir, name, inhalt) {
  const skript = join(dir, `${name}.mjs`);
  writeFileSync(skript, inhalt);
  return skript;
}

function installiere(dir, argv = [], antworten = PROJEKT_GITHUB_BESTAND) {
  return spawnSync(process.execPath, [INSTALLER, ...argv], {
    cwd: dir,
    input: antworten.join("\n") + "\n",
    encoding: "utf-8",
    env: {
      ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home"),
      INSTALL_SZENARIEN_FAKE: attrappe(dir, "szenarien-fake", "console.log(JSON.stringify({ ab: 1 }));\n"),
      INSTALL_BOARD_FAKE: attrappe(dir, "board-fake", "console.log(\"[]\");\n"),
    },
  });
}

const lies = (dir) => JSON.parse(readFileSync(join(dir, ".claude", "workflow.config.json"), "utf-8"));

test("[1728] das Update schreibt jeden Schluessel englisch und erhaelt jeden Wert, auch paket", () => {
  const dir = projekt("install-migration-werte-", BESTAND);
  try {
    const res = installiere(dir);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    const c = lies(dir);
    for (const deutsch of ["sprache", "ohnePruefung", "pushPruefung", "szenarienAb", "vorgeschichte"]) {
      assert.equal(deutsch in c, false, `${deutsch} steht noch unter seinem deutschen Namen`);
    }
    assert.equal("kette" in c.night, false);
    assert.deepEqual(c.buildChecks, [
      { cmd: "npm test", areas: ["kern"], stage: "paket" },
      { cmd: "npm run lint", always: true, kind: "hinweis" },
    ]);
    assert.deepEqual(c.checkAreas, { kern: ["src/**"] });
    assert.deepEqual(c.noCheck, [{ pattern: "docs/**", reason: "nur Text" }]);
    assert.deepEqual(c.pushCheck, { location: "buildDienst", branch: "kit-pruefung" });
    assert.equal(c.scenariosFrom, 5);
    assert.equal(c.history, true);
    assert.deepEqual(c.night.chain, { label: "kit:durchziehen", planMin: 30 });
    assert.deepEqual(c.eigenesFeld, { frei: "bleibt" }, "ein unbekanntes Feld bleibt, wie es ist");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1728] sprache wird language, provider und toolbox.ideaStored sind fort, die Zahl der Umbenennungen steht in einer Zeile", () => {
  const dir = projekt("install-migration-sprache-", BESTAND);
  try {
    const res = installiere(dir);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    const c = lies(dir);
    assert.equal(c.language, "de");
    assert.equal("sprache" in c, false);
    assert.equal("provider" in c, false);
    assert.equal(c.codeHost, "github");
    assert.equal(c.issueTracker, "github");
    assert.equal(c.toolbox?.ideaStored, undefined);
    // sprache, buildChecks[0].stufe, buildChecks[1].art, ohnePruefung (+ muster, grund),
    // pushPruefung (+ ort, zweig), szenarienAb, vorgeschichte, night.kette.
    const zeilen = res.stdout.split("\n").filter((z) => /umgestellt: \d+/.test(z));
    assert.equal(zeilen.length, 1, res.stdout);
    assert.match(zeilen[0], /: 12$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1728] ein schon englisches Projekt meldet null Umbenennungen, der Installer schreibt history nicht", () => {
  const dir = projekt("install-migration-englisch-", { language: "en", codeHost: "github", issueTracker: "github" });
  try {
    const res = installiere(dir);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /switched to English: 0/);
    assert.equal("history" in lies(dir), false);
    assert.equal("vorgeschichte" in lies(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1728] --language de laesst die Schluessel englisch und stellt nur Aufzaehlungswerte und Sprachfeld um", () => {
  const englisch = {
    language: "en",
    codeHost: "github",
    issueTracker: "github",
    buildChecks: [{ cmd: "npm test", stage: "package" }],
    noCheck: [{ pattern: "docs/**", reason: "only text" }],
  };
  const dir = projekt("install-migration-umstellung-", englisch);
  try {
    const res = installiere(dir, ["--language", "de"], []);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    const c = lies(dir);
    assert.equal(c.language, "de");
    assert.equal("sprache" in c, false);
    assert.deepEqual(c.buildChecks, [{ cmd: "npm test", stage: "paket" }]);
    assert.deepEqual(c.noCheck, [{ pattern: "docs/**", reason: "only text" }]);
    assert.match(res.stdout, /buildChecks\[0\]\.stufe: package → paket/);
    assert.doesNotMatch(res.stdout, /noCheck → ohnePruefung/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Die persoenliche Datei (Issue #1729, Plan #1710 A3, A11, A12, E2) ---

const LOKAL = join(".claude", "workflow.config.local.json");
const ENGLISCH = { language: "en", codeHost: "github", issueTracker: "github" };

function mitLokal(praefix, lokalText) {
  const dir = projekt(praefix, ENGLISCH);
  writeFileSync(join(dir, LOKAL), lokalText);
  return dir;
}

test("[1729] die persoenliche Datei traegt nach dem Update englische Namen, ohne provider und ideaStored, die Sicherung den alten Inhalt", () => {
  const alt = JSON.stringify({
    reviewModel: "opus",
    provider: "github",
    vorgeschichte: true,
    toolbox: { ideaStored: true, host: "http://localhost:1" },
    buildChecks: [{ cmd: "npm test", stufe: "paket" }],
  }, null, 2) + "\n";
  const dir = mitLokal("install-migration-lokal-", alt);
  try {
    const res = installiere(dir);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    const c = JSON.parse(readFileSync(join(dir, LOKAL), "utf-8"));
    assert.equal(c.history, true);
    assert.equal("vorgeschichte" in c, false);
    assert.equal("provider" in c, false);
    assert.deepEqual(c.toolbox, { host: "http://localhost:1" });
    assert.equal(c.reviewModel, "opus");
    assert.deepEqual(c.buildChecks, [{ cmd: "npm test", stage: "paket" }], "der Aufzaehlungswert paket bleibt");
    assert.equal(readFileSync(join(dir, `${LOKAL}.vor-update`), "utf-8"), alt);
    // Die geteilte Datei ist schon englisch; gezaehlt sind vorgeschichte und buildChecks[0].stufe.
    const zeilen = res.stdout.split("\n").filter((z) => /English: \d+/.test(z));
    assert.equal(zeilen.length, 1, res.stdout);
    assert.match(zeilen[0], /: 2$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1729] eine schon englische persoenliche Datei bleibt byte-gleich und bekommt keine Sicherung", () => {
  const alt = '{"reviewModel":"opus","history":true,\n  "buildChecks":[{"cmd":"npm test","stage":"paket"}]}\n';
  const dir = mitLokal("install-migration-lokal-englisch-", alt);
  try {
    const res = installiere(dir);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(readFileSync(join(dir, LOKAL), "utf-8"), alt);
    assert.equal(existsSync(join(dir, `${LOKAL}.vor-update`)), false);
    assert.match(res.stdout, /switched to English: 0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1729] eine unlesbare persoenliche Datei bleibt unberuehrt, das Update laeuft durch", () => {
  const alt = "{ kaputt\n";
  const dir = mitLokal("install-migration-lokal-kaputt-", alt);
  try {
    const res = installiere(dir);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.equal(readFileSync(join(dir, LOKAL), "utf-8"), alt);
    assert.equal(existsSync(join(dir, `${LOKAL}.vor-update`)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
