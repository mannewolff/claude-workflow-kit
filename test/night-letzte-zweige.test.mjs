// Die letzten erreichbaren Verzweigungen im Nacht-Runner (Issue #405).
//
// Vier Stellen, an denen ein Wert fehlen darf und der Runner trotzdem eine
// brauchbare Auskunft geben muss: eine Config ohne `local`-Block, ein Lauf ohne
// buildChecks, ein Vorflug-Kommando, das nicht startbar ist, und eine
// Review-Session, deren CLI selbst scheitert.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Die Fakes laufen ueber `sh -c` bzw. haengen an POSIX-Dateirechten. Siehe Issue #199." }
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

function setupProjekt(config = {}, praefix = "night-letzte-") {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" }, ...config,
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\nsessions.log\n");
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.invalid");
  git(dir, "config", "user.name", "T");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "setup");
  return dir;
}

function mitProjekt(fn, config, praefix) {
  const dir = setupProjekt(config, praefix);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readyIssue(dir, titel = "Ein Issue") {
  const issue = board(dir, "issue", "create", "--title", titel,
    "--body", "## Kontext\n\nIssue-Review: x\n\n## Abhaengigkeiten\n\nKeine.\n");
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

// ============================================================
// Eine Config ohne local-Block
// ============================================================

test("ohne local-Block zaehlen die Board-Dateien im Default-Verzeichnis nicht als dirty", NUR_POSIX, () => {
  // gitClean nimmt beim lokalen Tracker das issuesDir aus der Config heraus. Fehlt
  // der Block, muss der Default 'issues' gelten — sonst hielte der Runner jeden
  // Board-Move fuer eine Code-Aenderung und stoppte sofort hart.
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    const fake = `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`;

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `der Lauf haette durchlaufen muessen: ${res.stderr}${res.stdout}`);
    assert.match(res.stdout, new RegExp(`Erfolg nach [\\d.]+ min.*Issue #${id} in In review`),
      "die Runde wurde nicht als Erfolg gewertet");
    assert.doesNotMatch(res.stdout, /HARTER STOPP/,
      "ein Board-Move darf nicht als unkommittete Code-Aenderung zaehlen");
  }, { local: undefined }, "night-letzte-ohne-local-");
});

// ============================================================
// Ein Lauf ohne buildChecks
// ============================================================

test("ohne buildChecks ist der Salvage nicht moeglich, und der Lauf sagt es", NUR_POSIX, () => {
  // Mit --no-checks-ok laeuft die Nacht ohne Gate. Trifft sie dann auf eine Runde,
  // die Arbeit liegen laesst, gibt es nichts zu verifizieren: Eine leere Pruefliste
  // gilt als gruen, und der Salvage startet. Genau diese Kette muss halten, statt an
  // `undefined` zu zerbrechen.
  mitProjekt((dir) => {
    readyIssue(dir);
    const fake = [
      'if [ -n "$NIGHT_SALVAGE" ]; then',
      "  exit 0",
      "else",
      '  echo arbeit > "work.txt"',
      "fi",
    ].join("\n");

    const res = run(dir, ["--label", "none", "--no-checks-ok"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 1, "die gescheiterte Runde haette hart stoppen muessen");
    assert.match(res.stdout, /SALVAGE-VERSUCH gestartet/,
      "eine leere Pruefliste gilt als gruen — der Salvage haette starten muessen");
  }, { buildChecks: [] }, "night-letzte-ohne-checks-");
});

// ============================================================
// Ein Vorflug-Kommando, das nicht startbar ist
// ============================================================

test("Vorflug: ein nicht ausfuehrbares claude meldet den Systemfehler", NUR_POSIX, () => {
  mitProjekt((dir) => {
    board(dir, "issue", "create", "--title", "Ein Kandidat",
      "--body", "## Kontext\n\nAutor-Modell: m\n\n## Abhaengigkeiten\n\nKeine.\n");

    // Ein `claude` ohne Ausfuehrungsrecht: spawn liefert EACCES — weder ETIMEDOUT
    // noch ENOENT, also der dritte Zweig. Ohne ihn stuende dort kein Grund.
    // Der PATH enthaelt nur git (fuer die Vorbedingung) und dieses claude; er liegt
    // AUSSERHALB des Fixtures, damit der Working Tree sauber bleibt.
    const echtesGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf-8" }).stdout.trim();
    const bin = mkdtempSync(join(tmpdir(), "night-letzte-bin-"));
    writeFileSync(join(bin, "git"), `#!/bin/sh\nexec ${echtesGit} "$@"\n`, { mode: 0o755 });
    writeFileSync(join(bin, "claude"), "#!/bin/sh\necho hi\n", { mode: 0o644 });

    try {
      const res = run(dir, ["--review", "--dry-run", "--review-label", "none"], {
        NIGHT_VORFLUG_CMD: "", PATH: bin,
      });

      assert.equal(res.status, 0, `der Dry-Run haette mit 0 enden muessen: ${res.stderr}${res.stdout}`);
      assert.match(res.stdout, /EACCES|permission denied/i,
        "der Systemfehler fehlt — ohne ihn ist die Ursache unklar");
      assert.doesNotMatch(res.stdout, /nicht gefunden\. Ist Claude Code installiert/,
        "ein Rechteproblem darf nicht als 'nicht installiert' gemeldet werden");
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  }, {}, "night-letzte-vorflug-eacces-");
});

// ============================================================
// Eine Review-Session, deren CLI scheitert
// ============================================================

const VORFLUG_OK = 'cat <<\'EOF\'\n<<<VORFLUG\n{"reviewers":[],"tracker":{"erreichbar":true,"geprueft":"issue list"}}\nVORFLUG>>>\nEOF';

test("Review-Modus: ein Fehlstart der Session stoppt hart und nennt den Exit-Code", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const issue = board(dir, "issue", "create", "--title", "Ein Kandidat",
      "--body", "## Kontext\n\nAutor-Modell: m\n\n## Abhaengigkeiten\n\nKeine.\n");

    // Derselbe Guard wie in der Implementierungsschleife (#149): Exit != 0 ohne
    // Timeout heisst, das CLI selbst ist gescheitert. Harter Stopp OHNE Kommentar —
    // sonst kommentiert eine kaputte Umgebung den ganzen Backlog voll.
    const res = run(dir, ["--review", "--review-label", "none"], {
      NIGHT_VORFLUG_CMD: VORFLUG_OK,
      NIGHT_CLAUDE_CMD: 'echo "Auth abgelaufen" >&2; exit 5',
    });

    assert.equal(res.status, 1, "ein Fehlstart haette hart stoppen muessen");
    assert.match(res.stdout, /INFRASTRUKTUR-FEHLSCHLAG nach [\d.]+ min \(Exit 5\)/,
      "der Exit-Code fehlt in der Meldung");
    assert.match(res.stdout, new RegExp(`Issue #${issue.id} bleibt unangetastet`),
      "das Ticket muss ausdruecklich als unangetastet gemeldet werden");

    // Kein Kommentar am Ticket: Das ist der Unterschied zum fachlichen Fehlschlag.
    const full = board(dir, "issue", "get", String(issue.id));
    assert.ok(!full.body.includes("Nachtlauf:"),
      "ein Infrastruktur-Fehlschlag darf das Ticket nicht kommentieren");
    // Ein claude-Reviewer muss konfiguriert sein: Sonst haelt der Vorflug den Lauf
    // schon vorher an ("Kein Reviewer konfiguriert"), und die Schleife startet nie.
  }, { issueReview: { rounds: 1, reviewers: [{ name: "fable", kind: "claude", model: "claude-fable-5" }] } },
  "night-letzte-review-infra-");
});
