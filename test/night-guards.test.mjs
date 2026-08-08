// Vorflug-Checks, Fehlerpfade und Sonderfaelle des Nacht-Runners (Issue #189).
//
// Die acht bestehenden night-*-Dateien decken die Hauptwege ab (Erfolg, Fehlschlag,
// Salvage, Label-Filter). Hier stehen die Pfade, die erst unter Stoerung greifen:
// abgebrochene Vorfluege, ein kaputter Board-Adapter, ein fehlendes claude-CLI, eine
// Session die auf SIGTERM nicht reagiert, und die Abhaengigkeits-Kaskade.
//
// Wie in den uebrigen night-Tests laeuft alles lokal: issueTracker "local" in einem
// Temp-Repo, Session-Fake via NIGHT_CLAUDE_CMD, und das ECHTE kit/night.mjs aus dem
// Repo (cwd + KIT_ROOT zeigen ins Fixture).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." } : {};


const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt(praefix, config = {}) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"],
    local: { issuesDir: "issues" }, ...config,
  }, null, 2));
  // Alles, was die Tests selbst im Fixture ablegen, muss gitignored sein — sonst
  // schlaegt der Rest-Guard (#152) nach einer erfolgreichen Runde zu Recht an.
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\nbin/\n");
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

/** Erzeugt ein Issue in Ready und liefert seine ID als String. */
function readyIssue(dir, titel, body = "## Abhaengigkeiten\nKeine.") {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", body);
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

// --- Vorflug-Checks ---

test("Vorflug: ein Issue in In progress stoppt den Lauf als Crash-Rest", NUR_POSIX, () => {
  const dir = setupProjekt("night-guard-inprogress-");
  try {
    const id = readyIssue(dir, "Haengengeblieben");
    board(dir, "issue", "move", id, "in_progress");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 1, "der Lauf haette nicht starten duerfen");
    assert.match(res.stderr, new RegExp(`In progress \\(#${id}\\)[\\s\\S]*Crash-Rest`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Vorflug: leere buildChecks stoppen den Lauf, --no-checks-ok laesst ihn durch", NUR_POSIX, () => {
  const dir = setupProjekt("night-guard-checks-", { buildChecks: [] });
  try {
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 1, "ohne Gate darf nachts nicht implementiert werden");
    assert.match(res.stderr, /buildChecks .* ist leer[\s\S]*--no-checks-ok/);

    // Mit dem Override laeuft derselbe Stand durch (Ready ist leer -> nichts zu tun).
    const ok = run(dir, process.execPath, [NIGHT, "--label", "none", "--no-checks-ok"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(ok.status, 0, `mit --no-checks-ok haette der Lauf durchgehen muessen: ${ok.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Vorflug: --yolo warnt vor umgangenen Permission-Checks", NUR_POSIX, () => {
  const dir = setupProjekt("night-guard-yolo-");
  try {
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--yolo"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /WARNUNG: --yolo umgeht ALLE Permission-Checks/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Kaputter Board-Adapter ---

// Der Runner delegiert jede Board-Operation an board.mjs. Faellt der Adapter aus,
// muss das als solches im Log stehen — sonst sucht man morgens am falschen Ende.
function stubBoard(dir, script) {
  writeFileSync(join(dir, ".claude", "kit", "board.mjs"), script, "utf-8");
}

test("board.mjs mit Exit ungleich 0 beendet den Lauf mit sprechender Meldung", NUR_POSIX, () => {
  const dir = setupProjekt("night-guard-boardfail-");
  try {
    stubBoard(dir, 'process.stderr.write("Adapter kaputt\\n");\nprocess.exit(3);\n');
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /board\.mjs issue list --status in_progress schlug fehl[\s\S]*Adapter kaputt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("board.mjs ohne JSON-Ausgabe beendet den Lauf mit sprechender Meldung", NUR_POSIX, () => {
  const dir = setupProjekt("night-guard-boardjson-");
  try {
    stubBoard(dir, 'process.stdout.write("kein JSON, nur Text\\n");\n');
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /lieferte kein JSON[\s\S]*kein JSON, nur Text/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Versions-Drift-Warnung, wenn board.mjs zwar existiert, aber nicht lesbar ist.
// Ein Verzeichnis an der Stelle ist der portable Weg dorthin: existsSync sagt ja,
// readFileSync scheitert. Danach faellt der erste Board-Aufruf ohnehin aus — die
// Warnung muss trotzdem schon dagestanden haben.
test("Versions-Drift: unlesbare board.mjs warnt mit 'unbekannt'", NUR_POSIX, () => {
  const dir = setupProjekt("night-guard-unreadable-");
  try {
    rmSync(join(dir, ".claude", "kit", "board.mjs"));
    mkdirSync(join(dir, ".claude", "kit", "board.mjs"));
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: "true" });
    assert.match(res.stdout, /WARNUNG: Versions-Drift[\s\S]*board\.mjs ist unbekannt \(Kopie ohne Versionsstempel\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Dry-Run ---

test("Dry-Run: leeres Ready meldet 'nichts zu tun' und startet nichts", NUR_POSIX, () => {
  const dir = setupProjekt("night-guard-dryempty-");
  try {
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--dry-run"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Ready ist leer — nichts zu tun/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Dry-Run: unerfuellte Abhaengigkeit und --max-Grenze werden ausgewiesen", NUR_POSIX, () => {
  const dir = setupProjekt("night-guard-drydeps-");
  try {
    const blocker = board(dir, "issue", "create", "--title", "Blocker", "--body", "## Abhaengigkeiten\nKeine.");
    const abhaengig = readyIssue(dir, "Braucht den Blocker", `## Abhaengigkeiten\nIssue #${blocker.id} muss vorher fertig sein.`);
    const ersteRunde = readyIssue(dir, "Laeuft als erstes");
    const ueberMax = readyIssue(dir, "Faellt hinten runter");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--dry-run", "--max", "1"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`#${abhaengig} .*Abhaengigkeit #${Number(blocker.id)} nicht erfuellt`));
    assert.match(res.stdout, new RegExp(`#${ersteRunde} .*-> Session 1`));
    assert.match(res.stdout, new RegExp(`#${ueberMax} .*ueber --max 1, bliebe liegen`));
    assert.match(res.stdout, /Dry-Run beendet: 1 Session\(s\) wuerden starten/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Abhaengigkeits-Kaskade im echten Lauf ---

test("Kaskade: unerfuellte Abhaengigkeit wandert kommentiert ins Backlog, erfuellte laeuft", NUR_POSIX, () => {
  const dir = setupProjekt("night-guard-kaskade-");
  try {
    // #A ist erledigt (In review), #B nicht — also ist nur die Referenz auf #B offen.
    const erledigt = board(dir, "issue", "create", "--title", "Schon fertig", "--body", "## Abhaengigkeiten\nKeine.");
    board(dir, "issue", "move", String(erledigt.id), "in_review");
    const offen = board(dir, "issue", "create", "--title", "Noch offen", "--body", "## Abhaengigkeiten\nKeine.");

    const blockiert = readyIssue(dir, "Wartet auf Offenes", `## Abhaengigkeiten\nIssue #${offen.id} muss vorher fertig sein.`);
    const laeuft = readyIssue(dir, "Abhaengigkeit erfuellt", `## Abhaengigkeiten\nIssue #${erledigt.id} muss vorher fertig sein.`);

    const sessionLog = join(dir, "sessions.log");
    const fake = `echo "$NIGHT_ISSUE_ID" >> ${JSON.stringify(sessionLog)}\n`
      + `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null\n`;
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    assert.match(res.stdout, new RegExp(`#${blockiert} zurueckgestellt: Abhaengigkeit #${Number(offen.id)} nicht erfuellt`));
    // Nur das Issue mit erfuellter Abhaengigkeit bekam eine Session.
    assert.deepEqual(readFileSync(sessionLog, "utf-8").trim().split("\n"), [laeuft]);
    const backlog = board(dir, "issue", "list", "--status", "backlog").map((i) => String(i.id));
    assert.ok(backlog.includes(blockiert), "das blockierte Issue haette ins Backlog gemusst");
    const text = readFileSync(join(dir, "issues", `${blockiert}.md`), "utf-8");
    assert.match(text, /Abhaengigkeit #\d+ nicht erfuellt \(nicht in In review\/Done\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Der echte claude-Aufruf (ohne NIGHT_CLAUDE_CMD) ---

// Ohne den Test-Hook baut runSession die echte Kommandozeile. Ein Fake-claude im
// PATH macht sie pruefbar, ohne je eine Sitzung zu starten: Es protokolliert seine
// Argumente. So ist belegt, dass Prompt, Modell und Permission-Modus ankommen — und
// dass --yolo tatsaechlich --dangerously-skip-permissions setzt statt acceptEdits.
function binMitClaude(dir, claudeScript) {
  const binDir = join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
  // git und sh muessen erreichbar bleiben (gitClean, buildChecks) — der PATH wird
  // ersetzt, nicht ergaenzt, damit ein echtes claude auf der Maschine nie greift.
  for (const werkzeug of ["git", "sh", "node"]) {
    const pfad = spawnSync("sh", ["-c", `command -v ${werkzeug}`], { encoding: "utf-8" }).stdout.trim();
    assert.ok(pfad, `${werkzeug} nicht im PATH gefunden`);
    symlinkSync(pfad, join(binDir, werkzeug));
  }
  if (claudeScript !== null) {
    const pfad = join(binDir, "claude");
    writeFileSync(pfad, claudeScript, "utf-8");
    spawnSync("chmod", ["+x", pfad]);
  }
  return binDir;
}

test("Ohne Test-Hook ruft der Runner claude mit Prompt, Modell und Permission-Modus", NUR_POSIX, () => {
  const dir = setupProjekt("night-guard-claude-");
  try {
    const id = readyIssue(dir, "Wird beauftragt");
    const argLog = join(dir, "claude-args.log");
    const binDir = binMitClaude(dir, `#!/bin/sh\necho "$@" >> ${JSON.stringify(argLog)}\n`
      + `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null\n`);

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--model", "claude-test-modell"], { PATH: binDir });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const zeile = readFileSync(argLog, "utf-8").trim();
    assert.match(zeile, new RegExp(`-p /implement-next #${id}`), "das Issue muss verbindlich uebergeben werden");
    assert.match(zeile, /--model claude-test-modell/);
    assert.match(zeile, /--permission-mode acceptEdits/);
    assert.doesNotMatch(zeile, /--output-format/, "ohne --verbose kein Stream-Format");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Ohne Test-Hook setzt --yolo --dangerously-skip-permissions, --verbose den Stream", NUR_POSIX, () => {
  const dir = setupProjekt("night-guard-claude-yolo-");
  try {
    readyIssue(dir, "Wird beauftragt");
    const argLog = join(dir, "claude-args.log");
    const binDir = binMitClaude(dir, `#!/bin/sh\necho "$@" >> ${JSON.stringify(argLog)}\n`
      + `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null\n`);

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--yolo", "--verbose"], { PATH: binDir });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const zeile = readFileSync(argLog, "utf-8").trim();
    assert.match(zeile, /--dangerously-skip-permissions/);
    assert.doesNotMatch(zeile, /--permission-mode/);
    assert.match(zeile, /--output-format stream-json --verbose/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Fehlendes claude-CLI wird als solches gemeldet, nicht als Issue-Fehlschlag", NUR_POSIX, () => {
  const dir = setupProjekt("night-guard-noclaude-");
  try {
    readyIssue(dir, "Findet kein CLI");
    const binDir = binMitClaude(dir, null); // git und sh vorhanden, claude fehlt

    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { PATH: binDir });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /claude-CLI nicht gefunden/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Zeitlimit ---

// Eine Session, die SIGTERM ignoriert, muss nachgesetzt bekommen (#182). Die Nachfrist
// ist ueber NIGHT_KILL_GRACE_MS testbar gemacht; hier steht sie auf 1 ms, damit der
// Test in Millisekunden statt in Sekunden laeuft.
test("Zeitlimit: eine Session, die SIGTERM ignoriert, wird hart nachgesetzt", NUR_POSIX, () => {
  const dir = setupProjekt("night-guard-timeout-");
  try {
    const id = readyIssue(dir, "Reagiert nicht auf SIGTERM");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], {
      NIGHT_CLAUDE_CMD: "trap '' TERM; sleep 30",
      NIGHT_TIMEOUT_MS: "300",
      NIGHT_KILL_GRACE_MS: "1",
    });

    // Timeout zaehlt als issue-spezifisch, nicht als Infrastruktur: Das Issue wandert
    // mit Kommentar ins Backlog und der Lauf endet reguler.
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, new RegExp(`Fehlschlag nach .* Issue #${id} nicht in In review`));
    assert.doesNotMatch(res.stdout, /INFRASTRUKTUR-FEHLSCHLAG/,
      "ein Timeout ist kein Infrastruktur-Fehler");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Das Schadensbild aus Issue #182, im Zeitraffer: Die Session startet einen Enkel in
// EIGENER Prozessgruppe, der die geerbte stdout-Pipe offen haelt, und endet selbst
// sofort. Node liefert dann kein close-Event — der Runner muss von allein aufloesen.
// Beim Nachsetzen ist die Gruppe des Kindes bereits leer, der Kill scheitert mit
// ESRCH, und genau das darf den Runner nicht aus der Bahn werfen.
test("Zeitlimit: ein Enkel in eigener Prozessgruppe blockiert das close-Event nicht", NUR_POSIX, () => {
  const dir = setupProjekt("night-guard-enkel-");
  try {
    const id = readyIssue(dir, "Haengt an einem Enkel");
    const enkel = 'require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(()=>{},2000)"], '
      + '{ detached: true, stdio: "inherit" }).unref()';
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], {
      NIGHT_CLAUDE_CMD: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(enkel)}`,
      NIGHT_TIMEOUT_MS: "300",
      NIGHT_KILL_GRACE_MS: "50",
    });

    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, new RegExp(`Fehlschlag nach .* Issue #${id} nicht in In review`),
      "der Runner muss das Zeitlimit selbst aufloesen, statt auf das close-Event zu warten");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- settings-env der Salvage-Vorpruefung (#168) ---

// Die Vorpruefung mergt den env-Block aus .claude/settings.json und settings.local.json
// in ihre Kindprozess-Umgebung — ohne ihn liefert sie ein falsches Rot (kanban-kit#445).
// Hier ist die erste Datei kaputtes JSON: Sie darf die Vorpruefung nicht blockieren,
// nur selbst ausfallen. Der buildCheck prueft die Variable aus der zweiten Datei.
test("Salvage-Vorpruefung: kaputtes settings.json faellt aus, settings.local.json gilt", NUR_POSIX, () => {
  const dir = setupProjekt("night-guard-settingsenv-", {
    buildChecks: ['test "$NIGHT_TEST_VAR" = "aus-settings-local"'],
  });
  try {
    const id = readyIssue(dir, "Verliert sein Ergebnis");
    writeFileSync(join(dir, ".claude", "settings.json"), "{kaputt", "utf-8");
    writeFileSync(join(dir, ".claude", "settings.local.json"),
      JSON.stringify({ env: { NIGHT_TEST_VAR: "aus-settings-local" } }), "utf-8");
    // Der Vorflug verlangt einen sauberen Tree — die beiden Dateien gehoeren dazu.
    run(dir, "git", ["add", "-A"]);
    run(dir, "git", ["commit", "-q", "-m", "settings"]);

    // Regulaere Runde: laesst Arbeit liegen, bewegt das Board nicht. Die Salvage-Session
    // committet den Stand und verschiebt das Issue.
    const fake = `if [ -n "$NIGHT_SALVAGE" ]; then\n`
      + `  git add -A && git commit -q -m "Salvage (Issue $NIGHT_ISSUE_ID)"\n`
      + `  node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null\n`
      + `else\n`
      + `  echo arbeit > "work-$NIGHT_ISSUE_ID.txt"\n`
      + `fi\n`;
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /SALVAGE-VERSUCH gestartet/,
      "mit der Variable aus settings.local.json muessen die Checks gruen sein");
    assert.match(res.stdout, new RegExp(`Salvage erfolgreich[\\s\\S]*Issue #${id} in In review`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Plattform-Shell der buildChecks (#199) ---

// buildChecks und formatFixCommand sind frei konfigurierte Kommandozeilen und laufen
// deshalb in der Shell der Plattform (shell:true) statt in einem fest verdrahteten sh,
// das es unter Windows nicht gibt. Der Beleg dafuer ist ein Check, der ohne Shell gar
// nicht ausfuehrbar waere: Operator-Verkettung und eine Umgebungsvariable.
test("buildChecks laufen in einer Shell: Verkettung und Variablen werden ausgewertet", NUR_POSIX, () => {
  const dir = setupProjekt("night-guard-shell-", {
    buildChecks: ['test "$NIGHT_SHELL_PROBE" = "da" && echo verkettet'],
  });
  try {
    const id = readyIssue(dir, "Verliert sein Ergebnis");
    writeFileSync(join(dir, ".claude", "settings.json"),
      JSON.stringify({ env: { NIGHT_SHELL_PROBE: "da" } }), "utf-8");
    run(dir, "git", ["add", "-A"]);
    run(dir, "git", ["commit", "-q", "-m", "settings"]);

    // Die regulaere Runde laesst Arbeit liegen -> die Salvage-Vorpruefung faehrt die
    // buildChecks selbst. Nur wenn die Shell greift, sind sie gruen.
    const fake = `if [ -n "$NIGHT_SALVAGE" ]; then\n`
      + `  git add -A && git commit -q -m "Salvage (Issue $NIGHT_ISSUE_ID)"\n`
      + `  node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null\n`
      + `else\n`
      + `  echo arbeit > "work-$NIGHT_ISSUE_ID.txt"\n`
      + `fi\n`;
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });

    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.match(res.stdout, /SALVAGE-VERSUCH gestartet/,
      "die verkettete Kommandozeile muss von der Shell ausgewertet worden sein");
    assert.match(res.stdout, new RegExp(`Salvage erfolgreich[\\s\\S]*Issue #${id} in In review`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Verbose-Stream ---

// Ein Tool-Aufruf ohne die bekannten Schluessel (command, file_path, path, pattern,
// url) faellt auf ein kompaktes JSON zurueck; ist auch das leer, bleibt nur der Name.
test("Verbose: Tool-Aufrufe ohne bekannte Argumente werden trotzdem lesbar geloggt", NUR_POSIX, () => {
  const dir = setupProjekt("night-guard-verbose-");
  try {
    const id = readyIssue(dir, "Loggt exotische Tools");
    const ereignisse = [
      { type: "assistant", message: { content: [{ type: "tool_use", name: "TodoWrite", input: { todos: ["a"] } }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Ohnealles", input: {} }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "  " }] } },
      { type: "nicht-assistant" },
    ].map((o) => JSON.stringify(o)).join("\n");

    const fake = `cat <<'STREAM'\n${ereignisse}\nSTREAM\n`
      + `echo "kaputte zeile, kein json"\n`
      + `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null\n`;
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    assert.match(res.stdout, new RegExp(`#${id} > TodoWrite: \\{"todos":\\["a"\\]\\}`),
      "unbekannte Argumente muessen als JSON erscheinen");
    assert.match(res.stdout, new RegExp(`#${id} > Ohnealles$`, "m"),
      "ohne jedes Argument bleibt der blosse Tool-Name");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
