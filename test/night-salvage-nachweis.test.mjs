// Die Salvage-Vorpruefung schreibt den Nachweis, den das Commit-Gate liest (Issue #919).
//
// Beobachtet in kanban-kit am 2026-09-24 (Lauf `night-run-2026-09-24-125914`): Die
// Session lief rot, der Runner fuhr die buildChecks danach selbst und fand sie gruen —
// und die Salvage-Session konnte trotzdem nicht committen. Der Pre-Commit-Hook las
// `.claude/checks-summary.json`, und dort stand noch das rote Ergebnis der Session. Die
// Blob-Hashes passten exakt zum Baum; nur die gruene Pruefung des Runners landete
// nirgends. In dieser Lage kann die Rettung nie gelingen: Der Runner misst gruen an
// einer Stelle, die das Gate nicht liest.
//
// Beide Tests laufen E2E mit dem ECHTEN checks.mjs und dem ECHTEN Gate — die Kopplung
// zwischen dem, was der Runner fuer gruen haelt, und dem, was der Commit durchlaesst,
// ist genau der Gegenstand dieser Datei.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Ein eigener Sperrpfad je Testprozess (Issue #958): Dieser Test faehrt das echte
// kit/checks.mjs, und ohne eigenen Pfad serialisierte die maschinenweite Sperre die
// parallelen Testdateien gegeneinander.
import "./helpers/checks-sperre.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

// Der Pflichtcheck des Bereichs `kit`: rot, solange die Marker-Datei `.rot` liegt.
// Damit laesst sich "die Session sah rot, der Runner sieht gruen" ohne Zeitspiele
// nachstellen — genau die Lage des Vorfalls.
const KIT_CHECK = { cmd: "if [ -f .rot ]; then exit 1; fi; echo kit-check-lief", areas: ["kit"] };
// Ein Check eines Bereichs, den das Paket nicht beruehrt. checks.mjs laesst ihn aus;
// die alte Vorpruefung fuhr ihn mit und zitierte seine Ausgabe im Salvage-Prompt.
const FRONTEND_CHECK = { cmd: "echo frontend-check-lief", areas: ["frontend"] };
const CHECK_AREAS = { kit: ["kit/**"], frontend: ["frontend/**"], board: ["issues/**"] };

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

// Ein Projekt wie nach dem Installer: Kit unter .claude/kit/, Gate unter .githooks/
// und als core.hooksPath eingehaengt. Das Gate ist hier kein Beiwerk, sondern der
// Pruefstand — ohne es committet die Salvage-Session auch mit rotem Nachweis.
function setupProjekt(buildChecks) {
  const dir = mkdtempSync(join(tmpdir(), "night-salvage-nachweis-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  for (const name of ["board.mjs", "checks.mjs"]) {
    copyFileSync(join(repoRoot, "kit", name), join(dir, ".claude", "kit", name));
  }
  mkdirSync(join(dir, ".githooks"), { recursive: true });
  copyFileSync(join(repoRoot, ".githooks", "gate.mjs"), join(dir, ".githooks", "gate.mjs"));
  writeFileSync(join(dir, ".githooks", "pre-commit"),
    readFileSync(join(repoRoot, ".githooks", "pre-commit"), "utf-8"), { mode: 0o755 });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    buildChecks,
    checkAreas: CHECK_AREAS,
    local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"),
    ".claude/*\n!.claude/workflow.config.json\nsessions.log\nprompt.txt\ngate.log\n.rot\n");
  mkdirSync(join(dir, "kit"), { recursive: true });
  writeFileSync(join(dir, "kit", "bestand.txt"), "Bestand\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    assert.equal(run(dir, "git", a).status, 0);
  }
  // Erst nach dem Setup-Commit: Der haette sonst selbst durch das Gate gemusst, das
  // es zu diesem Zeitpunkt noch gar nicht zu erfuellen gibt.
  assert.equal(run(dir, "git", ["config", "core.hooksPath", ".githooks"]).status, 0);
  return dir;
}

function readyIssue(dir) {
  const issue = board(dir, "issue", "create", "--title", "Ein Issue", "--body", "## Abhaengigkeiten\nKeine.");
  board(dir, "issue", "move", String(issue.id), "ready");
  // Den Board-Stand committen, sonst zaehlten die untrackten issues/*.md zum
  // Arbeitspaket der Session. `--no-verify`: Das Gate gehoert zum Pruefgegenstand,
  // nicht zum Aufbau der Ausgangslage.
  assert.equal(run(dir, "git", ["add", "-A"]).status, 0);
  assert.equal(run(dir, "git", ["commit", "-q", "--no-verify", "-m", "Issues"]).status, 0);
  return String(issue.id);
}

// Die regulaere Runde des Vorfalls: Sie leistet die Arbeit, faehrt ihre Pruefung rot
// (Marker `.rot`) und endet ohne Board-Zug — der Baum ist dirty, die Zusammenfassung
// traegt das rote Ergebnis. Danach ist der Check gruen: Die Ursache war die Last einer
// fremden Suite, nicht die Aenderung.
const REGULAER = [
  `echo arbeit > kit/work-$NIGHT_ISSUE_ID.txt`,
  `touch .rot`,
  `node .claude/kit/checks.mjs run --abschluss "$NIGHT_ISSUE_ID" --frisch > /dev/null 2>&1`,
  `rm -f .rot`,
].join("\n");

// Die Salvage-Session tut, was ihr Prompt verlangt: committen, dann das Board bewegen.
// Die Ausgabe des Hooks landet in gate.log — sie ist der Befund, wenn der Commit scheitert.
const SALVAGE = [
  `printf '%s' "$NIGHT_PROMPT" > prompt.txt`,
  `git add -A && git commit -q -m "salvage (Issue #$NIGHT_ISSUE_ID)" 2>> gate.log \\`,
  `  && node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null`,
].join("\n");

function fakeSession(dir) {
  return `echo "$NIGHT_ISSUE_ID" >> ${JSON.stringify(join(dir, "sessions.log"))}\n`
    + `if [ -n "$NIGHT_SALVAGE" ]; then\n${SALVAGE}\nelse\n${REGULAER}\nfi\n`;
}

function gateLog(dir) {
  const p = join(dir, "gate.log");
  return existsSync(p) ? readFileSync(p, "utf-8") : "";
}

function zusammenfassung(dir) {
  return JSON.parse(readFileSync(join(dir, ".claude", "checks-summary.json"), "utf-8"));
}

test("[night-919] Die externe Verifikation hinterlaesst den gruenen Nachweis — das Gate laesst die Rettung durch", () => {
  const dir = setupProjekt([KIT_CHECK]);
  try {
    const id = readyIssue(dir);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fakeSession(dir) });

    assert.match(res.stdout, /SALVAGE-VERSUCH gestartet \(Checks extern verifiziert gruen\)/,
      `die Vorpruefung haette gruen sein muessen: ${res.stdout}`);
    assert.equal(gateLog(dir), "",
      `das Commit-Gate hat die Rettung abgewiesen: ${gateLog(dir)}`);
    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);

    const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id));
    assert.ok(inReview.includes(id), `Issue #${id} haette in In review landen muessen, dort stehen: ${inReview.join(", ")}`);
    const log = run(dir, "git", ["log", "--oneline"]).stdout;
    assert.match(log, new RegExp(`salvage \\(Issue #${id}\\)`), `der Salvage-Commit fehlt:\n${log}`);

    // Der Nachweis selbst: Er traegt den gruenen Lauf der Vorpruefung, nicht mehr das
    // rote Ergebnis der Session.
    const nachweis = zusammenfassung(dir);
    assert.equal(nachweis.abgeschlossen, true, "der Nachweis gilt als abgebrochen");
    assert.deepEqual(nachweis.laufen.map((e) => e.ergebnis), ["gruen"],
      `der Nachweis traegt nicht den gruenen Lauf: ${JSON.stringify(nachweis.laufen)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-919] Der Salvage-Prompt zitiert die Ausgabe von checks.mjs run, nicht die eines ausgelassenen Kommandos", () => {
  const dir = setupProjekt([KIT_CHECK, FRONTEND_CHECK]);
  try {
    readyIssue(dir);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fakeSession(dir) });

    assert.match(res.stdout, /SALVAGE-VERSUCH gestartet/, `der Salvage-Pfad lief nicht: ${res.stdout}`);
    const prompt = readFileSync(join(dir, "prompt.txt"), "utf-8");
    assert.match(prompt, /Zusammenfassung: .*checks-summary\.json/,
      `der Prompt zitiert nicht die Ausgabe von checks.mjs run:\n${prompt}`);
    assert.match(prompt, /^kit-check-lief$/m, `die Ausgabe des gelaufenen Kommandos fehlt:\n${prompt}`);
    // Die Auslassung gehoert in den Prompt, ihre AUSGABE nicht: Ein ausgelassenes
    // Kommando ist nicht gelaufen, und ein zitierter Ausgabetext behauptete das Gegenteil.
    assert.match(prompt, /ausgelassen: echo frontend-check-lief — Bereich frontend unberuehrt/,
      `die Auslassung fehlt samt Grund:\n${prompt}`);
    assert.doesNotMatch(prompt, /^frontend-check-lief$/m,
      `der Prompt zitiert die Ausgabe eines Kommandos, das der Abschluss dieses Pakets gar nicht faehrt:\n${prompt}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
