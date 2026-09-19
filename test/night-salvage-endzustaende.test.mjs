// Die drei harten Endzustaende des Salvage (Issue #672).
//
// Bis hierher fasste `versucheSalvage` alles, was kein Erfolg und keine rote
// Vorpruefung war, in einem Satz zusammen: "SALVAGE-VERSUCH gescheitert". Der Satz
// stand auch ueber einer Session, die committet hatte — und dann las man morgens
// "gescheitert", obwohl die Arbeit im Repo lag.
//
// Unterschieden werden jetzt drei Ausgaenge, und sie verlangen verschiedene Griffe:
//   - kein Commit, Board nicht bewegt   -> gescheitert (der alte Satz, jetzt eng)
//   - Commit, Board nicht bewegt        -> unvollstaendig (der Commit ist da, die Karte nicht)
//   - In review, Baum unsauber          -> widerspruechlich (die Karte luegt)
// Dazu die Reihenfolge im Salvage-Prompt: erst committen, dann `git status
// --porcelain`, und nur bei leerer Ausgabe das Board bewegen.
//
// Wie im uebrigen Nachtlauf-Bestand laeuft das ECHTE kit/night.mjs aus dem Repo
// gegen ein Fixture-Projekt mit lokalem Tracker (KIT_ROOT, Issue #189); die Sessions
// sind `sh`-Fakes ueber NIGHT_CLAUDE_CMD, die sich an NIGHT_SALVAGE erkennen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Die Session-Fakes laufen ueber `sh -c`. Siehe Issue #199." }
  : {};

const VORFLUG_OK = `cat <<'EOF'
<<<VORFLUG
{"reviewers": [], "tracker": {"erreichbar": true, "geprueft": "issue list"}}
VORFLUG>>>
EOF`;

function run(cwd, cliArgs, env = {}) {
  return spawnSync(process.execPath, [NIGHT, ...cliArgs], {
    cwd, encoding: "utf-8",
    env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, NIGHT_VORFLUG_CMD: VORFLUG_OK, ...env },
  });
}

function git(dir, ...args) {
  const res = spawnSync("git", args, { cwd: dir, encoding: "utf-8" });
  assert.equal(res.status, 0, `git ${args.join(" ")} schlug fehl: ${res.stderr}`);
}

function board(dir, ...cliArgs) {
  const res = spawnSync(process.execPath, [join(dir, ".claude", "kit", "board.mjs"), ...cliArgs], {
    cwd: dir, encoding: "utf-8",
    env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: dir },
  });
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
  // Das Textprotokoll bleibt ignoriert; der Ergebnisstand ist ueber die pathspec von
  // gitReste() ohnehin kein Rest und bleibt hier lesbar.
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\n.claude/checks-summary.json\n");
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.invalid");
  git(dir, "config", "user.name", "T");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "setup");
  return dir;
}

function mitProjekt(praefix, fn) {
  const dir = setupProjekt(praefix);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readyIssue(dir, titel = "Ein Paket") {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", "## Abhaengigkeiten\n\nKeine.\n");
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

/** Der Grund, den der harte Stopp an der Einheit der Karte hinterlegt hat. */
function grundDerKarte(dir, id) {
  const dateien = readdirSync(join(dir, ".claude"))
    .filter((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n)).sort();
  assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);
  const stand = JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
  const einheit = stand.einheiten.find((e) => String(e.id) === String(id));
  assert.ok(einheit, `keine Einheit fuer Issue #${id}: ${JSON.stringify(stand.einheiten)}`);
  assert.ok(typeof einheit.grund === "string" && einheit.grund.length > 0, `der Grund fehlt an Einheit #${id}`);
  return einheit.grund;
}

/** Der Kartentext des lokalen Trackers — Kommentare haengt er an die Datei an. */
function kartentext(dir, id) {
  return readFileSync(join(dir, "issues", `${id}.md`), "utf-8");
}

function inReview(dir, id) {
  return board(dir, "issue", "list", "--status", "in_review").some((i) => String(i.id) === String(id));
}

const ARBEIT = 'echo arbeit > "work-$NIGHT_ISSUE_ID.txt"';
const COMMIT = 'git add "work-$NIGHT_ISSUE_ID.txt" && git commit -q -m "salvage (Issue #$NIGHT_ISSUE_ID)"';
const MOVE_IN_REVIEW = 'node "$KIT_ROOT/.claude/kit/board.mjs" issue move "$NIGHT_ISSUE_ID" in_review > /dev/null';

/** Ein Fake, der die regulaere Runde von der Salvage-Session trennt. */
function fake(salvageTeil) {
  return [
    'if [ -n "$NIGHT_SALVAGE" ]; then',
    salvageTeil,
    "else",
    `  ${ARBEIT}`,
    "fi",
  ].join("\n");
}

// ============================================================
// Endzustand 2: Commit, Board nicht bewegt
// ============================================================

test("[night-27] eine Salvage-Session mit Commit ohne Board-Zug meldet UNVOLLSTAENDIG samt Resten", NUR_POSIX, () => {
  mitProjekt("night-salvage-unvoll-", (dir) => {
    const id = readyIssue(dir, "Runde ohne Board-Ergebnis");
    const res = run(dir, ["--label", "none"], {
      NIGHT_CLAUDE_CMD: fake(`  ${COMMIT}\n  echo rest > uebrig.txt`),
    });

    assert.notEqual(res.status, 0, `der unvollstaendige Salvage haette hart stoppen muessen:\n${res.stdout}`);
    assert.match(res.stdout, new RegExp(`SALVAGE UNVOLLSTAENDIG — harter Stopp\\. Issue #${id}: Commit \\w+, Board nicht bewegt`),
      "der Endzustand wird nicht als unvollstaendig benannt");
    assert.match(res.stdout, /uebrig\.txt/, "die liegengebliebene Datei fehlt in der Protokollzeile");
    assert.doesNotMatch(res.stdout, /gescheitert/,
      "die Session hat committet — 'gescheitert' waere das falsche Wort");
    assert.equal(inReview(dir, id), false, "das Board wurde nicht bewegt und darf es auch nicht sein");

    const grund = grundDerKarte(dir, id);
    assert.match(grund, /SALVAGE UNVOLLSTAENDIG — harter Stopp/, `der Satz fehlt im Grund: ${grund}`);
    assert.match(grund, /uebrig\.txt/, `die liegengebliebene Datei fehlt im Grund: ${grund}`);
    assert.match(kartentext(dir, id), /committet, aber Arbeit liegen gelassen und das Board nicht bewegt/,
      "am Paket fehlt der Board-Kommentar zu diesem Endzustand");
  });
});

// ============================================================
// Endzustand 3: In review, aber Baum unsauber
// ============================================================

test("[night-27] eine Salvage-Session, die trotz Resten nach In review zieht, meldet WIDERSPRUECHLICH", NUR_POSIX, () => {
  mitProjekt("night-salvage-widerspruch-", (dir) => {
    const id = readyIssue(dir, "Runde ohne Board-Ergebnis");
    const res = run(dir, ["--label", "none"], {
      NIGHT_CLAUDE_CMD: fake(`  ${COMMIT}\n  ${MOVE_IN_REVIEW}\n  echo rest > uebrig.txt`),
    });

    assert.notEqual(res.status, 0, `der widerspruechliche Salvage haette hart stoppen muessen:\n${res.stdout}`);
    assert.match(res.stdout, new RegExp(`SALVAGE WIDERSPRUECHLICH — harter Stopp\\. Issue #${id} steht in In review, obwohl Arbeit liegen blieb`),
      "der Endzustand wird nicht als widerspruechlich benannt");
    assert.match(res.stdout, /uebrig\.txt/, "die liegengebliebene Datei fehlt in der Protokollzeile");
    assert.doesNotMatch(res.stdout, /gescheitert/,
      "die Karte steht in In review — 'gescheitert' verdeckt den Widerspruch");

    const grund = grundDerKarte(dir, id);
    assert.match(grund, /SALVAGE WIDERSPRUECHLICH — harter Stopp/, `der Satz fehlt im Grund: ${grund}`);
    assert.match(grund, /uebrig\.txt/, `die liegengebliebene Datei fehlt im Grund: ${grund}`);
    assert.match(kartentext(dir, id), /nach In review verschoben, obwohl Arbeit im Working Tree liegen blieb/,
      "am Paket fehlt der Board-Kommentar zu diesem Endzustand");
  });
});

// ============================================================
// Endzustand 1: kein Commit, Board nicht bewegt
// ============================================================

test("[night-27] eine Salvage-Session ohne Commit und ohne Board-Zug bleibt 'gescheitert' und sagt warum", NUR_POSIX, () => {
  mitProjekt("night-salvage-gescheitert-", (dir) => {
    const id = readyIssue(dir, "Runde ohne Board-Ergebnis");
    // Die Salvage-Session tut nichts: kein Commit, kein Board-Zug. Die Arbeit der
    // regulaeren Runde bleibt liegen.
    const res = run(dir, ["--label", "none"], { NIGHT_CLAUDE_CMD: fake("  :") });

    assert.notEqual(res.status, 0, `der gescheiterte Salvage haette hart stoppen muessen:\n${res.stdout}`);
    assert.match(res.stdout, new RegExp(`SALVAGE-VERSUCH gescheitert — harter Stopp\\. Issue #${id}: kein Commit, Board nicht bewegt`),
      "der alte Satz gehoert genau diesem Fall — und er muss sagen, was fehlt");

    const grund = grundDerKarte(dir, id);
    assert.match(grund, /SALVAGE-VERSUCH gescheitert — harter Stopp/, `der Satz fehlt im Grund: ${grund}`);
    assert.match(grund, /kein Commit, Board nicht bewegt/, `die Begruendung fehlt im Grund: ${grund}`);
    assert.match(grund, /work-\d+\.txt/, `die liegengebliebene Datei fehlt im Grund: ${grund}`);
    assert.match(kartentext(dir, id), /weder committet noch das Board bewegt/,
      "am Paket fehlt der Board-Kommentar zu diesem Endzustand");
  });
});

// ============================================================
// Die Reihenfolge im Salvage-Prompt
// ============================================================

test("[night-27] der Salvage-Prompt verlangt `git status --porcelain` vor dem Board-Zug", NUR_POSIX, () => {
  mitProjekt("night-salvage-prompt-", (dir) => {
    readyIssue(dir, "Runde ohne Board-Ergebnis");
    // Der Prompt der Session steht ihr als NIGHT_PROMPT zur Verfuegung (Issue #620) —
    // der Fake legt ihn ab, statt dass der Test die private Funktion aufruft.
    run(dir, ["--label", "none"], {
      NIGHT_CLAUDE_CMD: fake('  printf \'%s\' "$NIGHT_PROMPT" > prompt.txt'),
    });

    const prompt = readFileSync(join(dir, "prompt.txt"), "utf-8");
    const pruefung = prompt.indexOf("git status --porcelain");
    const zug = prompt.indexOf("issue move");
    assert.ok(pruefung >= 0, `der Prompt verlangt keine Sauberkeitspruefung:\n${prompt}`);
    assert.ok(zug >= 0, `der Prompt nennt den Board-Zug nicht:\n${prompt}`);
    assert.ok(pruefung < zug,
      `die Sauberkeitspruefung steht hinter dem Board-Zug — genau die Reihenfolge, die #248 gekostet hat:\n${prompt}`);
  });
});
