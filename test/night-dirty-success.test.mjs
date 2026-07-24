// E2E fuer die gitClean-Leitplanke nach erfolgreicher Runde (Issue #152).
// Eine Session, die ihr Issue erfolgreich nach In review bringt, aber unkommittete
// Reste (z. B. Temp-Dateien) im Working Tree hinterlaesst, darf den Lauf nicht
// stillschweigend fortsetzen: Der Muell wuerde die Diagnose der Folgerunde
// vergiften. Der Runner stoppt darum nach einer erfolgreichen, aber schmutzigen
// Runde hart — bevor die naechste Runde beginnt.
// Laeuft komplett lokal: issueTracker "local" in einem Temp-Repo, Session-Fake via
// NIGHT_CLAUDE_CMD.

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
  const dir = mkdtempSync(join(tmpdir(), "night-dirty-success-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  copyFileSync(join(repoRoot, "kit", "night.mjs"), join(dir, ".claude", "kit", "night.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    buildChecks: ["true"],
    local: { issuesDir: "issues" },
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

test("Nachtlauf: erfolgreiche Runde mit unkommittetem Rest stoppt hart vor der naechsten Runde", () => {
  const dir = setupProjekt();
  try {
    const erstes = board(dir, "issue", "create", "--title", "Erstes Issue", "--body", "## Abhaengigkeiten\nKeine.");
    const zweites = board(dir, "issue", "create", "--title", "Zweites Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(erstes.id), "ready");
    board(dir, "issue", "move", String(zweites.id), "ready");

    // Session-Fake: bringt das Issue nach in_review (Erfolg), laesst aber eine
    // untracked Temp-Datei liegen — wie der reale kanban-kit#400-Fall.
    const sessionLog = join(dir, "sessions.log");
    const fake = `echo "$NIGHT_ISSUE_ID" >> ${JSON.stringify(sessionLog)}`
      + ` && node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`
      + ` && echo rest > .tmp-report.md`;

    const res = run(dir, process.execPath, [join(dir, ".claude", "kit", "night.mjs")], { NIGHT_CLAUDE_CMD: fake });

    // Harter Stopp direkt nach der erfolgreichen, aber schmutzigen Runde.
    assert.equal(res.status, 1, `night.mjs haette mit Exit 1 enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /Erfolg/, "die Runde haette als Erfolg gemeldet werden muessen");
    assert.match(res.stdout, /unkommittete Reste|harter Stopp/i, "kein Hinweis auf den Rest-Stopp");

    // Erstes Issue erfolgreich in In review, zweites Issue NIE gestartet.
    const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id));
    assert.ok(inReview.includes(String(erstes.id)), "erstes Issue liegt nicht in In review");
    const ready = board(dir, "issue", "list", "--status", "ready").map((i) => String(i.id));
    assert.ok(ready.includes(String(zweites.id)), "zweites Issue haette in Ready bleiben muessen");
    const sessions = readFileSync(sessionLog, "utf-8").trim().split("\n");
    assert.deepEqual(sessions, [String(erstes.id)], "es lief nicht genau eine Session");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Nachtlauf: erfolgreiche Runde mit sauberem Tree laeuft weiter (Bestandsverhalten)", () => {
  const dir = setupProjekt();
  try {
    const erstes = board(dir, "issue", "create", "--title", "Erstes Issue", "--body", "## Abhaengigkeiten\nKeine.");
    const zweites = board(dir, "issue", "create", "--title", "Zweites Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(erstes.id), "ready");
    board(dir, "issue", "move", String(zweites.id), "ready");

    // Session-Fake: sauberer Erfolg ohne Reste — beide Runden laufen durch.
    const sessionLog = join(dir, "sessions.log");
    const fake = `echo "$NIGHT_ISSUE_ID" >> ${JSON.stringify(sessionLog)}`
      + ` && node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`;

    const res = run(dir, process.execPath, [join(dir, ".claude", "kit", "night.mjs")], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id));
    assert.ok(inReview.includes(String(erstes.id)) && inReview.includes(String(zweites.id)),
      "beide Issues haetten in In review landen muessen");
    const sessions = readFileSync(sessionLog, "utf-8").trim().split("\n");
    assert.deepEqual(sessions, [String(erstes.id), String(zweites.id)], "es liefen nicht beide Sessions");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
