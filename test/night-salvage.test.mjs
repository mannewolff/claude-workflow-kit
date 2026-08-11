// E2E fuer den Salvage-Pfad (Issue #167).
//
// Ausgangslage: Eine Nacht-Session startet einen langen Check im Hintergrund,
// kuendigt an das Ergebnis abzuwarten und beendet trotzdem ihren Turn — eine
// headless -p-Session hat keinen Folge-Turn, das Ergebnis geht verloren. Das
// Board zeigt einen Fehlschlag, obwohl die Arbeit fertig ist (kanban-kit #438,
// #436, #443 am 2026-07-27). Der Runner faengt das jetzt ab: bevor er bei
// "nicht in In review UND dirty" hart stoppt, verifiziert er die buildChecks
// selbst. Sind sie gruen, bekommt genau eine Salvage-Session die Chance, den
// Zwischenstand gegen das Issue zu pruefen, zu committen und das Board zu
// bewegen.
//
// Laeuft komplett lokal: issueTracker "local" in einem Temp-Repo, Session-Fake
// via NIGHT_CLAUDE_CMD. Der Fake unterscheidet die Salvage-Session an der
// Umgebungsvariablen NIGHT_SALVAGE.

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

// buildChecks ist der Hebel dieses Tests: "true" simuliert gruene Pflichtchecks
// (die Arbeit ist inhaltlich fertig), "false" rote (die Session ist wirklich
// gescheitert).
function setupProjekt(buildChecks, extraConfig = {}) {
  const dir = mkdtempSync(join(tmpdir(), "night-salvage-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    buildChecks,
    local: { issuesDir: "issues" },
    ...extraConfig,
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\nsessions.log\nfixcount.log\n");
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

// Session-Fake: die regulaere Runde hinterlaesst unkommittete Arbeit und bewegt
// das Board NICHT — genau das Schadensbild der drei Vorfaelle. Die Datei traegt
// die Issue-ID im Namen, damit jede Runde den Tree wirklich dirty macht (gleicher
// Inhalt in derselben Datei waere nach dem ersten Commit wieder sauber).
function fakeSession(sessionLog, salvageBody) {
  return `echo "$NIGHT_ISSUE_ID" >> ${JSON.stringify(sessionLog)}\n`
    + `if [ -n "$NIGHT_SALVAGE" ]; then\n`
    + `  echo "salvage $NIGHT_ISSUE_ID" >> ${JSON.stringify(sessionLog)}\n`
    + `  ${salvageBody}\n`
    + `else\n`
    + `  echo arbeit > "work-$NIGHT_ISSUE_ID.txt"\n`
    + `fi\n`;
}

test("Salvage: rote buildChecks lassen das heutige Hard-Stop-Verhalten unveraendert", NUR_POSIX, () => {
  const dir = setupProjekt(["false"]);
  try {
    const erstes = board(dir, "issue", "create", "--title", "Erstes Issue", "--body", "## Abhaengigkeiten\nKeine.");
    const zweites = board(dir, "issue", "create", "--title", "Zweites Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(erstes.id), "ready");
    board(dir, "issue", "move", String(zweites.id), "ready");

    const sessionLog = join(dir, "sessions.log");
    const fake = fakeSession(sessionLog, "true");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"],
      { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 1, `night.mjs haette hart stoppen muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /FEHLSCHLAG[\s\S]*Working Tree dirty/,
      "die bestehende Fehlschlag-Meldung fehlt");
    assert.doesNotMatch(res.stdout, /SALVAGE-VERSUCH gestartet/,
      "bei roten Checks darf keine Salvage-Session starten");
    // Ohne formatFixCommand bleibt der Format-Fix-Pfad komplett aus (Issue #169).
    assert.doesNotMatch(res.stdout, /FORMAT-FIX/,
      "ohne formatFixCommand darf kein Format-Fix versucht werden");

    // Nur die regulaere Session lief, das Issue blieb liegen (kein Backlog-Move).
    const sessions = readFileSync(sessionLog, "utf-8").trim().split("\n");
    assert.deepEqual(sessions, [String(erstes.id)], "es lief nicht genau eine Session");
    const ready = board(dir, "issue", "list", "--status", "ready").map((i) => String(i.id));
    assert.ok(ready.includes(String(zweites.id)), "zweites Issue haette in Ready bleiben muessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Salvage: gruene buildChecks + erfolgreiche Salvage-Session setzen den Lauf fort", NUR_POSIX, () => {
  const dir = setupProjekt(["true"]);
  try {
    const erstes = board(dir, "issue", "create", "--title", "Erstes Issue", "--body", "## Abhaengigkeiten\nKeine.");
    const zweites = board(dir, "issue", "create", "--title", "Zweites Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(erstes.id), "ready");
    board(dir, "issue", "move", String(zweites.id), "ready");

    const sessionLog = join(dir, "sessions.log");
    // Die Salvage-Session tut, was der Prompt verlangt: committen und das Board bewegen.
    const fake = fakeSession(sessionLog,
      `git add -A && git commit -q -m "salvage (Issue #$NIGHT_ISSUE_ID)"`
      + ` && node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null`);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"],
      { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /SALVAGE-VERSUCH gestartet \(Checks extern verifiziert gruen\)/,
      "die Salvage-Startzeile fehlt");
    assert.doesNotMatch(res.stdout, /SALVAGE-VERSUCH gescheitert/,
      "der Salvage war erfolgreich, darf also nicht als gescheitert gemeldet werden");

    // Beide Issues gerettet, der Lauf lief bis zum Ende durch.
    const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id));
    assert.ok(inReview.includes(String(erstes.id)) && inReview.includes(String(zweites.id)),
      `beide Issues haetten in In review landen muessen, sind aber: ${inReview.join(", ")}`);
    const log = readFileSync(sessionLog, "utf-8");
    assert.match(log, new RegExp(`salvage ${erstes.id}`), "fuer das erste Issue lief keine Salvage-Session");
    assert.match(log, new RegExp(`salvage ${zweites.id}`), "fuer das zweite Issue lief keine Salvage-Session");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Salvage: env-Block aus .claude/settings.json wird beim Vorpruefen der buildChecks gemergt", NUR_POSIX, () => {
  // buildChecks besteht nur, wenn die Variable ankommt — belegt, dass
  // runBuildChecksSync sie aus settings.json mergt statt nur process.env zu
  // erben (kanban-kit #445: DOCKER_HOST/TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE
  // fehlten sonst, weil night.mjs ausserhalb von Claude Code laeuft).
  const dir = setupProjekt(['test "$NIGHT_TEST_ENV_VAR" = "hello-from-settings"']);
  try {
    writeFileSync(join(dir, ".claude", "settings.json"),
      JSON.stringify({ env: { NIGHT_TEST_ENV_VAR: "hello-from-settings" } }, null, 2));
    // Committen, sonst meldet der gitClean()-Vorflug-Check faelschlich einen
    // dirty Tree, noch bevor ueberhaupt eine Runde startet.
    run(dir, "git", ["add", "-A"]);
    run(dir, "git", ["commit", "-q", "-m", "settings.json ergaenzt"]);

    const erstes = board(dir, "issue", "create", "--title", "Erstes Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(erstes.id), "ready");

    const sessionLog = join(dir, "sessions.log");
    const fake = fakeSession(sessionLog,
      `git add -A && git commit -q -m "salvage (Issue #$NIGHT_ISSUE_ID)"`
      + ` && node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null`);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"],
      { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, /Salvage nicht moeglich: buildChecks sind rot/,
      "die settings.json-Variable haette die buildChecks gruen machen muessen");
    assert.match(res.stdout, /SALVAGE-VERSUCH gestartet \(Checks extern verifiziert gruen\)/,
      "die Salvage-Startzeile fehlt");

    const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id));
    assert.ok(inReview.includes(String(erstes.id)), "Issue haette in In review landen muessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Fuehrt einen Salvage-Lauf mit vorgegebenen settings-Dateien aus und liefert das
// Runner-Ergebnis. Geteilt von den beiden settings.local.json-Faellen (Issue #168).
function laufMitSettings(erwarteterWert, dateien) {
  const dir = setupProjekt([`test "$NIGHT_TEST_ENV_VAR" = "${erwarteterWert}"`]);
  try {
    for (const [name, env] of Object.entries(dateien)) {
      writeFileSync(join(dir, ".claude", name), JSON.stringify({ env }, null, 2));
    }
    // Committen, sonst meldet der gitClean()-Vorflug-Check faelschlich dirty.
    run(dir, "git", ["add", "-A"]);
    run(dir, "git", ["commit", "-q", "-m", "settings ergaenzt"]);

    const erstes = board(dir, "issue", "create", "--title", "Erstes Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(erstes.id), "ready");

    const fake = fakeSession(join(dir, "sessions.log"),
      `git add -A && git commit -q -m "salvage (Issue #$NIGHT_ISSUE_ID)"`
      + ` && node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null`);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"],
      { NIGHT_CLAUDE_CMD: fake });
    const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id));
    return { res, geretttet: inReview.includes(String(erstes.id)) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("Salvage: env-Block aus .claude/settings.local.json wird ebenfalls gemergt", NUR_POSIX, () => {
  // settings.local.json ist gitignored und damit der uebliche Ort fuer
  // maschinenspezifische Werte (z. B. ein Colima-Socket-Pfad). Claude Code liest
  // beide Dateien — die Vorpruefung muss das auch tun (Issue #168).
  const { res, geretttet } = laufMitSettings("from-local", {
    "settings.local.json": { NIGHT_TEST_ENV_VAR: "from-local" },
  });

  assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
  assert.doesNotMatch(res.stdout, /Salvage nicht moeglich: buildChecks sind rot/,
    "die Variable aus settings.local.json haette die buildChecks gruen machen muessen");
  assert.ok(geretttet, "Issue haette in In review landen muessen");
});

test("Salvage: settings.local.json gewinnt gegen settings.json (gleiche Precedence wie Claude Code)", NUR_POSIX, () => {
  const { res, geretttet } = laufMitSettings("from-local", {
    "settings.json": { NIGHT_TEST_ENV_VAR: "from-shared" },
    "settings.local.json": { NIGHT_TEST_ENV_VAR: "from-local" },
  });

  assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
  assert.doesNotMatch(res.stdout, /Salvage nicht moeglich: buildChecks sind rot/,
    "bei gleichem Schluessel haette der Wert aus settings.local.json gewinnen muessen");
  assert.ok(geretttet, "Issue haette in In review landen muessen");
});

test("Salvage: gescheiterte Salvage-Session stoppt hart mit eigener Log-Zeile", NUR_POSIX, () => {
  const dir = setupProjekt(["true"]);
  try {
    const erstes = board(dir, "issue", "create", "--title", "Erstes Issue", "--body", "## Abhaengigkeiten\nKeine.");
    const zweites = board(dir, "issue", "create", "--title", "Zweites Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(erstes.id), "ready");
    board(dir, "issue", "move", String(zweites.id), "ready");

    const sessionLog = join(dir, "sessions.log");
    // Die Salvage-Session laesst den Stand liegen (Diff passt nicht zum Issue).
    const fake = fakeSession(sessionLog, "true");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"],
      { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 1, `night.mjs haette hart stoppen muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /SALVAGE-VERSUCH gestartet \(Checks extern verifiziert gruen\)/,
      "die Salvage-Startzeile fehlt");
    assert.match(res.stdout, /SALVAGE-VERSUCH gescheitert/,
      "der Salvage-Fehlschlag braucht eine eigene, unterscheidbare Log-Zeile");

    // Genau eine Salvage-Session fuer dieses Issue, danach Stopp.
    const log = readFileSync(sessionLog, "utf-8").trim().split("\n");
    assert.deepEqual(log, [String(erstes.id), String(erstes.id), `salvage ${erstes.id}`],
      `erwartet: regulaere Runde + genau eine Salvage-Runde, tatsaechlich: ${log.join(" / ")}`);
    const ready = board(dir, "issue", "list", "--status", "ready").map((i) => String(i.id));
    assert.ok(ready.includes(String(zweites.id)), "zweites Issue haette in Ready bleiben muessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Format-Fix (Issue #169) ---
//
// Beobachtet bei kanban-kit#463: ein einzelner Javadoc-Zeilenumbruch liess
// Spotless rot laufen und stoppte damit einen ganzen Nachtlauf, obwohl die
// Arbeit vollstaendig war. Ein Formatverstoss ist mechanisch und deterministisch
// behebbar und sagt nichts ueber die fachliche Qualitaet — er darf einen Lauf
// mit zwanzig wartenden Issues nicht beenden. Rote Checks mit inhaltlicher
// Aussage (Testfehler, Lint) bleiben unveraendert ein harter Stopp.

test("Format-Fix: erst rote, nach dem Format-Kommando gruene Checks retten den Lauf", NUR_POSIX, () => {
  // Der buildCheck besteht erst, wenn die Marker-Datei existiert — das
  // formatFixCommand legt sie an. Damit ist "erst rot, nach dem Fix gruen"
  // deterministisch nachgestellt.
  const dir = setupProjekt(["test -f fixed.marker"], { formatFixCommand: "touch fixed.marker" });
  try {
    const erstes = board(dir, "issue", "create", "--title", "Erstes Issue", "--body", "## Abhaengigkeiten\nKeine.");
    const zweites = board(dir, "issue", "create", "--title", "Zweites Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(erstes.id), "ready");
    board(dir, "issue", "move", String(zweites.id), "ready");

    const sessionLog = join(dir, "sessions.log");
    const fake = fakeSession(sessionLog,
      `git add -A && git commit -q -m "salvage (Issue #$NIGHT_ISSUE_ID)"`
      + ` && node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null`);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"],
      { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /FORMAT-FIX angewendet, buildChecks jetzt gruen/,
      "der angewendete Format-Fix muss im Protokoll sichtbar sein");
    assert.match(res.stdout, /SALVAGE-VERSUCH gestartet/, "der Salvage haette danach laufen muessen");

    // Beide Issues gerettet: der Lauf wurde fortgesetzt statt gestoppt.
    const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id));
    assert.ok(inReview.includes(String(erstes.id)) && inReview.includes(String(zweites.id)),
      `beide Issues haetten in In review landen muessen, sind aber: ${inReview.join(", ")}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Format-Fix: hilft er nicht, bleibt es beim harten Stopp — und er lief genau einmal", NUR_POSIX, () => {
  // Das Format-Kommando protokolliert jeden Aufruf, die Checks bleiben rot.
  // Belegt zugleich: keine Schleife, genau ein Versuch.
  const dir = setupProjekt(["false"], { formatFixCommand: "echo lauf >> fixcount.log" });
  try {
    const erstes = board(dir, "issue", "create", "--title", "Erstes Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(erstes.id), "ready");

    const sessionLog = join(dir, "sessions.log");
    const fake = fakeSession(sessionLog, "true");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"],
      { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 1, `night.mjs haette hart stoppen muessen: ${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, /FORMAT-FIX angewendet/,
      "der Fix hat nicht geholfen, darf also nicht als erfolgreich gemeldet werden");
    assert.match(res.stdout, /FEHLSCHLAG[\s\S]*Working Tree dirty/, "die bestehende Fehlschlag-Meldung fehlt");

    const laeufe = readFileSync(join(dir, "fixcount.log"), "utf-8").trim().split("\n");
    assert.equal(laeufe.length, 1, `das Format-Kommando lief ${laeufe.length}x statt genau einmal`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
