// E2E fuer die Idee-Leitplanke des Nacht-Runners (Issue #192).
// Analog zu [Fachlich]: Issues mit dem Titelpraefix [Idee] sind rohe Ideen ohne
// /plan-Zyklus. Eine Session wuerde sie korrekt ablehnen — der Runner koennte diese
// Ablehnung aber nicht von einem Fehlschlag unterscheiden und verbrennt eine Session.
// Also mechanisch vor dem Session-Start zurueck ins Backlog.
// Laeuft komplett lokal: issueTracker "local" in einem Temp-Repo, Session-Fake via
// NIGHT_CLAUDE_CMD.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt() {
  const dir = mkdtempSync(join(tmpdir(), "night-idee-"));
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

function issuesDirText(dir) {
  const issuesDir = join(dir, "issues");
  return readdirSync(issuesDir)
    .map((f) => readFileSync(join(issuesDir, f), "utf-8"))
    .join("\n---\n");
}

test("Nachtlauf: [Idee]-Issue wird kommentiert uebersprungen, normales Issue laeuft", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const idee = board(dir, "issue", "create", "--title", "[Idee] Aktivitaetsverlauf anzeigen", "--body", "## Kontext\nRohe Idee.");
    const normal = board(dir, "issue", "create", "--title", "Normales technisches Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(idee.id), "ready");
    board(dir, "issue", "move", String(normal.id), "ready");

    const sessionLog = join(dir, "sessions.log");
    const fake = `echo "$NIGHT_ISSUE_ID" >> ${JSON.stringify(sessionLog)} && node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`;

    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);

    // Idee: zurueck im Backlog, mit Kommentar, der auf /plan + /issues verweist.
    const backlog = board(dir, "issue", "list", "--status", "backlog").map((i) => String(i.id));
    assert.ok(backlog.includes(String(idee.id)), "[Idee]-Issue liegt nicht im Backlog");
    assert.match(issuesDirText(dir), /Idee.*\/plan.*\/issues.*nicht implementiert/s);

    // Normales Issue lief, und zwar als einzige Session.
    const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id));
    assert.ok(inReview.includes(String(normal.id)), "normales Issue liegt nicht in In review");
    const sessions = readFileSync(sessionLog, "utf-8").trim().split("\n");
    assert.deepEqual(sessions, [String(normal.id)], "es lief nicht genau eine Session fuer das normale Issue");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Dry-Run weist [Idee]-Issues als uebersprungen aus, ohne etwas zu bewegen", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const idee = board(dir, "issue", "create", "--title", "[Idee] Irgendwas mit KPIs", "--body", "## Kontext\nRohe Idee.");
    board(dir, "issue", "move", String(idee.id), "ready");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--dry-run"]);
    assert.equal(res.status, 0, `dry-run schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /wuerde ins Backlog \(Idee, wird nicht implementiert\)/,
      "dry-run weist das [Idee]-Issue nicht als zurueckgestellt aus");
    assert.match(res.stdout, /0 Session\(s\) wuerden starten/, "dry-run wuerde faelschlich eine Session starten");

    const ready = board(dir, "issue", "list", "--status", "ready").map((i) => String(i.id));
    assert.ok(ready.includes(String(idee.id)), "dry-run hat das Issue bewegt — darf er nicht");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
