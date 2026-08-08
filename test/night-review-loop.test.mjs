// Review-Schleife des Nacht-Runners (Issue #235).
//
// Der bestehende Apparat misst Erfolg als "Issue in In review UND git clean". Eine
// Review-Session bewegt das Board nicht und fasst kein git an — nach jener Logik waere
// sie immer ein Fehlschlag. Hier ist Erfolg dreistufig:
//
//   1. Marker im Body                -> geprueft, ohne gewichtigen Befund
//   2. kein Marker, aber neue Spur   -> geprueft, MIT Befund (ebenfalls Erfolg)
//   3. weder noch                    -> Fehlschlag
//
// Stufe 2 als Fehlschlag zu werten waere der teuerste Denkfehler des Features: Genau
// die Issues, bei denen der Review sich gelohnt hat, wuerden als gescheitert gemeldet.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

const NUR_CLAUDE = [
  { name: "opus", kind: "claude", model: "claude-opus-5" },
  { name: "sonnet", kind: "claude", model: "claude-sonnet-5" },
];

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt(config = {}) {
  const dir = mkdtempSync(join(tmpdir(), "night-reviewloop-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" }, issueReview: { reviewers: NUR_CLAUDE }, ...config,
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\naufrufe.log\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    assert.equal(run(dir, "git", a).status, 0);
  }
  return dir;
}

const OHNE_MARKER = "## Kontext\n\nAutor-Modell: claude-opus-5\n\n## Abhaengigkeiten\n\nKeine.\n";
const MIT_MARKER = "## Kontext\n\nAutor-Modell: claude-opus-5\nIssue-Review: sonnet, fable (2026-08-06)\n\n## Abhaengigkeiten\n\nKeine.\n";

function backlogIssue(dir, titel, body) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", body);
  const pfad = join(dir, "issues", `${issue.id}.md`);
  const roh = readFileSync(pfad, "utf-8");
  writeFileSync(pfad, roh.replace(/^status:/m, "labels: kit:nightreview\nstatus:"), "utf-8");
  return String(issue.id);
}

function mitProjekt(fn, config = {}) {
  const dir = setupProjekt(config);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Fakes fuer die drei Ausgaenge. NIGHT_ISSUE_ID nennt das beauftragte Issue.
const BOARD = '"$KIT_ROOT/.claude/kit/board.mjs"';
const FAKE_MARKER = `echo "$NIGHT_PROMPT" >> aufrufe.log; node ${BOARD} issue update "$NIGHT_ISSUE_ID" --body "## Kontext

Autor-Modell: claude-opus-5
Issue-Review: opus, sonnet (2026-08-06, Nachtlauf)

## Abhaengigkeiten

Keine."`;
const FAKE_KOMMENTAR = `echo "$NIGHT_PROMPT" >> aufrufe.log; node ${BOARD} issue comment "$NIGHT_ISSUE_ID" --text "BLOCKER: fehlt was"`;
const FAKE_STUMM = 'echo "$NIGHT_PROMPT" >> aufrufe.log';

function aufrufe(dir) {
  const p = join(dir, "aufrufe.log");
  return existsSync(p) ? readFileSync(p, "utf-8").trim().split("\n").filter(Boolean) : [];
}

// --- Die drei Stufen ---

test("Marker gesetzt -> geprueft ohne Befund, Exit 0", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: FAKE_MARKER });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /geprueft ohne Befund/);
    assert.match(res.stdout, /1 ohne Befund/);
    assert.equal(board(dir, "issue", "get", id).status, "backlog");
  });
});

test("nur ein Kommentar -> geprueft mit Befund, Exit 0, kein Fehlschlag", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: FAKE_KOMMENTAR });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /geprueft mit Befund/);
    // Nicht als Fehlschlag gewertet: Die Zaehlzeile muss null "ohne Ergebnis" nennen
    // (ein blosses doesNotMatch(/ohne Ergebnis/) traefe genau diese Zeile).
    assert.match(res.stdout, /0 ohne Ergebnis/);
    assert.doesNotMatch(res.stdout, /Fehlschlag/);
    assert.equal(board(dir, "issue", "get", id).status, "backlog");
  });
});

test("keine Spur -> ohne Ergebnis, Lauf geht mit dem naechsten Kandidaten weiter", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const eins = backlogIssue(dir, "Eins", OHNE_MARKER);
    const zwei = backlogIssue(dir, "Zwei", OHNE_MARKER);
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: FAKE_STUMM });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /ohne Ergebnis/);
    // Beide Kandidaten wurden beauftragt — kein harter Stopp nach dem ersten.
    assert.equal(aufrufe(dir).length, 2);
    assert.match(res.stdout, /2 ohne Ergebnis/);
    // Beide bleiben im Backlog, beide bekamen einen Kommentar.
    for (const id of [eins, zwei]) {
      assert.equal(board(dir, "issue", "get", id).status, "backlog");
      assert.match(readFileSync(join(dir, "issues", `${id}.md`), "utf-8"), /Nachtlauf/);
    }
  });
});

// --- Guards ---

test("dirty Working Tree -> harter Stopp, kein Salvage-Versuch", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    const dreckig = `${FAKE_STUMM}; echo rest > uebrig.txt`;
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: dreckig });
    assert.notEqual(res.status, 0);
    assert.match(res.stdout, /HARTER STOPP/);
    assert.match(res.stdout, /Working Tree|nicht sauber|dirty/i);
    assert.doesNotMatch(res.stdout, /SALVAGE/i);
  });
});

test("Session-Exit != 0 -> harter Stopp, Issue unangetastet", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    const vorher = readFileSync(join(dir, "issues", `${id}.md`), "utf-8");
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: "exit 1" });
    assert.notEqual(res.status, 0);
    assert.match(res.stdout, /INFRASTRUKTUR/i);
    assert.equal(readFileSync(join(dir, "issues", `${id}.md`), "utf-8"), vorher, "Issue wurde angetastet");
  });
});

// --- Auswahl und Auftrag ---

test("ein Issue mit vorhandenem Marker bekommt keine Session", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "Schon geprueft", MIT_MARKER);
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: FAKE_STUMM });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(aufrufe(dir).length, 0, "es lief eine Session fuer ein bereits geprueftes Issue");
    assert.match(res.stdout, /1 uebersprungen/);
  });
});

test("der Prompt lautet exakt /issue-review #<id>", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: FAKE_STUMM });
    assert.deepEqual(aufrufe(dir), [`/issue-review #${id}`]);
  });
});

test("--max 1 startet genau eine Session bei zwei Kandidaten", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "Eins", OHNE_MARKER);
    backlogIssue(dir, "Zwei", OHNE_MARKER);
    const res = run(dir, process.execPath, [NIGHT, "--review", "--max", "1"], { NIGHT_CLAUDE_CMD: FAKE_MARKER });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(aufrufe(dir).length, 1);
  });
});

test("in keinem Ausgang aendert sich die Board-Spalte", NUR_POSIX, () => {
  // Die Kandidaten liegen bereits im Backlog; ein Move waere in jedem Ausgang falsch —
  // anders als in der Implementierungsschleife, die Fehlschlaege dorthin schiebt.
  for (const fake of [FAKE_MARKER, FAKE_KOMMENTAR, FAKE_STUMM]) {
    mitProjekt((dir) => {
      const id = backlogIssue(dir, "Ein Issue", OHNE_MARKER);
      run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: fake });
      assert.equal(board(dir, "issue", "get", id).status, "backlog");
    });
  }
});

test("das Morgen-Ritual des Review-Modus nennt nicht push main", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: FAKE_MARKER });
    assert.doesNotMatch(res.stdout, /push main/);
    assert.match(res.stdout, /Ready/);
  });
});
