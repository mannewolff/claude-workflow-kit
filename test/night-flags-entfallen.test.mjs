// Die Flags der entfallenen Betriebsarten (Plan #638, A1; Issue #640).
//
// `--review`, `--erzeuge`, `--stufe`, `--review-label` und `--erzeuge-label` bleiben dem
// Parser bekannt und enden mit einer Meldung, die sagt, WAS es nicht mehr gibt. Ein
// "unbekanntes Argument" liesse den Menschen raten, ob er sich vertippt hat. Die Meldung
// faellt vor jedem Board-Zugriff: kein Ergebnisstand, keine Logdatei.
//
// Dazu das Gate `requiredBeforeReady` nach A17: nur noch `marker` und `ungeprueft`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

function run(cwd, cliArgs, env = {}) {
  return spawnSync(process.execPath, [NIGHT, ...cliArgs], {
    cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env },
  });
}

function board(cwd, ...cliArgs) {
  const res = spawnSync(process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs], {
    cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell" },
  });
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt(config = {}) {
  const dir = mkdtempSync(join(tmpdir(), "night-flags-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" }, ...config,
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    assert.equal(spawnSync("git", a, { cwd: dir, encoding: "utf-8" }).status, 0);
  }
  return dir;
}

function mitProjekt(fn, config) {
  const dir = setupProjekt(config);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ENTFALLEN = [
  ["--review"],
  ["--erzeuge"],
  ["--stufe", "plan"],
  ["--review-label", "x"],
  ["--erzeuge-label", "x"],
];

for (const flags of ENTFALLEN) {
  test(`[night-15] ${flags[0]} endet mit Exit 1, nennt --kette und hinterlaesst keinen Ergebnisstand`, () => {
    mitProjekt((dir) => {
      const res = run(dir, flags);
      assert.equal(res.status, 1, `${flags[0]} haette abgewiesen werden muessen: ${res.stdout}`);
      assert.match(res.stderr, new RegExp(`${flags[0]} gibt es seit Stufe 2 nicht mehr`));
      assert.match(res.stderr, /--kette/, "die Meldung nennt den Nachfolger nicht");
      assert.doesNotMatch(res.stderr, /Unbekanntes Argument/, "ein entfallenes Flag ist kein unbekanntes");
      const dateien = readdirSync(join(dir, ".claude")).filter((n) => n.startsWith("night-run-"));
      assert.deepEqual(dateien, [], "vor dem Vorflug darf kein Ergebnisstand und keine Logdatei entstehen");
    });
  });
}

test("[night-15] --stufe sagt zusaetzlich, dass die Kette keine Stufen hat", () => {
  mitProjekt((dir) => {
    const res = run(dir, ["--stufe", "issue"]);
    assert.match(res.stderr, /die Kette hat keine Stufen/);
  });
});

test("[night-15] ein entfallenes Flag greift auch hinter anderen Flags", () => {
  mitProjekt((dir) => {
    const res = run(dir, ["--max", "2", "--erzeuge", "--dry-run"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /--erzeuge gibt es seit Stufe 2 nicht mehr/);
  });
});

test("[night-15] --help nennt keines der fuenf entfallenen Flags", () => {
  const res = spawnSync(process.execPath, [NIGHT, "--help"], { encoding: "utf-8" });
  assert.equal(res.status, 0);
  for (const flag of ["--review", "--erzeuge", "--stufe", "--review-label", "--erzeuge-label"]) {
    assert.ok(!res.stdout.includes(flag), `--help nennt ${flag} noch`);
  }
  assert.match(res.stdout, /--label <name>/, "die bleibenden Flags stehen weiter in der Hilfe");
});

// --- Das Gate nach A17: marker oder ungeprueft, sonst nichts ---

const OHNE_MARKER = "## Kontext\nAutor-Modell: claude-opus-5\n\n## Abhaengigkeiten\nKeine.";
const MIT_MARKER = "## Kontext\nAutor-Modell: claude-opus-5\nIssue-Review: sonnet (2026-09-14)\n\n## Abhaengigkeiten\nKeine.";
const GATE_AN = { issueReview: { requiredBeforeReady: true, reviewers: [] } };

function readyIssue(dir, titel, body) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", body);
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

test("[night-16] Gate an: ohne Marker zurueckgestellt, mit Marker gestartet — in einem Lauf", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const offen = readyIssue(dir, "Erstes Ticket ohne Marker", OHNE_MARKER);
    const frei = readyIssue(dir, "Zweites Ticket mit Marker", MIT_MARKER);
    const res = run(dir, ["--max", "1", "--label", "none"], { NIGHT_CLAUDE_CMD: "true" });

    assert.ok(board(dir, "issue", "list", "--status", "backlog").some((i) => String(i.id) === offen),
      "das ungepruefte Ticket muss ins Backlog");
    assert.match(res.stdout, new RegExp(`#${offen} uebersprungen: ungeprueft \\(kein Issue-Review-Marker im Body\\)`));
    assert.match(res.stdout, new RegExp(`Session 1/1: Issue #${frei}`), "das geprueft Ticket muss die Session bekommen");
    assert.doesNotMatch(res.stdout, /verfallen|ungueltig|Verzicht/i, "die alten Arten duerfen nicht mehr vorkommen");
  }, GATE_AN);
});
