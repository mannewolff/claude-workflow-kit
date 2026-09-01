// Wegwerf-Repository fuer die Tests von kit/checks.mjs (Issue #423).
//
// Die Auswahl liest ihren Zustand aus zwei Quellen, die sich nicht nachbilden
// lassen: `git diff` gegen einen Anker und `git status` fuer Ungetracktes. Ein
// Mock davon wuerde genau die Frage offenlassen, um die es geht — ob eine
// Loeschung, eine Umbenennung oder ein committetes Paket wirklich mitzaehlt.
// Deshalb laeuft jeder Test gegen ein echtes, frisch angelegtes Repo im
// Temp-Verzeichnis, nach dem Muster der night-*-Tests.

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const CHECKS = join(repoRoot, "kit", "checks.mjs");

export function git(dir, ...args) {
  const res = spawnSync("git", args, { cwd: dir, encoding: "utf-8" });
  assert.equal(res.status, 0, `git ${args.join(" ")} schlug fehl: ${res.stderr}`);
  return res.stdout.trim();
}

/** Roher Aufruf — fuer die Faelle, in denen der Exit-Code selbst der Befund ist. */
export function checks(dir, ...cliArgs) {
  return spawnSync(process.execPath, [CHECKS, ...cliArgs], { cwd: dir, encoding: "utf-8" });
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

export function repoAnlegen({ config = {}, ohneConfig = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "checks-"));
  // Eine getrackte Datei von Anfang an: sonst haette der Setup-Commit im Fall
  // `ohneConfig` nichts zu committen und das Repo bliebe ohne HEAD.
  datei(dir, "README.md", "# Wegwerf\n");
  // Dieselbe Ignore-Regel, die ein installiertes Projekt hat (Issue #208/#209):
  // alles unter .claude/ ist lokaler Zustand, nur die workflow.config.json gehoert
  // ins Repo. Ohne sie wuerde die Zusammenfassung aus `run` (Issue #424) hier als
  // Tree-Aenderung erscheinen, waehrend sie es im echten Projekt nie tut — das
  // Wegwerf-Repo wuerde dann etwas anderes pruefen als den Ernstfall.
  datei(dir, ".gitignore", ".claude/*\n!.claude/workflow.config.json\n");
  if (!ohneConfig) {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(config, null, 2) + "\n", "utf-8");
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

/** Findet einen Eintrag aus `laufen` oder `ausgelassen` ueber sein Kommando. */
export function eintrag(liste, cmd) {
  return liste.find((e) => e.cmd === cmd);
}

export function kommandos(liste) {
  return liste.map((e) => e.cmd);
}
