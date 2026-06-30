#!/usr/bin/env node
/**
 * Stellwerk Installer v1.1.0
 *
 * Kopiert die zehn Skills nach ~/.claude/skills/ oder ./.claude/skills/
 * und schreibt .claude/workflow.config.json aus sechs interaktiven Fragen.
 *
 * Aufruf:
 *   node install.mjs
 *   node install.mjs --version
 *   npx github:mannewolff/claude-workflow-kit  (nach Veroeffentlichung)
 */

import { createInterface } from "node:readline";
import { existsSync, mkdirSync, cpSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const VERSION = "1.1.0";

// --- Defaults (eingebettet, damit install.mjs als Single-File portabel ist) ---
const schema = {
  defaults: {
    provider: "github",
    buildChecks: [],
    mutationCommand: "",
    mainBranch: "main",
    productionBranch: "production",
    reviewScope: "diff",
    reviewModel: "claude-opus-4-8",
    triggers: { go: "GO", push: "push main", merge: "merge production" },
  },
  validationRules: [
    {
      field: "provider",
      rule: "enum",
      allowed: ["github", "gitlab"],
      error: "provider muss 'github' oder 'gitlab' sein.",
    },
    {
      field: "reviewScope",
      rule: "enum",
      allowed: ["diff", "full"],
      error: "reviewScope muss 'diff' oder 'full' sein.",
    },
    {
      field: "reviewModel",
      rule: "pattern",
      pattern: "^claude-",
      error: "reviewModel muss eine Claude-Modell-ID sein (z.B. 'claude-opus-4-8').",
    },
  ],
};
const DEFAULTS = schema.defaults;

// --- Stdin-Lese-Infrastruktur ---
// Liest alle Zeilen vorab wenn kein TTY (Pipe/CI), liefert sie der Reihe nach.
// Im TTY-Modus nutzt readline normal interaktiv.

let _pipedLines = null;

async function loadPipedLines() {
  if (process.stdin.isTTY) return;
  _pipedLines = [];
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    _pipedLines.push(line);
  }
}

function ask(rl, question) {
  if (_pipedLines !== null) {
    const line = _pipedLines.shift() ?? "";
    process.stdout.write(question + line + "\n");
    return Promise.resolve(line);
  }
  return new Promise((resolve) => rl.question(question, resolve));
}

// --- Hilfsfunktionen ---

function validate(field, value) {
  const rules = schema.validationRules || [];
  for (const rule of rules) {
    if (rule.field !== field) continue;
    if (rule.rule === "enum" && !rule.allowed.includes(value)) {
      return rule.error;
    }
    if (rule.rule === "pattern" && !new RegExp(rule.pattern).test(value)) {
      return rule.error;
    }
  }
  return null;
}

async function askWithDefault(rl, question, defaultValue, field) {
  while (true) {
    const raw = await ask(rl, `${question} [${defaultValue}]: `);
    const value = raw.trim() === "" ? defaultValue : raw.trim();
    const error = field ? validate(field, value) : null;
    if (error) {
      console.error(`  Fehler: ${error}`);
      if (_pipedLines !== null) throw new Error(`Validation failed in non-interactive mode: ${error}`);
      continue;
    }
    return value;
  }
}

function copySkills(skillsSrc, targetDir) {
  const skills = [
    "plan", "issues", "implement-ready", "local-check",
    "review", "retro", "push-main", "merge-production",
    "kontext", "document",
  ];
  mkdirSync(targetDir, { recursive: true });
  for (const skill of skills) {
    const src = join(skillsSrc, skill);
    const dest = join(targetDir, skill);
    if (!existsSync(src)) {
      console.warn(`  Warnung: ${src} nicht gefunden, wird uebersprungen.`);
      continue;
    }
    cpSync(src, dest, { recursive: true });
    console.log(`  ✓ ${skill}`);
  }
}

// --- Hauptprogramm ---

async function main() {
  if (process.argv.includes("--version")) {
    console.log(`Stellwerk install.mjs v${VERSION}`);
    process.exit(0);
  }

  await loadPipedLines();
  const rl = process.stdin.isTTY
    ? createInterface({ input: process.stdin, output: process.stdout })
    : { close: () => {} };

  console.log("\n=== Stellwerk Installer ===\n");
  console.log("Dieser Installer richtet die Stellwerk-Skill-Bibliothek ein.");
  console.log("Sechs Fragen, dann bist du fertig.\n");

  // Frage 1: global oder projekt
  let scope;
  while (true) {
    const raw = await ask(rl, "Skills global (~/.claude/skills/) oder nur fuer dieses Projekt (.claude/skills/)? [global/projekt]: ");
    const answer = raw.trim().toLowerCase();
    if (answer === "" || answer === "global") { scope = "global"; break; }
    if (answer === "projekt") { scope = "projekt"; break; }
    console.error("  Bitte 'global' oder 'projekt' eingeben.");
  }

  // Frage 2: provider
  const provider = await askWithDefault(
    rl,
    "Issue-Plattform: 'github' oder 'gitlab'?",
    DEFAULTS.provider,
    "provider"
  );

  // Frage 3: mainBranch
  const mainBranch = await askWithDefault(rl, "Haupt-Branch (mainBranch)", DEFAULTS.mainBranch);

  // Frage 4: productionBranch
  const productionBranch = await askWithDefault(rl, "Production-Branch (productionBranch)", DEFAULTS.productionBranch);

  // Frage 5: reviewScope
  const reviewScope = await askWithDefault(
    rl,
    "Review-Umfang: 'diff' (nur Aenderungen) oder 'full' (gesamter Quelltext)?",
    DEFAULTS.reviewScope,
    "reviewScope"
  );

  // Frage 6: reviewModel
  const reviewModel = await askWithDefault(
    rl,
    "Reviewer-Modell (muss mit 'claude-' beginnen)",
    DEFAULTS.reviewModel,
    "reviewModel"
  );

  // Frage 6 (nur bei globalem Install): Vault-Pfad für kontext.config.json
  let vaultPath = "";
  if (scope === "global") {
    const raw = await ask(rl, "Pfad zum Memory-Vault für /kontext (leer = überspringen): ");
    vaultPath = raw.trim();
  }

  rl.close();

  // --- Pfade berechnen ---
  const skillsSrc = join(__dirname, "skills");
  const targetBase = scope === "global"
    ? join(homedir(), ".claude")
    : resolve(".claude");
  const skillsTarget = join(targetBase, "skills");
  const configTarget = join(targetBase, "workflow.config.json");
  const workflowMdTarget = join(targetBase, "CLAUDE-workflow.md");
  const workflowMdSrc = join(__dirname, "templates", "CLAUDE-workflow.md");

  // --- Skills kopieren ---
  console.log(`\nKopiere Skills nach ${skillsTarget}:`);
  copySkills(skillsSrc, skillsTarget);

  // --- Config schreiben ---
  const config = {
    provider,
    buildChecks: DEFAULTS.buildChecks,
    mutationCommand: DEFAULTS.mutationCommand,
    mainBranch,
    productionBranch,
    reviewScope,
    reviewModel,
    triggers: DEFAULTS.triggers,
  };
  mkdirSync(targetBase, { recursive: true });
  writeFileSync(configTarget, JSON.stringify(config, null, 2) + "\n", "utf-8");
  console.log(`\n✓ Config geschrieben: ${configTarget}`);

  // --- kontext.config.json schreiben (nur bei globalem Install mit Vault-Pfad) ---
  if (scope === "global" && vaultPath) {
    const kontextConfig = {
      vault: vaultPath,
      always: ["Index.md", "Profil.md"],
      projectDocs: ["CLAUDE-*", ".claude/CLAUDE-*"],
    };
    const kontextConfigTarget = join(targetBase, "kontext.config.json");
    writeFileSync(kontextConfigTarget, JSON.stringify(kontextConfig, null, 2) + "\n", "utf-8");
    console.log(`✓ kontext.config.json geschrieben: ${kontextConfigTarget}`);
  }

  // --- CLAUDE-workflow.md ablegen ---
  if (existsSync(workflowMdSrc)) {
    cpSync(workflowMdSrc, workflowMdTarget);
    console.log(`✓ CLAUDE-workflow.md abgelegt: ${workflowMdTarget}`);
  } else {
    console.warn("  Hinweis: templates/CLAUDE-workflow.md nicht gefunden (wird in Issue #5 ergaenzt).");
  }

  console.log("\n=== Fertig ===");
  console.log(`Starte eine neue Claude-Code-Session im Projekt.`);
  console.log(`Die zehn Skills erscheinen in /help.\n`);
  if (provider === "gitlab") {
    console.log(`GitLab: Stelle sicher dass 'glab auth login' durchgefuehrt wurde.`);
    console.log(`GitLab: Lege die Labels Backlog, Ready, In-progress, In-review, Done im Projekt an.\n`);
  } else {
    console.log(`GitHub: Stelle sicher dass 'gh auth login' durchgefuehrt wurde.\n`);
  }
  console.log(`Naechster Schritt: workflow.config.json anpassen (buildChecks, mutationCommand).`);
  console.log(`Pfad: ${configTarget}\n`);
}

main().catch((err) => {
  console.error("\nFehler:", err.message);
  process.exit(1);
});
