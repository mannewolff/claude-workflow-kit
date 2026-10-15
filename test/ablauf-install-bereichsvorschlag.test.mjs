// Ablauf-Pruefung: der Installer faehrt `areas suggest` als Kindprozess — beim ersten Einrichten aus einer Wegwerf-Kopie, beim Update aus .claude/kit/; das zeigt nur ein echter Installer-Lauf.
//
// Der Bereichsvorschlag im Installer (Issue #1721, Plan #1713 A13, E3, E4, fachliche Quelle
// #1706 Kriterium 7 und 13).
//
// Beim ersten Einrichten bietet die Bereichsfrage den gemessenen Vorschlag an: uebernehmen (`j`),
// anpassen (`a`) oder leer = ueberspringen. Beim Update eines Projekts ohne Bereiche nennt die
// Ausgabe in einer Zeile den Befehl fuer den Vorschlag — ohne Frage und ohne Schreiben in die
// Config. Projekte mit Bereichen und Projekte ohne Tests einer unterstuetzten Sprache bekommen
// die Zeile nicht.
//
// Gefahren wird das echte install.mjs im Pipe-Modus, cwd und HOME im Wegwerf-Verzeichnis —
// dieselben Vorkehrungen wie in test/install-bereiche.test.mjs. Die Messung liest den
// Arbeitsstand ueber git, darum ist jedes Fixture ein Git-Repo; die Hook-Frage beantwortet
// dort ein `n`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = join(repoRoot, "install.mjs");
const CHECKS = join(repoRoot, "kit", "checks.mjs");

// Scope, codeHost, Schutzfragen, issueTracker, mainBranch, productionBranch, reviewScope,
// reviewModel, reviewCommand, dann die Hook-Frage (Git-Repo) mit "n".
const VORSPANN_BESTAND = ["projekt", "github", "j", "n", "github", "", "", "", "", "", "n"];
const VORSPANN = ["de", ...VORSPANN_BESTAND];

const VORSCHLAG_FRAGE = "Vorschlag übernehmen? (j = übernehmen, a = anpassen, leer = überspringen)";

function umgebung(dir) {
  return {
    ...process.env,
    HOME: join(dir, "home"),
    USERPROFILE: join(dir, "home"),
    GIT_CONFIG_GLOBAL: join(dir, "home", ".gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

function datei(dir, pfad, inhalt) {
  mkdirSync(dirname(join(dir, pfad)), { recursive: true });
  writeFileSync(join(dir, pfad), inhalt, "utf-8");
}

/** Ein Git-Repo mit den genannten Dateien; `art` waehlt JavaScript- oder Python-Tests. */
function projekt(praefix, art = "js") {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, "home"), { recursive: true });
  const git = spawnSync("git", ["init", "-q"], { cwd: dir, env: umgebung(dir), encoding: "utf-8" });
  assert.equal(git.status, 0, git.stderr);
  if (art === "js") {
    datei(dir, "src/eins.mjs", "export const eins = 1;\n");
    datei(dir, "test/eins.test.mjs", 'import { eins } from "../src/eins.mjs";\nconsole.log(eins);\n');
  } else {
    datei(dir, "src/eins.py", "EINS = 1\n");
    datei(dir, "tests/test_eins.py", "from src.eins import EINS\n\ndef test_eins():\n    assert EINS == 1\n");
  }
  return dir;
}

function mitProjekt(praefix, art, fn) {
  const dir = projekt(praefix, art);
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function installiere(dir, antworten) {
  return spawnSync(process.execPath, [INSTALLER], {
    cwd: dir,
    input: antworten.join("\n") + "\n",
    encoding: "utf-8",
    env: umgebung(dir),
  });
}

function configPfad(dir) {
  return join(dir, ".claude", "workflow.config.json");
}

function config(dir) {
  return JSON.parse(readFileSync(configPfad(dir), "utf-8"));
}

function bestand(dir, felder = {}) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(configPfad(dir), JSON.stringify({ codeHost: "github", issueTracker: "github", ...felder }, null, 2), "utf-8");
}

/** Der Vorschlag, wie ihn das Kommando selbst fuer das Projekt misst — vor der Installation. */
function vorschlagDesKommandos(dir) {
  const res = spawnSync(process.execPath, [CHECKS, "areas", "suggest", "--json"], { cwd: dir, encoding: "utf-8", env: umgebung(dir) });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
}

const zeilenMitBefehl = (ausgabe) => ausgabe.split("\n").filter((zeile) => zeile.includes("areas suggest"));

test("Szenario: Beim Einrichten nach Bereichen gefragt", () => {
  // Uebernehmen: die Config traegt genau die vorgeschlagenen Bereiche.
  mitProjekt("install-vorschlag-j-", "js", (dir) => {
    const vorschlag = vorschlagDesKommandos(dir);
    assert.ok(vorschlag.bereiche.length > 0, JSON.stringify(vorschlag));

    const res = installiere(dir, [...VORSPANN, "j"]);
    const ausgabe = res.stdout + res.stderr;
    assert.equal(res.status, 0, ausgabe);
    assert.ok(ausgabe.includes(VORSCHLAG_FRAGE), ausgabe);
    for (const bereich of vorschlag.bereiche) {
      assert.ok(ausgabe.includes(`    ${bereich.name}: ${bereich.muster.join(", ")}`), ausgabe);
    }
    assert.deepEqual(config(dir).checkAreas, vorschlag.ausschnitt.checkAreas);
  });

  // Anpassen: die bisherige Bereichsfrage mit den vorgeschlagenen Bereichen als vorhandenen.
  mitProjekt("install-vorschlag-a-", "js", (dir) => {
    const vorschlag = vorschlagDesKommandos(dir);

    const res = installiere(dir, [...VORSPANN, "a", "eigen: lib/**", ""]);
    const ausgabe = res.stdout + res.stderr;
    assert.equal(res.status, 0, ausgabe);
    assert.ok(ausgabe.includes("Vorhandene Bereiche (leer = beibehalten)"), ausgabe);
    assert.deepEqual(config(dir).checkAreas, { ...vorschlag.ausschnitt.checkAreas, eigen: ["lib/**"] });
  });

  // Ueberspringen: keine Bereiche, dieselbe Meldung wie ohne Antwort auf die Bereichsfrage.
  mitProjekt("install-vorschlag-leer-", "js", (dir) => {
    const res = installiere(dir, [...VORSPANN, ""]);
    const ausgabe = res.stdout + res.stderr;
    assert.equal(res.status, 0, ausgabe);
    assert.ok(ausgabe.includes(VORSCHLAG_FRAGE), ausgabe);
    assert.ok(ausgabe.includes("Ohne Bereiche fährt jede Karte alle Prüfungen."), ausgabe);
    assert.equal(config(dir).checkAreas, undefined);
  });
});

test("Szenario: Update eines Projekts ohne Bereiche", () => {
  // Ein Projekt mit JavaScript-Tests ohne Bereiche: eine Zeile mit dem Befehl, keine Frage,
  // die Config bleibt ohne checkAreas.
  mitProjekt("install-update-js-", "js", (dir) => {
    bestand(dir);
    const res = installiere(dir, [...VORSPANN_BESTAND]);
    const ausgabe = res.stdout + res.stderr;
    assert.equal(res.status, 0, ausgabe);
    assert.equal(zeilenMitBefehl(ausgabe).length, 1, ausgabe);
    assert.match(zeilenMitBefehl(ausgabe)[0], /node \.claude\/kit\/checks\.mjs areas suggest/);
    assert.ok(!ausgabe.includes(VORSCHLAG_FRAGE), "das Update fragt nicht nach dem Vorschlag");
    assert.equal(config(dir).checkAreas, undefined);
  });

  // Gegenprobe: mit Bereichen keine Zeile.
  mitProjekt("install-update-bereiche-", "js", (dir) => {
    bestand(dir, { checkAreas: { app: ["src/**"] } });
    const res = installiere(dir, [...VORSPANN_BESTAND]);
    const ausgabe = res.stdout + res.stderr;
    assert.equal(res.status, 0, ausgabe);
    assert.deepEqual(zeilenMitBefehl(ausgabe), []);
    assert.deepEqual(config(dir).checkAreas, { app: ["src/**"] });
  });

  // Gegenprobe: mit nur Python-Tests keine Zeile.
  mitProjekt("install-update-python-", "python", (dir) => {
    bestand(dir);
    const res = installiere(dir, [...VORSPANN_BESTAND]);
    const ausgabe = res.stdout + res.stderr;
    assert.equal(res.status, 0, ausgabe);
    assert.deepEqual(zeilenMitBefehl(ausgabe), []);
    assert.equal(config(dir).checkAreas, undefined);
  });
});
