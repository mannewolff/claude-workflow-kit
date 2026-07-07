#!/usr/bin/env node
/**
 * version.mjs — liest/erhoeht die Versionskennung (x.y.z) in workflow.config.json.
 * Bei --minor/--major wird zusaetzlich install.mjs' VERSION-Konstante synchronisiert:
 * install.mjs repraesentiert den zuletzt veroeffentlichten Stand, --patch (push main)
 * laesst es deshalb bewusst unangetastet.
 *
 * Nutzung:
 *   node tools/version.mjs --get      # aktuelle Version auf stdout ausgeben
 *   node tools/version.mjs --patch    # z + 1                 (push main)
 *   node tools/version.mjs --minor    # y + 1, z = 0          (merge production, synct install.mjs)
 *   node tools/version.mjs --major    # x + 1, y = 0, z = 0   (nur explizit, synct install.mjs)
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

// Ersetzt nur den Versions-String im Roh-Text, damit der Bump die uebrige
// Config-Formatierung nicht anfasst (kein Neu-Serialisieren via JSON.stringify).
const VERSION_RE = /("version"\s*:\s*")\d+\.\d+\.\d+(")/;

const INSTALL_PATH = resolve("install.mjs");
const INSTALL_VERSION_RE = /(const VERSION = ")\d+\.\d+\.\d+(";)/;

// Liest und validiert install.mjs' VERSION-Konstante, OHNE zu schreiben. Wird bei
// --minor/--major VOR dem Config-Bump aufgerufen: schlaegt die Validierung fehl,
// bleibt workflow.config.json unangetastet (keine Teil-Inkonsistenz zwischen den Dateien).
function readInstallVersion() {
  if (!existsSync(INSTALL_PATH)) {
    fail(`install.mjs nicht gefunden: ${INSTALL_PATH}`);
  }
  const raw = readFileSync(INSTALL_PATH, "utf-8");
  if (!INSTALL_VERSION_RE.test(raw)) {
    fail(`VERSION-Konstante in install.mjs nicht gefunden oder unerwartetes Format: ${INSTALL_PATH}`);
  }
  return raw;
}

function writeInstallVersion(raw, next) {
  writeFileSync(INSTALL_PATH, raw.replace(INSTALL_VERSION_RE, `$1${next}$2`));
}

function main() {
  const flags = ["--get", "--patch", "--minor", "--major"];
  const flag = process.argv.slice(2).find((a) => flags.includes(a));
  if (!flag) fail(`Kein gueltiges Flag. Erwartet: ${flags.join(" | ")}`);

  const path = configPath();
  const raw = readFileSync(path, "utf-8");
  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    fail(`workflow.config.json konnte nicht gelesen werden: ${path}`);
  }

  let [x, y, z] = parseVersion(config.version);

  if (flag === "--get") {
    process.stdout.write(`${x}.${y}.${z}\n`);
    return;
  }

  const syncInstall = flag === "--minor" || flag === "--major";
  // Install.mjs VOR dem Config-Bump validieren (siehe readInstallVersion-Kommentar).
  const installRaw = syncInstall ? readInstallVersion() : null;

  if (flag === "--patch") z += 1;
  else if (flag === "--minor") { y += 1; z = 0; }
  else if (flag === "--major") { x += 1; y = 0; z = 0; }

  const next = `${x}.${y}.${z}`;
  // Nur den Versions-String im Roh-Text ersetzen — Formatierung der restlichen Config bleibt unangetastet.
  const updated = raw.replace(VERSION_RE, `$1${next}$2`);
  if (updated === raw) {
    fail(`version-Feld konnte im Roh-Text nicht ersetzt werden (unerwartetes Format): ${path}`);
  }
  writeFileSync(path, updated);
  if (syncInstall) writeInstallVersion(installRaw, next);
  process.stdout.write(`${next}\n`);
}

main();
