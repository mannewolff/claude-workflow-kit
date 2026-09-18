#!/usr/bin/env node
/**
 * version.mjs — liest/erhoeht die VERSION-Konstante in install.mjs (x.y.z).
 * install.mjs ist die alleinige Versionsquelle des Kits.
 *
 * Nutzung:
 *   node tools/version.mjs --get      # aktuelle Version auf stdout ausgeben
 *   node tools/version.mjs --patch    # z + 1                 (push main)
 *   node tools/version.mjs --minor    # y + 1, z = 0          (merge production)
 *   node tools/version.mjs --major    # x + 1, y = 0, z = 0   (nur explizit)
 *
 * Ausgabe: neue (bzw. aktuelle) Version auf stdout. Fehler: stderr, Exit 1.
 * Single-File-Tool: nur node:*-Imports, Pfade relativ zum Arbeitsverzeichnis.
 *
 * Der Bump rechnet ab dem COMMITTETEN Stand (HEAD), nicht ab der Arbeitskopie —
 * damit ist er idempotent: Zweimal --patch ohne Commit dazwischen ergibt zweimal
 * dieselbe Version. Anlass ist der umgestellte Veroeffentlichungsweg (Plan #652):
 * Dort entstehen erst alle Dateien, dann laeuft die Pruefung, dann der Commit. Ist
 * der Lauf rot, traegt die Arbeitskopie den Bump bereits, ohne dass etwas
 * festgeschrieben waere — der naechste Anlauf bumpte aus der Arbeitskopie ein
 * zweites Mal, die Versionskennung spraenge, und es faellt niemandem auf (#656).
 * --get beantwortet die andere Frage ("welche Version traegt dieser Stand") und
 * liest deshalb unveraendert die Arbeitskopie.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

function fail(msg) {
  process.stderr.write(`Fehler: ${msg}\n`);
  process.exit(1);
}

const INSTALL_PATH = resolve("install.mjs");
const INSTALL_VERSION_RE = /(const VERSION = ")(\d+)\.(\d+)\.(\d+)(";)/;

// Die VERSION-Konstante aus HEAD:install.mjs, auf der der Bump aufsetzt.
// Rueckfall auf die Arbeitskopie, wenn git scheitert (kein Repo, kein Commit)
// oder HEAD die Datei bzw. die Konstante nicht fuehrt — ein frisches Repo ohne
// ersten Commit hat keinen committeten Stand, und dort abzubrechen machte das
// Werkzeug im Erstgebrauch unbenutzbar.
function basisVersion(arbeitskopie) {
  const res = spawnSync("git", ["show", "HEAD:./install.mjs"], { encoding: "utf-8" });
  if (res.status !== 0 || typeof res.stdout !== "string") return arbeitskopie;
  return res.stdout.match(INSTALL_VERSION_RE) ?? arbeitskopie;
}

function main() {
  const flags = ["--get", "--patch", "--minor", "--major"];
  const flag = process.argv.slice(2).find((a) => flags.includes(a));
  if (!flag) fail(`Kein gueltiges Flag. Erwartet: ${flags.join(" | ")}`);

  if (!existsSync(INSTALL_PATH)) fail(`install.mjs nicht gefunden: ${INSTALL_PATH}`);
  const raw = readFileSync(INSTALL_PATH, "utf-8");
  const m = raw.match(INSTALL_VERSION_RE);
  if (!m) fail(`VERSION-Konstante in install.mjs nicht gefunden oder unerwartetes Format: ${INSTALL_PATH}`);

  if (flag === "--get") {
    process.stdout.write(`${m[2]}.${m[3]}.${m[4]}\n`);
    return;
  }

  const basis = basisVersion(m);
  let x = Number(basis[2]);
  let y = Number(basis[3]);
  let z = Number(basis[4]);

  if (flag === "--patch") z += 1;
  else if (flag === "--minor") { y += 1; z = 0; }
  else if (flag === "--major") { x += 1; y = 0; z = 0; }

  const next = `${x}.${y}.${z}`;
  writeFileSync(INSTALL_PATH, raw.replace(INSTALL_VERSION_RE, `$1${next}$5`));
  process.stdout.write(`${next}\n`);
}

main();
