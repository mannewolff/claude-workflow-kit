// Ablauf-Pruefung: Die Rettung einer Runde ordnet der Einstieg an (versucheSalvage in kit/night.mjs) — Vorpruefung ueber das echte checks.mjs, Salvage-Session, Board und Stash greifen erst im Lauf des Runners ineinander.
//
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
//
// Seit Issue #1229 steht hier nur, was den Lauf des Runners braucht. Die Vorpruefung selbst
// (Aufruf von checks.mjs, Format-Fix, settings-Umgebung) pruefen
// test/night-session-salvage.test.mjs im selben Prozess.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Ein eigener Sperrpfad je Testprozess (Issue #958): Dieser Test faehrt das echte
// kit/checks.mjs, und ohne eigenen Pfad serialisierte die maschinenweite Sperre die
// parallelen Testdateien gegeneinander.
import "./helpers/checks-sperre.mjs";
import { lfAttribute } from "./helpers/zeilenenden.mjs";

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
  cpSync(join(repoRoot, "kit", "board"), join(dir, ".claude", "kit", "board"), { recursive: true });
  // Die Salvage-Vorpruefung faehrt seit Issue #919 `checks.mjs run` im Zielprojekt,
  // damit sie denselben Nachweis hinterlaesst, den das Commit-Gate liest. Ohne die
  // Datei im Fixture gaebe es keine Pflicht-Pruefung und damit keinen Rettungsversuch.
  copyFileSync(join(repoRoot, "kit", "checks.mjs"), join(dir, ".claude", "kit", "checks.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    buildChecks,
    local: { issuesDir: "issues" },
    ...extraConfig,
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\nsessions.log\nfixcount.log\nchecklauf.log\n");
  lfAttribute(join(dir, ".gitattributes"));
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

test("Salvage: rote buildChecks starten keine Rettung — die Reste gehen in den Stash, der Lauf geht weiter (Issue #1089)", () => {
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

    assert.equal(res.status, 0, `ein gescheitertes Paket haelt nur sich an (E14): ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /FEHLSCHLAG[\s\S]*Working Tree dirty/,
      "die bestehende Fehlschlag-Meldung fehlt");
    assert.doesNotMatch(res.stdout, /SALVAGE-VERSUCH gestartet/,
      "bei roten Checks darf keine Salvage-Session starten");
    // Ohne formatFixCommand bleibt der Format-Fix-Pfad komplett aus (Issue #169).
    assert.doesNotMatch(res.stdout, /FORMAT-FIX/,
      "ohne formatFixCommand darf kein Format-Fix versucht werden");

    // Nur die regulaeren Sessions liefen; beide Pakete liegen mit ihren Resten im Stash.
    const sessions = readFileSync(sessionLog, "utf-8").trim().split("\n");
    assert.deepEqual(sessions, [String(erstes.id), String(zweites.id)], "es liefen nicht genau die zwei regulaeren Sessions");
    const backlog = board(dir, "issue", "list", "--status", "backlog").map((i) => String(i.id));
    assert.deepEqual(backlog.sort(), [String(erstes.id), String(zweites.id)].sort());
    const stashes = run(dir, "git", ["stash", "list"]).stdout;
    assert.match(stashes, new RegExp(`nachtrest #${erstes.id} `));
    assert.match(stashes, new RegExp(`nachtrest #${zweites.id} `));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Salvage: gruene buildChecks + erfolgreiche Salvage-Session setzen den Lauf fort", () => {
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

test("Salvage: env-Block aus .claude/settings.json wird beim Vorpruefen der buildChecks gemergt", () => {
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

test("Salvage: gescheiterte Salvage-Session ohne Commit hat eine eigene Log-Zeile, die Reste gehen in den Stash", () => {
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

    assert.equal(res.status, 0, `ein gescheitertes Paket haelt nur sich an (E14): ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /SALVAGE-VERSUCH gestartet \(Checks extern verifiziert gruen\)/,
      "die Salvage-Startzeile fehlt");
    assert.match(res.stdout, /SALVAGE-VERSUCH gescheitert/,
      "der Salvage-Fehlschlag braucht eine eigene, unterscheidbare Log-Zeile");

    // Genau eine Salvage-Session je Issue, danach geht der Lauf weiter.
    const log = readFileSync(sessionLog, "utf-8").trim().split("\n");
    assert.deepEqual(log, [String(erstes.id), String(erstes.id), `salvage ${erstes.id}`, String(zweites.id), String(zweites.id), `salvage ${zweites.id}`],
      `erwartet: je Issue regulaere Runde + genau eine Salvage-Runde, tatsaechlich: ${log.join(" / ")}`);
    assert.match(run(dir, "git", ["stash", "list"]).stdout, new RegExp(`nachtrest #${erstes.id} `));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Die Guetemessung in der Vorpruefung (Issue #817, seit Issue #950 ausgelassen) ---
//
// Issue #817 liess die Vorpruefung die Guetemessung mitwerten: Ein Mutationstest mit
// Exit 0 und 84 % gegen Marke 90 galt bis dahin als gruen, obwohl checks.mjs denselben
// Lauf rot faerbt.
//
// Seit Issue #946 laesst der Abschluss einer Karte die Guetemessung aus — ihr Anteil
// entsteht aus der vollstaendigen Testmenge, und ein Anteil aus einem verkuerzten Lauf
// waere eine andere Groesse mit demselben Namen. Die Vorpruefung des Salvage faehrt den
// Umfang genau dieses Abschlusses (Issue #950, Plan #944, E14) und laesst die Messung
// darum ebenfalls aus: Eine Vorpruefung, die STRENGER waere als der Abschluss, den sie
// nachvollzieht, waere der zweite Weg ueber denselben Vorgang.
//
// Die Marke ist damit nicht aufgegeben, sondern verschoben: Vor dem Veroeffentlichen
// laeuft die Messung immer, an der Push-Stufe sogar bei leerem Paket (Issue #763).

/** Ein Eintrag mit Guetemessung: Exit 0, gemessene 84 %, Marke `marke`. */
function gueteCheck(marke) {
  return {
    cmd: `node -e "console.log('Killed 5 (84%)')" && echo guete >> checklauf.log`,
    guete: { muster: String.raw`\((\d+)%\)`, marke },
  };
}

/** Wie oft die Guetemessung gelaufen ist. */
function gueteLaeufe(dir) {
  const p = join(dir, "checklauf.log");
  return existsSync(p) ? readFileSync(p, "utf-8").trim().split("\n").filter(Boolean).length : 0;
}

test("[night-950] Salvage: eine verfehlte Marke haelt die Vorpruefung nicht auf — sie gehoert nicht zum Abschlussumfang", () => {
  // Der Eintrag "true" daneben ist das Gate des Abschlusses: Ohne ihn startet der Lauf
  // gar nicht (Start-Guard, Issue #950).
  const dir = setupProjekt([gueteCheck(90), "true"]);
  try {
    const erstes = board(dir, "issue", "create", "--title", "Erstes Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(erstes.id), "ready");

    const sessionLog = join(dir, "sessions.log");
    const fake = fakeSession(sessionLog,
      `git add -A && git commit -q -m "salvage (Issue #$NIGHT_ISSUE_ID)"`
      + ` && node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null`);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /SALVAGE-VERSUCH gestartet \(Checks extern verifiziert gruen\)/,
      "die ausgelassene Messung haette den Salvage nicht aufhalten duerfen");
    assert.doesNotMatch(res.stdout, /84 % erreicht/,
      "eine ausgelassene Messung darf keinen Anteil melden — sie hat nicht gemessen");
    assert.equal(gueteLaeufe(dir), 0, "das Kommando der Guetemessung ist in der Vorpruefung gelaufen");
    const inReview = board(dir, "issue", "list", "--status", "in_review").map((i) => String(i.id));
    assert.ok(inReview.includes(String(erstes.id)), "das gerettete Issue haette in In review landen muessen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-950] Salvage: auch ein nicht auswertbares Ergebnis ist kein Halt mehr — es wird nicht gemessen", () => {
  const dir = setupProjekt([{
    cmd: `node -e "console.log('BUILD SUCCESS')" && echo guete >> checklauf.log`,
    guete: { muster: String.raw`\((\d+)%\)`, marke: 80 },
  }, "true"]);
  try {
    const erstes = board(dir, "issue", "create", "--title", "Erstes Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(erstes.id), "ready");

    const sessionLog = join(dir, "sessions.log");
    const fake = fakeSession(sessionLog,
      `git add -A && git commit -q -m "salvage (Issue #$NIGHT_ISSUE_ID)"`
      + ` && node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null`);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.doesNotMatch(res.stdout, /kein auswertbares Ergebnis/,
      "wo nicht gemessen wird, darf auch kein fehlender Messwert gemeldet werden");
    assert.match(res.stdout, /SALVAGE-VERSUCH gestartet/, "der Salvage-Pfad lief nicht");
    assert.equal(gueteLaeufe(dir), 0, "das Kommando der Guetemessung ist in der Vorpruefung gelaufen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-65] Salvage: ein Guete-Eintrag der Stufe push bleibt in der Vorpruefung aussen vor", () => {
  // Die Stufenauswahl gilt unveraendert (Plan #753, E13): Was erst beim
  // Veroeffentlichen faellig ist, haelt keinen Rettungsversuch auf.
  const dir = setupProjekt([{ ...gueteCheck(90), stufe: "push" }, "true"]);
  try {
    const erstes = board(dir, "issue", "create", "--title", "Erstes Issue", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(erstes.id), "ready");

    const sessionLog = join(dir, "sessions.log");
    const fake = fakeSession(sessionLog,
      `git add -A && git commit -q -m "salvage (Issue #$NIGHT_ISSUE_ID)"`
      + ` && node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null`);
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"],
      { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `night.mjs haette sauber enden muessen: ${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /SALVAGE-VERSUCH gestartet \(Checks extern verifiziert gruen\)/,
      "die Messung der Stufe push haette den Salvage nicht aufhalten duerfen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
