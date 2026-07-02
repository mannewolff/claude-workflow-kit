#!/usr/bin/env node
/**
 * sync-blobs.mjs — haelt die Base64-Blobs in install.mjs synchron mit kit/.
 *
 * Nutzung:
 *   node tools/sync-blobs.mjs          # Blobs in install.mjs neu generieren
 *   node tools/sync-blobs.mjs --check  # nur pruefen; Exit 1 bei Drift
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL = join(root, "install.mjs");

const BLOBS = [
  { constName: "BOARD_MJS_B64", source: join(root, "kit", "board.mjs") },
  { constName: "BOARD_UI_MJS_B64", source: join(root, "kit", "board-ui.mjs") },
];

const checkOnly = process.argv.includes("--check");
let installSrc = readFileSync(INSTALL, "utf-8");
const drift = [];

for (const { constName, source } of BLOBS) {
  const expected = Buffer.from(readFileSync(source, "utf-8")).toString("base64");
  const re = new RegExp(`(const ${constName} = ")([A-Za-z0-9+/=]*)(";)`);
  const m = installSrc.match(re);
  if (!m) {
    process.stderr.write(`Fehler: Konstante ${constName} nicht in install.mjs gefunden\n`);
    process.exit(1);
  }
  if (m[2] !== expected) {
    drift.push(constName);
    // Base64-Alphabet enthaelt kein '$' — Ersetzung ohne Escaping sicher
    if (!checkOnly) installSrc = installSrc.replace(re, `$1${expected}$3`);
  }
}

if (checkOnly) {
  if (drift.length > 0) {
    process.stderr.write(
      `Blob-Drift in install.mjs: ${drift.join(", ")} weicht von kit/ ab.\n` +
      `Beheben mit: node tools/sync-blobs.mjs\n`
    );
    process.exit(1);
  }
  process.stdout.write("Blobs synchron mit kit/.\n");
} else if (drift.length > 0) {
  writeFileSync(INSTALL, installSrc, "utf-8");
  process.stdout.write(`Aktualisiert: ${drift.join(", ")}\n`);
} else {
  process.stdout.write("Blobs bereits synchron.\n");
}
