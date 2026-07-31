// E2E fuer das Routing-Label des Nacht-Runners (Issue #159).
// night.mjs verarbeitet aus Ready nur Issues mit einem bestimmten Label
// (Default kit:nightrun); alle anderen bleiben unangetastet liegen. --label none
// stellt das alte Verhalten wieder her (striktes ready[0]). --label <name>
// filtert auf ein beliebiges Label.
// Laeuft lokal: issueTracker "local", Labels im Frontmatter, Session-Fake via
// NIGHT_CLAUDE_CMD.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

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

// Setzt Labels auf ein lokales Issue, indem eine labels-Zeile (CSV) ins
// Frontmatter eingefuegt wird — der lokale Tracker liest sie beim listIssues.
function setLabels(dir, id, labels) {
  const file = join(dir, "issues", `${id}.md`);
  const raw = readFileSync(file, "utf-8");
  writeFileSync(file, raw.replace(/\n---\n/, `\nlabels: ${labels.join(",")}\n---\n`), "utf-8");
}

function setupProjekt() {
  const dir = mkdtempSync(join(tmpdir(), "night-label-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\nsessions.log\n");
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

// Fake: protokolliert die Issue-ID und bringt das Issue nach In review.
function successFake(sessionLog) {
  return `echo "$NIGHT_ISSUE_ID" >> ${JSON.stringify(sessionLog)}`
    + ` && node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`;
}

test("Default-Label: nur kit:nightrun-Issues laufen, ungelabelte bleiben in Ready", () => {
  const dir = setupProjekt();
  try {
    const a = board(dir, "issue", "create", "--title", "Ungelabelt", "--body", "## Abhaengigkeiten\nKeine.");
    const b = board(dir, "issue", "create", "--title", "Nachtlauf", "--body", "## Abhaengigkeiten\nKeine.");
    setLabels(dir, b.id, ["kit:nightrun"]);
    board(dir, "issue", "move", a.id, "ready");
    board(dir, "issue", "move", b.id, "ready");

    const sessionLog = join(dir, "sessions.log");
    const res = run(dir, process.execPath, [NIGHT], { NIGHT_CLAUDE_CMD: successFake(sessionLog) });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);

    // Nur B lief, A blieb unangetastet in Ready.
    assert.deepEqual(readFileSync(sessionLog, "utf-8").trim().split("\n"), [b.id], "es lief nicht genau die Session fuer B");
    const ready = board(dir, "issue", "list", "--status", "ready").map((i) => i.id);
    assert.ok(ready.includes(a.id), "ungelabeltes A haette in Ready bleiben muessen");
    const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => i.id);
    assert.ok(inReview.includes(b.id), "B haette in In review landen muessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--label none: altes Verhalten, striktes ready[0] (auch ungelabelt)", () => {
  const dir = setupProjekt();
  try {
    const a = board(dir, "issue", "create", "--title", "Ungelabelt", "--body", "## Abhaengigkeiten\nKeine.");
    const b = board(dir, "issue", "create", "--title", "Nachtlauf", "--body", "## Abhaengigkeiten\nKeine.");
    setLabels(dir, b.id, ["kit:nightrun"]);
    board(dir, "issue", "move", a.id, "ready");
    board(dir, "issue", "move", b.id, "ready");

    const sessionLog = join(dir, "sessions.log");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: successFake(sessionLog) });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);

    // Ohne Filter kommt das erste Ready-Issue dran (A), unabhaengig vom Label.
    const sessions = readFileSync(sessionLog, "utf-8").trim().split("\n");
    assert.equal(sessions[0], a.id, "mit --label none haette A (ready[0]) zuerst laufen muessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("kein Label-Treffer -> Lauf endet wie bei leerem Ready", () => {
  const dir = setupProjekt();
  try {
    const a = board(dir, "issue", "create", "--title", "Ungelabelt", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", a.id, "ready");

    const sessionLog = join(dir, "sessions.log");
    const res = run(dir, process.execPath, [NIGHT], { NIGHT_CLAUDE_CMD: successFake(sessionLog) });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /0 erfolgreich, 0 zurueckgestellt, 0 Session/, "kein-Treffer-Lauf haette leer enden muessen");
    assert.ok(!existsSync(sessionLog), "es haette keine Session laufen duerfen");
    const ready = board(dir, "issue", "list", "--status", "ready").map((i) => i.id);
    assert.ok(ready.includes(a.id), "A haette in Ready bleiben muessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--dry-run: ungelabelte Issues werden sichtbar als uebersprungen ausgewiesen", () => {
  const dir = setupProjekt();
  try {
    const a = board(dir, "issue", "create", "--title", "Ungelabelt", "--body", "## Abhaengigkeiten\nKeine.");
    const b = board(dir, "issue", "create", "--title", "Nachtlauf", "--body", "## Abhaengigkeiten\nKeine.");
    setLabels(dir, b.id, ["kit:nightrun"]);
    board(dir, "issue", "move", a.id, "ready");
    board(dir, "issue", "move", b.id, "ready");

    const res = run(dir, process.execPath, [NIGHT, "--dry-run"]);
    assert.equal(res.status, 0, `dry-run schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, new RegExp(`#${a.id}.*uebersprungen.*kit:nightrun`), "ungelabeltes A nicht als uebersprungen ausgewiesen");
    assert.match(res.stdout, new RegExp(`#${b.id}.*Session 1`), "gelabeltes B nicht als Session gezaehlt");
    assert.match(res.stdout, /Dry-Run beendet: 1 Session/, "genau eine Session sollte geplant sein");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
