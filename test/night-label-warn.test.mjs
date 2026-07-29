// Vorflug-Warnung fuer das Routing-Label (Issue #179).
//
// Seit #159 verarbeitet der Runner per Default nur Ready-Issues mit dem Label
// kit:nightrun. Ein Vertipper im Wert ist syntaktisch gueltig: --label no filtert
// auf ein Label namens "no", findet nichts und der Lauf endet ohne Arbeit — im
// Protokoll nicht von einem tatsaechlich leeren Board zu unterscheiden.
//
// Die Warnung trennt die beiden Faelle. Sie blockiert bewusst nicht: Ein Lauf ohne
// passende Issues ist ein legitimer Zustand (Board abgearbeitet).
//
// Laeuft lokal: issueTracker "local", Labels im Frontmatter, Session-Fake via
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

// Labels als CSV ins Frontmatter — der lokale Tracker liest sie beim listIssues.
function setLabels(dir, id, labels) {
  const file = join(dir, "issues", `${id}.md`);
  const raw = readFileSync(file, "utf-8");
  writeFileSync(file, raw.replace(/\n---\n/, `\nlabels: ${labels.join(",")}\n---\n`), "utf-8");
}

function setupProjekt() {
  const dir = mkdtempSync(join(tmpdir(), "night-labelwarn-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  copyFileSync(join(repoRoot, "kit", "night.mjs"), join(dir, ".claude", "kit", "night.mjs"));
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

function successFake(sessionLog) {
  return `echo "$NIGHT_ISSUE_ID" >> ${JSON.stringify(sessionLog)}`
    + ` && node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`;
}

const WARNUNG = /kein Ready-Issue traegt das Label/;

test("Vertipper: --label no warnt und nennt gesuchten Wert, vorhandene Labels und den Ausweg", () => {
  const dir = setupProjekt();
  try {
    const a = board(dir, "issue", "create", "--title", "Nachtlauf", "--body", "## Abhaengigkeiten\nKeine.");
    setLabels(dir, a.id, ["kit:nightrun"]);
    board(dir, "issue", "move", a.id, "ready");

    const sessionLog = join(dir, "sessions.log");
    const res = run(dir, process.execPath, [join(dir, ".claude", "kit", "night.mjs"), "--label", "no"],
      { NIGHT_CLAUDE_CMD: successFake(sessionLog) });

    assert.equal(res.status, 0, `night.mjs haette regulaer enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, WARNUNG, "die Warnung fehlt");
    assert.match(res.stdout, /'no'/, "der gesuchte Label-Wert wird nicht genannt");
    assert.match(res.stdout, /kit:nightrun/, "die tatsaechlich vorhandenen Labels werden nicht genannt");
    assert.match(res.stdout, /--label none/, "der Ausweg ueber --label none wird nicht genannt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Vertipper: ohne jedes Label in Ready meldet die Warnung ausdruecklich 'keine'", () => {
  const dir = setupProjekt();
  try {
    const a = board(dir, "issue", "create", "--title", "Ungelabelt", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", a.id, "ready");

    const res = run(dir, process.execPath, [join(dir, ".claude", "kit", "night.mjs")],
      { NIGHT_CLAUDE_CMD: successFake(join(dir, "sessions.log")) });

    assert.equal(res.status, 0, `night.mjs haette regulaer enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, WARNUNG, "die Warnung fehlt");
    assert.match(res.stdout, /vorhandene Labels[^\n]*keine/i, "das Fehlen jeglicher Labels wird nicht ausdruecklich gemeldet");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Gegenprobe: passendes Label vorhanden -> keine Warnung", () => {
  const dir = setupProjekt();
  try {
    const a = board(dir, "issue", "create", "--title", "Nachtlauf", "--body", "## Abhaengigkeiten\nKeine.");
    setLabels(dir, a.id, ["kit:nightrun"]);
    board(dir, "issue", "move", a.id, "ready");

    const res = run(dir, process.execPath, [join(dir, ".claude", "kit", "night.mjs")],
      { NIGHT_CLAUDE_CMD: successFake(join(dir, "sessions.log")) });

    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, WARNUNG, "bei passendem Label darf keine Warnung erscheinen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Gegenprobe: --label none -> keine Warnung, der Filter ist ja abgeschaltet", () => {
  const dir = setupProjekt();
  try {
    const a = board(dir, "issue", "create", "--title", "Ungelabelt", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", a.id, "ready");

    const res = run(dir, process.execPath, [join(dir, ".claude", "kit", "night.mjs"), "--label", "none"],
      { NIGHT_CLAUDE_CMD: successFake(join(dir, "sessions.log")) });

    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, WARNUNG, "ohne Label-Filter darf keine Warnung erscheinen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Gegenprobe: leeres Ready -> keine Warnung, es gibt nichts zu unterscheiden", () => {
  const dir = setupProjekt();
  try {
    const res = run(dir, process.execPath, [join(dir, ".claude", "kit", "night.mjs"), "--label", "no"],
      { NIGHT_CLAUDE_CMD: successFake(join(dir, "sessions.log")) });

    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    // Im echten Lauf endet leeres Ready ueber die Zusammenfassung; die Meldung
    // "Ready ist leer" gibt es nur im Dry-Run-Pfad.
    assert.match(res.stdout, /0 erfolgreich, 0 zurueckgestellt, 0 Session/, "der Lauf haette leer enden muessen");
    assert.doesNotMatch(res.stdout, WARNUNG, "bei leerem Ready darf keine Warnung erscheinen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--dry-run: die Warnung erscheint auch im Trockenlauf", () => {
  const dir = setupProjekt();
  try {
    const a = board(dir, "issue", "create", "--title", "Nachtlauf", "--body", "## Abhaengigkeiten\nKeine.");
    setLabels(dir, a.id, ["kit:nightrun"]);
    board(dir, "issue", "move", a.id, "ready");

    const res = run(dir, process.execPath, [join(dir, ".claude", "kit", "night.mjs"), "--dry-run", "--label", "no"]);

    assert.equal(res.status, 0, `dry-run schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, WARNUNG, "im Dry-Run fehlt die Warnung — gerade dort will man den Vertipper sehen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
