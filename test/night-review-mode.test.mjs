// Review-Modus: Flags, Vorflug und Dry-Run (Issue #233).
//
// Der Modus arbeitet auf dem BACKLOG, nicht auf Ready — zwischen Review und
// Implementierung liegt das GO, und das GO ist menschlich. Deshalb auch exklusiv
// zur Implementierungsschleife.
//
// Dieses Issue baut den Modus bis zur Startlinie; die Schleife ist Issue #235.
// Entsprechend prueft die Datei vor allem, dass NICHTS startet: keine Session, kein
// Board-Move, kein geschriebener Body.
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

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

const REVIEW_LABEL = "kit:nightreview";

// Ein Reviewer-Paar, das ohne installiertes Fremdwerkzeug auskommt: claude-Reviewer
// gelten immer als verfuegbar.
const NUR_CLAUDE = [
  { name: "opus", kind: "claude", model: "claude-opus-5" },
  { name: "sonnet", kind: "claude", model: "claude-sonnet-5" },
];

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt(config = {}) {
  const dir = mkdtempSync(join(tmpdir(), "night-reviewmode-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" },
    issueReview: { reviewers: NUR_CLAUDE },
    ...config,
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\nsession-lief\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    assert.equal(run(dir, "git", a).status, 0);
  }
  return dir;
}

/** Legt ein Backlog-Issue an; Labels stehen beim lokalen Tracker als CSV im Frontmatter. */
function backlogIssue(dir, titel, body, label = REVIEW_LABEL) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", body);
  if (label) {
    const pfad = join(dir, "issues", `${issue.id}.md`);
    const roh = readFileSync(pfad, "utf-8");
    writeFileSync(pfad, roh.replace(/^status:/m, `labels: ${label}\nstatus:`), "utf-8");
  }
  return String(issue.id);
}

const OHNE_MARKER = "## Kontext\n\nAutor-Modell: claude-opus-5\n\n## Abhaengigkeiten\n\nKeine.\n";
const MIT_MARKER = "## Kontext\n\nAutor-Modell: claude-opus-5\nIssue-Review: sonnet, fable (2026-08-06)\n\n## Abhaengigkeiten\n\nKeine.\n";

// Ein Fake, der eine Datei anlegt — so ist belegbar, ob ueberhaupt eine Session lief.
const SESSION_FAKE = "touch session-lief";

function mitProjekt(fn, config = {}) {
  const dir = setupProjekt(config);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- Flags und Hilfe ---

test("--help nennt --review und --review-label samt Default", () => {
  const res = spawnSync(process.execPath, [NIGHT, "--help"], { encoding: "utf-8" });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /--review\b/);
  assert.match(res.stdout, /--review-label/);
  assert.match(res.stdout, /kit:nightreview/);
});

// --- Vorflug ---

test("--review bricht bei nicht verfuegbarem command-Reviewer ab, ohne eine Session zu starten", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: SESSION_FAKE });
    assert.notEqual(res.status, 0);
    assert.match(res.stdout + res.stderr, /gibtsnicht/);
    assert.equal(existsSync(join(dir, "session-lief")), false, "es lief eine Session, obwohl der Vorflug abbrechen sollte");
  }, {
    issueReview: {
      reviewers: [...NUR_CLAUDE, { name: "gibtsnicht", kind: "command", command: "gibtsnicht-xyz --flag" }],
    },
  });
});

test("--review laeuft mit leeren buildChecks, ohne --no-checks-ok", NUR_POSIX, () => {
  // Im Review-Modus wird nichts gebaut und nichts committet — die Pflicht ist dort
  // gegenstandslos. Im Implementierungsmodus bleibt sie bestehen (Gegenprobe unten).
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    const res = run(dir, process.execPath, [NIGHT, "--review", "--dry-run"]);
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout + res.stderr, /buildChecks/);
  }, { buildChecks: [] });
});

test("ohne --review bleibt die buildChecks-Pflicht bestehen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = run(dir, process.execPath, [NIGHT, "--dry-run"]);
    assert.notEqual(res.status, 0);
    assert.match(res.stdout + res.stderr, /buildChecks/);
  }, { buildChecks: [] });
});

// --- Dry-Run ---

test("--review --dry-run mit fehlendem Reviewer laeuft durch und meldet ihn", NUR_POSIX, () => {
  // Der Dry-Run ist das Werkzeug, das den Vorflug-Befund zeigt — er darf nicht an
  // genau dem Problem scheitern, das er aufklaeren soll.
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    const res = run(dir, process.execPath, [NIGHT, "--review", "--dry-run"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /gibtsnicht.*NICHT verfuegbar/);
  }, {
    issueReview: {
      reviewers: [...NUR_CLAUDE, { name: "gibtsnicht", kind: "command", command: "gibtsnicht-xyz --flag" }],
    },
  });
});

test("--review --dry-run startet keine Session und bewegt kein Issue", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const id = backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    // Die Issue-Datei selbst als Zeuge: Sie traegt Status, Body und beim lokalen
    // Tracker auch die Kommentare. Bleibt sie byte-gleich, hat der Dry-Run nichts
    // angefasst — schaerfer als drei Einzelvergleiche.
    const pfad = join(dir, "issues", `${id}.md`);
    const vorher = readFileSync(pfad, "utf-8");

    const res = run(dir, process.execPath, [NIGHT, "--review", "--dry-run"], { NIGHT_CLAUDE_CMD: SESSION_FAKE });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(existsSync(join(dir, "session-lief")), false, "es lief eine Session im Dry-Run");
    assert.equal(readFileSync(pfad, "utf-8"), vorher, "der Dry-Run hat die Issue-Datei veraendert");
  });
});

test("--review --dry-run listet ein Issue mit vorhandenem Marker als uebersprungen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const geprueft = backlogIssue(dir, "Schon geprueft", MIT_MARKER);
    const offen = backlogIssue(dir, "Noch offen", OHNE_MARKER);

    const res = run(dir, process.execPath, [NIGHT, "--review", "--dry-run"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`#${geprueft}.*wuerde uebersprungen`));
    assert.match(res.stdout, new RegExp(`#${offen}.*Review-Session 1`));
    assert.match(res.stdout, /1 Review-Session\(s\) wuerden starten/);
  });
});

test("--review --dry-run ueberspringt Issues ohne das Routing-Label", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const mit = backlogIssue(dir, "Mit Label", OHNE_MARKER, REVIEW_LABEL);
    const ohne = backlogIssue(dir, "Ohne Label", OHNE_MARKER, "");

    const res = run(dir, process.execPath, [NIGHT, "--review", "--dry-run"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`#${ohne}.*uebersprungen.*kit:nightreview`));
    assert.match(res.stdout, new RegExp(`#${mit}.*Review-Session 1`));
  });
});

test("--review --dry-run ueberspringt [Fachlich] und [Idee]", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const fachlich = backlogIssue(dir, "[Fachlich] Eine Story", OHNE_MARKER);
    const idee = backlogIssue(dir, "[Idee] Ein Einfall", OHNE_MARKER);

    const res = run(dir, process.execPath, [NIGHT, "--review", "--dry-run"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`#${fachlich}.*uebersprungen.*Fachlich`));
    assert.match(res.stdout, new RegExp(`#${idee}.*uebersprungen.*Idee`));
    assert.match(res.stdout, /Keine Review-Kandidaten/);
  });
});

test("--review-label none schaltet den Filter ab", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const ohne = backlogIssue(dir, "Ohne Label", OHNE_MARKER, "");
    const res = run(dir, process.execPath, [NIGHT, "--review", "--review-label", "none", "--dry-run"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`#${ohne}.*Review-Session 1`));
  });
});

test("--review --dry-run beachtet --max", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "Eins", OHNE_MARKER);
    backlogIssue(dir, "Zwei", OHNE_MARKER);
    const res = run(dir, process.execPath, [NIGHT, "--review", "--max", "1", "--dry-run"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /ueber --max 1, bliebe liegen/);
    assert.match(res.stdout, /1 Review-Session\(s\) wuerden starten/);
  });
});

test("--review meldet den Modus in der Startzeile", NUR_POSIX, () => {
  mitProjekt((dir) => {
    backlogIssue(dir, "Ein Issue", OHNE_MARKER);
    const res = run(dir, process.execPath, [NIGHT, "--review", "--dry-run"]);
    assert.match(res.stdout, /Modus Review/);
    const impl = run(dir, process.execPath, [NIGHT, "--dry-run"]);
    assert.match(impl.stdout, /Modus Implementierung/);
  });
});
