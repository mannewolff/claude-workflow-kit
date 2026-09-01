// Der Auftrag der Review-Session nennt die Betriebsart (Issue #419).
//
// Am 2026-08-31 endeten vier von vier Nacht-Review-Sessions ohne Schaerfung. Zwei
// davon hatten `KIT_AGENT_MODEL` selbst geprueft und im Protokoll erwaehnt: Sie
// wussten, dass niemand zusieht, und nahmen trotzdem den interaktiven Pfad. Der
// Prompt ist der einzige Hebel, der greift, BEVOR die Session das Dokument liest —
// die Strukturaenderung an Schritt 6 (Issue #417) wirkt erst beim Lesen.
//
// Dieser Test steht neben der Zusicherung in night-review-loop.test.mjs, er
// ersetzt sie nicht: Dort steht der Prompt im Zusammenhang der Sessionschleife,
// hier steht er fuer sich.
//
// Massgeblich fuer die Session bleibt `KIT_AGENT_MODEL`; der Hinweis im Prompt
// wiederholt es nur (siehe Schritt 6 des Skills). Ein zweites Erkennungsmerkmal
// waere eine zweite Wahrheit.

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

const NUR_CLAUDE = [
  { name: "opus", kind: "claude", model: "claude-opus-5" },
  { name: "sonnet", kind: "claude", model: "claude-sonnet-5" },
];

// Der Vorflug laeuft seit Issue #269 als eigene Session; ohne diesen Hook wuerde
// der Test eine echte claude-Session starten.
const VORFLUG_OK = `cat <<'EOF'
<<<VORFLUG
{"reviewers": [], "tracker": {"erreichbar": true, "geprueft": "issue list"}}
VORFLUG>>>
EOF`;

// Schreibt den Prompt ungekuerzt weg — anders als die Fakes in
// night-review-loop.test.mjs, die nur die erste Zeile brauchen.
const FAKE_PROMPT_MITSCHRIFT = 'printf "%s" "$NIGHT_PROMPT" > prompt.txt';

const OHNE_MARKER = "## Kontext\n\nAutor-Modell: claude-opus-5\n\n## Abhaengigkeiten\n\nKeine.\n";

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, {
    cwd, encoding: "utf-8",
    env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, NIGHT_VORFLUG_CMD: VORFLUG_OK, ...env },
  });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt() {
  const dir = mkdtempSync(join(tmpdir(), "night-reviewprompt-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" }, issueReview: { reviewers: NUR_CLAUDE },
  }, null, 2));
  // prompt.txt muss ignoriert sein: night.mjs stoppt hart, wenn eine Review-Session
  // den Working Tree veraendert.
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\nprompt.txt\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    assert.equal(run(dir, "git", a).status, 0);
  }
  return dir;
}

function backlogIssue(dir, titel) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", OHNE_MARKER);
  const pfad = join(dir, "issues", `${issue.id}.md`);
  writeFileSync(pfad, readFileSync(pfad, "utf-8").replace(/^status:/m, "labels: kit:nightreview\nstatus:"), "utf-8");
  return String(issue.id);
}

function mitProjekt(fn) {
  const dir = setupProjekt();
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function reviewPrompt(dir) {
  const id = backlogIssue(dir, "Ein Issue");
  const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: FAKE_PROMPT_MITSCHRIFT });
  assert.equal(res.status, 0, res.stderr);
  return { id, prompt: readFileSync(join(dir, "prompt.txt"), "utf-8") };
}

test("der Auftrag beginnt mit dem Skill-Aufruf", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const { id, prompt } = reviewPrompt(dir);
    assert.equal(prompt.split("\n")[0], `/issue-review #${id}`,
      "die erste Zeile muss der Skill-Aufruf bleiben — sie startet den Skill");
  });
});

test("der Auftrag sagt der Session, dass niemand zusieht", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const { prompt } = reviewPrompt(dir);
    assert.match(prompt, /unbeaufsichtigt/i,
      "der Prompt benennt die Betriebsart nicht — die Session muss sie sich wieder selbst erschliessen");
    assert.match(prompt, /Es sieht niemand zu/i);
    assert.match(prompt, /wird nicht gefragt/i,
      "ohne diesen Halbsatz bleibt offen, was aus der Betriebsart folgt");
  });
});

test("der Auftrag verlangt ein Ergebnis am Board vor Sessionende", NUR_POSIX, () => {
  // Der gemessene Ausfall war kein Abbruch: Die Sessions haben gearbeitet und ihr
  // Ergebnis nicht geschrieben. Der Prompt muss genau das verlangen.
  mitProjekt((dir) => {
    const { prompt } = reviewPrompt(dir);
    assert.match(prompt, /Board/,
      "der Prompt nennt das Board als Ablageort des Ergebnisses nicht");
    assert.match(prompt, /bevor die Session endet/i);
  });
});
