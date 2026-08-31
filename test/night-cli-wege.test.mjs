// Die Wege, auf denen der Nacht-Runner gar nicht erst startet (Issue #405).
//
// Zwischen `parseArgs` und der ersten Session liegen sechs Vorbedingungen. Jede von
// ihnen ist ein Abbruch mit eigener Meldung — und genau die Meldung ist morgens die
// ganze Diagnose, weil niemand danebenstand.
//
// Geprueft war bisher der Weg, auf dem alles stimmt. Hier steht, was passiert, wenn
// eine Zahl unbrauchbar ist, board.mjs fehlt, die Config fehlt, der Baum schmutzig
// ist oder das Routing-Label nirgends vorkommt.

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
  ? { skip: "Windows: Die Fakes laufen ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

function run(cwd, cliArgs, env = {}) {
  return spawnSync(process.execPath, [NIGHT, ...cliArgs], {
    cwd, encoding: "utf-8",
    env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env },
  });
}

function git(dir, ...args) {
  const res = spawnSync("git", args, { cwd: dir, encoding: "utf-8" });
  assert.equal(res.status, 0, `git ${args.join(" ")} schlug fehl: ${res.stderr}`);
}

function board(cwd, ...cliArgs) {
  const res = spawnSync(process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs], {
    cwd, encoding: "utf-8",
    env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd },
  });
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

/**
 * Ein Fixture-Projekt. `mitBoard: false` laesst board.mjs weg, `mitConfig: false`
 * die Config, `mitGit: false` das Repository — jedes davon ist eine eigene
 * Vorbedingung des Runners.
 */
function setupProjekt({ mitBoard = true, mitConfig = true, mitGit = true, config = {} } = {}, praefix = "night-cli-") {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  if (mitBoard) copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  if (mitConfig) {
    writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
      codeHost: "local", issueTracker: "local", buildChecks: ["true"],
      local: { issuesDir: "issues" }, ...config,
    }, null, 2));
  }
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\n");
  if (mitGit) {
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "t@example.invalid");
    git(dir, "config", "user.name", "T");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "setup");
  }
  return dir;
}

function mitProjekt(fn, optionen, praefix) {
  const dir = setupProjekt(optionen, praefix);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================================
// Unbrauchbare Zahlen
// ============================================================

// Beide Zahlen steuern, wie lange die Nacht laeuft. Ein unbrauchbarer Wert darf
// nicht auf einen Default zurueckfallen: `--max abc` als "10" zu lesen hiesse, zehn
// Sessions zu starten, wo jemand eine wollte.
const ZAHLEN = [
  { flag: "--max", wert: "0", meldung: /--max braucht eine Zahl >= 1/ },
  { flag: "--max", wert: "abc", meldung: /--max braucht eine Zahl >= 1/ },
  { flag: "--max", wert: "-3", meldung: /--max braucht eine Zahl >= 1/ },
  { flag: "--timeout-min", wert: "0", meldung: /--timeout-min braucht eine Zahl >= 1/ },
  { flag: "--timeout-min", wert: "abc", meldung: /--timeout-min braucht eine Zahl >= 1/ },
];

for (const fall of ZAHLEN) {
  test(`${fall.flag} ${fall.wert} bricht ab, statt auf den Default zurueckzufallen`, () => {
    mitProjekt((dir) => {
      const res = run(dir, [fall.flag, fall.wert, "--dry-run"]);

      assert.equal(res.status, 1, `der Lauf haette abbrechen muessen: ${res.stdout}`);
      assert.match(res.stderr, fall.meldung, "die Meldung nennt das Flag nicht");
      assert.doesNotMatch(res.stdout, /Nacht-Runner startet/,
        "die Pruefung muss VOR dem Start greifen");
    });
  });
}

// ============================================================
// Fehlende Vorbedingungen
// ============================================================

test("ohne board.mjs neben night.mjs bricht der Lauf mit dem Pfad ab", () => {
  mitProjekt((dir) => {
    const res = run(dir, ["--dry-run"]);

    assert.equal(res.status, 1, "ohne den Adapter haette der Lauf abbrechen muessen");
    assert.match(res.stderr, /board\.mjs nicht gefunden unter .*\.claude[/\\]kit[/\\]board\.mjs/,
      "die Meldung nennt den erwarteten Pfad nicht");
  }, { mitBoard: false }, "night-cli-ohne-board-");
});

test("ohne workflow.config.json nennt der Abbruch den Projekt-Root als Ursache", () => {
  mitProjekt((dir) => {
    const res = run(dir, ["--dry-run"]);

    assert.equal(res.status, 1, "ohne Config haette der Lauf abbrechen muessen");
    assert.match(res.stderr, /Keine \.claude\/workflow\.config\.json — bitte im Projekt-Root starten/,
      "die Meldung nennt die Abhilfe nicht");
  }, { mitConfig: false }, "night-cli-ohne-config-");
});

test("ein schmutziger Working Tree stoppt vor jeder Session", () => {
  mitProjekt((dir) => {
    // Eine unkommittete Datei ausserhalb des issuesDir: Board-Zustand zaehlt nicht
    // als dirty, Code-Zustand schon.
    writeFileSync(join(dir, "rest.txt"), "unkommittet\n");

    const res = run(dir, ["--dry-run"]);

    assert.equal(res.status, 1, "ein schmutziger Baum haette den Lauf stoppen muessen");
    assert.match(res.stderr, /Working Tree ist nicht sauber/, "die Meldung fehlt");
  }, {}, "night-cli-dirty-");
});

test("Board-Moves des lokalen Trackers zaehlen nicht als schmutzig", () => {
  mitProjekt((dir) => {
    // Genau die Gegenprobe zum Test darueber: `issue create` legt eine Datei unter
    // issues/ an. Zaehlte sie als dirty, koennte der lokale Tracker nie nachts laufen.
    board(dir, "issue", "create", "--title", "Ein Issue", "--body", "## Abhaengigkeiten\nKeine.");

    const res = run(dir, ["--dry-run", "--label", "none"]);

    assert.equal(res.status, 0, `der Lauf haette durchlaufen muessen: ${res.stderr}`);
    assert.match(res.stdout, /Ready ist leer/, "das angelegte Issue liegt noch im Backlog");
  }, {}, "night-cli-board-move-");
});

test("ohne buildChecks bricht die Implementierung ab, der Review-Modus nicht", () => {
  mitProjekt((dir) => {
    const ohneChecks = run(dir, ["--dry-run", "--label", "none"]);
    assert.equal(ohneChecks.status, 1, "ohne Gate darf nachts nicht implementiert werden");
    assert.match(ohneChecks.stderr, /buildChecks in workflow\.config\.json ist leer/);
    assert.match(ohneChecks.stderr, /--no-checks-ok/, "der Override wird nicht genannt");

    // Mit Override laeuft derselbe Aufruf durch.
    const mitOverride = run(dir, ["--dry-run", "--label", "none", "--no-checks-ok"]);
    assert.equal(mitOverride.status, 0, `--no-checks-ok haette den Lauf freigeben muessen: ${mitOverride.stderr}`);
  }, { config: { buildChecks: [] } }, "night-cli-ohne-checks-");
});

// ============================================================
// Die Label-Warnung: beide Formen der Auskunft
// ============================================================

function readyIssue(dir, titel, labels = null) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", "## Kontext\n\nIssue-Review: x\n\n## Abhaengigkeiten\n\nKeine.\n");
  const pfad = join(dir, "issues", `${issue.id}.md`);
  let text = readFileSync(pfad, "utf-8");
  if (labels) text = text.replace(/^status:/m, `labels: ${labels}\nstatus:`);
  writeFileSync(pfad, text, "utf-8");
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

test("die Label-Warnung zaehlt die vorhandenen Labels auf", () => {
  mitProjekt((dir) => {
    readyIssue(dir, "Mit fremdem Label", "ein-anderes");

    const res = run(dir, ["--dry-run"]);

    assert.equal(res.status, 0, `der Dry-Run haette durchlaufen muessen: ${res.stderr}`);
    assert.match(res.stdout, /kein Ready-Issue traegt das Label 'kit:nightrun'/, "die Warnung fehlt");
    assert.match(res.stdout, /In Ready vorhandene Labels: ein-anderes/,
      "ohne die Aufzaehlung ist ein Vertipper nicht zu erkennen");
  }, {}, "night-cli-label-warnung-");
});

test("liegen gar keine Labels in Ready, sagt die Warnung genau das", () => {
  mitProjekt((dir) => {
    readyIssue(dir, "Ganz ohne Label");

    const res = run(dir, ["--dry-run"]);

    assert.equal(res.status, 0, `der Dry-Run haette durchlaufen muessen: ${res.stderr}`);
    assert.match(res.stdout, /In Ready vorhandene Labels: keine/,
      "eine leere Aufzaehlung muss als 'keine' erscheinen, nicht als Leerstelle");
  }, {}, "night-cli-label-keine-");
});

test("mit --label none entfaellt die Warnung und das Issue wird eingeplant", NUR_POSIX, () => {
  mitProjekt((dir) => {
    readyIssue(dir, "Ganz ohne Label");

    const res = run(dir, ["--dry-run", "--label", "none"]);

    assert.equal(res.status, 0, `der Dry-Run haette durchlaufen muessen: ${res.stderr}`);
    assert.doesNotMatch(res.stdout, /WARNUNG: kein Ready-Issue/, "ohne Filter gibt es nichts zu warnen");
    assert.match(res.stdout, /Dry-Run beendet: 1 Session\(s\) wuerden starten/,
      "das Issue haette eingeplant werden muessen");
  }, {}, "night-cli-label-none-");
});
