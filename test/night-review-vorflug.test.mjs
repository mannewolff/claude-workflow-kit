// Reviewer-Vorflug in einer Session statt im Runner (Issue #269).
//
// Der Vorflug aus Issue #262 startete das Reviewer-Kommando im Runner-Prozess. Damit
// beantwortet er die falsche Frage: Gebraucht wird der Reviewer in den Review-Sessions —
// eigenen Kindprozessen mit eigener Sandbox, eigener Netzwerk-Allowlist und eigenen
// Freigaben. In der Nacht vom 2026-08-08 lief der Vorflug sauber durch, waehrend die
// Session an "Run outside of the sandbox" scheiterte. Der Lauf startete vollbesetzt und
// arbeitete mit einem Reviewer.
//
// Der zentrale Test unten baut genau diese Asymmetrie nach: Das Reviewer-Kommando liegt
// startbar im PATH (der Runner koennte es also starten), scheitert aber in der
// Vorflug-Session. Erwartet wird `verfuegbar: false` — und dass board.mjs den Reviewer
// gar nicht erst direkt angefasst hat.
//
// Wie in den uebrigen night-Tests laeuft das ECHTE kit/night.mjs gegen ein Fixture
// (cwd + KIT_ROOT).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { trackerProbeId, parseVorflugBefund, normalisiereVorflug } from "../kit/night.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Die Fakes laufen ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

const OPUS = { name: "opus", kind: "claude", model: "claude-opus-5" };
// Das Kommando liegt als echtes Skript im PATH des Fixtures — im Runner also startbar.
const FREMD = { name: "fremd", kind: "command", command: "reviewer-fake" };

const OHNE_MARKER = "## Kontext\n\nAutor-Modell: claude-opus-5\n\n## Abhaengigkeiten\n\nKeine.\n";

/**
 * Fake fuer die Vorflug-Session (NIGHT_VORFLUG_CMD).
 *
 * Er protokolliert jeden Aufruf in `vorflug-lief` — nur so ist pruefbar, dass genau eine
 * Vorflug-Session lief — und gibt den Befund-Block aus, den der Runner auswertet.
 */
function vorflugFake({ reviewers = [], tracker = { erreichbar: true, geprueft: "issue list" }, vorher = "" } = {}) {
  return `echo vorflug >> vorflug-lief; ${vorher}cat <<'EOF'
<<<VORFLUG
${JSON.stringify({ reviewers, tracker })}
VORFLUG>>>
EOF`;
}

const VORFLUG_OK = vorflugFake({ reviewers: [{ name: "fremd", verfuegbar: true }] });
// Der Fall aus der Nacht vom 2026-08-08: im Runner startbar, in der Session nicht.
const VORFLUG_REVIEWER_TOT = vorflugFake({
  reviewers: [{ name: "fremd", verfuegbar: false, grund: "Run outside of the sandbox" }],
});
const VORFLUG_TRACKER_TOT = vorflugFake({
  reviewers: [{ name: "fremd", verfuegbar: true }],
  tracker: { erreichbar: false, geprueft: "issue get 1", grund: "api.github.com: Operation not permitted" },
});

// Der Fake fuer die Issue-Review-Sessions legt eine Datei an — so ist belegbar, ob nach
// dem Vorflug ueberhaupt noch eine Session startete.
const SESSION_FAKE = "touch session-lief";

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, {
    cwd, encoding: "utf-8",
    env: {
      ...process.env,
      KIT_AGENT_MODEL: "fixture-modell",
      KIT_ROOT: cwd,
      PATH: `${join(cwd, "bin")}:${process.env.PATH}`,
      NIGHT_VORFLUG_CMD: VORFLUG_OK,
      ...env,
    },
  });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt(reviewers = [OPUS, FREMD]) {
  const dir = mkdtempSync(join(tmpdir(), "night-vorflug-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  mkdirSync(join(dir, "bin"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));

  // Startbar und erfolgreich — waere der Vorflug noch im Runner, meldete er "verfuegbar".
  // Der Zeuge `reviewer-lief` zeigt, ob ihn jemand direkt aus board.mjs gestartet hat.
  const skript = join(dir, "bin", "reviewer-fake");
  writeFileSync(skript, '#!/bin/sh\ncat > /dev/null\necho reviewer >> "$KIT_ROOT/reviewer-lief"\necho OK\n', { mode: 0o755 });

  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" }, issueReview: { reviewers },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\nvorflug-lief\nreviewer-lief\nsession-lief\nbin/\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    assert.equal(run(dir, "git", a).status, 0);
  }
  return dir;
}

function backlogIssue(dir, titel, body = OHNE_MARKER) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", body);
  const pfad = join(dir, "issues", `${issue.id}.md`);
  writeFileSync(pfad, readFileSync(pfad, "utf-8").replace(/^status:/m, "labels: kit:nightreview\nstatus:"), "utf-8");
  return String(issue.id);
}

function mitProjekt(fn, reviewers) {
  const dir = setupProjekt(reviewers);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function zeilen(dir, datei) {
  const p = join(dir, datei);
  return existsSync(p) ? readFileSync(p, "utf-8").trim().split("\n").filter(Boolean) : [];
}

// --- Die falsche Umgebung ---

test("Reviewer im Runner startbar, in der Session nicht -> verfuegbar: false", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue");
    const res = run(dir, process.execPath, [NIGHT, "--review", "--dry-run"], {
      NIGHT_VORFLUG_CMD: VORFLUG_REVIEWER_TOT,
    });

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /fremd \(command\) in review-session: NICHT verfuegbar — Run outside of the sandbox/);
    assert.equal(zeilen(dir, "vorflug-lief").length, 1, "es muss genau eine Vorflug-Session gelaufen sein");
    assert.equal(existsSync(join(dir, "reviewer-lief")), false,
      "board.mjs hat den Reviewer direkt gestartet — genau die Messung in der falschen Umgebung");
  });
});

test("kein Reviewer-Befund traegt umgebung: runner", NUR_POSIX, () => {
  // Der Gegenwert von board.mjs. Taucht er im Nachtlauf auf, stammt die Auskunft aus dem
  // Runner-Prozess — und dann sagt sie nichts ueber die Session aus.
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue");
    const res = run(dir, process.execPath, [NIGHT, "--review", "--dry-run"]);
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, /in runner:/);
    assert.match(res.stdout, /fremd \(command\) in review-session: verfuegbar/);
  });
});

// --- Tracker als eigener Befund ---

test("nicht erreichbarer Tracker ist ein eigener Befund mit eigenem Grund", NUR_POSIX, () => {
  // Bei Issue #248 scheiterte nicht der Reviewer, sondern `board.mjs issue get` an der
  // leeren Netzwerk-Allowlist. Wer das als Reviewer-Ausfall meldet, schickt den Menschen
  // morgens in die falsche Ecke.
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue");
    const res = run(dir, process.execPath, [NIGHT, "--review", "--dry-run"], {
      NIGHT_VORFLUG_CMD: VORFLUG_TRACKER_TOT,
    });

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Tracker \(review-session\): NICHT erreichbar — api\.github\.com: Operation not permitted/);
    assert.match(res.stdout, /fremd \(command\) in review-session: verfuegbar/,
      "der Reviewer war in Ordnung und darf nicht mit dem Tracker vermengt werden");
  });
});

test("--review stoppt bei nicht erreichbarem Tracker, ohne eine Issue-Review-Session zu starten", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue");
    const res = run(dir, process.execPath, [NIGHT, "--review"], {
      NIGHT_VORFLUG_CMD: VORFLUG_TRACKER_TOT, NIGHT_CLAUDE_CMD: SESSION_FAKE,
    });

    assert.notEqual(res.status, 0);
    assert.match(res.stdout + res.stderr, /Tracker aus der Session nicht erreichbar/);
    assert.equal(existsSync(join(dir, "session-lief")), false, "es lief eine Issue-Review-Session trotz totem Tracker");
  });
});

// --- Gate (Verhalten aus Issue #233, gegen den neuen Befund) ---

test("--review startet bei einem Reviewer-Ausfall in der Session gar nicht erst", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue");
    const res = run(dir, process.execPath, [NIGHT, "--review"], {
      NIGHT_VORFLUG_CMD: VORFLUG_REVIEWER_TOT, NIGHT_CLAUDE_CMD: SESSION_FAKE,
    });

    assert.notEqual(res.status, 0);
    assert.match(res.stdout + res.stderr, /Reviewer in der Session nicht verfuegbar: fremd/);
    assert.equal(existsSync(join(dir, "session-lief")), false, "es lief eine Issue-Review-Session trotz totem Reviewer");
    assert.equal(zeilen(dir, "vorflug-lief").length, 1, "genau eine Vorflug-Session, danach Schluss");
  });
});

test("--review --dry-run berichtet den negativen Vorflug und endet mit Exit-Code 0", NUR_POSIX, () => {
  // Der Dry-Run ist das Werkzeug, das den Befund zeigt — er darf nicht an genau dem
  // Problem scheitern, das er aufklaeren soll.
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue");
    const res = run(dir, process.execPath, [NIGHT, "--review", "--dry-run"], {
      NIGHT_VORFLUG_CMD: VORFLUG_REVIEWER_TOT, NIGHT_CLAUDE_CMD: SESSION_FAKE,
    });

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /fremd \(command\) in review-session: NICHT verfuegbar/);
    assert.equal(existsSync(join(dir, "session-lief")), false, "der Dry-Run hat eine Issue-Review-Session gestartet");
    assert.equal(zeilen(dir, "vorflug-lief").length, 1, "genau eine Vorflug-Session, auch im Dry-Run");
  });
});

// --- Fehlerpfad der Vorflug-Session selbst ---

test("Vorflug-Session ohne auswertbaren Befund -> harter Stopp mit eigenem Grund", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue");
    const res = run(dir, process.execPath, [NIGHT, "--review"], {
      NIGHT_VORFLUG_CMD: "echo vorflug >> vorflug-lief; exit 3", NIGHT_CLAUDE_CMD: SESSION_FAKE,
    });

    assert.notEqual(res.status, 0);
    assert.match(res.stdout + res.stderr, /Die Vorflug-Session lieferte kein Ergebnis .*Exit 3/);
    assert.equal(existsSync(join(dir, "session-lief")), false);
  });
});

test("Vorflug-Session ohne Befund-Block: der Dry-Run berichtet und endet mit 0", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue");
    const res = run(dir, process.execPath, [NIGHT, "--review", "--dry-run"], {
      NIGHT_VORFLUG_CMD: "echo Ich habe alles geprueft, alles gut.",
    });

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Vorflug-Session nicht auswertbar: die Vorflug-Session endete ohne auswertbaren Befund-Block/);
  });
});

test("eine Vorflug-Session, die den Working Tree verschmutzt, stoppt den Lauf hart", NUR_POSIX, () => {
  // Dieselbe Leitplanke wie nach einer regulaeren Review-Session (Issue #152): Eine
  // Session, die nichts anfassen darf und es doch tut, hinterlaesst eine unklare Lage.
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue");
    const res = run(dir, process.execPath, [NIGHT, "--review"], {
      NIGHT_VORFLUG_CMD: vorflugFake({ reviewers: [{ name: "fremd", verfuegbar: true }], vorher: "echo dreck > dreck.txt; " }),
      NIGHT_CLAUDE_CMD: SESSION_FAKE,
    });

    assert.equal(res.status, 1);
    assert.match(res.stdout, /HARTER STOPP: die Vorflug-Session hat den Working Tree veraendert/);
    assert.equal(existsSync(join(dir, "session-lief")), false);
  });
});

// --- Ohne command-Reviewer ---

test("ohne kind:command-Reviewer laeuft die Vorflug-Session trotzdem", NUR_POSIX, () => {
  // Die Tracker-Erreichbarkeit muss weiterhin aus der Session-Umgebung geprueft werden —
  // sie haengt nicht an fremden Werkzeugen.
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue");
    const res = run(dir, process.execPath, [NIGHT, "--review", "--dry-run"], {
      NIGHT_VORFLUG_CMD: vorflugFake(),
    });

    assert.equal(res.status, 0, res.stderr);
    assert.equal(zeilen(dir, "vorflug-lief").length, 1, "auch ohne command-Reviewer muss der Vorflug laufen");
    assert.match(res.stdout, /Tracker \(review-session\): erreichbar/);
  }, [OPUS, { name: "sonnet", kind: "claude", model: "claude-sonnet-5" }]);
});

// --- Reine Funktionen ---

test("trackerProbeId: der erste Kandidat gewinnt, sonst das erste Issue der Liste", () => {
  assert.equal(trackerProbeId([{ id: 7 }, { id: 9 }], [{ id: 1 }]), "7");
  assert.equal(trackerProbeId([], [{ id: 1 }, { id: 2 }]), "1");
  assert.equal(trackerProbeId([], []), null);
  assert.equal(trackerProbeId([], null), null);
});

test("parseVorflugBefund: nimmt den letzten Block und vertraegt Prosa drumherum", () => {
  const text = 'Ich pruefe jetzt.\n<<<VORFLUG\n{"reviewers": []}\nVORFLUG>>>\nnoch ein Versuch:\n'
    + '<<<VORFLUG\n{"tracker": {"erreichbar": true}}\nVORFLUG>>>\n';
  assert.deepEqual(parseVorflugBefund(text), { tracker: { erreichbar: true } });
  assert.equal(parseVorflugBefund("alles gut"), null);
  assert.equal(parseVorflugBefund("<<<VORFLUG\nkein json\nVORFLUG>>>"), null);
  assert.equal(parseVorflugBefund("<<<VORFLUG\n{}"), null, "ohne Endmarker ist der Block nicht auswertbar");
});

test("normalisiereVorflug: Schweigen zaehlt nicht als Zustimmung", () => {
  const reviewers = [{ name: "opus", kind: "claude" }, { name: "fremd", kind: "command" }];
  const { reviewers: befunde, tracker } = normalisiereVorflug({ reviewers: [], tracker: {} }, reviewers);

  assert.deepEqual(befunde[0], { name: "opus", kind: "claude", umgebung: "review-session", verfuegbar: true });
  assert.equal(befunde[1].verfuegbar, false);
  assert.equal(befunde[1].umgebung, "review-session");
  assert.ok(befunde[1].grund.length > 0, "ein nicht verfuegbarer Reviewer braucht einen Grund");
  assert.equal(tracker.erreichbar, false);
  assert.ok(tracker.grund.length > 0);
});

test("normalisiereVorflug: ein uebersprungenes issue get bleibt erreichbar", () => {
  const { tracker } = normalisiereVorflug(
    { reviewers: [], tracker: { erreichbar: true, geprueft: "issue list", uebersprungen: "kein Issue vorhanden" } },
    [],
  );
  assert.equal(tracker.erreichbar, true);
  assert.equal(tracker.uebersprungen, "kein Issue vorhanden");
  assert.equal(tracker.grund, undefined);
});

test("normalisiereVorflug: nur ein ausdrueckliches true zaehlt", () => {
  const reviewers = [{ name: "fremd", kind: "command" }];
  for (const wert of ["true", 1, null, undefined]) {
    const { reviewers: befunde } = normalisiereVorflug({ reviewers: [{ name: "fremd", verfuegbar: wert }] }, reviewers);
    assert.equal(befunde[0].verfuegbar, false, `verfuegbar: ${JSON.stringify(wert)} darf nicht als ja gelten`);
  }
});
