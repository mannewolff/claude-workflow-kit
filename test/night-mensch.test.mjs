// E2E fuer die Menschenschritt-Leitplanke des Nacht-Runners (Issue #984).
//
// Analog zu [Fachlich], [Idee] und [Plan]: Eine Karte mit dem Titelpraefix [Mensch] verlangt
// eine Handlung ausserhalb des Repositories — eine Einstellung in einer Weboberflaeche, ein
// Konto, ein Zugang, eine Freigabe. Keine Sitzung kann sie erledigen. Ohne Gate startete der
// Runner eine Session, die den Fall richtig erkennt und nichts tut, und wertete das als
// Fehlschlag (belegter Fall: kanban-kit #1256 im Lauf night-run-2026-09-28). Also mechanisch
// vor dem Session-Start zurueck ins Backlog — mit einem Kommentar, der sagt, dass die Karte
// wartet und nicht gescheitert ist.
// Laeuft komplett lokal: issueTracker "local" in einem Temp-Repo, Session-Fake via
// NIGHT_CLAUDE_CMD.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { lfAttribute } from "./helpers/zeilenenden.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
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
  const dir = mkdtempSync(join(tmpdir(), "night-mensch-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\nsessions.log\n");
  lfAttribute(join(dir, ".gitattributes"));
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

// --- Das Gate als Funktion (AK 1) ---

// Gefahren wird das Gate im Unterprozess IM Temp-Projekt, nicht im Testprozess: Kommt der
// Aufruf hinter die Titel-Gates, holt er den Body ueber board.mjs — im Testprozess waere das
// der echte Tracker des Kits. Ein `fail()` dort beendet den Prozess und liesse die ganze
// Datei durchfallen, statt eine Zusicherung zu pruefen.
function gateProbe(dir, titel) {
  const skript = join(dir, "probe.mjs");
  writeFileSync(skript, [
    `const { pruefeIssueGates } = await import(${JSON.stringify(pathToFileURL(NIGHT).href)});`,
    `const gate = pruefeIssueGates({ id: "1256", title: process.argv[2], labels: [] });`,
    `process.stdout.write(JSON.stringify(gate));`,
  ].join("\n"));
  return run(dir, process.execPath, [skript, titel]);
}

test("[night-984] pruefeIssueGates haelt eine `[Mensch]`-Karte, eine Karte ohne Praefix nicht", () => {
  const dir = setupProjekt();
  try {
    const res = gateProbe(dir, "[Mensch] Private Vulnerability Reporting aktivieren");
    assert.equal(res.status, 0, `die Probe schlug fehl: ${res.stderr}`);
    const gate = JSON.parse(res.stdout);
    assert.ok(gate, "das Gate laesst den Menschenschritt durch");
    assert.match(gate.log, /\[Mensch\]/, "die Logzeile nennt das Praefix nicht");
    assert.match(gate.kommentar, /wartet auf einen Menschen/i, "der Kommentar sagt nicht, dass die Karte auf einen Menschen wartet");
    assert.match(gate.kommentar, /nicht gescheitert/i, "der Kommentar sagt nicht, dass die Karte nicht gescheitert ist");

    // Gegenprobe im selben Test: Ein Titel ohne Praefix wird an dieser Stelle nicht gehalten.
    // Belegt daran, dass der Aufruf WEITERGEHT und den Body der Nummer 1256 holen will, die es
    // im Temp-Projekt nicht gibt — ein greifendes Titel-Gate haette vorher `null` ausgegeben
    // und mit Exit 0 geendet.
    const ohne = gateProbe(dir, "Normales technisches Issue");
    assert.notEqual(ohne.status, 0, "ein Titel ohne Praefix wurde an einem Titel-Gate gehalten");
    assert.equal(ohne.stdout, "", `es wurde ein Gate ausgegeben: ${ohne.stdout}`);
    assert.match(ohne.stderr, /issue get 1256/, `der Aufruf kam nicht bis zum Body: ${ohne.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Der Lauf (AK 3) ---

test("Nachtlauf: [Mensch]-Karte wird kommentiert uebersprungen, normales Issue laeuft", () => {
  const dir = setupProjekt();
  try {
    const mensch = board(dir, "issue", "create", "--title", "[Mensch] Private Vulnerability Reporting aktivieren", "--body", "## Kontext\nEin Klick in den Einstellungen.");
    const normal = board(dir, "issue", "create", "--title", "Normales technisches Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(mensch.id), "ready");
    board(dir, "issue", "move", String(normal.id), "ready");

    const sessionLog = join(dir, "sessions.log");
    const fake = `echo "$NIGHT_ISSUE_ID" >> ${JSON.stringify(sessionLog)} && node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`;

    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);

    const backlog = board(dir, "issue", "list", "--status", "backlog").map((i) => String(i.id));
    assert.ok(backlog.includes(String(mensch.id)), "[Mensch]-Karte liegt nicht im Backlog");
    const kommentare = issuesDirText(dir);
    assert.match(kommentare, /wartet auf einen Menschen/i, "der Kommentar haengt nicht an der Karte");
    assert.match(kommentare, /nicht gescheitert/i, "der Kommentar sagt nicht, dass die Karte nicht gescheitert ist");

    // Kein Kindprozess fuer die [Mensch]-Karte: die Logdatei des Fakes fuehrt nur das
    // normale Issue, und genau eine Session lief.
    const sessions = existsSync(sessionLog) ? readFileSync(sessionLog, "utf-8").trim().split("\n") : [];
    assert.deepEqual(sessions, [String(normal.id)], "es lief nicht genau eine Session fuer das normale Issue");
    const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id));
    assert.ok(inReview.includes(String(normal.id)), "normales Issue liegt nicht in In review");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Dry-Run weist [Mensch]-Karten als uebersprungen aus, ohne etwas zu bewegen", () => {
  const dir = setupProjekt();
  try {
    const mensch = board(dir, "issue", "create", "--title", "[Mensch] Zugang zum Paketregister anlegen", "--body", "## Kontext\nEin Konto.");
    board(dir, "issue", "move", String(mensch.id), "ready");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--dry-run"]);
    assert.equal(res.status, 0, `dry-run schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /wuerde ins Backlog \(Menschenschritt, wird nicht implementiert\)/,
      "dry-run weist die [Mensch]-Karte nicht als zurueckgestellt aus");
    assert.match(res.stdout, /0 Session\(s\) wuerden starten/, "dry-run wuerde faelschlich eine Session starten");

    const ready = board(dir, "issue", "list", "--status", "ready").map((i) => String(i.id));
    assert.ok(ready.includes(String(mensch.id)), "dry-run hat die Karte bewegt — darf er nicht");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
