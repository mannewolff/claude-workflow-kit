// E2E fuer die verbindliche Issue-Uebergabe an die Session (Issue #191).
// night.mjs waehlt das Issue (Label-Filter, Abhaengigkeiten, Board-Reihenfolge) und
// uebergibt es der Session als Argument: /implement-next #N. Vorher waehlte der Skill
// selbst "das oberste Ready-Issue" — zwei Wahrheiten ueber das Dran-Sein, mit denen
// eine Session am Label-Filter vorbei ein fremdes Issue implementieren konnte.
// Laeuft lokal: issueTracker "local", Session-Fake via NIGHT_CLAUDE_CMD, der den
// tatsaechlichen Prompt aus NIGHT_PROMPT protokolliert.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." } : {};


const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Das ECHTE Script aus dem Repo (nicht kopiert): nur so wird seine Coverage gemessen.
// Die Isolation leistet cwd + KIT_ROOT auf das Fixture-Verzeichnis (Issue #189).
const NIGHT = join(repoRoot, "kit", "night.mjs");

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setLabels(dir, id, labels) {
  const file = join(dir, "issues", `${id}.md`);
  const raw = readFileSync(file, "utf-8");
  writeFileSync(file, raw.replace(/\n---\n/, `\nlabels: ${labels.join(",")}\n---\n`), "utf-8");
}

function setupProjekt() {
  const dir = mkdtempSync(join(tmpdir(), "night-assign-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\nprompts.log\n");
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

// Fake: protokolliert den Prompt, den die Session bekommen haette, und bringt das
// beauftragte Issue nach In review.
function promptFake(promptLog) {
  return `echo "$NIGHT_PROMPT" >> ${JSON.stringify(promptLog)}`
    + ` && node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`;
}

test("Runner uebergibt das Issue verbindlich: Prompt enthaelt /implement-next #N", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const a = board(dir, "issue", "create", "--title", "Erstes", "--body", "## Abhaengigkeiten\nKeine.");
    const b = board(dir, "issue", "create", "--title", "Zweites", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", a.id, "ready");
    board(dir, "issue", "move", b.id, "ready");

    const promptLog = join(dir, "prompts.log");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"],
      { NIGHT_CLAUDE_CMD: promptFake(promptLog) });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);

    const prompts = readFileSync(promptLog, "utf-8").trim().split("\n");
    assert.deepEqual(prompts, [`/implement-next #${a.id}`, `/implement-next #${b.id}`],
      "jede Session haette genau ihr beauftragtes Issue im Prompt tragen muessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Label-Filter wirkt im Prompt: ungelabeltes Ready-Issue wird nie beauftragt", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const a = board(dir, "issue", "create", "--title", "Ungelabelt", "--body", "## Abhaengigkeiten\nKeine.");
    const b = board(dir, "issue", "create", "--title", "Nachtlauf", "--body", "## Abhaengigkeiten\nKeine.");
    setLabels(dir, b.id, ["kit:nightrun"]);
    board(dir, "issue", "move", a.id, "ready");
    board(dir, "issue", "move", b.id, "ready");

    const promptLog = join(dir, "prompts.log");
    const res = run(dir, process.execPath, [NIGHT],
      { NIGHT_CLAUDE_CMD: promptFake(promptLog) });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);

    const prompts = readFileSync(promptLog, "utf-8").trim().split("\n");
    assert.deepEqual(prompts, [`/implement-next #${b.id}`],
      "nur das gelabelte Issue haette beauftragt werden duerfen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
