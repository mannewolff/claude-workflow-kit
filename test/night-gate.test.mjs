// Der Nachweis-Guard im Nacht-Runner (Issue #471, Plan #467 A5/A6).
//
// Zwei Loecher, nicht eines: Bis hierher galt jede lesbare Zusammenfassung als
// "geprueft" — auch eine mit rotem Lauf — und der Zustand floss in die Bewertung
// der Runde gar nicht ein. Ein roter Lauf fuehrte damit zum selben Ergebnis wie
// ein fehlender Nachweis: Erfolg.
//
// Die tragende Einschraenkung: Der Nachweis wirkt NUR im In-review-Pfad. Steht die
// Karte nicht dort, bleiben Infrastruktur-Guard, Dirty-Guard, Salvage und
// Backlog-Move unberuehrt — sonst zoege der Runner ein Ready-Issue in jeder
// Iteration erneut, und ein Auth-Fehler bekaeme den Kommentar "keine Pruefung
// gefahren".
//
// Echtes `checks.mjs run` im Session-Fake wie in night-checks-bericht: Ein von Hand
// geschriebenes JSON froere das Format ein, das die andere Datei pflegt.

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

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, {
    cwd, encoding: "utf-8",
    env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env },
  });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt({ buildChecks = ["true"] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "night-gate-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  for (const f of ["board.mjs", "checks.mjs"]) {
    copyFileSync(join(repoRoot, "kit", f), join(dir, ".claude", "kit", f));
  }
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks, local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/*\n!.claude/workflow.config.json\nsessions.log\n");
  mkdirSync(join(dir, "kit"), { recursive: true });
  writeFileSync(join(dir, "kit", "bestand.txt"), "Bestand\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    assert.equal(run(dir, "git", a).status, 0);
  }
  return dir;
}

function readyIssue(dir, titel = "Ein Issue") {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", "## Abhaengigkeiten\nKeine.");
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

function issuesCommitten(dir) {
  assert.equal(run(dir, "git", ["add", "-A"]).status, 0);
  assert.equal(run(dir, "git", ["commit", "-q", "-m", "Issues"]).status, 0);
}

function mitProjekt(fn, optionen = {}) {
  const dir = setupProjekt(optionen);
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function head(dir) {
  return run(dir, "git", ["rev-parse", "HEAD"]).stdout.trim();
}

function status(dir, id) {
  return board(dir, "issue", "get", String(id)).status;
}

// Der lokale Tracker haengt Kommentare an den Body der Issue-Datei an; ein
// eigenes `comments`-Array gibt es dort nicht (siehe LocalIssueTracker.commentIssue).
function kommentare(dir, id) {
  return board(dir, "issue", "get", String(id)).body || "";
}

const LOG_SESSION = 'echo "$NIGHT_ISSUE_ID" >> sessions.log';
const ARBEIT = 'echo arbeit > "kit/work-$NIGHT_ISSUE_ID.txt"';
const CHECKS_RUN = "node .claude/kit/checks.mjs run > /dev/null 2>&1";
const COMMIT = 'git add -A && git commit -q -m "arbeit (Issue #$NIGHT_ISSUE_ID)"';
const IN_REVIEW = 'node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null';

const FAKE_MIT_PRUEFUNG = [LOG_SESSION, ARBEIT, CHECKS_RUN, COMMIT, IN_REVIEW].join("\n");
const FAKE_OHNE_PRUEFUNG = [LOG_SESSION, ARBEIT, COMMIT, IN_REVIEW].join("\n");
// Der Lauf ist rot, die Session committet und zieht trotzdem nach In review — genau
// das Verhalten, das #463 beobachtet hat.
const FAKE_ROT = [LOG_SESSION, ARBEIT, CHECKS_RUN, COMMIT, IN_REVIEW].join("\n");
const FAKE_UNLESBAR = [
  LOG_SESSION, ARBEIT, CHECKS_RUN,
  'echo "{kaputt" > .claude/checks-summary.json',
  COMMIT, IN_REVIEW,
].join("\n");
// Karte bleibt in Ready, Tree sauber, Exit 0 — der bestehende deferred-Pfad.
const FAKE_OHNE_ERGEBNIS = [LOG_SESSION].join("\n");

function sessions(dir) {
  const p = join(dir, "sessions.log");
  return existsSync(p) ? readFileSync(p, "utf-8").trim().split("\n").filter(Boolean) : [];
}

test("[night-1] eine Runde ohne Nachweis gilt als Fehlschlag, obwohl die Karte in In review steht", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    issuesCommitten(dir);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: FAKE_OHNE_PRUEFUNG });
    assert.match(res.stdout, /Fehlschlag/, "der Lauf haette einen Fehlschlag melden muessen");
    assert.match(res.stdout, /Nachweis fehlt|ungeprueft/i);
    assert.equal(status(dir, id), "in_review", "die Karte darf nicht bewegt werden");
  });
});

test("[night-1] ein roter Lauf gilt als Fehlschlag und wird von ungeprueft unterschieden", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    issuesCommitten(dir);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: FAKE_ROT });
    assert.match(res.stdout, /rot/, "der Zustand rot muss im Bericht stehen");
    assert.equal(status(dir, id), "in_review");
    assert.doesNotMatch(res.stdout, /Nachweis fehlt/, "rot ist nicht dasselbe wie ungeprueft");
  }, { buildChecks: ["false"] });
});

test("[night-1] eine unlesbare Zusammenfassung gilt als Fehlschlag mit eigenem Grund", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    issuesCommitten(dir);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: FAKE_UNLESBAR });
    assert.match(res.stdout, /unlesbar/i);
    assert.equal(status(dir, id), "in_review");
  });
});

test("[night-1] Kartenstatus und HEAD bleiben nach dem Fehlschlag unveraendert", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    issuesCommitten(dir);
    run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: FAKE_OHNE_PRUEFUNG });
    const nachher = head(dir);
    // Die Session hat committet; der Runner darf daran nichts aendern.
    assert.equal(status(dir, id), "in_review");
    assert.equal(head(dir), nachher, "kein Revert, kein Amend");
    assert.match(kommentare(dir, id), /Nachweis|Pruefung/i, "der Grund gehoert ans Board");
  });
});

test("[night-1] der Board-Kommentar unterscheidet sich vom Text fuer eine Session ohne In-review-Ergebnis", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    issuesCommitten(dir);
    run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: FAKE_OHNE_PRUEFUNG });
    assert.doesNotMatch(kommentare(dir, id), /Session ohne In-review-Ergebnis/);
  });
});

test("[night-1] steht die Karte nicht in In review, bleibt der bestehende Backlog-Pfad unberuehrt", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    issuesCommitten(dir);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: FAKE_OHNE_ERGEBNIS });
    assert.equal(status(dir, id), "backlog", "der deferred-Pfad zieht die Karte weiterhin ins Backlog");
    assert.match(kommentare(dir, id), /Session ohne In-review-Ergebnis/);
    assert.doesNotMatch(res.stdout, /Nachweis fehlt/, "ohne In-review-Ergebnis zaehlt der Nachweis nicht");
  });
});

test("[night-1] ein Ready-Issue ohne Nachweis wird in derselben Nacht nicht erneut gezogen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    issuesCommitten(dir);
    run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "3"], { NIGHT_CLAUDE_CMD: FAKE_OHNE_PRUEFUNG });
    assert.deepEqual(sessions(dir), [id], "genau ein Session-Start fuer dieses Issue");
  });
});

test("[night-1] der Lauf setzt nach dem Fehlschlag mit dem naechsten Issue fort", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const a = readyIssue(dir, "Erstes");
    const b = readyIssue(dir, "Zweites");
    issuesCommitten(dir);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "3"], { NIGHT_CLAUDE_CMD: FAKE_OHNE_PRUEFUNG });
    assert.deepEqual(sessions(dir).sort(), [a, b].sort(), "beide Issues muessen gelaufen sein");
    assert.equal(res.status, 0, "kein harter Stopp");
  });
});

test("[night-1] die Endzeile fuehrt Runden ohne gueltigen Nachweis in einem eigenen Zaehler", NUR_POSIX, () => {
  mitProjekt((dir) => {
    readyIssue(dir);
    issuesCommitten(dir);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: FAKE_OHNE_PRUEFUNG });
    assert.match(res.stdout, /Nachweis/, "die Endzeile muss den neuen Zaehler nennen");
    assert.doesNotMatch(res.stdout, /1 erfolgreich/, "eine Runde ohne Nachweis ist kein Erfolg");
  });
});

test("[night-1] eine Session mit gruenem Nachweis bleibt Erfolg", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    issuesCommitten(dir);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: FAKE_MIT_PRUEFUNG });
    assert.match(res.stdout, /Erfolg/);
    assert.equal(status(dir, id), "in_review");
  });
});
