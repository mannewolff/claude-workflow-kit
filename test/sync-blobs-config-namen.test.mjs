// Die Namenstabelle der Einstellungen in kit/einstellungen.mjs (Issue #1437, Plan #1420 E10).
//
// kit/einstellungen.mjs wird allein verteilt und kann kit/board/config-namen.mjs nicht
// importieren. tools/sync-blobs.mjs bettet die Tabelle darum ein wie das Schema, und `--check`
// wird rot, sobald die eingebettete Fassung von der Quelle abweicht — eine Kopie von Hand gibt
// es nicht. Die Oberflaeche bringt Config und persoenliche Datei vor dem Mischen auf dieselben
// Namen: Eine englische Config mit deutscher Override-Datei ergibt dasselbe wie zwei deutsche.
// Ablauf-Pruefung: Einbettung und Drift zeigt nur sync-blobs als Programm in einem Wegwerf-Repo, und dass die Datei allein lauffaehig ist, nur ihr Start aus einem Wegwerf-Verzeichnis.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const SYNC = join(repoRoot, "tools", "sync-blobs.mjs");
const EINSTELLUNGEN = join(repoRoot, "kit", "einstellungen.mjs");
const CONFIG_NAMEN = join(repoRoot, "kit", "board", "config-namen.mjs");

const KONSTANTEN = ["CONFIG_EXAMPLE_B64", "CLAUDE_WORKFLOW_MD_B64", "CLAUDE_FACHPLAN_MD_B64", "CLAUDE_PLAN_MD_B64", "BOARD_MJS_B64", "NIGHT_MJS_B64", "CHECKS_MJS_B64", "PREISE_MJS_B64", "AUFWAND_MJS_B64", "WIRKSAMKEIT_MJS_B64", "BEFUNDE_MJS_B64", "WORKTREE_MJS_B64", "FINDINGS_MJS_B64", "EFFORT_MJS_B64", "EFFECTIVENESS_MJS_B64", "KIT_NIGHT_B64", "KIT_BOARD_B64", "KIT_ROLLEN_B64", "GATE_MJS_B64", "PRE_COMMIT_B64", "SKILLS_B64", "AGENTS_B64", "SKILLS_EN_B64", "TEMPLATES_EN_B64", "AGENTS_EN_B64", "KIT_ROLLEN_EN_B64"];

/** Minimales Repo mit allem, was sync-blobs.mjs anfasst, und der echten Namenstabelle. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "sync-config-namen-"));
  for (const ordner of ["tools", "kit/board", "templates", "skills/beispiel", ".githooks"]) mkdirSync(join(dir, ordner), { recursive: true });
  writeFileSync(join(dir, ".githooks", "gate.mjs"), 'console.log("gate");\n');
  writeFileSync(join(dir, ".githooks", "pre-commit"), "#!/bin/sh\nexit 0\n");
  for (const datei of ["CLAUDE-workflow.md", "CLAUDE-Fachplan.md", "CLAUDE-Plan.md"]) writeFileSync(join(dir, "templates", datei), "# Vorlage\n");
  writeFileSync(join(dir, "templates", "workflow.config.json"), "{}\n");
  writeFileSync(join(dir, "templates", "workflow.config.schema.json"), "{}\n");
  writeFileSync(join(dir, "skills", "beispiel", "SKILL.md"), "# Beispiel\n");
  for (const datei of ["board.mjs", "night.mjs", "checks.mjs", "preise.mjs", "aufwand.mjs", "wirksamkeit.mjs", "befunde.mjs", "worktree.mjs"]) {
    writeFileSync(join(dir, "kit", datei), `const KIT_VERSION = "1.0.0";\n`);
  }
  // Seit Issue #1462: die englischen Einstiege, als Blob und in der Kopie, aber ohne Stempel.
  for (const datei of ["findings.mjs", "effort.mjs", "effectiveness.mjs"]) writeFileSync(join(dir, "kit", datei), `console.log("${datei}");\n`);
  copyFileSync(CONFIG_NAMEN, join(dir, "kit", "board", "config-namen.mjs"));
  writeFileSync(join(dir, "kit", "board", "namen.mjs"), "export {};\n");
  writeFileSync(join(dir, "tools", "config-referenz.en.json"), "{}\n");
  writeFileSync(join(dir, "kit", "einstellungen.mjs"), `const KIT_VERSION = "1.0.0";\nconst SCHEMA_B64 = "";\nconst CONFIG_NAMEN_B64 = "";\nconst CONFIG_REFERENZ_EN_B64 = "";\nconst NAMEN_B64 = "";\n`);
  writeFileSync(join(dir, "install.mjs"), ['const VERSION = "1.0.0";', ...KONSTANTEN.map((k) => `const ${k} = "";`), ""].join("\n"));
  return dir;
}

function syncBlobs(dir, ...args) {
  return spawnSync(process.execPath, [SYNC, ...args], { cwd: dir, encoding: "utf-8", env: { ...process.env, KIT_ROOT: dir } });
}

const eingebettet = (pfad) => readFileSync(pfad, "utf-8").match(/const CONFIG_NAMEN_B64 = "([^"]*)";/)?.[1];

test("[1437-1] sync-blobs schreibt die Namenstabelle in kit/einstellungen.mjs", () => {
  const dir = fixture();
  try {
    const res = syncBlobs(dir);
    assert.equal(res.status, 0, res.stderr);
    const b64 = eingebettet(join(dir, "kit", "einstellungen.mjs"));
    assert.equal(Buffer.from(b64, "base64").toString("utf-8"), readFileSync(CONFIG_NAMEN, "utf-8"));
    assert.equal(syncBlobs(dir, "--check").status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1437-2] --check wird rot, wenn die eingebettete Tabelle von kit/board/config-namen.mjs abweicht", () => {
  const dir = fixture();
  try {
    assert.equal(syncBlobs(dir).status, 0);
    const quelle = join(dir, "kit", "board", "config-namen.mjs");
    writeFileSync(quelle, `${readFileSync(quelle, "utf-8")}\n// geaendert\n`);
    const res = syncBlobs(dir, "--check");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /einstellungen\.mjs.*kit\/board\/config-namen\.mjs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1437-3] die Tabelle im Repo ist eingebettet und stimmt mit der Quelle ueberein", () => {
  assert.equal(Buffer.from(eingebettet(EINSTELLUNGEN) ?? "", "base64").toString("utf-8"), readFileSync(CONFIG_NAMEN, "utf-8"));
});

/** Mischt `team` und `lokal` mit der allein kopierten Oberflaeche in einem Wegwerf-Verzeichnis. */
function mischeAllein(team, lokal) {
  const wurzel = mkdtempSync(join(tmpdir(), "einstellungen-allein-"));
  try {
    mkdirSync(join(wurzel, ".claude"));
    copyFileSync(EINSTELLUNGEN, join(wurzel, "einstellungen.mjs"));
    writeFileSync(join(wurzel, ".claude", "workflow.config.json"), JSON.stringify(team));
    writeFileSync(join(wurzel, ".claude", "workflow.config.local.json"), JSON.stringify(lokal));
    const skript = [
      'import { readFileSync } from "node:fs";',
      'import { mergeWorkflowConfig } from "./einstellungen.mjs";',
      'const lies = (d) => JSON.parse(readFileSync(d, "utf-8"));',
      'const { config } = mergeWorkflowConfig(lies(".claude/workflow.config.json"), lies(".claude/workflow.config.local.json"));',
      "process.stdout.write(JSON.stringify(config));",
    ].join("\n");
    const res = spawnSync(process.execPath, ["--input-type=module", "-e", skript], { cwd: wurzel, encoding: "utf-8" });
    assert.equal(res.status, 0, res.stderr);
    return JSON.parse(res.stdout);
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
}

test("[1437-4] die allein kopierte Oberflaeche mischt eine englische Config mit deutscher Override-Datei wie zwei deutsche", () => {
  const lokal = { reviewCommand: "mein-review", reviewLesegrenze: 9, triggers: { push: "LOS" }, toolbox: { tokenFile: "~/t" } };
  const deutsch = {
    language: "en",
    ohnePruefung: [{ muster: "docs/**", grund: "Doku" }],
    buildChecks: [{ cmd: "npm test", stufe: "paket", nichtBeimAbschluss: "zusammenspiel" }],
    reviewLesegrenze: 5,
    reviewModel: "opus",
    triggers: { go: "GO", push: "push main" },
    toolbox: { host: "h" },
  };
  const englisch = {
    language: "en",
    noCheck: [{ pattern: "docs/**", reason: "Doku" }],
    buildChecks: [{ cmd: "npm test", stage: "package", notAtCompletion: "interplay" }],
    reviewReadLimit: 5,
    reviewModel: "opus",
    triggers: { go: "GO", push: "push main" },
    toolbox: { host: "h" },
  };
  const erwartet = mischeAllein(deutsch, lokal);
  assert.equal(erwartet.reviewLesegrenze, 9);
  assert.equal(erwartet.reviewModel, undefined, "das persoenliche reviewCommand verdraengt reviewModel");
  assert.deepEqual(mischeAllein(englisch, lokal), erwartet);
});
