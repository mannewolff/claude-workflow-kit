// Messen ohne zu protokollieren (Issue #748, Plan #745, Fund B1).
//
// Der Strom wird in jedem unbeaufsichtigten Lauf angefordert (`stream: true`), bisher aber
// nur bei `--verbose` zeilenweise verarbeitet. Damit waere die Werkzeugzeit in jedem
// normalen Nachtlauf dauerhaft "nicht gemessen". `useStream` einfach immer wahr zu machen
// waere der andere Fehler: Dann liefe `emitVerbose()` in jedem Lauf und schriebe jedes
// Stream-Ereignis in Konsole UND Tagesprotokoll. Hier wird beides getrennt geprueft —
// gemessen wird immer, wenn der Strom angefordert ist, ausgegeben nur bei `--verbose`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { runSession } from "../kit/night.mjs";

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

const ARGS = { model: "fixture-modell", timeoutMin: 1, yolo: false, verbose: false };

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt() {
  const dir = mkdtempSync(join(tmpdir(), "night-stream-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  copyFileSync(join(repoRoot, "kit", "checks.mjs"), join(dir, ".claude", "kit", "checks.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    buildChecks: ["true"],
    local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/*\n!.claude/workflow.config.json\nsessions.log\n");
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

/** Ein Schub aus einem `tool_use` und seinem `tool_result`, mit messbarer Spanne dazwischen. */
const SCHUB = [
  `echo '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"mvn -q verify"}}]}}'`,
  "sleep 0.2",
  `echo '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}'`,
];

/** Fake einer vollstaendigen Runde: Schub im Strom, Checks, Issue nach In review. */
function streamFake() {
  return [
    ...SCHUB,
    "node .claude/kit/checks.mjs run > /dev/null 2>&1",
    `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`,
  ].join(" && ");
}

/** Das Tagesprotokoll des Laufs aus dem Wegwerf-Verzeichnis. */
function protokoll(dir) {
  const datei = readdirSync(join(dir, ".claude")).find((n) => n.startsWith("night-run-") && n.endsWith(".log"));
  assert.ok(datei, "kein Tagesprotokoll geschrieben");
  return readFileSync(join(dir, ".claude", datei), "utf-8");
}

test("[night-50] ohne --verbose misst die Session die Werkzeugzeit, sobald sie den Strom anfordert", NUR_POSIX, async () => {
  process.env.NIGHT_CLAUDE_CMD = SCHUB.join(" && ");
  try {
    const res = await runSession("748", ARGS, { stream: true });
    assert.equal(res.status, 0, res.stderr);
    assert.ok(res.werkzeugzeit, "ohne --verbose fehlt das Beobachter-Ergebnis");
    assert.ok(res.werkzeugzeit.werkzeugMs > 0, `werkzeugMs haette gemessen sein muessen: ${res.werkzeugzeit.werkzeugMs}`);
    assert.equal(res.werkzeugzeit.schuebe, 1);
    assert.equal(res.werkzeugzeit.offeneSchuebe, 0);
  } finally {
    delete process.env.NIGHT_CLAUDE_CMD;
  }
});

test("[night-50] mit --verbose wird ebenso gemessen", NUR_POSIX, async () => {
  process.env.NIGHT_CLAUDE_CMD = SCHUB.join(" && ");
  try {
    const res = await runSession("748", { ...ARGS, verbose: true }, { stream: true });
    assert.equal(res.status, 0, res.stderr);
    assert.ok(res.werkzeugzeit.werkzeugMs > 0, "mit --verbose muss dieselbe Messung laufen");
    assert.equal(res.werkzeugzeit.schuebe, 1);
  } finally {
    delete process.env.NIGHT_CLAUDE_CMD;
  }
});

test("[night-50] ein Lauf, der den Strom gar nicht anfordert, traegt kein Beobachter-Ergebnis — nicht etwa eines mit Nullen", NUR_POSIX, async () => {
  process.env.NIGHT_CLAUDE_CMD = SCHUB.join(" && ");
  try {
    const res = await runSession("748", ARGS, {});
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.werkzeugzeit, null, "ohne angeforderten Strom ist nichts gemessen, und das muss unterscheidbar bleiben");
  } finally {
    delete process.env.NIGHT_CLAUDE_CMD;
  }
});

test("[night-50] ohne --verbose bleibt das Tagesprotokoll frei von Stream-Ereignissen", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const issue = board(dir, "issue", "create", "--title", "Still-Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(issue.id), "ready");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: streamFake() });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);

    const ereignis = new RegExp(`#${issue.id} > `);
    assert.doesNotMatch(res.stdout, ereignis, "ohne --verbose duerfen keine Ereigniszeilen auf der Konsole stehen");
    assert.doesNotMatch(protokoll(dir), ereignis, "ohne --verbose duerfen keine Ereigniszeilen im Tagesprotokoll stehen");
    assert.match(res.stdout, /Erfolg/, "die erfolgreiche Runde wird weiterhin gemeldet");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-50] mit --verbose traegt das Tagesprotokoll die Stream-Ereignisse weiterhin", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const issue = board(dir, "issue", "create", "--title", "Laut-Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(issue.id), "ready");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: streamFake() });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);

    const ereignis = new RegExp(`#${issue.id} > Bash: mvn -q verify`);
    assert.match(res.stdout, ereignis, "mit --verbose fehlt die Ereigniszeile auf der Konsole");
    assert.match(protokoll(dir), ereignis, "mit --verbose fehlt die Ereigniszeile im Tagesprotokoll");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
