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
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
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

/**
 * Schreibt .claude/workflow.config.json ins Fixture-Verzeichnis (Issue #442).
 * Ohne Aufruf hat das Verzeichnis keine Config — der Zustand eines Projekts,
 * das den spec-Block nie gesetzt hat, und ein eigener Pfad in `check`.
 */
export function configSchreiben(dir, config) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  // `issueTracker` gehoert seit Issue #461 dazu: Ein fehlendes Feld gilt als 'github'
  // (Schema-Default), und github traegt das beschriebene Verhalten nicht (A19) — jede
  // Fixture ohne das Feld wuerde abgewiesen. 'local' ist der Tracker dieser Tests und
  // ausdruecklich erlaubt; ein Test, der einen anderen braucht, setzt ihn selbst.
  const vollstaendig = { issueTracker: "local", ...config };
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(vollstaendig, null, 2), "utf-8");
}

/** Legt eine Paketdatei im Fixture-Verzeichnis an und gibt ihren Pfad zurueck. */
export function paketSchreiben(dir, text, name = "paket.md") {
  const pfad = join(dir, name);
  writeFileSync(pfad, text, "utf-8");
  return pfad;
}

/**
 * Legt eine Datei samt Zwischenverzeichnissen an (Issue #445).
 * `luecken` zaehlt Dateien als Punkte — die Tests brauchen deshalb einen Weg,
 * Code neben der Beschreibung abzulegen, nicht nur unter specs/. Der Pfad wird
 * mit '/' geschrieben, wie ihn auch die Globs der Config sehen.
 */
export function dateiSchreiben(dir, relPfad, text = "") {
  const pfad = join(dir, ...relPfad.split("/"));
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, text, "utf-8");
  return pfad;
}
