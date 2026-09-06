// E2E fuer den maschinenlesbaren Ergebnisstand des Nacht-Runners (Issue #486).
//
// Der Runner gibt sein Ergebnis bisher nur als Fliesstext aus; jede Umformulierung
// bricht eine Auswertung still. Dieses Paket legt Schema, Pfad und Schreiber an:
// Bei --verbose (und ohne --dry-run) entsteht nach den Vorflug-Pruefungen eine Datei
// .claude/night-run-<YYYY-MM-DD>-<HHMMSS>.json, deren erstes Feld die Schemafassung
// traegt. Ein Schreibfehler geht ins Textprotokoll und bricht den Lauf nie ab.
//
// Zweiter Teil und Voraussetzung: gitClean() nimmt .claude/night-run-* aus, sonst
// stoppte der Rest-Guard (#152) nach jeder erfolgreichen Runde hart.
//
// Wie in den uebrigen night-Tests laeuft alles lokal: issueTracker "local" in einem
// Temp-Repo, Session-Fake via NIGHT_CLAUDE_CMD, und das ECHTE kit/night.mjs aus dem
// Repo (cwd + KIT_ROOT zeigen ins Fixture).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, chmodSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." } : {};

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

function setupProjekt(praefix) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" },
  }, null, 2));
  // Bewusst OHNE `.claude/*` und ohne `*.json` (Muster aus night-guards.test.mjs:48):
  // Die Ergebnisstand-Datei muss untracked sichtbar bleiben, sonst bewiese der
  // [night-3]-Test nichts. Die .log-Datei bleibt ignoriert, sonst fiele die
  // Gegenprobe schon am Textprotokoll statt an der JSON-Datei.
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\nbin/\n");
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

/** Erzeugt ein Issue in Ready und liefert seine ID als String. */
function readyIssue(dir, titel) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", "## Abhaengigkeiten\nKeine.");
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

/** Die Ergebnisstand-Dateien im Fixture, nach Namen sortiert. */
function staende(dir) {
  return readdirSync(join(dir, ".claude"))
    .filter((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n))
    .sort();
}

test("[night-2] --verbose legt den Ergebnisstand an: schemaFassung 1 als erstes Feld, dazu erzeugtVon", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-neu-");
  try {
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const dateien = staende(dir);
    assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);

    const stand = JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
    assert.equal(Object.keys(stand)[0], "schemaFassung", "schemaFassung muss das erste Feld sein");
    assert.equal(stand.schemaFassung, 1, "schemaFassung traegt die Zahl 1");
    assert.ok(typeof stand.erzeugtVon === "string" && stand.erzeugtVon.length > 0, "erzeugtVon nennt den Kit-Stand");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ohne --verbose entsteht keine Ergebnisstand-Datei", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-still-");
  try {
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.deepEqual(staende(dir), [], "ohne --verbose darf nichts geschrieben werden");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mit --dry-run --verbose entsteht keine Ergebnisstand-Datei", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-dry-");
  try {
    readyIssue(dir, "Wird nur angezeigt");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--dry-run", "--verbose"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.deepEqual(staende(dir), [], "ein Dry-Run schreibt nichts");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("zwei Laeufe am selben Tag hinterlassen zwei Ergebnisstand-Dateien", NUR_POSIX, async () => {
  const dir = setupProjekt("night-stand-zwei-");
  try {
    const erst = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(erst.status, 0, `${erst.stderr}\n${erst.stdout}`);
    // Die Uhrzeit im Namen loest auf Sekunden auf — ohne Wartezeit koennten beide
    // Laeufe denselben Namen treffen.
    await new Promise((fertig) => setTimeout(fertig, 1100));
    const zweit = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(zweit.status, 0, `${zweit.stderr}\n${zweit.stdout}`);

    const dateien = staende(dir);
    assert.equal(dateien.length, 2, `zwei Dateien erwartet, gefunden: ${dateien.join(", ")}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ein Schreibfehler des Ergebnisstands bricht den Lauf nicht ab, das Textprotokoll nennt ihn", NUR_POSIX, () => {
  // root ignoriert Verzeichnisrechte — der Schreibfehler waere nicht herstellbar.
  if (process.getuid?.() === 0) return;
  const dir = setupProjekt("night-stand-eacces-");
  const claudeDir = join(dir, ".claude");
  try {
    const id = readyIssue(dir, "Laeuft trotz Schreibfehler");
    // Die Tagesdatei des Textprotokolls vorab anlegen: Ihr Name ist vorhersagbar,
    // und POSIX erlaubt das Anhaengen an eine bestehende Datei auch in einem nicht
    // beschreibbaren Verzeichnis. Nur das Anlegen der JSON-Datei scheitert (EACCES).
    const logPfad = join(claudeDir, `night-run-${new Date().toISOString().slice(0, 10)}.log`);
    writeFileSync(logPfad, "", "utf-8");
    chmodSync(claudeDir, 0o555);

    const fake = `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null`;
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `der Schreibfehler darf den Lauf nicht abbrechen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /Ergebnisstand konnte nicht geschrieben werden:/, "die Fehlerzeile fehlt auf der Konsole");
    assert.match(readFileSync(logPfad, "utf-8"), /Ergebnisstand konnte nicht geschrieben werden:/,
      "die Fehlerzeile fehlt im Textprotokoll");
    const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id));
    assert.ok(inReview.includes(id), "die Runde haette trotzdem durchlaufen muessen");
  } finally {
    chmodSync(claudeDir, 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-3] eine erfolgreiche Runde endet trotz untracked Ergebnisstand mit Exit 0", NUR_POSIX, () => {
  const dir = setupProjekt("night-stand-clean-");
  try {
    const id = readyIssue(dir, "Erfolgreiche Runde");
    const fake = `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null`;
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `der untracked Ergebnisstand darf keinen harten Stopp ausloesen: ${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, /HARTER STOPP/, "der Rest-Guard haette nicht anschlagen duerfen");
    assert.match(res.stdout, new RegExp(`Erfolg[\\s\\S]*Issue #${id} in In review`), "die Runde haette als Erfolg gemeldet werden muessen");

    // Die Datei liegt wirklich untracked im Arbeitsbaum — sonst bewiese der Test nichts.
    const dateien = staende(dir);
    assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);
    const status = run(dir, "git", ["status", "--porcelain"]);
    assert.match(status.stdout, new RegExp(`\\?\\? \\.claude/${dateien[0]}`), "die Datei muesste untracked sichtbar sein");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
