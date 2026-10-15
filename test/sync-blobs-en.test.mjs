// Der Spiegel en/ als eigene Blobs in install.mjs (Issue #1464, Plan #1420 E17).
//
// Die englischen Fassungen liegen im Spiegelordner en/ an der Wurzel: en/templates/,
// en/agents/ und en/kit/rollen/. Skills gibt es seit Issue #1566 nur in einer Fassung. tools/sync-blobs.mjs bettet jeden davon als eigenen Blob neben
// dem deutschen ein, und `--check` wird rot, sobald ein Blob von seiner Quelle abweicht. Die
// .gitkeep-Dateien, die den leeren Spiegel im Repo halten, gehoeren in keinen Blob.
// Ablauf-Pruefung: Einbettung und Drift zeigt nur sync-blobs als Programm in einem Wegwerf-Repo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const SYNC = join(repoRoot, "tools", "sync-blobs.mjs");

const KONSTANTEN = ["CONFIG_EXAMPLE_B64", "CLAUDE_WORKFLOW_MD_B64", "CLAUDE_FACHPLAN_MD_B64", "CLAUDE_PLAN_MD_B64", "BOARD_MJS_B64", "NIGHT_MJS_B64", "CHECKS_MJS_B64", "PREISE_MJS_B64", "WORKTREE_MJS_B64", "FINDINGS_MJS_B64", "EFFORT_MJS_B64", "EFFECTIVENESS_MJS_B64", "KIT_NIGHT_B64", "KIT_BOARD_B64", "KIT_ROLLEN_B64", "KIT_TEXTE_B64", "KIT_CHECKS_B64", "GATE_MJS_B64", "PRE_COMMIT_B64", "SKILLS_B64", "AGENTS_B64", "TEMPLATES_EN_B64", "AGENTS_EN_B64", "KIT_ROLLEN_EN_B64"];

/** Minimales Repo mit allem, was sync-blobs.mjs anfasst; `spiegel` legt en/ mit Inhalt an. */
function fixture({ spiegel = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sync-en-"));
  for (const ordner of ["tools", "kit/board", "kit/rollen", "templates", "skills/requirement", "agents", ".githooks"]) mkdirSync(join(dir, ordner), { recursive: true });
  writeFileSync(join(dir, ".githooks", "gate.mjs"), 'console.log("gate");\n');
  writeFileSync(join(dir, ".githooks", "pre-commit"), "#!/bin/sh\nexit 0\n");
  for (const datei of ["CLAUDE-workflow.md", "CLAUDE-Fachplan.md", "CLAUDE-Plan.md"]) writeFileSync(join(dir, "templates", datei), "# Vorlage\n");
  writeFileSync(join(dir, "templates", "workflow.config.json"), "{}\n");
  writeFileSync(join(dir, "templates", "workflow.config.schema.json"), "{}\n");
  writeFileSync(join(dir, "skills", "requirement", "SKILL.md"), "# Requirement\n");
  writeFileSync(join(dir, "agents", "kit-pruefer.md"), "# Pruefer\n");
  writeFileSync(join(dir, "kit", "rollen", "code-review.md"), "# Code-Review\n");
  for (const datei of ["board.mjs", "night.mjs", "checks.mjs", "preise.mjs", "effort.mjs", "effectiveness.mjs", "findings.mjs", "worktree.mjs"]) {
    writeFileSync(join(dir, "kit", datei), `const KIT_VERSION = "1.0.0";\n`);
  }
  writeFileSync(join(dir, "kit", "board", "config-namen.mjs"), "export {};\n");
  writeFileSync(join(dir, "kit", "board", "namen.mjs"), "export {};\n");
  writeFileSync(join(dir, "tools", "config-referenz.en.json"), "{}\n");
  writeFileSync(join(dir, "kit", "settings.mjs"), `const KIT_VERSION = "1.0.0";\nconst SCHEMA_B64 = "";\nconst CONFIG_NAMEN_B64 = "";\nconst CONFIG_REFERENZ_EN_B64 = "";\nconst NAMEN_B64 = "";\n`);
  writeFileSync(join(dir, "install.mjs"), ['const VERSION = "1.0.0";', ...KONSTANTEN.map((k) => `const ${k} = "";`), ""].join("\n"));
  if (spiegel) {
    for (const ordner of ["en/templates", "en/agents", "en/kit/rollen"]) mkdirSync(join(dir, ordner), { recursive: true });
    for (const ordner of ["en/templates", "en/agents", "en/kit/rollen"]) writeFileSync(join(dir, ordner, ".gitkeep"), "");
    writeFileSync(join(dir, "en", "templates", "CLAUDE-workflow.md"), "# Template\n");
    writeFileSync(join(dir, "en", "agents", "kit-pruefer.md"), "# Checker\n");
    writeFileSync(join(dir, "en", "kit", "rollen", "code-review.md"), "# Code review\n");
  }
  return dir;
}

function syncBlobs(dir, ...args) {
  return spawnSync(process.execPath, [SYNC, ...args], { cwd: dir, encoding: "utf-8", env: { ...process.env, KIT_ROOT: dir } });
}

function blob(dir, konstante) {
  const b64 = readFileSync(join(dir, "install.mjs"), "utf-8").match(new RegExp(`const ${konstante} = "([^"]*)";`))?.[1];
  return JSON.parse(Buffer.from(b64 ?? "", "base64").toString("utf-8"));
}

test("[1464-1] sync-blobs bettet en/ als eigene Blobs neben den deutschen ein, ohne .gitkeep", () => {
  const dir = fixture();
  try {
    const res = syncBlobs(dir);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(blob(dir, "TEMPLATES_EN_B64"), { "CLAUDE-workflow.md": "# Template\n" });
    assert.deepEqual(blob(dir, "AGENTS_EN_B64"), { "kit-pruefer.md": "# Checker\n" });
    assert.deepEqual(blob(dir, "KIT_ROLLEN_EN_B64"), { "code-review.md": "# Code review\n" });
    assert.deepEqual(blob(dir, "SKILLS_B64"), { requirement: { "SKILL.md": "# Requirement\n" } }, "der Skill-Blob traegt die eine Fassung");
    assert.deepEqual(blob(dir, "KIT_ROLLEN_B64"), { "code-review.md": "# Code-Review\n" });
    assert.equal(syncBlobs(dir, "--check").status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1464-2] --check wird rot, wenn eine englische Fassung von ihrem Blob abweicht", () => {
  const dir = fixture();
  try {
    assert.equal(syncBlobs(dir).status, 0);
    for (const [datei, konstante] of [
      [join("en", "templates", "CLAUDE-workflow.md"), "TEMPLATES_EN_B64"],
      [join("en", "agents", "kit-pruefer.md"), "AGENTS_EN_B64"],
      [join("en", "kit", "rollen", "code-review.md"), "KIT_ROLLEN_EN_B64"],
    ]) {
      const pfad = join(dir, datei);
      const vorher = readFileSync(pfad, "utf-8");
      writeFileSync(pfad, `${vorher}geaendert\n`);
      const res = syncBlobs(dir, "--check");
      assert.equal(res.status, 1, datei);
      assert.match(res.stderr, new RegExp(`Blob-Drift in install\\.mjs: ${konstante}`), datei);
      writeFileSync(pfad, vorher);
    }
    assert.equal(syncBlobs(dir, "--check").status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1464-3] ohne en/ sind die englischen Blobs leer und --check bleibt gruen", () => {
  const dir = fixture({ spiegel: false });
  try {
    assert.equal(syncBlobs(dir).status, 0);
    for (const konstante of ["TEMPLATES_EN_B64", "AGENTS_EN_B64", "KIT_ROLLEN_EN_B64"]) assert.deepEqual(blob(dir, konstante), {}, konstante);
    assert.equal(syncBlobs(dir, "--check").status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1464-4] der Spiegel en/ im Repo ist eingebettet", () => {
  const install = readFileSync(join(repoRoot, "install.mjs"), "utf-8");
  for (const konstante of ["TEMPLATES_EN_B64", "AGENTS_EN_B64", "KIT_ROLLEN_EN_B64"]) {
    assert.match(install, new RegExp(`const ${konstante} = "[A-Za-z0-9+/=]+";`), konstante);
  }
});

test("[1566-4] Skills gibt es nur in einer Fassung: kein SKILLS_EN_B64, kein en/skills/", () => {
  const install = readFileSync(join(repoRoot, "install.mjs"), "utf-8");
  assert.doesNotMatch(install, /SKILLS_EN_B64/);
  assert.doesNotMatch(readFileSync(SYNC, "utf-8"), /SKILLS_EN_B64/);
  assert.equal(existsSync(join(repoRoot, "en", "skills")), false, "en/skills/ liegt noch da");
});
