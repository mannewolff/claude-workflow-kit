// E2E fuer den Infrastruktur-Guard des Nacht-Runners (Issue #149).
// Stirbt eine Session mit Exit ungleich 0 (Auth abgelaufen, CLI kaputt), ist das
// kein fachliches Scheitern: Der Lauf stoppt hart (Exit 1), das Issue bleibt
// unangetastet in Ready, es gibt keinen Kommentar und keine weitere Session —
// die Ready-Spalte wird nicht ins Backlog geraeumt.
// Laeuft komplett lokal: issueTracker "local" in einem Temp-Repo, Session-Fake via
// NIGHT_CLAUDE_CMD (protokolliert den Aufruf und scheitert wie ein CLI-Fehlstart).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cwd, cmd, cliArgs, env = {}) {
  const res = spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, ...env } });
  return res;
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt() {
  const dir = mkdtempSync(join(tmpdir(), "night-infra-"));
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

function issuesDirText(dir) {
  const issuesDir = join(dir, "issues");
  return readdirSync(issuesDir)
    .map((f) => readFileSync(join(issuesDir, f), "utf-8"))
    .join("\n---\n");
}

test("Nachtlauf: Session-Fehlstart (Exit ungleich 0) stoppt hart, Ready bleibt unveraendert", () => {
  const dir = setupProjekt();
  try {
    const erstes = board(dir, "issue", "create", "--title", "Erstes Issue", "--body", "## Abhaengigkeiten\nKeine.");
    const zweites = board(dir, "issue", "create", "--title", "Zweites Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(erstes.id), "ready");
    board(dir, "issue", "move", String(zweites.id), "ready");

    // Session-Fake: protokolliert den Aufruf und stirbt wie ein CLI-Fehlstart
    // (Auth abgelaufen) — ohne das Board oder den Working Tree anzufassen.
    const sessionLog = join(dir, "sessions.log");
    const fake = `echo "$NIGHT_ISSUE_ID" >> ${JSON.stringify(sessionLog)}; echo "Failed to authenticate: OAuth session expired" >&2; exit 1`;

    const res = run(dir, process.execPath, [join(dir, ".claude", "kit", "night.mjs")], { NIGHT_CLAUDE_CMD: fake });

    // Harter Stopp: Exit 1, Meldung nennt Exit-Code und CLI-Ausgabe.
    assert.equal(res.status, 1, `night.mjs haette mit Exit 1 enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /harter Stopp/i, "Log meldet keinen harten Stopp");
    assert.match(res.stdout, /Failed to authenticate/, "Log nennt die CLI-Fehlermeldung nicht");

    // Beide Issues unangetastet in Ready — nichts wandert ins Backlog.
    const ready = board(dir, "issue", "list", "--status", "ready").map((i) => String(i.id));
    assert.ok(ready.includes(String(erstes.id)), "erstes Issue liegt nicht mehr in Ready");
    assert.ok(ready.includes(String(zweites.id)), "zweites Issue liegt nicht mehr in Ready");
    const backlog = board(dir, "issue", "list", "--status", "backlog");
    assert.equal(backlog.length, 0, "Backlog haette leer bleiben muessen");

    // Keine Kommentare auf den Issues.
    assert.doesNotMatch(issuesDirText(dir), /Nachtlauf/, "Issue wurde faelschlich kommentiert");

    // Genau eine Session — nach dem Fehlstart keine weitere.
    const sessions = readFileSync(sessionLog, "utf-8").trim().split("\n");
    assert.deepEqual(sessions, [String(erstes.id)], "es lief nicht genau eine Session");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Nachtlauf: fachlicher Fehlschlag (Exit 0, kein In review) wandert weiterhin ins Backlog", () => {
  const dir = setupProjekt();
  try {
    const issue = board(dir, "issue", "create", "--title", "Scheitert fachlich", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(issue.id), "ready");

    // Session-Fake: endet sauber (Exit 0), hat aber nichts erreicht — das ist
    // das bestehende Verhalten und darf durch den Guard nicht kippen.
    const res = run(dir, process.execPath, [join(dir, ".claude", "kit", "night.mjs")], { NIGHT_CLAUDE_CMD: "exit 0" });

    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /Fehlschlag/, "fachlicher Fehlschlag wird nicht gemeldet");
    const backlog = board(dir, "issue", "list", "--status", "backlog").map((i) => String(i.id));
    assert.ok(backlog.includes(String(issue.id)), "Issue liegt nicht im Backlog");
    assert.match(issuesDirText(dir), /Nachtlauf/, "Issue wurde nicht kommentiert");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
