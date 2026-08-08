// Vorflug-Gate fuer ungepruefte Ready-Issues (Issue #223).
//
// Dritter Filter neben [Fachlich] (#146) und [Idee] (#192), aus demselben Grund: Eine
// Session, die ein ungeeignetes Issue korrekt ablehnt, ist vom Runner nicht von einem
// Fehlschlag zu unterscheiden. Ein ungepruefte Issue wuerde der Runner dagegen gar
// nicht ablehnen — er wuerde es implementieren, und die Maengel fielen erst im Code
// auf. Die Nacht waere verloren.
//
// Anders als die beiden Geschwister greift dieser Filter am BODY, nicht am Titel — der
// Marker steht im Kontext-Abschnitt. Der Body liegt ohnehin vor, weil parseDeps ihn
// braucht; ein zusaetzlicher Board-Aufruf entsteht nicht.
//
// Wie in den uebrigen night-Tests laeuft das ECHTE kit/night.mjs gegen ein Fixture
// (cwd + KIT_ROOT), Sessions ueber NIGHT_CLAUDE_CMD.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt(config = {}) {
  const dir = mkdtempSync(join(tmpdir(), "night-reviewgate-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" }, ...config,
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    assert.equal(run(dir, "git", a).status, 0);
  }
  return dir;
}

function readyIssue(dir, titel, body) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", body);
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

/** Faehrt genau eine Runde mit einer Session, die nichts tut. */
function nightRun(dir) {
  return run(dir, process.execPath, [NIGHT, "--max", "1", "--label", "none"], {
    NIGHT_CLAUDE_CMD: "true",
  });
}

// Die Titel tragen bewusst nicht das Wort, auf das die Assertions pruefen: Der Runner
// loggt den Titel mit, und ein Titel wie "Ungeprueft" liess zwei Tests aus dem falschen
// Grund bestehen.
const OHNE_MARKER = "## Kontext\nAutor-Modell: claude-opus-5\n\n## Abhaengigkeiten\nKeine.";
const MIT_MARKER = "## Kontext\nAutor-Modell: claude-opus-5\nIssue-Review: sonnet, codex (2026-08-06)\n\n## Abhaengigkeiten\nKeine.";

const GATE_AN = { issueReview: { requiredBeforeReady: true, reviewers: [] } };

test("Gate an: ungepruftes Ready-Issue wandert kommentiert ins Backlog", NUR_POSIX, () => {
  const dir = setupProjekt(GATE_AN);
  try {
    const id = readyIssue(dir, "Ein Issue ohne Marker", OHNE_MARKER);
    const res = nightRun(dir);

    const backlog = board(dir, "issue", "list", "--status", "backlog");
    assert.ok(backlog.some((i) => String(i.id) === id), "das Issue muss im Backlog liegen");
    assert.match(res.stdout, /kein Issue-Review-Marker/i);
    const full = board(dir, "issue", "get", id);
    assert.match(JSON.stringify(full), /issue-review/i, "der Kommentar muss den Skill nennen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Gate an: geprueftes Issue wird normal verarbeitet", NUR_POSIX, () => {
  const dir = setupProjekt(GATE_AN);
  try {
    readyIssue(dir, "Ein Issue mit Marker", MIT_MARKER);
    const res = nightRun(dir);
    // Nicht die Spalte pruefen: Die Fake-Session tut nichts, das Issue landet danach
    // regulaer als Fehlschlag im Backlog. Signal ist allein, ob das GATE gegriffen hat.
    assert.doesNotMatch(res.stdout, /kein Issue-Review-Marker/i,
      "ein geprueftes Issue darf nicht am Gate haengenbleiben");
    assert.match(res.stdout, /Session 1\/1/, "die Session muss ueberhaupt gestartet sein");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Gate an: eine aehnliche Zeile zaehlt nicht als Marker", NUR_POSIX, () => {
  // 'Issue-Review folgt noch' ist genau das Gegenteil einer Freigabe.
  const dir = setupProjekt(GATE_AN);
  try {
    const id = readyIssue(dir, "Ein Issue mit aehnlicher Zeile",
      "## Kontext\nIssue-Review folgt noch\n\n## Abhaengigkeiten\nKeine.");
    nightRun(dir);
    const backlog = board(dir, "issue", "list", "--status", "backlog");
    assert.ok(backlog.some((i) => String(i.id) === id));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Default: ohne requiredBeforeReady aendert sich nichts", NUR_POSIX, () => {
  // Ein Kit-Update darf keinem Bestandsprojekt ueber Nacht den Runner anhalten.
  const dir = setupProjekt();
  try {
    readyIssue(dir, "Ein Issue ohne Marker", OHNE_MARKER);
    const res = nightRun(dir);
    assert.doesNotMatch(res.stdout, /kein Issue-Review-Marker/i, "beim Default darf das Gate nicht greifen");
    assert.match(res.stdout, /Session 1\/1/, "die Session muss ueberhaupt gestartet sein");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
