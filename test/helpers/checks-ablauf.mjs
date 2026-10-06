// Der Prozessstart fuer die Ablauf-Pruefungen von kit/checks.mjs (Issue #1212, Plan
// #1199 E6 und E7).
//
// Die meisten Tests rufen checks.mjs im selben Prozess, ueber `checks-repo.mjs`. Was nur
// als Prozess zu belegen ist, startet dieser Helfer: die Kommandozeile selbst, Signale an
// den Lauf, der Commit-Hook und das Gate, das ihn fuehrt. Wer ihn laedt, ist eine
// Ablauf-Pruefung und traegt das im Kopf (`test/checks-leichtigkeit.test.mjs`).

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const CHECKS = join(repoRoot, "kit", "checks.mjs");
export const GATE = join(repoRoot, ".githooks", "gate.mjs");
export const HOOK = join(repoRoot, ".githooks", "pre-commit");

/** `checks.mjs` als Kindprozess; `env` ergaenzt die Umgebung, `optionen` die von `spawnSync`. */
export function checksProzess(dir, cliArgs, { env = {}, ...optionen } = {}) {
  return spawnSync(process.execPath, [CHECKS, ...cliArgs], {
    cwd: dir,
    encoding: "utf-8",
    env: { ...process.env, ...env },
    ...optionen,
  });
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
