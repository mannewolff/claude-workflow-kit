#!/usr/bin/env node
/**
 * sync-blobs.mjs — haelt die Base64-Blobs in install.mjs synchron mit templates/, kit/ und skills/
 * und stempelt die Kit-Version in die Kit-Dateien (Issue #171).
 *
 * Nutzung:
 *   node tools/sync-blobs.mjs          # Stempel setzen, Blobs in install.mjs neu generieren
 *   node tools/sync-blobs.mjs --check  # nur pruefen; Exit 1 bei Drift
 *
 * Reihenfolge ist bindend: erst stempeln, dann Blobs backen — sonst enthielte
 * install.mjs die Kit-Dateien mit dem alten Stempel und jede Neuinstallation
 * verteilte eine Kopie, die eine falsche Version behauptet.
 *
 * Warum hier und nicht in version.mjs: Wuerde version.mjs stempeln, waeren nach
 * dem Bump die Blobs veraltet und `sync-blobs --check` — ein buildCheck dieses
 * Repos — ginge zwischenzeitlich rot. Hier bleibt es ein atomarer Schritt, und
 * RELEASING.md braucht keine zusaetzliche Reihenfolge-Regel.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Repo-Root: normalerweise der eigene Ort (<tool-dir>/..). KIT_ROOT ueberschreibt ihn
// und ist ein Test-Hook (Issue #186, analog NIGHT_CLAUDE_CMD/NIGHT_TIMEOUT_MS in
// night.mjs). Vorher kopierten die Tests dieses Script in ein Fixture-Verzeichnis und
// fuehrten die Kopie aus — dabei entsteht Coverage unter einem Temp-Pfad, den SonarCloud
// nicht auf die Repo-Datei abbilden kann. Mit dem Hook laeuft das ECHTE Script und zeigt
// nur mit dem Root ins Fixture.
const root = process.env.KIT_ROOT
  ? resolve(process.env.KIT_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL = join(root, "install.mjs");

// Liest einen Ordner mit einer Unterordner-Ebene (z.B. skills/<name>/<datei>)
// zu { name: { datei: inhalt } } ein — Grundlage fuer einen gemeinsamen Blob.
function buildDirJson(dir) {
  const result = {};
  for (const entry of readdirSync(dir).sort()) {
    const entryDir = join(dir, entry);
    if (!statSync(entryDir).isDirectory()) continue;
    const files = {};
    for (const file of readdirSync(entryDir).sort()) {
      const filePath = join(entryDir, file);
      if (statSync(filePath).isFile()) files[file] = readFileSync(filePath, "utf-8");
    }
    result[entry] = files;
  }
  return result;
}

const BLOBS = [
  { constName: "CLAUDE_WORKFLOW_MD_B64", source: join(root, "templates", "CLAUDE-workflow.md") },
  { constName: "CLAUDE_FACHPLAN_MD_B64", source: join(root, "templates", "CLAUDE-Fachplan.md") },
  { constName: "CLAUDE_PLAN_MD_B64", source: join(root, "templates", "CLAUDE-Plan.md") },
  // Beispiel-Config, die der Installer als .claude/workflow.config.example.json ablegt.
  // Sie ist der einzige Ort, an dem ein Nutzer den issueReview-Block zu sehen bekommt,
  // ohne die Doku zu lesen — der Installer fragt ihn nicht ab (reviewers ist
  // maschinenabhaengig, pairs eine Denkentscheidung). Nebeneffekt: Die Vorlage stand
  // vorher in keiner Blob-Liste, wurde von niemandem gelesen und driftete unbemerkt;
  // jetzt bewacht sie `sync-blobs --check`, also ein buildCheck.
  { constName: "CONFIG_EXAMPLE_B64", source: join(root, "templates", "workflow.config.json") },
  { constName: "BOARD_MJS_B64", source: join(root, "kit", "board.mjs") },
  { constName: "NIGHT_MJS_B64", source: join(root, "kit", "night.mjs") },
  { constName: "CHECKS_MJS_B64", source: join(root, "kit", "checks.mjs") },
  { constName: "SPEC_MJS_B64", source: join(root, "kit", "spec.mjs") },
  // Hook und Gate (Issue #473). gate.mjs gehoert bewusst NICHT in STAMPED: Die
  // Liste steuert Versions-Stempel und die Dogfooding-Kopie nach .claude/kit/,
  // und dort soll das Gate gerade nicht liegen (Plan #467, A2).
  { constName: "GATE_MJS_B64", source: join(root, ".githooks", "gate.mjs") },
  { constName: "PRE_COMMIT_B64", source: join(root, ".githooks", "pre-commit") },
  { constName: "SKILLS_B64", sourceDir: join(root, "skills") },
];

// Dateien, die den Kit-Stand als KIT_VERSION tragen (Issue #170/#171).
// Die Liste steuert zugleich die Dogfooding-Kopie unter .claude/kit/ (weiter unten):
// Ein Werkzeug, das hier fehlt, entstuende dort nie — und die Skills dieses Repos
// riefen ein Kommando auf, das im eigenen Klon nicht liegt (Issue #425).
const STAMPED = ["board.mjs", "night.mjs", "checks.mjs", "spec.mjs"];
const KIT_VERSION_RE = /(const KIT_VERSION = ")(\d+\.\d+\.\d+)(";)/;
const INSTALL_VERSION_RE = /const VERSION = "(\d+\.\d+\.\d+)";/;

// Die Kit-Version aus install.mjs — alleinige Versionsquelle laut RELEASING.md.
function kitVersion() {
  const m = readFileSync(INSTALL, "utf-8").match(INSTALL_VERSION_RE);
  if (!m) {
    process.stderr.write(`Fehler: VERSION-Konstante nicht in install.mjs gefunden\n`);
    process.exit(1);
  }
  return m[1];
}

const checkOnly = process.argv.includes("--check");

// --- Stempel (vor dem Blob-Backen, siehe Kopfkommentar) ---
const version = kitVersion();
const stampDrift = [];

for (const datei of STAMPED) {
  const pfad = join(root, "kit", datei);
  const src = readFileSync(pfad, "utf-8");
  const m = src.match(KIT_VERSION_RE);
  if (!m) {
    // Kein stiller Skip: eine Kit-Datei ohne Konstante wuerde unbemerkt
    // ungestempelt ausgeliefert und behauptete dann gar nichts.
    process.stderr.write(`Fehler: KIT_VERSION-Konstante nicht in kit/${datei} gefunden\n`);
    process.exit(1);
  }
  if (m[2] !== version) {
    stampDrift.push(`kit/${datei} ist ${m[2]}, erwartet ${version}`);
    if (!checkOnly) writeFileSync(pfad, src.replace(KIT_VERSION_RE, `$1${version}$3`), "utf-8");
  }
}

let installSrc = readFileSync(INSTALL, "utf-8");
const drift = [];

for (const { constName, source, sourceDir } of BLOBS) {
  const raw = sourceDir ? JSON.stringify(buildDirJson(sourceDir)) : readFileSync(source, "utf-8");
  const expected = Buffer.from(raw, "utf-8").toString("base64");
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

// --- Dogfooding-Kopie unter .claude/kit/ (Issue #173) ---
//
// Hier schreibt das Tool bewusst eine NICHT versionierte Datei: .claude/ steht
// komplett in der .gitignore. Die Kopie ist der Runner, den dieses Repo selbst
// benutzt — laeuft sie der Quelle hinterher, fuehrt das Dogfooding einen anderen
// Stand aus als das Repo enthaelt (bei Issue #167 waere der manuelle cp beinahe
// vergessen worden). Fehlt das Verzeichnis, ist es ein frischer Clone ohne lokale
// Installation: stiller Skip, kein Anlegen — .claude/kit/ ist Laufzeitzustand,
// kein Repo-Inhalt.
const LOCAL_KIT = join(root, ".claude", "kit");
const copyDrift = [];

if (existsSync(LOCAL_KIT)) {
  for (const datei of STAMPED) {
    const ziel = join(LOCAL_KIT, datei);
    const soll = readFileSync(join(root, "kit", datei), "utf-8");
    const ist = existsSync(ziel) ? readFileSync(ziel, "utf-8") : null;
    if (ist !== soll) {
      copyDrift.push(`.claude/kit/${datei}`);
      if (!checkOnly) writeFileSync(ziel, soll, "utf-8");
    }
  }
}

// --- Dogfooding-Kopien unter .claude/skills/ (Issue #213) ---
//
// Dieselbe Mechanik wie fuer .claude/kit/ darueber, aber aus einem konkreten Fehlbild
// geboren: Am 2026-08-06 liefen zwei Skill-Issues in einem Nachtlauf in eine
// Schreibsperre auf .claude/skills/, die Kopien drifteten — und `--check` blieb gruen,
// weil es die Skills gar nicht ansah. Die Konsistenz stand damit nur als Bitte im
// Issue-Text; nach dem Leitplanken-Prinzip (Issue #122) gehoert sie ins Gate.
//
// Ein Skill, der in skills/ liegt und unter .claude/skills/ fehlt, zaehlt als Drift und
// nicht als Skip — sonst verschwindet ein neu angelegter Skill unbemerkt aus dem
// Dogfooding. Fehlt das Verzeichnis ganz, ist es ein frischer Clone ohne lokale
// Installation: stiller Skip, wie bei .claude/kit/.
const LOCAL_SKILLS = join(root, ".claude", "skills");
const SKILLS_SRC = join(root, "skills");

if (existsSync(LOCAL_SKILLS) && existsSync(SKILLS_SRC)) {
  for (const name of readdirSync(SKILLS_SRC, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const quelle = join(SKILLS_SRC, name.name, "SKILL.md");
    if (!existsSync(quelle)) continue;
    const ziel = join(LOCAL_SKILLS, name.name, "SKILL.md");
    const soll = readFileSync(quelle, "utf-8");
    const ist = existsSync(ziel) ? readFileSync(ziel, "utf-8") : null;
    if (ist === soll) continue;

    copyDrift.push(`.claude/skills/${name.name}/SKILL.md`);
    if (!checkOnly) {
      try {
        mkdirSync(dirname(ziel), { recursive: true });
        writeFileSync(ziel, soll, "utf-8");
      } catch (err) {
        // Sichtbar scheitern statt still weiterlaufen: Genau diese Sperre war der
        // Anlass des Issues, und ein verschluckter Fehler waere derselbe Fehler
        // eine Ebene tiefer.
        process.stderr.write(
          `Fehler: ${ziel} liess sich nicht schreiben (${err.code || err.message}).\n` +
          `Steht .claude/skills/ unter Schreibschutz? Dann die Sandbox-Ausnahme setzen ` +
          `oder die Datei von Hand kopieren.\n`
        );
        process.exit(1);
      }
    }
  }
}

if (checkOnly) {
  // Stempel- und Blob-Drift getrennt melden: sie haben verschiedene Ursachen
  // (vergessener Bump-Nachzug vs. geaenderte Quelldatei) und die Meldung soll
  // ohne Nachdenken sagen, was zu tun ist.
  const probleme = [];
  if (stampDrift.length > 0) probleme.push(`Versions-Stempel: ${stampDrift.join("; ")}.`);
  if (drift.length > 0) probleme.push(`Blob-Drift in install.mjs: ${drift.join(", ")} weicht von kit/ ab.`);
  if (copyDrift.length > 0) probleme.push(`Lokale Kopie veraltet: ${copyDrift.join(", ")}.`);
  if (probleme.length > 0) {
    process.stderr.write(`${probleme.join("\n")}\nBeheben mit: node tools/sync-blobs.mjs\n`);
    process.exit(1);
  }
  process.stdout.write("Blobs und Versions-Stempel synchron mit kit/.\n");
} else if (stampDrift.length > 0 || drift.length > 0 || copyDrift.length > 0) {
  if (drift.length > 0) writeFileSync(INSTALL, installSrc, "utf-8");
  const teile = [];
  const gestempelt = STAMPED.map((d) => `kit/${d}`).join(", ");
  if (stampDrift.length > 0) teile.push(`Gestempelt auf v${version}: ${gestempelt}`);
  if (drift.length > 0) teile.push(`Aktualisiert: ${drift.join(", ")}`);
  if (copyDrift.length > 0) teile.push(`Lokale Kopie aufgefrischt: ${copyDrift.join(", ")}`);
  process.stdout.write(`${teile.join("\n")}\n`);
} else {
  process.stdout.write("Blobs bereits synchron.\n");
}
