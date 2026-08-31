// Die Fehlerwege des Nacht-Runners im echten Lauf (Issue #405).
//
// Alles hier ist ein Ausgang, den nachts niemand sieht: eine Session, die gar nicht
// startet; ein board.mjs, das scheitert; ein Repo ohne Commit; ein Salvage, dessen
// Checks nichts ausgeben. Was in diesen Faellen im Protokoll steht, ist am naechsten
// Morgen die einzige Spur.
//
// Gefahren wird das ECHTE kit/night.mjs gegen ein Fixture (cwd + KIT_ROOT), mit dem
// lokalen Tracker und Session-Fakes ueber NIGHT_CLAUDE_CMD.

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

function setupProjekt({ config = {}, mitCommit = true, boardInhalt = null, allesIgnorieren = false } = {}, praefix = "night-fehler-") {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  if (boardInhalt === null) {
    copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  } else {
    writeFileSync(join(dir, ".claude", "kit", "board.mjs"), boardInhalt, "utf-8");
  }
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" }, ...config,
  }, null, 2));
  // `*` ignoriert alles einschliesslich der .gitignore selbst: So ist der Working
  // Tree auch OHNE Commit sauber — anders waere ein Repo ohne Commit gar nicht
  // bespielbar, weil jede Datei als untracked zaehlt.
  writeFileSync(join(dir, ".gitignore"),
    allesIgnorieren ? "*\n" : ".claude/night-run-*.log\nsessions.log\n");
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.invalid");
  git(dir, "config", "user.name", "T");
  if (mitCommit) {
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

function readyIssue(dir, titel = "Ein Issue") {
  const issue = board(dir, "issue", "create", "--title", titel,
    "--body", "## Kontext\n\nIssue-Review: x\n\n## Abhaengigkeiten\n\nKeine.\n");
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

// ============================================================
// Der Board-Adapter selbst scheitert
// ============================================================

test("scheitert board.mjs, steht seine Ausgabe in der Meldung", () => {
  // Ein board.mjs, das mit Exit 1 endet und auf stderr schreibt: Der Runner darf den
  // Text nicht verschlucken — er ist die einzige Auskunft ueber die Ursache.
  mitProjekt((dir) => {
    const res = run(dir, ["--dry-run", "--label", "none"]);

    assert.equal(res.status, 1, "ein kaputter Adapter haette den Lauf stoppen muessen");
    assert.match(res.stderr, /board\.mjs .* schlug fehl/, "die eigene Meldung fehlt");
    assert.match(res.stderr, /Adapter kaputt/, "die Ausgabe des Adapters fehlt");
  }, { boardInhalt: 'process.stderr.write("Adapter kaputt\\n");\nprocess.exit(1);\n' }, "night-fehler-board-");
});

test("gibt board.mjs nur auf stdout aus, steht auch das in der Meldung", () => {
  // Der zweite Zweig des Rueckfalls: kein stderr, aber stdout. Ohne ihn stuende dort
  // eine leere Zeichenkette und die Ursache waere verloren.
  mitProjekt((dir) => {
    const res = run(dir, ["--dry-run", "--label", "none"]);

    assert.equal(res.status, 1, "ein kaputter Adapter haette den Lauf stoppen muessen");
    assert.match(res.stderr, /nur auf stdout/, "die stdout-Ausgabe des Adapters fehlt");
  }, { boardInhalt: 'process.stdout.write("nur auf stdout\\n");\nprocess.exit(1);\n' }, "night-fehler-board-stdout-");
});

// ============================================================
// git: kein Repo, kein Commit
// ============================================================

test("ausserhalb eines git-Repos nennt der Abbruch den Projekt-Root", () => {
  const dir = mkdtempSync(join(tmpdir(), "night-fehler-ohne-git-"));
  try {
    mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
    copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
    writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
      codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
    }), "utf-8");

    const res = run(dir, ["--dry-run", "--label", "none"]);

    assert.equal(res.status, 1, "ohne git-Repo haette der Lauf abbrechen muessen");
    assert.match(res.stderr, /git status schlug fehl — bin ich im Projekt-Root eines git-Repos\?/,
      "die Meldung nennt die eigentliche Frage nicht");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("in einem Repo ohne Commit meldet der Erfolg den Hash als '?'", NUR_POSIX, () => {
  // `git log -1` scheitert im leeren Repo. Der Rueckfall auf "?" haelt die
  // Erfolgsmeldung lesbar, statt den ganzen Lauf an einer Protokollzeile zu kippen.
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    const fake = `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`;

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `der Lauf haette durchlaufen muessen: ${res.stderr}${res.stdout}`);
    assert.match(res.stdout, new RegExp(`Erfolg nach [\\d.]+ min, Commit \\?, Issue #${id} in In review`),
      "ohne Commit muss der Hash als '?' erscheinen");
  }, { mitCommit: false, allesIgnorieren: true }, "night-fehler-ohne-commit-");
});

// ============================================================
// Die Session startet gar nicht
// ============================================================

test("ein Infrastruktur-Fehlschlag nennt Exit-Code und die ersten Zeilen der Ausgabe", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    // Exit != 0 ohne Timeout heisst: das CLI selbst ist gescheitert. Mit dem Issue
    // ist nichts falsch — deshalb harter Stopp OHNE Kommentar und ohne Backlog-Move.
    const fake = 'echo "Auth abgelaufen" >&2; echo "zweite Zeile" >&2; exit 7';

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 1, "ein Fehlstart haette hart stoppen muessen");
    assert.match(res.stdout, /INFRASTRUKTUR-FEHLSCHLAG nach [\d.]+ min \(Exit 7\)/,
      "der Exit-Code fehlt in der Meldung");
    assert.match(res.stdout, /CLI-Meldung: Auth abgelaufen \| zweite Zeile/,
      "die ersten Zeilen der Ausgabe fehlen");
    // Das Issue bleibt unangetastet: eine kaputte Umgebung darf nicht die ganze
    // Ready-Spalte leerraeumen.
    const ready = board(dir, "issue", "list", "--status", "ready").map((i) => String(i.id));
    assert.ok(ready.includes(id), "das Issue haette in Ready bleiben muessen");
  }, {}, "night-fehler-infra-");
});

test("ein Fehlstart ohne jede Ausgabe meldet trotzdem den Exit-Code", NUR_POSIX, () => {
  mitProjekt((dir) => {
    readyIssue(dir);

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: "exit 9" });

    assert.equal(res.status, 1, "ein Fehlstart haette hart stoppen muessen");
    assert.match(res.stdout, /INFRASTRUKTUR-FEHLSCHLAG nach [\d.]+ min \(Exit 9\)/);
    assert.doesNotMatch(res.stdout, /CLI-Meldung:/,
      "ohne Ausgabe darf keine leere CLI-Meldung erscheinen");
  }, {}, "night-fehler-infra-stumm-");
});

test("eine Session, die ihr Zeitlimit reisst, ist KEIN Infrastruktur-Fehlschlag", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = readyIssue(dir);
    // Ein Timeout ist ein fachlicher Fehlschlag: Das CLI lief, es wurde nur nicht
    // fertig. Das Issue wandert ins Backlog, der Lauf geht weiter.
    const res = run(dir, ["--label", "none"], {
      NIGHT_CLAUDE_CMD: "sleep 30", NIGHT_TIMEOUT_MS: "300", NIGHT_KILL_GRACE_MS: "200",
    });

    assert.doesNotMatch(res.stdout, /INFRASTRUKTUR-FEHLSCHLAG/,
      "ein Zeitlimit ist kein Fehlstart des CLI");
    const backlog = board(dir, "issue", "list", "--status", "backlog").map((i) => String(i.id));
    assert.ok(backlog.includes(id), "das Issue haette ins Backlog wandern muessen");
  }, {}, "night-fehler-timeout-");
});

// ============================================================
// Salvage: Checks ohne Ausgabe
// ============================================================

test("der Salvage-Prompt kommt auch mit Checks ohne Ausgabe zustande", NUR_POSIX, () => {
  mitProjekt((dir) => {
    readyIssue(dir);
    // Die regulaere Runde laesst Arbeit liegen; die Checks sind gruen, geben aber
    // NICHTS aus (`true`). Der Salvage-Prompt schneidet die letzten Zeilen dieser
    // Ausgabe mit — bei leerer Ausgabe muss er trotzdem zustande kommen.
    //
    // Der Fake darf stdin nicht lesen: Der Runner uebergibt den Prompt als Argument
    // und schliesst stdin nicht; ein `cat` warte bis zum Salvage-Zeitlimit.
    const fake = [
      'if [ -n "$NIGHT_SALVAGE" ]; then',
      "  exit 0",
      "else",
      '  echo arbeit > "work.txt"',
      "fi",
    ].join("\n");

    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.match(res.stdout, /SALVAGE-VERSUCH gestartet/, "der Salvage lief nicht an");
    assert.equal(res.status, 1, "der gescheiterte Salvage haette hart stoppen muessen");
    assert.match(res.stdout, /SALVAGE-VERSUCH gescheitert/, "das Ergebnis wird nicht benannt");
  }, {}, "night-fehler-salvage-");
});

// ============================================================
// Der Review-Modus und seine Auskuenfte
// ============================================================

const VORFLUG_OK = 'cat <<\'EOF\'\n<<<VORFLUG\n{"reviewers":[],"tracker":{"erreichbar":true,"geprueft":"issue list"}}\nVORFLUG>>>\nEOF';

test("ohne Kandidaten nennt der Review-Lauf die Labels des Backlogs", NUR_POSIX, () => {
  mitProjekt((dir) => {
    // Ein Backlog-Issue mit fremdem Label: Der Review-Filter greift nicht, und die
    // Meldung muss zeigen, welche Labels es stattdessen gibt.
    const issue = board(dir, "issue", "create", "--title", "Fremdes Label", "--body", "## Kontext\n\nAutor-Modell: m\n");
    const pfad = join(dir, "issues", `${issue.id}.md`);
    writeFileSync(pfad, readFileSync(pfad, "utf-8").replace(/^status:/m, "labels: anderes\nstatus:"), "utf-8");

    const res = run(dir, ["--review", "--dry-run"], { NIGHT_VORFLUG_CMD: VORFLUG_OK });

    assert.equal(res.status, 0, `der Review-Dry-Run haette mit 0 enden muessen: ${res.stderr}`);
    assert.match(res.stdout, /Keine Review-Kandidaten im Backlog/, "die Lage wird nicht benannt");
    assert.match(res.stdout, /Im Backlog vorhandene Labels: anderes/,
      "ohne die Aufzaehlung ist ein Vertipper im --review-label nicht zu erkennen");
  }, {}, "night-fehler-review-labels-");
});

test("die Tracker-Probe nennt das Issue, an dem sie haengen wuerde", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const issue = board(dir, "issue", "create", "--title", "Ein Kandidat",
      "--body", "## Kontext\n\nAutor-Modell: m\n\n## Abhaengigkeiten\n\nKeine.\n");

    const res = run(dir, ["--review", "--dry-run", "--review-label", "none"], { NIGHT_VORFLUG_CMD: VORFLUG_OK });

    assert.equal(res.status, 0, `der Review-Dry-Run haette mit 0 enden muessen: ${res.stderr}`);
    assert.match(res.stdout, new RegExp(`Tracker-Probe Issue #${issue.id}`),
      "ohne die Nummer ist nicht erkennbar, woran die Probe haengt");
  }, {}, "night-fehler-probe-");
});

test("ohne jedes Issue beschraenkt sich die Probe auf issue list", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = run(dir, ["--review", "--dry-run", "--review-label", "none"], { NIGHT_VORFLUG_CMD: VORFLUG_OK });

    assert.equal(res.status, 0, `der Review-Dry-Run haette mit 0 enden muessen: ${res.stderr}`);
    assert.match(res.stdout, /Tracker-Probe nur issue list/,
      "ohne Issue gibt es nichts zu holen — das muss so dastehen");
  }, {}, "night-fehler-probe-leer-");
});
