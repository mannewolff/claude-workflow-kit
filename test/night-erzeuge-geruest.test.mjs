// Das Geruest des Erzeugungsmodus (Issue #518).
//
// Geprueft wird hier nur der Rahmen, nicht die Arbeit: der Zweig in main(), der
// Tracker-Guard, der Vorflug und die Ausnahme von der buildChecks-Pflicht. Die
// Kandidatenauswahl (Issue #519) und die Schleife (Issue #520) fehlen noch —
// laufeErzeugungsModus arbeitet vorerst mit einer leeren Liste und endet mit
// "Keine Erzeugungs-Kandidaten".
//
// Der Guard ist der Grund, warum es diese Datei ueberhaupt gibt: Steht der Tracker auf
// `toolbox` und ist `toolbox.ideaStored` gesetzt, legt `issue create` eine Pool-Idee ohne
// Kartennummer an. Das Erfolgssignal der Nacht faende nichts, das Routing-Label bliebe
// stehen, und die naechste Nacht legte eine zweite Idee an. Deshalb bricht der Lauf ab,
// bevor er eine Vorflug-Session kostet.
//
// Wie in den uebrigen night-Tests laeuft das ECHTE kit/night.mjs gegen ein Fixture
// (cwd + KIT_ROOT); der Vorflug ist ueber NIGHT_VORFLUG_CMD gefaked (Muster
// test/night-review-vorflug.test.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");
const BOARD = join(repoRoot, "kit", "board.mjs");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Die Fakes laufen ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

const OPUS = { name: "opus", kind: "claude", model: "claude-opus-5" };
const FREMD = { name: "fremd", kind: "command", command: "reviewer-fake" };

/** Fake fuer die Vorflug-Session: protokolliert seinen Start und gibt den Befund aus. */
function vorflugFake(reviewers = [{ name: "fremd", verfuegbar: true }]) {
  return `echo vorflug >> vorflug-lief; cat <<'EOF'
<<<VORFLUG
${JSON.stringify({ reviewers, tracker: { erreichbar: true, geprueft: "issue list" } })}
VORFLUG>>>
EOF`;
}

const VORFLUG_OK = vorflugFake();
const VORFLUG_REVIEWER_TOT = vorflugFake([{ name: "fremd", verfuegbar: false, grund: "Run outside of the sandbox" }]);

// Zeuge dafuer, ob nach dem Vorflug noch irgendeine Session startete.
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
      NIGHT_CLAUDE_CMD: SESSION_FAKE,
      ...env,
    },
  });
}

/**
 * Ersatz-board.mjs fuer die Toolbox-Fixtures.
 *
 * Der echte Adapter spraeche mit einem Host; hier geht es allein darum, welche Config
 * night.mjs liest. Der Stub beantwortet jedes `issue list` mit einer leeren Liste und
 * traegt dieselbe KIT_VERSION wie das Original, damit die Drift-Warnung schweigt.
 */
function boardStub() {
  const version = readFileSync(BOARD, "utf-8").match(/const KIT_VERSION = "([^"]*)";/)[1];
  return `const KIT_VERSION = "${version}";\nvoid KIT_VERSION;\nconsole.log("[]");\n`;
}

function setupProjekt({ tracker = "local", ideaStored = null, buildChecks = ["true"], reviewers = [OPUS, FREMD] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "night-erzeuge-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  mkdirSync(join(dir, "bin"), { recursive: true });
  if (tracker === "toolbox") {
    writeFileSync(join(dir, ".claude", "kit", "board.mjs"), boardStub(), "utf-8");
  } else {
    copyFileSync(BOARD, join(dir, ".claude", "kit", "board.mjs"));
  }

  const skript = join(dir, "bin", "reviewer-fake");
  writeFileSync(skript, '#!/bin/sh\ncat > /dev/null\necho OK\n', { mode: 0o755 });

  const config = {
    codeHost: "local", issueTracker: tracker, buildChecks,
    local: { issuesDir: "issues" }, issueReview: { reviewers },
  };
  // Ein Toolbox-Block ohne ideaStored ist der Normalfall; das Feld faellt nur dann in
  // die Config, wenn der Test es setzt — "fehlendes Feld" ist ein eigener Fall.
  if (ideaStored !== null) config.toolbox = { host: "https://kanban.invalid", ideaStored };
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(config, null, 2));

  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\nvorflug-lief\nsession-lief\nbin/\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    assert.equal(run(dir, "git", a).status, 0);
  }
  return dir;
}

function mitProjekt(fn, optionen) {
  const dir = setupProjekt(optionen);
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

function erzeuge(dir, extraArgs = [], env = {}) {
  return run(dir, process.execPath, [NIGHT, "--erzeuge", "--stufe", "plan", ...extraArgs], env);
}

// --- Der Zweig in main() ---

test("--erzeuge --stufe plan --dry-run laeuft durch und endet ohne Kandidaten", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = erzeuge(dir, ["--dry-run"]);

    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.match(res.stdout, /Keine Erzeugungs-Kandidaten \(Stufe plan\) — nichts zu tun\./);
    assert.doesNotMatch(res.stdout + res.stderr, /Schleife folgt in Issue #518/,
      "die Uebergangsmeldung aus Issue #517 muss durch den echten Zweig ersetzt sein");
    assert.equal(zeilen(dir, "vorflug-lief").length, 1, "genau eine Vorflug-Session, auch im Dry-Run");
    assert.equal(existsSync(join(dir, "session-lief")), false, "der Dry-Run hat eine Erzeugungs-Session gestartet");
  });
});

// --- Der Vorflug: harter Stopp im Ernstfall, Bericht im Dry-Run ---

test("ein in der Session fehlender Reviewer stoppt den Erzeugungslauf hart", NUR_POSIX, () => {
  // Dieselbe Begruendung wie im Review-Modus: Die spaetere Pruefschleife faehrt dieselben
  // /issue-review-Sessions, und ein unterbesetzter Lauf sieht am Board aus wie ein
  // vollstaendiger.
  mitProjekt((dir) => {
    const res = erzeuge(dir, [], { NIGHT_VORFLUG_CMD: VORFLUG_REVIEWER_TOT });

    assert.notEqual(res.status, 0);
    assert.match(res.stdout + res.stderr, /Reviewer in der Session nicht verfuegbar: fremd/);
    assert.equal(existsSync(join(dir, "session-lief")), false, "es lief eine Session trotz totem Reviewer");
    assert.equal(zeilen(dir, "vorflug-lief").length, 1, "genau eine Vorflug-Session, danach Schluss");
  });
});

test("derselbe Befund bricht den Dry-Run nicht ab, sondern wird berichtet", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = erzeuge(dir, ["--dry-run"], { NIGHT_VORFLUG_CMD: VORFLUG_REVIEWER_TOT });

    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.match(res.stdout, /fremd \(command\) in review-session: NICHT verfuegbar/);
    assert.equal(existsSync(join(dir, "session-lief")), false);
  });
});

// --- Der Tracker-Guard ---

test("[night-7] toolbox mit ideaStored: true weist den Lauf ab, bevor der Vorflug startet", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = erzeuge(dir);

    assert.notEqual(res.status, 0);
    assert.match(res.stdout + res.stderr, /ideaStored/);
    assert.equal(zeilen(dir, "vorflug-lief").length, 0,
      "der Guard sitzt vor dem Vorflug — ein abgewiesener Lauf darf keine Session kosten");
  }, { tracker: "toolbox", ideaStored: true });
});

test("[night-7] der Guard greift auch im Dry-Run", NUR_POSIX, () => {
  // Sonst pruefte der Trockenlauf etwas anderes als der Ernstfall.
  mitProjekt((dir) => {
    const res = erzeuge(dir, ["--dry-run"]);

    assert.notEqual(res.status, 0);
    assert.match(res.stdout + res.stderr, /ideaStored/);
  }, { tracker: "toolbox", ideaStored: true });
});

test("[night-7] toolbox mit ideaStored: false und ohne das Feld laufen durch", NUR_POSIX, () => {
  for (const ideaStored of [false, null]) {
    mitProjekt((dir) => {
      const res = erzeuge(dir, ["--dry-run"]);

      assert.equal(res.status, 0, `ideaStored: ${JSON.stringify(ideaStored)} -> ${res.stderr}${res.stdout}`);
      assert.doesNotMatch(res.stdout + res.stderr, /ideaStored/);
    }, { tracker: "toolbox", ideaStored });
  }
});

test("[night-7] bei einem anderen Tracker ist ideaStored wirkungslos", NUR_POSIX, () => {
  // board.mjs wertet das Feld nur im Toolbox-Adapter aus. Ein local-Projekt mit
  // liegengebliebenem toolbox-Block wuerde sonst grundlos gestoppt.
  mitProjekt((dir) => {
    const res = erzeuge(dir, ["--dry-run"]);

    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.match(res.stdout, /Keine Erzeugungs-Kandidaten \(Stufe plan\)/);
  }, { tracker: "local", ideaStored: true });
});

// --- Die buildChecks-Pflicht ---

test("[night-7] ohne buildChecks laeuft der Erzeugungsmodus, die Implementierung nicht", NUR_POSIX, () => {
  // Ein Lauf, der nichts baut und nichts committet, braucht kein Build-Gate. Fuer die
  // Implementierung bleibt es Pflicht — das ist der Rueckwaertskompatibilitaets-Fall.
  mitProjekt((dir) => {
    const erz = erzeuge(dir, ["--dry-run"]);
    assert.equal(erz.status, 0, erz.stderr + erz.stdout);

    const impl = run(dir, process.execPath, [NIGHT, "--dry-run"]);
    assert.notEqual(impl.status, 0, "die Implementierung darf ohne buildChecks weiterhin nicht starten");
    assert.match(impl.stdout + impl.stderr, /buildChecks in workflow\.config\.json ist leer/);
  }, { buildChecks: [] });
});
