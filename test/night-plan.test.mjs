// E2E fuer die Plan-Leitplanke des Nacht-Runners (Issue #276).
// Analog zu [Fachlich] und [Idee]: Ein Plan-Dokument beschreibt einen Weg, es ist
// keine Aufgabe. Ohne Gate kaeme ein [Plan]-Titel als normales Arbeitspaket durch —
// er wuerde implementiert, und das saehe am Board wie ein Erfolg aus.
// Laeuft komplett lokal: issueTracker "local" in einem Temp-Repo, Session-Fake via
// NIGHT_CLAUDE_CMD.

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
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt() {
  const dir = mkdtempSync(join(tmpdir(), "night-plan-"));
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

// Der lokale Tracker haengt Kommentare an die Issue-Datei an (`**Kommentar** (Zeitstempel)`)
// und gibt sie bei `issue get` nicht als Feld zurueck — geprueft wird deshalb der Dateitext.
function issueText(dir, id) {
  return readFileSync(join(dir, "issues", `${id}.md`), "utf-8");
}

const kommentare = (text) =>
  text.split(/\n---\n\*\*Kommentar\*\* \([^)]*\)\n\n/).slice(1).map((k) => k.trim());

test("Nachtlauf: [Plan]-Issue wird kommentiert uebersprungen, normales Issue laeuft", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const plan = board(dir, "issue", "create", "--title", "[Plan] Weg zur Mandantentrennung", "--body", "## Ziel\nEin Loesungsweg.");
    const normal = board(dir, "issue", "create", "--title", "Normales technisches Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(plan.id), "ready");
    board(dir, "issue", "move", String(normal.id), "ready");

    const sessionLog = join(dir, "sessions.log");
    // Protokolliert den uebergebenen Auftrag, nicht nur die ID (NIGHT_PROMPT, Issue #191).
    const fake = `echo "$NIGHT_PROMPT" >> ${JSON.stringify(sessionLog)} && node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`;

    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);

    // Plan: zurueck im Backlog.
    const backlog = board(dir, "issue", "list", "--status", "backlog").map((i) => String(i.id));
    assert.ok(backlog.includes(String(plan.id)), "[Plan]-Issue liegt nicht im Backlog");

    // Der Kommentar ist woertlich vorgegeben — 'kommentiert' allein liesse jeden Text zu.
    assert.deepEqual(kommentare(issueText(dir, plan.id)), [
      `Nachtlauf: Plan-Dokument — wird nicht implementiert, bitte per /issues #${plan.id} in Arbeitspakete ueberfuehren.`,
    ]);

    // Normales Issue lief, und zwar als einzige Session — mit genau diesem Auftrag.
    const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id));
    assert.ok(inReview.includes(String(normal.id)), "normales Issue liegt nicht in In review");
    const sessions = readFileSync(sessionLog, "utf-8").trim().split("\n");
    assert.deepEqual(sessions, [`/implement-next #${normal.id}`],
      "es lief nicht genau eine Session mit dem Auftrag fuer das normale Issue");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Dry-Run weist [Plan]-Issues als uebersprungen aus, ohne etwas zu bewegen", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const plan = board(dir, "issue", "create", "--title", "[Plan] Umbau der Board-Achse", "--body", "## Ziel\nEin Loesungsweg.");
    board(dir, "issue", "move", String(plan.id), "ready");

    const sessionLog = join(dir, "sessions.log");
    const fake = `echo "$NIGHT_PROMPT" >> ${JSON.stringify(sessionLog)}`;

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--dry-run"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `dry-run schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /wuerde ins Backlog \(Plan-Dokument, wird nicht implementiert\)/,
      "dry-run weist das [Plan]-Issue nicht als zurueckgestellt aus");
    assert.match(res.stdout, /0 Session\(s\) wuerden starten/, "dry-run wuerde faelschlich eine Session starten");

    const ready = board(dir, "issue", "list", "--status", "ready").map((i) => String(i.id));
    assert.ok(ready.includes(String(plan.id)), "dry-run hat das Issue bewegt — darf er nicht");
    assert.deepEqual(kommentare(issueText(dir, plan.id)), [], "dry-run hat kommentiert — darf er nicht");
    assert.throws(() => readFileSync(sessionLog, "utf-8"), "dry-run hat eine Session gestartet — darf er nicht");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
