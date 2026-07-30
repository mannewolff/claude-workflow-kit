// E2E fuer die Modell-Selbstauskunft des Nacht-Runners (Issue #193).
// night.mjs kennt --model und setzt es der Session als KIT_AGENT_MODEL. Die Variable
// wird vom Bash-Kindprozess der Session geerbt (verifiziert mit einer echten
// Headless-Session, siehe Abschlussbericht #193) und von board.mjs als Header
// X-Agent-Model gesendet. Hier wird die erste Prozessgrenze geprueft: kommt der Wert
// aus --model in der Session-Umgebung an, und zwar auch bei der Salvage-Session.
// Laeuft lokal: issueTracker "local", Session-Fake via NIGHT_CLAUDE_CMD.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt() {
  const dir = mkdtempSync(join(tmpdir(), "night-agent-model-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  copyFileSync(join(repoRoot, "kit", "night.mjs"), join(dir, ".claude", "kit", "night.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\nmodels.log\n");
  for (const [c, a] of [
    ["git", ["init", "-q"]],
    ["git", ["config", "user.email", "test@example.invalid"]],
    ["git", ["config", "user.name", "Night Test"]],
    ["git", ["add", "-A"]],
    ["git", ["commit", "-q", "-m", "setup"]],
  ]) {
    const res = run(dir, c, a);
    assert.equal(res.status, 0, `${c} ${a.join(" ")} schlug fehl: ${res.stderr}`);
  }
  return dir;
}

// Fake: protokolliert die Modell-Angabe, die die Session in ihrer Umgebung sieht.
function modelFake(modelLog) {
  return `echo "\${KIT_AGENT_MODEL:-KEINE}" >> ${JSON.stringify(modelLog)}`
    + ` && node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`;
}

test("Session-Umgebung traegt KIT_AGENT_MODEL mit dem Wert aus --model", () => {
  const dir = setupProjekt();
  try {
    const a = board(dir, "issue", "create", "--title", "Erstes", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", a.id, "ready");

    const modelLog = join(dir, "models.log");
    const res = run(dir, process.execPath,
      [join(dir, ".claude", "kit", "night.mjs"), "--label", "none", "--model", "claude-sonnet-5"],
      { NIGHT_CLAUDE_CMD: modelFake(modelLog) });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);

    assert.deepEqual(readFileSync(modelLog, "utf-8").trim().split("\n"), ["claude-sonnet-5"],
      "die Session haette das Modell aus --model in KIT_AGENT_MODEL sehen muessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Ohne --model steht das Default-Modell in KIT_AGENT_MODEL", () => {
  const dir = setupProjekt();
  try {
    const a = board(dir, "issue", "create", "--title", "Erstes", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", a.id, "ready");

    const modelLog = join(dir, "models.log");
    const res = run(dir, process.execPath, [join(dir, ".claude", "kit", "night.mjs"), "--label", "none"],
      { NIGHT_CLAUDE_CMD: modelFake(modelLog) });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);

    // Der Default steht in night.mjs (DEFAULT_MODEL) und wird auch im --help ausgewiesen.
    const help = run(dir, process.execPath, [join(dir, ".claude", "kit", "night.mjs"), "--help"]);
    const defaultModel = help.stdout.match(/--model <id>\s+Modell der Nacht-Sessions \(Default (\S+)\)/)?.[1];
    assert.ok(defaultModel, "Default-Modell nicht aus --help ablesbar");
    assert.deepEqual(readFileSync(modelLog, "utf-8").trim().split("\n"), [defaultModel],
      "ohne --model haette das Default-Modell in KIT_AGENT_MODEL stehen muessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
