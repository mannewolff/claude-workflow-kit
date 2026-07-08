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
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function fail(msg) {
  process.stderr.write(`Fehler: ${msg}\n`);
  process.exit(1);
}

const INSTALL_PATH = resolve("install.mjs");
const INSTALL_VERSION_RE = /(const VERSION = ")(\d+)\.(\d+)\.(\d+)(";)/;

function main() {
  const flags = ["--get", "--patch", "--minor", "--major"];
  const flag = process.argv.slice(2).find((a) => flags.includes(a));
  if (!flag) fail(`Kein gueltiges Flag. Erwartet: ${flags.join(" | ")}`);

  if (!existsSync(INSTALL_PATH)) fail(`install.mjs nicht gefunden: ${INSTALL_PATH}`);
  const raw = readFileSync(INSTALL_PATH, "utf-8");
  const m = raw.match(INSTALL_VERSION_RE);
  if (!m) fail(`VERSION-Konstante in install.mjs nicht gefunden oder unerwartetes Format: ${INSTALL_PATH}`);

  let x = Number(m[2]);
  let y = Number(m[3]);
  let z = Number(m[4]);

  if (flag === "--get") {
    process.stdout.write(`${x}.${y}.${z}\n`);
    return;
  }

  if (flag === "--patch") z += 1;
  else if (flag === "--minor") { y += 1; z = 0; }
  else if (flag === "--major") { x += 1; y = 0; z = 0; }

  const next = `${x}.${y}.${z}`;
  writeFileSync(INSTALL_PATH, raw.replace(INSTALL_VERSION_RE, `$1${next}$5`));
  process.stdout.write(`${next}\n`);
}

main();
