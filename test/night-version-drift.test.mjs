// Vorflug-Warnung bei abweichendem Versionsstempel (Issue #172).
//
// board.mjs und night.mjs liegen nebeneinander in .claude/kit/ und werden von
// install.mjs gemeinsam geschrieben. Auseinanderlaufen koennen sie trotzdem: eine
// einzeln kopierte Datei, ein abgebrochenes Re-Install. Heute ist das unsichtbar
// und aeussert sich erst als schwer zuzuordnendes Fehlverhalten — der Runner ruft
// Adapter-Funktionen auf, die die aeltere board.mjs noch nicht kennt (etwa labels
// in listIssues aus Issue #158).
//
// Bewusst nur eine Warnung: Ein Versionsunterschied macht den Lauf nicht zwingend
// kaputt, und ein zusaetzlicher naechtlicher Abbruchgrund waere schlimmer als das
// Problem, das er meldet.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
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

// boardVersion === null laesst die KIT_VERSION-Konstante ganz weg (aeltere Kopie
// aus der Zeit vor Issue #170).
function setupProjekt(boardVersion) {
  const dir = mkdtempSync(join(tmpdir(), "night-drift-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });

  let boardSrc = readFileSync(join(repoRoot, "kit", "board.mjs"), "utf-8");
  if (boardVersion === null) {
    boardSrc = boardSrc.replace(/const KIT_VERSION = "[^"]*";/, "");
  } else if (boardVersion) {
    boardSrc = boardSrc.replace(/(const KIT_VERSION = ")[^"]*(";)/, `$1${boardVersion}$2`);
  }
  writeFileSync(join(dir, ".claude", "kit", "board.mjs"), boardSrc);

  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    buildChecks: ["true"],
    local: { issuesDir: "issues" },
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

// Ein Lauf mit genau einem Issue, das sauber nach In review wandert — so ist
// belegbar, dass die Warnung den Lauf nicht behindert.
function laufMitEinemIssue(dir) {
  const erstes = board(dir, "issue", "create", "--title", "Erstes Issue", "--body", "## Abhaengigkeiten\nKeine.");
  board(dir, "issue", "move", String(erstes.id), "ready");
  const fake = `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null`;
  const res = run(dir, process.execPath, [NIGHT, "--label", "none"],
    { NIGHT_CLAUDE_CMD: fake });
  const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id));
  return { res, geschafft: inReview.includes(String(erstes.id)) };
}

test("Versions-Drift: abweichender board.mjs-Stempel warnt, stoppt den Lauf aber nicht", NUR_POSIX, () => {
  const dir = setupProjekt("0.9.9");
  try {
    const { res, geschafft } = laufMitEinemIssue(dir);

    assert.match(res.stdout, /0\.9\.9/, "die Warnung nennt die board.mjs-Version nicht");
    assert.match(res.stdout, /install\.mjs/i,
      "die Warnung sagt nicht, wie man die Installation auffrischt");
    assert.equal(res.status, 0, `der Lauf haette normal enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.ok(geschafft, "das Issue haette trotz Warnung in In review landen muessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Versions-Drift: gleiche Stempel erzeugen keine Warnung", NUR_POSIX, () => {
  const dir = setupProjekt(undefined); // board.mjs unveraendert = gleicher Stand
  try {
    const { res, geschafft } = laufMitEinemIssue(dir);

    assert.doesNotMatch(res.stdout, /Versions/i,
      `bei gleichem Stand darf nichts gemeldet werden: ${res.stdout}`);
    assert.equal(res.status, 0, `der Lauf haette normal enden muessen: ${res.stderr}`);
    assert.ok(geschafft, "das Issue haette in In review landen muessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Versions-Drift: board.mjs ohne Konstante warnt mit 'unbekannt', bricht nicht ab", NUR_POSIX, () => {
  const dir = setupProjekt(null);
  try {
    const { res, geschafft } = laufMitEinemIssue(dir);

    assert.match(res.stdout, /unbekannt/i,
      "eine Kopie ohne Konstante haette als 'unbekannt' gemeldet werden muessen");
    assert.equal(res.status, 0, `der Lauf haette normal enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.ok(geschafft, "das Issue haette trotz Warnung in In review landen muessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
