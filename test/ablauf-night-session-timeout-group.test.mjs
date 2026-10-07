// Ablauf-Pruefung: Ob das Signal an die Prozessgruppe den Enkel trifft, der die geerbte Pipe offen haelt, und ob ein SIGTERM-taubes Kommando wirklich hart endet, zeigt nur ein echter Prozessbaum unter dem echten Runner.
//
// Timeout gegen ueberlebende Enkelprozesse (Issue #182).
//
// Der Runner killte beim Zeitlimit nur den direkten Kindprozess. Node loest das
// close-Event aber erst auf, wenn alle stdio-Streams geschlossen sind — ein
// Enkelprozess, der die geerbte Pipe offen haelt, verhindert das. Der Runner wartete
// dann die volle Laufzeit ab, obwohl er laengst gekillt hatte.
//
// Gemessen am 2026-07-29 (macOS, spawn + SIGTERM nach 300 ms, Kommando sleep mit 5 s Laufzeit):
//   direkter Prozess, Einzel-Kill      close nach  307 ms
//   Enkelprozess,     Einzel-Kill      close nach 5023 ms   <- der Bug
//   Enkelprozess,     Gruppen-Kill     close nach  306 ms
//
// Das erklaert auch "lokal gruen, CI rot": Ob bei `sh -c "<einfaches Kommando>"` die
// Shell sich per exec selbst ersetzt (dann gibt es keinen Enkel) oder als Elternprozess
// stehen bleibt, haengt von der Shell-Implementierung ab und unterscheidet sich
// zwischen macOS und dem Ubuntu-Runner.
//
// Produktiv ist derselbe Pfad betroffen: Der Kindprozess ist `claude`, und der startet
// seinerseits Bash-Tool-Aufrufe wie `mvn verify`.
//
// Dieser Test erzwingt den Enkelprozess ueber "& wait" und ist damit auf jeder
// Plattform aussagekraeftig.
//
// Seit Issue #1229 stehen hier nur die beiden Faelle am echten Prozessbaum. Die Stufen des
// Zeitlimits, das Warten auf die Gruppe und der Aufruf zum Beenden des Baums sind in
// test/night-session-timeout-group.test.mjs im selben Prozess belegt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { lfAttribute } from "./helpers/zeilenenden.mjs";

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
  const dir = mkdtempSync(join(tmpdir(), "night-killgroup-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  cpSync(join(repoRoot, "kit", "board"), join(dir, ".claude", "kit", "board"), { recursive: true });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\n");
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

function lebt(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

test("Timeout: ueberlebender Enkelprozess haelt den Lauf nicht auf", () => {
  const dir = setupProjekt();
  // Der Enkel ist ein Node-Prozess, der seine PID ausserhalb des Repos ablegt.
  const aussen = mkdtempSync(join(tmpdir(), "night-killgroup-enkel-"));
  const pidDatei = join(aussen, "enkel.pid").replaceAll("\\", "/");
  const enkel = join(aussen, "enkel.mjs");
  writeFileSync(enkel, `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(pidDatei)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`);
  try {
    const issue = board(dir, "issue", "create", "--title", "Langsames-Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(issue.id), "ready");

    // "& wait" erzwingt einen echten Enkelprozess: Die Shell bleibt Elternprozess,
    // sleep haelt die geerbte stdout-Pipe. Ohne Gruppen-Kill laeuft der Runner die
    // vollen 120 s, obwohl das Zeitlimit bei 400 ms liegt. Die Grenze muss nur unter der
    // Schlafdauer liegen (Issue #1080): Unter Last brauchte allein der Runner-Start 27 s,
    // und 20 s bei 30 s Schlaf riss ohne Fehler.
    // Das Zeitlimit liegt ueber dem Start des Enkels, damit er seine PID sicher schreibt.
    const node = JSON.stringify(process.execPath.replaceAll("\\", "/"));
    const skript = JSON.stringify(enkel.replaceAll("\\", "/"));
    const started = Date.now();
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"],
      { NIGHT_CLAUDE_CMD: `${node} ${skript} & wait`, NIGHT_TIMEOUT_MS: "3000" });
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 90000, `Timeout griff nicht — Enkelprozess hielt den Lauf auf (${elapsed} ms)`);
    assert.equal(res.status, 0, "regulaeres Ende (kein harter Stopp) nach Timeout-Fehlschlag");
    const backlog = board(dir, "issue", "list", "--status", "backlog").map((i) => String(i.id));
    assert.ok(backlog.includes(String(issue.id)), "Issue haette nach Timeout im Backlog liegen muessen");
    assert.ok(existsSync(pidDatei), `der Enkel hat seine PID nicht geschrieben: ${res.stdout}${res.stderr}`);
    const pid = Number(readFileSync(pidDatei, "utf-8").trim());
    assert.ok(pid > 0, "der Enkel hat keine PID geschrieben");
    assert.equal(lebt(pid), false, `der Enkel ${pid} lebt nach dem Zeitlimit noch`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(aussen, { recursive: true, force: true });
  }
});

test("Timeout: ein SIGTERM-taubes Kommando wird hart nachgekillt", () => {
  const dir = setupProjekt();
  try {
    const issue = board(dir, "issue", "create", "--title", "Taubes-Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(issue.id), "ready");

    // trap "" TERM ignoriert SIGTERM vollstaendig. Ohne harte Obergrenze wartet der
    // Runner unbegrenzt — genau der Zustand, den ein Nachtlauf nie erreichen darf.
    const started = Date.now();
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"],
      { NIGHT_CLAUDE_CMD: 'trap "" TERM; sleep 120 # haengt', NIGHT_TIMEOUT_MS: "400", NIGHT_KILL_GRACE_MS: "600" });
    const elapsed = Date.now() - started;

    // Unter der Schlafdauer, mit Reserve fuer Last (Issue #1080).
    assert.ok(elapsed < 90000, `harte Obergrenze griff nicht — Lauf haengt (${elapsed} ms)`);
    assert.equal(res.status, 0, "regulaeres Ende nach hartem Nachkillen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
