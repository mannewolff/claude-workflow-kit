// Die Bereichsfrage des Installers (Issue #1009, Plan #1001 E10, Fachplan #985 AK 9).
//
// Ein neues Projekt wird bei der projektlokalen Installation nach seinen Bereichen
// gefragt, statt sie spaeter von Hand in workflow.config.json einzutragen. Die Frage
// ist die letzte der projektlokalen Fragefolge; bei vorhandenen buildChecks folgt je
// Pruefung die Zuordnung.
//
// Gefahren wird das echte install.mjs im Pipe-Modus, cwd und HOME im Wegwerf-
// Verzeichnis — dieselben Vorkehrungen wie in test/install-flow.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = join(repoRoot, "install.mjs");

// Woertlich so, wie sie im Installer stehen.
const BEREICH_FRAGE = "Bereich (Name: Muster, Muster; leer = fertig)";
const ZUORDNUNG_FRAGE = "Bereiche dieser Prüfung";
const OHNE_BEREICHE = "Ohne Bereiche fährt jede Karte alle Prüfungen.";
const AREAS_HINWEIS = /wirken erst, wenn die Prüfkommandos in workflow\.config\.json sie in 'areas' nennen/;

// Scope, codeHost, issueTracker, mainBranch, productionBranch, reviewScope,
// reviewModel, reviewCommand. Ohne Git-Repo entfaellt die Hook-Frage, die
// naechste Zeile beantwortet also die Bereichsfrage.
const VORSPANN = ["projekt", "github", "github", "", "", "", "", ""];

function fixture(praefix) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, "home"), { recursive: true });
  return dir;
}

function mitFixture(praefix, fn) {
  const dir = fixture(praefix);
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function installiere(dir, antworten, installer = INSTALLER, extraEnv = {}) {
  return spawnSync(process.execPath, [installer], {
    cwd: dir,
    input: antworten.join("\n") + "\n",
    encoding: "utf-8",
    env: {
      ...process.env,
      HOME: join(dir, "home"),
      USERPROFILE: join(dir, "home"),
      GIT_CONFIG_GLOBAL: join(dir, "home", ".gitconfig"),
      GIT_CONFIG_NOSYSTEM: "1",
      ...extraEnv,
    },
  });
}

function configPfad(dir) {
  return join(dir, ".claude", "workflow.config.json");
}

function config(dir) {
  return JSON.parse(readFileSync(configPfad(dir), "utf-8"));
}

function bestand(dir, felder) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(configPfad(dir), JSON.stringify({ codeHost: "github", issueTracker: "github", ...felder }, null, 2), "utf-8");
}

test("Neuinstallation mit leerem buildChecks schreibt nur checkAreas und nennt 'areas'", () => {
  mitFixture("install-bereiche-neu-", (dir) => {
    const res = installiere(dir, [...VORSPANN, "backend: src/**, lib/**", "docs: docs/**", ""]);
    const ausgabe = res.stdout + res.stderr;
    assert.equal(res.status, 0, ausgabe);

    const c = config(dir);
    assert.deepEqual(c.checkAreas, { backend: ["src/**", "lib/**"], docs: ["docs/**"] });
    assert.deepEqual(c.buildChecks, [], "buildChecks bleibt leer");
    assert.match(ausgabe, AREAS_HINWEIS);
    assert.ok(!ausgabe.includes(ZUORDNUNG_FRAGE), "ohne Pruefungen entfaellt die Zuordnungsschleife");
  });
});

test("Die Bereichsfrage ist die letzte Frage der projektlokalen Installation", () => {
  mitFixture("install-bereiche-letzte-", (dir) => {
    // Mit Git-Repo, damit auch die Hook-Frage gestellt wird.
    for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"], ["config", "user.name", "T"]]) {
      assert.equal(spawnSync("git", a, { cwd: dir, encoding: "utf-8",
        env: { ...process.env, GIT_CONFIG_GLOBAL: join(dir, "home", ".gitconfig"), GIT_CONFIG_NOSYSTEM: "1" } }).status, 0);
    }
    const res = installiere(dir, [...VORSPANN, "n", "backend: src/**", ""]);
    const ausgabe = res.stdout + res.stderr;
    assert.equal(res.status, 0, ausgabe);

    const hook = ausgabe.indexOf("Soll das Commit-Gate eingehaengt werden?");
    const bereich = ausgabe.indexOf(BEREICH_FRAGE);
    const skills = ausgabe.indexOf("Kopiere Skills nach");
    assert.ok(hook > 0, "die Hook-Frage muss gestellt worden sein");
    assert.ok(bereich > hook, "die Bereichsfrage kommt nach der Hook-Frage");
    assert.ok(skills > bereich, "nach der Bereichsfrage beginnt die Installation");
    // Zwischen der letzten Bereichsfrage und der Installation steht keine Frage mehr.
    const danach = ausgabe.slice(ausgabe.lastIndexOf(BEREICH_FRAGE), skills);
    assert.equal(danach.split("\n").filter((z) => z.includes("]: ") || /\?\s/.test(z)).length, 0, danach);
    assert.deepEqual(config(dir).checkAreas, { backend: ["src/**"] });
  });
});

test("Globale Installation stellt keine Bereichsfrage", () => {
  mitFixture("install-bereiche-global-", (dir) => {
    const res = installiere(dir, ["global", "github", "github", "", "", "", "", "", ""]);
    const ausgabe = res.stdout + res.stderr;
    assert.equal(res.status, 0, ausgabe);
    assert.ok(!ausgabe.includes(BEREICH_FRAGE), ausgabe);
  });
});

test("Ueberspringen laesst checkAreas und buildChecks unveraendert und sagt es", () => {
  mitFixture("install-bereiche-skip-", (dir) => {
    bestand(dir, { buildChecks: ["npm test", { cmd: "npx eslint .", always: true }] });
    const res = installiere(dir, [...VORSPANN, ""]);
    const ausgabe = res.stdout + res.stderr;
    assert.equal(res.status, 0, ausgabe);

    const c = config(dir);
    assert.equal(c.checkAreas, undefined, "checkAreas darf nicht entstehen");
    assert.deepEqual(c.buildChecks, ["npm test", { cmd: "npx eslint .", always: true }]);
    assert.ok(ausgabe.includes(OHNE_BEREICHE), ausgabe);
    assert.ok(!ausgabe.includes(ZUORDNUNG_FRAGE), "nach dem Ueberspringen wird nichts zugeordnet");
  });
});

test("Antwort mit Bereichen ordnet jede vorhandene Pruefung zu", () => {
  mitFixture("install-bereiche-zuordnung-", (dir) => {
    bestand(dir, { buildChecks: ["npm test", { cmd: "npx eslint .", stufe: "push" }, { cmd: "npm run e2e", always: true }] });
    const res = installiere(dir, [
      ...VORSPANN,
      "backend: src/**", "frontend: web/**", "",
      "backend, frontend", // npm test
      "frontend",          // npx eslint .
      "",                  // npm run e2e: laeuft immer, bleibt wie es ist
    ]);
    const ausgabe = res.stdout + res.stderr;
    assert.equal(res.status, 0, ausgabe);

    const c = config(dir);
    assert.deepEqual(c.checkAreas, { backend: ["src/**"], frontend: ["web/**"] });
    assert.deepEqual(c.buildChecks, [
      { cmd: "npm test", areas: ["backend", "frontend"] },
      { cmd: "npx eslint .", stufe: "push", areas: ["frontend"] },
      { cmd: "npm run e2e", always: true },
    ]);
  });
});

test("Ein bei einer Pruefung genannter, nicht definierter Bereich wird abgewiesen und erneut gefragt", () => {
  mitFixture("install-bereiche-unbekannt-", (dir) => {
    bestand(dir, { buildChecks: ["npm test"] });
    const res = installiere(dir, [...VORSPANN, "backend: src/**", "", "frontend", "backend"]);
    const ausgabe = res.stdout + res.stderr;
    assert.equal(res.status, 0, ausgabe);

    assert.match(ausgabe, /Unbekannter Bereich 'frontend'/);
    assert.equal(ausgabe.split(ZUORDNUNG_FRAGE).length - 1, 2, "die Zuordnung muss erneut gefragt werden");
    assert.deepEqual(config(dir).buildChecks, [{ cmd: "npm test", areas: ["backend"] }]);
  });
});

test("Eine Bereichsangabe ohne Muster wird abgewiesen und erneut gefragt", () => {
  mitFixture("install-bereiche-form-", (dir) => {
    const res = installiere(dir, [...VORSPANN, "backend", "backend:", "backend: src/**", ""]);
    const ausgabe = res.stdout + res.stderr;
    assert.equal(res.status, 0, ausgabe);
    assert.equal(ausgabe.split("Fehler: Bitte 'Name: Muster, Muster' eingeben.").length - 1, 2, ausgabe);
    assert.deepEqual(config(dir).checkAreas, { backend: ["src/**"] });
  });
});

test("Update-Modus: vorhandene Bereiche stehen als Vorgabe da, leer behaelt sie", () => {
  mitFixture("install-bereiche-update-leer-", (dir) => {
    const vorher = {
      checkAreas: { backend: ["src/**"] },
      buildChecks: [{ cmd: "npm test", areas: ["backend"] }, "npx eslint ."],
    };
    bestand(dir, vorher);
    const res = installiere(dir, [...VORSPANN, ""]);
    const ausgabe = res.stdout + res.stderr;
    assert.equal(res.status, 0, ausgabe);

    assert.match(ausgabe, /backend: src\/\*\*/, "der vorhandene Bereich muss als Vorgabe erscheinen");
    assert.ok(ausgabe.includes(`${BEREICH_FRAGE} [beibehalten]: `), ausgabe);
    assert.ok(!ausgabe.includes(OHNE_BEREICHE), "es gibt Bereiche — der Satz waere falsch");
    const c = config(dir);
    assert.deepEqual(c.checkAreas, vorher.checkAreas);
    assert.deepEqual(c.buildChecks, vorher.buildChecks);
  });
});

test("Update-Modus: neue Bereiche kommen hinzu, leere Zuordnung behaelt die vorhandene", () => {
  mitFixture("install-bereiche-update-neu-", (dir) => {
    bestand(dir, {
      checkAreas: { backend: ["src/**"] },
      buildChecks: [{ cmd: "npm test", areas: ["backend"] }, "npx eslint ."],
    });
    const res = installiere(dir, [...VORSPANN, "docs: docs/**", "", "", "docs"]);
    const ausgabe = res.stdout + res.stderr;
    assert.equal(res.status, 0, ausgabe);

    assert.ok(ausgabe.includes(`${ZUORDNUNG_FRAGE} (leer = beibehalten) [backend]: `), ausgabe);
    const c = config(dir);
    assert.deepEqual(c.checkAreas, { backend: ["src/**"], docs: ["docs/**"] });
    assert.deepEqual(c.buildChecks, [
      { cmd: "npm test", areas: ["backend"] },
      { cmd: "npx eslint .", areas: ["docs"] },
    ]);
  });
});

test("install.mjs allein in ein Wegwerfverzeichnis kopiert stellt die Bereichsfrage und schreibt checkAreas", () => {
  mitFixture("install-bereiche-allein-", (dir) => {
    const kopie = join(dir, "install.mjs");
    copyFileSync(INSTALLER, kopie);
    const res = installiere(dir, [...VORSPANN, "app: app/**", ""], kopie);
    const ausgabe = res.stdout + res.stderr;
    assert.equal(res.status, 0, ausgabe);
    assert.ok(ausgabe.includes(BEREICH_FRAGE), ausgabe);
    assert.ok(existsSync(configPfad(dir)));
    assert.deepEqual(config(dir).checkAreas, { app: ["app/**"] });
  });
});
