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
import { existsSync, mkdirSync, cpSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const VERSION = "1.2.0";

// --- CLAUDE-workflow.md (eingebettet fuer Single-File-Portabilitaet) ---
const CLAUDE_WORKFLOW_MD = `# CLAUDE-workflow.md — Stellwerk-Prozess

Verbindlicher Prozess fuer KI-gestuetzte Softwareentwicklung in diesem Projekt.
Basiert auf dem 9-Schritt-Prozess (Whitepaper "Ein Prozess zur KI-gestuetzten Softwareentwicklung", Manne Wolff, 2026).

---

## Die neun Schritte

| Schritt | Aktor | Was passiert | Skill |
|---------|-------|-------------|-------|
| 1. Anforderung | Mensch | Formuliert oder diktiert die Anforderung | — |
| 2. Plan | KI | Erstellt Plan, stellt zur Diskussion, implementiert nichts | \`/plan\` |
| 3. Plan zu Issues | KI | Uebertraegt Plan in GitHub-Issues (Vier-Abschnitt-Format) | \`/issues\` |
| 4. GO | Mensch | Zieht Issues nach Ready — das ist das GO | — |
| 5. Implementierung | KI | Arbeitet Ready-Issues sequenziell ab, committet lokal | \`/implement-ready\` |
| 6. Lokale Pruefung | KI + Mensch | Pflicht-Checks + manuelle UI-Verifikation | \`/local-check\` |
| 7. Code-Review | KI | Startet Opus-Reviewer in frischer Session | \`/review\` |
| 7.5. Retro | KI | KI-Retrospektive, Memory konsolidieren | \`/retro\` |
| 8. Push | Mensch | Tippt \`push main\` — Claude pusht den Batch | \`/push-main\` |
| 9. Merge | Mensch | Tippt \`merge production\` — Claude erstellt PR | \`/merge-production\` |

---

## Die drei Stop-Punkte (nie automatisiert)

1. **GO (Schritt 4):** Issue nach Ready ziehen. Claude wartet.
2. **Push (Schritt 8):** Trigger-Phrase \`push main\`. Claude pusht nicht autonom.
3. **Merge (Schritt 9):** Trigger-Phrase \`merge production\`. Claude merged nicht.

Diese drei Schritte sind die Verantwortungsschwellen. Sie bleiben menschlich und tippbar.

---

## Kanban-Board (5 Spalten)

| Spalte | Bedeutung | Wer bewegt |
|--------|-----------|-----------|
| Backlog | Idee oder Issue mit offenen Fragen | Beide |
| Ready | Freigegeben, gilt als GO | Nur Mensch |
| In progress | Aktuelle Arbeit, ein Issue zur Zeit | KI beim Start |
| In review | Lokal fertig, nicht gepusht | KI beim Abschluss |
| Done | Mensch hat getestet, Push erfolgt | Nur Mensch |

Claude geht nur bis **In review**. Done setzt der Mensch nach seinem Test.

---

## Git-Workflow (strikt bindend)

1. Claude committet lokal, pusht NICHT automatisch.
2. Mensch testet lokal (Dev-Server starten, Golden Path durchklicken).
3. Mensch tippt \`push main\` — Claude pusht auf \`mainBranch\`.
4. Mensch testet auf Testserver.
5. Mensch tippt \`merge production\` — Claude erstellt PR \`mainBranch -> productionBranch\`.
6. Mensch merget den PR.

Absolut bindend:
- Kein Force-Push auf \`mainBranch\` oder \`productionBranch\` ohne explizite Einzelanweisung.
- Hooks (Pre-Commit / Pre-Push) werden nicht mit \`--no-verify\` umgangen.
- \`productionBranch\` wird nie direkt gepusht.

---

## Config (.claude/workflow.config.json)

\`\`\`json
{
  "provider": "github",
  "buildChecks": ["<build-kommando>", "<test-kommando>"],
  "mutationCommand": "<mutations-test-kommando oder leer>",
  "mainBranch": "main",
  "productionBranch": "production",
  "reviewScope": "diff",
  "reviewModel": "claude-opus-4-8",
  "triggers": { "go": "GO", "push": "push main", "merge": "merge production" }
}
\`\`\`

\`provider\` ist \`"github"\` oder \`"gitlab"\`. Steuert welche CLI die Skills verwenden.

\`buildChecks\` und \`mutationCommand\` anpassen. Alle anderen Felder haben sinnvolle Defaults.

Beispiele fuer verschiedene Stacks:

| Stack | buildChecks | mutationCommand |
|-------|------------|-----------------|
| Java/Maven | \`["mvn verify"]\` | \`"mvn org.pitest:pitest-maven:mutationCoverage"\` |
| Node/npm | \`["npm test", "npm run build"]\` | \`""\` |
| Python | \`["pytest", "python -m build"]\` | \`""\` |
| Go | \`["go test ./...", "go build ./..."]\` | \`""\` |

---

## Pflichtchecks vor Push (Schritt 6)

Alle \`buildChecks\` aus der Config laufen gruen. Rote Checks blockieren den Push mechanisch.
Bei UI-Aenderungen: Dev-Server starten, Golden Path und mindestens einen Edge Case manuell pruefen.
Wenn ein Check nicht lokal ausfuehrbar ist: im Abschlussbericht vermerken, nicht verschweigen.

---

## Issue-Format (Vier Abschnitte)

\`\`\`markdown
## Kontext
Warum wird diese Aufgabe gemacht?

## Aufgabe
Was konkret ist zu tun?

## Akzeptanzkriterium
Wie wird verifiziert, dass die Aufgabe erledigt ist?
Portabilitaets-Konvention: Wenn eine Datei als eigenstaendig portabel gedacht ist (Installer, kopierbares Script), muss hier stehen: "lauffaehig ohne weiteren Repo-Kontext".

## Abhaengigkeiten
Keine. (oder: Issue #N muss vorher fertig sein)
\`\`\`

---

## Abschlussbericht-Format

\`\`\`
### Aenderungen
- \`Datei\` — kurze Beschreibung der Wirkung

### Tests und Checks
- <Kommando> -> <Ergebnis>

### Hinweise
- <Restrisiken, offene Punkte, manuelle Folgeschritte>
\`\`\`

---

## Prioritaeten bei Zielkonflikten

1. Sicherheit
2. Korrektheit
3. Datenintegritaet
4. Accessibility
5. Wartbarkeit
6. Performance
7. Visuelle Praeferenz
8. Bequemlichkeit der Implementierung

---

## KI-Retro (alle 1-2 Wochen)

\`/retro\` startet die KI-Retrospektive. Drei Fragen:
- Wo hat die Mensch-KI-Zusammenarbeit gehakt?
- Welche Memory-Eintraege sind veraltet?
- Welche Workflow-Regel braucht eine Schaerfung?

Output: konkrete Aenderungen an Memory-Dateien und CLAUDE*.md-Dateien.
`;

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

// --- GitLab Label Setup ---

const GITLAB_LABELS = [
  { name: "Backlog",     color: "#e2e2e2" },
  { name: "Ready",       color: "#0075ca" },
  { name: "In Progress", color: "#e4e669" },
  { name: "In Review",   color: "#d93f0b" },
  { name: "Done",        color: "#0e8a16" },
];

async function setupGitLabLabels(rl) {
  const raw = await ask(rl, "\nGitLab-Labels jetzt automatisch anlegen? (glab muss eingeloggt sein) [j/n]: ");
  if (raw.trim().toLowerCase() !== "j") {
    console.log(`  Labels manuell anlegen: Backlog, Ready, "In Progress", "In Review", Done`);
    console.log(`  Wichtig: Leerzeichen in den Namen verwenden, kein Bindestrich.\n`);
    return;
  }
  console.log("\nLege GitLab-Labels an:");
  const { execSync } = await import("node:child_process");
  for (const label of GITLAB_LABELS) {
    try {
      execSync(`glab label create --name "${label.name}" --color "${label.color}"`, { stdio: "pipe" });
      console.log(`  ✓ ${label.name}`);
    } catch (e) {
      const msg = e.stderr?.toString() ?? "";
      if (msg.includes("already exists") || msg.includes("has already been taken")) {
        console.log(`  ~ ${label.name} (bereits vorhanden)`);
      } else {
        console.warn(`  ✗ ${label.name}: ${msg.trim()}`);
      }
    }
  }
  console.log(`\n  Labels angelegt. Jetzt manuell das Board einrichten:`);
  console.log(`  Issues → Boards → "Add list" → je eine Spalte fuer jedes Label anlegen.`);
  console.log(`  Reihenfolge: Backlog → Ready → In Progress → In Review → Done`);
  console.log(`  (Board-Spalten lassen sich nicht per CLI anlegen — das ist eine GitLab-Einschraenkung.)\n`);
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

  // Bestehende Config als Defaults laden (Update-Modus)
  const existingConfigPath = scope === "global"
    ? join(homedir(), ".claude", "workflow.config.json")
    : resolve(".claude", "workflow.config.json");
  let existingConfig = {};
  if (existsSync(existingConfigPath)) {
    try {
      existingConfig = JSON.parse(readFileSync(existingConfigPath, "utf-8"));
      console.log("  Bestehende workflow.config.json gefunden — Werte als Defaults uebernommen.\n");
    } catch {
      console.warn("  Hinweis: Bestehende workflow.config.json konnte nicht gelesen werden.\n");
    }
  }
  const D = { ...DEFAULTS, ...existingConfig };

  // Frage 2: provider
  const provider = await askWithDefault(
    rl,
    "Issue-Plattform: 'github' oder 'gitlab'?",
    D.provider,
    "provider"
  );

  // Frage 3: mainBranch
  const mainBranch = await askWithDefault(rl, "Haupt-Branch (mainBranch)", D.mainBranch);

  // Frage 4: productionBranch
  const productionBranch = await askWithDefault(rl, "Production-Branch (productionBranch)", D.productionBranch);

  // Frage 5: reviewScope
  const reviewScope = await askWithDefault(
    rl,
    "Review-Umfang: 'diff' (nur Aenderungen) oder 'full' (gesamter Quelltext)?",
    D.reviewScope,
    "reviewScope"
  );

  // Frage 6: reviewModel
  const reviewModel = await askWithDefault(
    rl,
    "Reviewer-Modell (muss mit 'claude-' beginnen)",
    D.reviewModel,
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
  writeFileSync(workflowMdTarget, CLAUDE_WORKFLOW_MD, "utf-8");
  console.log(`✓ CLAUDE-workflow.md abgelegt: ${workflowMdTarget}`);

  // --- .gitignore ergänzen (nur projektlokal) ---
  if (scope === "projekt") {
    const gitignorePath = resolve(".gitignore");
    const entry = ".claude/";
    let content = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
    const lines = content.split("\n");
    if (!lines.some((l) => l.trim() === entry)) {
      content = content.endsWith("\n") || content === "" ? content + entry + "\n" : content + "\n" + entry + "\n";
      writeFileSync(gitignorePath, content, "utf-8");
      console.log(`✓ .gitignore: '${entry}' eingetragen`);
    } else {
      console.log(`✓ .gitignore: '${entry}' bereits vorhanden`);
    }
  }

  console.log("\n=== Fertig ===");
  console.log(`Starte eine neue Claude-Code-Session im Projekt.`);
  console.log(`Die zehn Skills erscheinen in /help.\n`);
  if (provider === "gitlab") {
    console.log(`GitLab: Stelle sicher dass 'glab auth login' durchgefuehrt wurde.`);
    await setupGitLabLabels(rl);
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
