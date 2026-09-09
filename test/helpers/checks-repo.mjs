// Wegwerf-Repository fuer die Tests von kit/checks.mjs (Issue #423).
//
// Die Auswahl liest ihren Zustand aus zwei Quellen, die sich nicht nachbilden
// lassen: `git diff` gegen einen Anker und `git status` fuer Ungetracktes. Ein
// Mock davon wuerde genau die Frage offenlassen, um die es geht — ob eine
// Loeschung, eine Umbenennung oder ein committetes Paket wirklich mitzaehlt.
// Deshalb laeuft jeder Test gegen ein echtes, frisch angelegtes Repo im
// Temp-Verzeichnis, nach dem Muster der night-*-Tests.

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { delimiter, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const CHECKS = join(repoRoot, "kit", "checks.mjs");
export const GATE = join(repoRoot, ".githooks", "gate.mjs");
export const HOOK = join(repoRoot, ".githooks", "pre-commit");

export function git(dir, ...args) {
  const res = spawnSync("git", args, { cwd: dir, encoding: "utf-8" });
  assert.equal(res.status, 0, `git ${args.join(" ")} schlug fehl: ${res.stderr}`);
  return res.stdout.trim();
}

/** Roher Aufruf — fuer die Faelle, in denen der Exit-Code selbst der Befund ist. */
export function checks(dir, ...cliArgs) {
  return spawnSync(process.execPath, [CHECKS, ...cliArgs], { cwd: dir, encoding: "utf-8" });
}

/**
 * Derselbe Aufruf, aber mit `fakebin` vorne im PATH (Issue #504). Die uebrige
 * Umgebung wird durchgereicht — insbesondere NODE_V8_COVERAGE, sonst faende die
 * Messung den Kindprozess nicht.
 */
export function checksMitFakeGit(dir, ...cliArgs) {
  const env = { ...process.env, PATH: `${join(dir, "fakebin")}${delimiter}${process.env.PATH}` };
  return spawnSync(process.execPath, [CHECKS, ...cliArgs], { cwd: dir, encoding: "utf-8", env });
}

/**
 * Ein Fake-`git` in `<dir>/fakebin`, das genau ein Unterkommando scheitern laesst
 * und alles andere an das echte git durchreicht (Issue #504, Muster `fakeCli` aus
 * board-fixture.mjs). Anders als ein Mock laesst es die uebrigen git-Aufrufe von
 * checks.mjs unangetastet: `rev-parse` loest weiter auf, nur der eine Schritt
 * danach bricht ab — genau die Reihenfolge, um die es in den Fehlerpfaden geht.
 *
 * Der Pfad des echten git wird hier aufgeloest und fest eingetragen. Ein
 * `exec git "$@"` im Wrapper riefe sich selbst wieder auf, weil `fakebin` im PATH
 * vorne steht.
 *
 * `meldung: null` laesst das Unterkommando stumm scheitern — der Fall, in dem
 * checks.mjs seine Meldung ohne Zutun von git bilden muss.
 */
export function fakeGitOhne(dir, unterkommando, meldung = "fake: absichtlich gescheitert") {
  const echtesGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf-8" }).stdout.trim();
  assert.ok(echtesGit, "das echte git liess sich nicht im PATH finden");

  const binDir = join(dir, "fakebin");
  mkdirSync(binDir, { recursive: true });
  const wrapper = [
    "#!/bin/sh",
    "# Generiert von test/helpers/checks-repo.mjs (Issue #504) — kein Produktivcode.",
    `if [ "$1" = ${JSON.stringify(unterkommando)} ]; then`,
    meldung === null ? "  :" : `  printf '%s\\n' ${JSON.stringify(meldung)} >&2`,
    "  exit 128",
    "fi",
    `exec ${JSON.stringify(echtesGit)} "$@"`,
    "",
  ].join("\n");
  const cliPfad = join(binDir, "git");
  writeFileSync(cliPfad, wrapper, "utf-8");
  chmodSync(cliPfad, 0o755);
  return binDir;
}

/** Erfolgreicher `plan`-Aufruf, JSON geparst. */
export function plan(dir, ...cliArgs) {
  const res = checks(dir, "plan", ...cliArgs);
  assert.equal(res.status, 0, `checks.mjs plan schlug fehl (${res.status}): ${res.stderr}`);
  return JSON.parse(res.stdout);
}

/** Roher `run`-Aufruf — bei `run` ist der Exit-Code selbst ein Ergebnis (Issue #424). */
export function run(dir, ...cliArgs) {
  return checks(dir, "run", ...cliArgs);
}

/** Die Zusammenfassung, die `run` hinterlaesst. */
export function zusammenfassung(dir) {
  return JSON.parse(readFileSync(join(dir, ".claude", "checks-summary.json"), "utf-8"));
}

/**
 * Der Stand des Working Tree als Text. `--untracked-files=all` wie in checks.mjs:
 * sonst faellt eine einzelne Datei in einem neuen Verzeichnis unter den Tisch.
 */
export function treeStand(dir) {
  return git(dir, "status", "--porcelain", "--untracked-files=all");
}

export function datei(dir, pfad, inhalt = "Inhalt\n") {
  const ziel = join(dir, pfad);
  mkdirSync(dirname(ziel), { recursive: true });
  writeFileSync(ziel, inhalt, "utf-8");
}

export function repoAnlegen({ config = {}, configText = null, ohneConfig = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "checks-"));
  // Eine getrackte Datei von Anfang an: sonst haette der Setup-Commit im Fall
  // `ohneConfig` nichts zu committen und das Repo bliebe ohne HEAD.
  datei(dir, "README.md", "# Wegwerf\n");
  // Dieselbe Ignore-Regel, die ein installiertes Projekt hat (Issue #208/#209):
  // alles unter .claude/ ist lokaler Zustand, nur die workflow.config.json gehoert
  // ins Repo. Ohne sie wuerde die Zusammenfassung aus `run` (Issue #424) hier als
  // Tree-Aenderung erscheinen, waehrend sie es im echten Projekt nie tut — das
  // Wegwerf-Repo wuerde dann etwas anderes pruefen als den Ernstfall.
  //
  // `fakebin/` steht aus demselben Grund dabei (Issue #504): Das Fake-`git` ist
  // Werkzeug des Tests und kein Teil des Arbeitspakets; ungetrackt wuerde es als
  // geaenderte Datei zaehlen und jeden Lauf in den vollen Umfang ziehen.
  datei(dir, ".gitignore", ".claude/*\n!.claude/workflow.config.json\nfakebin/\n");
  if (!ohneConfig) {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    const inhalt = configText ?? JSON.stringify(config, null, 2) + "\n";
    writeFileSync(join(dir, ".claude", "workflow.config.json"), inhalt, "utf-8");
  }
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.invalid");
  git(dir, "config", "user.name", "T");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "setup");
  return dir;
}

export function mitRepo(optionen, fn) {
  const dir = repoAnlegen(optionen);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Ruft das Commit-Gate im Wegwerf-Repo auf (Issue #470). `checks.mjs` liegt dort
 * unter `.claude/kit/`, wohin `gateEinbauen` es legt.
 */
export function gate(dir, ...cliArgs) {
  return spawnSync(process.execPath, [join(dir, ".githooks", "gate.mjs"), ...cliArgs], {
    cwd: dir,
    encoding: "utf-8",
  });
}

/** Legt Hook und Gate im Wegwerf-Repo an — das macht sonst der Installer (#473). */
export function gateEinbauen(dir, { checksOrt = ".claude/kit" } = {}) {
  mkdirSync(join(dir, ".githooks"), { recursive: true });
  writeFileSync(join(dir, ".githooks", "gate.mjs"), readFileSync(GATE, "utf-8"), "utf-8");
  writeFileSync(join(dir, ".githooks", "pre-commit"), readFileSync(HOOK, "utf-8"), { mode: 0o755 });
  if (checksOrt) {
    mkdirSync(join(dir, checksOrt), { recursive: true });
    writeFileSync(join(dir, checksOrt, "checks.mjs"), readFileSync(CHECKS, "utf-8"), "utf-8");
  }
}

/** Findet einen Eintrag aus `laufen` oder `ausgelassen` ueber sein Kommando. */
export function eintrag(liste, cmd) {
  return liste.find((e) => e.cmd === cmd);
}

export function kommandos(liste) {
  return liste.map((e) => e.cmd);
}
