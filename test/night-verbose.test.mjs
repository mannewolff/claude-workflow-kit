// E2E fuer das --verbose-Flag des Nacht-Runners (Issue #154).
// Mit --verbose liest der Runner den stream-json-Output der Session live und
// schreibt kompakte Ereigniszeilen (Tool-Aufrufe, Text-Snippets) mit in Log
// und Konsole. Ohne Flag bleibt das Log beim heutigen Format (nur Start/Ende
// plus finaler Session-Output-Block). Der Umbau von spawnSync auf async spawn
// wird zusaetzlich am Timeout-Pfad abgesichert (eigener Timer killt die Runde).
// Laeuft komplett lokal: issueTracker "local", Session-Fake via NIGHT_CLAUDE_CMD.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
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
  const dir = mkdtempSync(join(tmpdir(), "night-verbose-"));
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

// Fake, der zwei stream-json-Zeilen ausgibt (Tool-Aufruf + Text) und dann das
// Issue erfolgreich nach In review bringt.
function streamFake() {
  return [
    `echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"mvn -q verify"}}]}}'`,
    `echo '{"type":"assistant","message":{"content":[{"type":"text","text":"Tests gruen, ich committe jetzt."}]}}'`,
    `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`,
  ].join(" && ");
}

test("--verbose zeigt kompakte Ereigniszeilen (Tool-Aufruf + Text) im Konsolen-Log", () => {
  const dir = setupProjekt();
  try {
    const issue = board(dir, "issue", "create", "--title", "Verbose-Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(issue.id), "ready");

    const res = run(dir, process.execPath, [join(dir, ".claude", "kit", "night.mjs"), "--verbose"],
      { NIGHT_CLAUDE_CMD: streamFake() });

    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, new RegExp(`#${issue.id} > Bash: mvn -q verify`), "Tool-Aufruf-Zeile fehlt");
    assert.match(res.stdout, new RegExp(`#${issue.id} > Claude: Tests gruen`), "Text-Snippet-Zeile fehlt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ohne --verbose bleibt das Log beim heutigen Format (keine Ereigniszeilen)", () => {
  const dir = setupProjekt();
  try {
    const issue = board(dir, "issue", "create", "--title", "Still-Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(issue.id), "ready");

    const res = run(dir, process.execPath, [join(dir, ".claude", "kit", "night.mjs")],
      { NIGHT_CLAUDE_CMD: streamFake() });

    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, /> Bash:/, "ohne --verbose duerften keine Ereigniszeilen erscheinen");
    assert.match(res.stdout, /Erfolg/, "die erfolgreiche Runde wird weiterhin gemeldet");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Timeout-Pfad: laenger laufende Session wird gekillt, Runde endet ohne Haenger", () => {
  const dir = setupProjekt();
  try {
    const issue = board(dir, "issue", "create", "--title", "Langsames-Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(issue.id), "ready");

    // Fake laeuft laenger als das (per Test-Hook winzig gesetzte) Zeitlimit und
    // bringt das Issue nicht nach In review -> Timeout greift, Runde = Fehlschlag.
    const started = Date.now();
    const res = run(dir, process.execPath, [join(dir, ".claude", "kit", "night.mjs")],
      { NIGHT_CLAUDE_CMD: "sleep 30", NIGHT_TIMEOUT_MS: "400" });
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 20000, `Timeout griff nicht — Lauf haengt (${elapsed} ms)`);
    // Sauberer Tree, kein In review -> Issue zurueck ins Backlog, Lauf endet regulaer.
    const backlog = board(dir, "issue", "list", "--status", "backlog").map((i) => String(i.id));
    assert.ok(backlog.includes(String(issue.id)), "Issue haette nach Timeout im Backlog liegen muessen");
    assert.equal(res.status, 0, "regulaeres Ende (kein harter Stopp) nach Timeout-Fehlschlag");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
