// Die vier Dateien der Wirksamkeits-Auswertung im Rest-Guard und im Worktree-Spiegel
// (Plan #782, E12; Issue #784).
//
// Die Auswertung legt waehrend des Laufs vier Dateien unter `.claude/` an: die
// Protokolle `bewegungen.tsv` (aus kit/board.mjs) und `ausfuehrungen.tsv` (aus
// kit/checks.mjs) sowie die Berichte `wirksamkeit.md` und `wirksamkeit.json`. Ohne
// Ausnahme im Rest-Guard stoppte der Runner in jedem Projekt ohne den `.claude/*`-Block
// in der `.gitignore` nach der ersten erfolgreichen Runde hart — die Messung machte die
// Arbeit unmoeglich, die sie misst.
//
// Geprueft wird in beiden Richtungen: am ECHTEN kit/night.mjs gegen ein Temp-Repo mit
// lokalem Tracker und einer `.gitignore` OHNE den `.claude/*`-Block (nur dort traegt der
// Ausschluss in `gitReste()`), und am exportierten `worktreeAnlegen` fuer den Spiegel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { worktreeAnlegen } from "../kit/night.mjs";

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." } : {};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Das ECHTE Script aus dem Repo (nicht kopiert): nur so wird seine Coverage gemessen.
const NIGHT = join(repoRoot, "kit", "night.mjs");

/** Die vier Dateien, die die Wirksamkeits-Auswertung unter `.claude/` anlegt. */
const VIER = ["wirksamkeit.md", "wirksamkeit.json", "bewegungen.tsv", "ausfuehrungen.tsv"];

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function git(cwd, ...a) {
  const res = spawnSync("git", a, { cwd, encoding: "utf-8" });
  assert.equal(res.status, 0, `git ${a.join(" ")}: ${res.stderr}`);
  return res.stdout;
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

/**
 * Ein Projekt mit lokalem Tracker, dessen `.gitignore` den `.claude/*`-Block NICHT
 * fuehrt — genau die Lage aus E12, in der allein der Ausschluss in `gitReste()` haelt.
 */
function setupProjekt() {
  const dir = mkdtempSync(join(tmpdir(), "night-wirksamkeit-reste-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    buildChecks: ["true"],
    local: { issuesDir: "issues" },
  }, null, 2));
  // Bewusst ohne `.claude/*`: Protokoll und Kit-Kopie sind namentlich ausgenommen,
  // die vier Dateien der Auswertung sind es nicht.
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*\n.claude/kit/\nsessions.log\n");
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "test@example.invalid");
  git(dir, "config", "user.name", "Night Test");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "setup");
  return dir;
}

function mitProjekt(fn) {
  const dir = setupProjekt();
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("[night-59] gitReste wertet die vier Dateien der Wirksamkeits-Auswertung nicht als Rest", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const erstes = board(dir, "issue", "create", "--title", "Erstes Issue", "--body", "## Abhaengigkeiten\nKeine.");
    const zweites = board(dir, "issue", "create", "--title", "Zweites Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(erstes.id), "ready");
    board(dir, "issue", "move", String(zweites.id), "ready");

    // Der Session-Fake legt genau die vier Dateien an — wie die Auswertung im echten Lauf.
    const sessionLog = join(dir, "sessions.log");
    const anlegen = VIER.map((n) => `echo x > .claude/${n}`).join(" && ");
    const fake = `echo "$NIGHT_ISSUE_ID" >> ${JSON.stringify(sessionLog)}`
      + ` && node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`
      + ` && ${anlegen}`;

    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    // Kein harter Stopp: Der Rest-Guard (#152) hat die vier Dateien nicht als Rest gesehen.
    assert.equal(res.status, 0, `der Lauf haette regulaer enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, /unkommittete Reste/i, `kein Rest-Stopp erwartet:\n${res.stdout}`);

    // Beide Runden liefen — der Beweis, dass der Lauf nach der ersten weiterging.
    const sessions = readFileSync(sessionLog, "utf-8").trim().split("\n");
    assert.deepEqual(sessions, [String(erstes.id), String(zweites.id)], "es liefen nicht beide Sessions");

    // Und die Dateien liegen wirklich da — der Test misst nicht ihre Abwesenheit.
    for (const n of VIER) assert.ok(existsSync(join(dir, ".claude", n)), `.claude/${n} fehlt im Arbeitsbaum`);
    assert.notEqual(git(dir, "status", "--porcelain").trim(), "",
      "git selbst muss die Dateien sehen — sonst pruefte der Test die .gitignore statt des Ausschlusses");
  });
});

// --- Der Worktree-Spiegel (night-17) -----------------------------------------

/** Ein Repo mit Commit und einem `.claude/` voller Lokalzustand, inklusive der vier Dateien. */
function setupWorktreeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "night-wirksamkeit-spiegel-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  writeFileSync(join(dir, ".gitignore"), ".claude/*\n!.claude/workflow.config.json\n");
  writeFileSync(join(dir, ".claude", "workflow.config.json"), "{\"codeHost\":\"local\",\"issueTracker\":\"local\"}\n");
  writeFileSync(join(dir, "README.md"), "hallo\n");
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.invalid");
  git(dir, "config", "user.name", "T");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "setup");
  writeFileSync(join(dir, ".claude", "kit", "board.mjs"), "// kopie\n");
  for (const n of VIER) writeFileSync(join(dir, ".claude", n), `stand ${n}\n`);
  return dir;
}

test("[night-59] der Worktree-Spiegel laesst die vier Dateien in der Hauptkopie zurueck", () => {
  const dir = setupWorktreeRepo();
  let pfad = null;
  try {
    pfad = worktreeAnlegen({ repoRoot: dir, issueId: "784", stempel: "2026-09-21-010203" });
    for (const n of VIER) {
      assert.ok(!existsSync(join(pfad, ".claude", n)), `.claude/${n} darf nicht in den Worktree`);
      assert.equal(readFileSync(join(dir, ".claude", n), "utf-8"), `stand ${n}\n`,
        `.claude/${n} muss in der Hauptkopie stehen bleiben`);
    }
    // Der uebrige Lokalzustand kommt weiterhin mit — der Spiegel wurde nicht stumpf.
    assert.ok(existsSync(join(pfad, ".claude", "kit", "board.mjs")), "die Kit-Kopie fehlt im Worktree");
    assert.ok(existsSync(join(pfad, ".claude", "workflow.config.json")), "die Config fehlt im Worktree");
  } finally {
    if (pfad) rmSync(pfad, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
