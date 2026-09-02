// Wegwerf-Verzeichnis fuer die Tests von kit/spec.mjs (Issue #440).
//
// `index` SCHREIBT — es legt specs/INDEX.md an. Liefe ein Test gegen den
// Repo-Baum, entstuende dort ein specs/ und der naechste `git status` meldete
// eine Aenderung, die niemand gemacht hat. Deshalb kopiert jeder Test seine
// Fixture nach dem Muster von helpers/checks-repo.mjs in ein Temp-Verzeichnis
// und ruft spec.mjs dort mit `cwd` auf.
//
// Kein git wie bei checks-repo: spec.mjs liest nur Dateien unter specs/ und
// kennt weder Anker noch Working Tree.

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, cpSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const SPEC = join(repoRoot, "kit", "spec.mjs");

const FIXTURES = join(repoRoot, "test", "fixtures", "specs");

/** Roher Aufruf — bei spec.mjs ist der Exit-Code selbst ein Ergebnis. */
export function spec(dir, ...cliArgs) {
  return spawnSync(process.execPath, [SPEC, ...cliArgs], { cwd: dir, encoding: "utf-8" });
}

/**
 * Legt ein Temp-Verzeichnis an und kopiert die benannte Fixture nach specs/.
 * `null` als Name laesst specs/ bewusst fehlen — der Normalzustand eines
 * Projekts vor Ausbaustufe 5 und ein eigener Pfad in beiden Kommandos.
 */
export function fixtureAnlegen(name) {
  const dir = mkdtempSync(join(tmpdir(), "spec-"));
  if (name !== null) {
    mkdirSync(join(dir, "specs"), { recursive: true });
    cpSync(join(FIXTURES, name), join(dir, "specs"), { recursive: true });
  }
  return dir;
}

export function mitFixture(name, fn) {
  const dir = fixtureAnlegen(name);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Der geschriebene Index als Text — Byte fuer Byte, ohne Normalisierung. */
export function indexText(dir) {
  return readFileSync(join(dir, "specs", "INDEX.md"), "utf-8");
}
