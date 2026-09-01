// Wegwerf-Repository fuer die Tests von kit/checks.mjs (Issue #423).
//
// Die Auswahl liest ihren Zustand aus zwei Quellen, die sich nicht nachbilden
// lassen: `git diff` gegen einen Anker und `git status` fuer Ungetracktes. Ein
// Mock davon wuerde genau die Frage offenlassen, um die es geht — ob eine
// Loeschung, eine Umbenennung oder ein committetes Paket wirklich mitzaehlt.
// Deshalb laeuft jeder Test gegen ein echtes, frisch angelegtes Repo im
// Temp-Verzeichnis, nach dem Muster der night-*-Tests.

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
