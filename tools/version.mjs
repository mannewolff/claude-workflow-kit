#!/usr/bin/env node
/**
 * version.mjs — liest/erhoeht die Versionskennung (x.y.z) in workflow.config.json.
 *
 * Nutzung:
 *   node tools/version.mjs --get      # aktuelle Version auf stdout ausgeben
 *   node tools/version.mjs --patch    # z + 1                 (push main)
 *   node tools/version.mjs --minor    # y + 1, z = 0          (merge production)
 *   node tools/version.mjs --major    # x + 1, y = 0, z = 0   (nur explizit)
 *
 * Ausgabe: neue (bzw. aktuelle) Version auf stdout. Fehler: stderr, Exit 1.
 * Single-File-Tool: nur node:*-Imports, Config-Pfad relativ zum Arbeitsverzeichnis.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function fail(msg) {
  process.stderr.write(`Fehler: ${msg}\n`);
  process.exit(1);
}

// Kandidaten-Aufloesung wie board.mjs: erst .claude/, dann Projekt-Root — relativ zum cwd.
function configPath() {
  const candidates = [
    resolve(".claude", "workflow.config.json"),
    resolve("workflow.config.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  fail("Keine workflow.config.json gefunden (.claude/workflow.config.json oder workflow.config.json).");
}

function parseVersion(v) {
  if (typeof v !== "string" || !/^\d+\.\d+\.\d+$/.test(v)) {
    fail(`Ungueltige oder fehlende Version '${v}'. Erwartet Format x.y.z (drei nicht-negative Ganzzahlen).`);
  }
  return v.split(".").map(Number);
}

function main() {
  const flags = ["--get", "--patch", "--minor", "--major"];
  const flag = process.argv.slice(2).find((a) => flags.includes(a));
  if (!flag) fail(`Kein gueltiges Flag. Erwartet: ${flags.join(" | ")}`);

  const path = configPath();
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    fail(`workflow.config.json konnte nicht gelesen werden: ${path}`);
  }

  let [x, y, z] = parseVersion(config.version);

  if (flag === "--get") {
    process.stdout.write(`${x}.${y}.${z}\n`);
    return;
  }

  if (flag === "--patch") z += 1;
  else if (flag === "--minor") { y += 1; z = 0; }
  else if (flag === "--major") { x += 1; y = 0; z = 0; }

  config.version = `${x}.${y}.${z}`;
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
  process.stdout.write(`${config.version}\n`);
}

main();
