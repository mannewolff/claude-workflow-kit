// Verbleibende Wege im Nacht-Runner (Issue #405).
//
// Drei Gruppen, die die Bestandsdateien nicht erreichen:
//
// 1. `--version`. Die Auskunft muss auch dann funktionieren, wenn nichts daneben
//    liegt (Issue #170) — genau dort will man wissen, aus welchem Kit-Stand eine
//    gefundene Datei stammt.
// 2. Die persoenlichen Config-Overrides. Bisher war nur belegt, dass ein teamweites
//    Feld ignoriert wird; dass die ERLAUBTEN wirken, stand nirgends — und ein
//    Override, der still nichts tut, ist schlimmer als keiner.
// 3. Die echte Kommandozeile der Vorflug-Session. Alle Bestandstests fahren ueber
//    den Test-Hook NIGHT_VORFLUG_CMD; welches Kommando der Runner OHNE Hook baut,
//    war damit nie geprueft. Genau daran haengt aber, mit welchen Freigaben die
//    Session laeuft.

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
  ? { skip: "Windows: Die Fakes laufen ueber `sh -c` bzw. als endungslose Skripte. Siehe Issue #199." }
  : {};

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, {
    cwd, encoding: "utf-8",
    env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, PATH: `${join(cwd, "bin")}:${process.env.PATH}`, ...env },
  });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt(config = {}, praefix = "night-luecken-") {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  mkdirSync(join(dir, "bin"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" }, ...config,
  }, null, 2));
  // Die persoenliche Config gehoert nie ins Repository (Issue #207) — im Fixture
  // wird sie erst nach dem Setup-Commit angelegt, und ohne diesen Eintrag stoppt der
  // Runner an seiner eigenen gitClean-Vorbedingung.
  writeFileSync(join(dir, ".gitignore"),
    ".claude/night-run-*.log\n.claude/workflow.config.local.json\nbin/\nclaude-aufruf\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    assert.equal(run(dir, "git", a).status, 0, `git ${a.join(" ")} schlug fehl`);
  }
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

// ============================================================
// Auskunft ohne Projekt
// ============================================================

test("--version nennt die Kit-Version und beantwortet sie ohne Projekt", () => {
  // Bewusst im Temp-Verzeichnis, ohne .claude und ohne board.mjs: Die Zusage aus
  // Issue #170 gilt genau dort, wo die Datei allein liegt.
  const dir = mkdtempSync(join(tmpdir(), "night-version-"));
  try {
    const res = spawnSync(process.execPath, [NIGHT, "--version"], { cwd: dir, encoding: "utf-8" });

    assert.equal(res.status, 0, `--version haette mit 0 enden muessen: ${res.stderr}`);
    assert.match(res.stdout, /^night\.mjs \(claude-workflow-kit v\d+\.\d+\.\d+\)\n$/,
      "die Auskunft nennt die Kit-Version nicht in der erwarteten Form");
    // Die Version stammt aus dem Stempel von tools/sync-blobs.mjs und muss zur
    // Quelle passen — sonst meldet eine kopierte Datei einen fremden Stand.
    const stand = /const KIT_VERSION = "([^"]*)";/.exec(readFileSync(NIGHT, "utf-8"))[1];
    assert.ok(res.stdout.includes(`v${stand}`), "die gemeldete Version weicht vom Stempel der Datei ab");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// Persoenliche Overrides
// ============================================================

test("ein erlaubtes Feld aus workflow.config.local.json wirkt", NUR_POSIX, () => {
  mitProjekt((dir) => {
    writeFileSync(join(dir, ".claude", "workflow.config.local.json"),
      JSON.stringify({ reviewModel: "persoenliches-modell" }), "utf-8");

    const res = run(dir, process.execPath, [NIGHT, "--dry-run", "--label", "none"]);

    assert.equal(res.status, 0, `Dry-Run schlug fehl: ${res.stderr}`);
    assert.doesNotMatch(res.stderr, /reviewModel.*ignoriert/,
      "ein erlaubtes Feld darf nicht als teamweit abgewiesen werden");
  });
});

test("toolbox.tokenFile gewinnt lokal, die uebrigen toolbox-Felder bleiben teamweit", NUR_POSIX, () => {
  mitProjekt((dir) => {
    writeFileSync(join(dir, ".claude", "workflow.config.local.json"), JSON.stringify({
      toolbox: { tokenFile: ".claude/mein-token", host: "https://privat.example" },
    }), "utf-8");

    const res = run(dir, process.execPath, [NIGHT, "--dry-run", "--label", "none"]);

    assert.equal(res.status, 0, `Dry-Run schlug fehl: ${res.stderr}`);
    // Genau ein Hinweis: der Host. tokenFile ist als Blattfeld freigegeben.
    assert.match(res.stderr, /'toolbox\.host' aus workflow\.config\.local\.json wird ignoriert/,
      "der teamweite Host wurde nicht abgewiesen");
    assert.doesNotMatch(res.stderr, /toolbox\.tokenFile.*ignoriert/,
      "tokenFile ist persoenlich und darf nicht abgewiesen werden");
  }, { toolbox: { host: "https://team.example" } }, "night-luecken-blatt-");
});

test("ein unbekanntes Feld aus der lokalen Datei wird namentlich abgewiesen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    writeFileSync(join(dir, ".claude", "workflow.config.local.json"),
      JSON.stringify({ mainBranch: "mein-branch" }), "utf-8");

    const res = run(dir, process.execPath, [NIGHT, "--dry-run", "--label", "none"]);

    assert.equal(res.status, 0, `Dry-Run schlug fehl: ${res.stderr}`);
    assert.match(res.stderr, /'mainBranch' aus workflow\.config\.local\.json wird ignoriert/,
      "das teamweite Feld wurde nicht namentlich abgewiesen");
  });
});

// ============================================================
// Die Kommandozeile der Vorflug-Session
// ============================================================

/**
 * Ein Fake-`claude` im PATH, das seine Argumente protokolliert.
 *
 * Ohne NIGHT_VORFLUG_CMD baut der Runner die Kommandozeile selbst — dieser Zweig ist
 * der Ernstfall, und er entscheidet, mit welchen Freigaben die Session laeuft.
 */
function fakeClaude(dir) {
  const p = join(dir, "bin", "claude");
  // Bewusst OHNE `cat`: Der Runner uebergibt den Prompt als Argument und schliesst
  // stdin nicht. Ein Fake, das stdin liest, wartet bis zum Zeitlimit — fuenf Minuten
  // je Test.
  writeFileSync(p, [
    "#!/bin/sh",
    String.raw`printf "%s\n" "$@" >> "$KIT_ROOT/claude-aufruf"`,
    // Kein auswertbarer Befund: Der Vorflug meldet das, und der Dry-Run laeuft weiter.
    "echo nichts",
    "",
  ].join("\n"), { mode: 0o755 });
}

function vorflugArgumente(dir) {
  const p = join(dir, "claude-aufruf");
  return existsSync(p) ? readFileSync(p, "utf-8").trim().split("\n") : [];
}

test("ohne Test-Hook startet der Vorflug 'claude' mit acceptEdits", NUR_POSIX, () => {
  mitProjekt((dir) => {
    fakeClaude(dir);
    board(dir, "issue", "create", "--title", "Backlog-Issue", "--body", "## Kontext\n\nAutor-Modell: m\n\n## Abhaengigkeiten\n\nKeine.\n");

    const res = run(dir, process.execPath, [NIGHT, "--review", "--dry-run", "--review-label", "none"],
      { NIGHT_VORFLUG_CMD: "", NIGHT_VORFLUG_TIMEOUT_MS: "20000" });

    assert.equal(res.status, 0, `der Review-Dry-Run haette mit 0 enden muessen: ${res.stderr}${res.stdout}`);
    const argumente = vorflugArgumente(dir);
    assert.ok(argumente.length > 0, "das Vorflug-Kommando wurde gar nicht gestartet");
    assert.ok(argumente.includes("--permission-mode") && argumente.includes("acceptEdits"),
      `ohne --yolo muss der Vorflug mit acceptEdits laufen: ${argumente.join(" ")}`);
    assert.ok(!argumente.includes("--dangerously-skip-permissions"),
      "ohne --yolo darf kein Permission-Check umgangen werden");
    assert.ok(argumente.includes("--model") && argumente.includes("haiku"),
      "der Vorflug laeuft in einem eigenen, billigen Modell — nicht im Modell des Laufs");
  }, {}, "night-luecken-vorflug-");
});

test("mit --yolo umgeht die Vorflug-Session die Permission-Checks", NUR_POSIX, () => {
  mitProjekt((dir) => {
    fakeClaude(dir);
    board(dir, "issue", "create", "--title", "Backlog-Issue", "--body", "## Kontext\n\nAutor-Modell: m\n\n## Abhaengigkeiten\n\nKeine.\n");

    const res = run(dir, process.execPath, [NIGHT, "--review", "--dry-run", "--review-label", "none", "--yolo"],
      { NIGHT_VORFLUG_CMD: "", NIGHT_VORFLUG_TIMEOUT_MS: "20000" });

    assert.equal(res.status, 0, `der Review-Dry-Run haette mit 0 enden muessen: ${res.stderr}${res.stdout}`);
    const argumente = vorflugArgumente(dir);
    assert.ok(argumente.includes("--dangerously-skip-permissions"),
      `mit --yolo muessen die Permission-Checks umgangen werden: ${argumente.join(" ")}`);
    assert.ok(!argumente.includes("--permission-mode"),
      "beide Freigabe-Formen zugleich waeren widerspruechlich");
  }, {}, "night-luecken-yolo-");
});

test("ohne konfigurierten Reviewer nennt der Vorflug den Config-Block als Abhilfe", NUR_POSIX, () => {
  mitProjekt((dir) => {
    fakeClaude(dir);
    board(dir, "issue", "create", "--title", "Backlog-Issue", "--body", "## Kontext\n\nAutor-Modell: m\n\n## Abhaengigkeiten\n\nKeine.\n");

    const res = run(dir, process.execPath, [NIGHT, "--review", "--dry-run", "--review-label", "none"],
      { NIGHT_VORFLUG_CMD: "", NIGHT_VORFLUG_TIMEOUT_MS: "20000" });

    // Die Abhilfe ist hier eine andere als bei einem ausgefallenen Reviewer: nicht
    // "Werkzeug installieren", sondern "Block uebernehmen".
    assert.match(res.stdout, /Kein Reviewer konfiguriert/, "der leere Reviewer-Block wird nicht gemeldet");
    assert.match(res.stdout, /workflow\.config\.example\.json/,
      "die Meldung nennt nicht, woher der Block zu uebernehmen ist");
  }, { issueReview: { reviewers: [] } }, "night-luecken-ohne-reviewer-");
});
