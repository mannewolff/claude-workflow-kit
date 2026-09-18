// Die wartende Session (Issue #668).
//
// Ausgangslage, dreimal in zwei Naechten beobachtet (kanban-kit #891, #899, #900): Eine
// Session erledigt ihre Arbeit, startet den Pflichtcheck im Hintergrund, wartet mit dem
// `Monitor`-Werkzeug auf sein Ende — und beendet damit ihren Zug, weil eine headless
// -p-Session keinen Folge-Turn hat. Der Runner sammelt sie ein, findet die Karte nicht in
// In review und den Baum dirty und wertet die Runde als Fehlschlag. Die Arbeit war fertig.
//
// Zwei Dinge werden hier festgehalten:
//   night-25 — der Runner sperrt der Session das Werkzeug, mit dem sie wartend enden kann,
//              hebt ihr Bash-Zeitlimit auf das Rundenzeitlimit und misst erst, wenn kein
//              Prozess ihrer Gruppe mehr laeuft.
//   night-24 — endet sie dennoch ohne Commit, sagt das Protokoll WARUM, unterscheidbar
//              von Zeitlimit, Abbruch und rotem Pflichtcheck.
//
// Laeuft komplett lokal: issueTracker "local" in einem Temp-Repo, Session-Fake via
// NIGHT_CLAUDE_CMD; nur der Test der CLI-Argumente faehrt den Produktivzweig ueber eine
// Fake-CLI im PATH, weil der Test-Hook die Argumente gar nicht baut.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." } : {};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Das ECHTE Script aus dem Repo (nicht kopiert): nur so wird seine Coverage gemessen.
const NIGHT = join(repoRoot, "kit", "night.mjs");

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt(praefix, buildChecks) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local",
    issueTracker: "local",
    buildChecks,
    local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\n.claude/night-run-*.json\n");
  for (const [c, a] of [
    ["git", ["init", "-q"]],
    ["git", ["config", "user.email", "test@example.com"]],
    ["git", ["config", "user.name", "Test"]],
    ["git", ["add", "-A"]],
    ["git", ["commit", "-qm", "Fixture"]],
  ]) {
    const res = run(dir, c, a);
    assert.equal(res.status, 0, `${c} ${a.join(" ")}: ${res.stderr}`);
  }
  return dir;
}

function readyIssue(dir, titel) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", "## Abhaengigkeiten\nKeine.");
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

// Ein `result`-Ereignis, wie es die CLI am Ende einer Session schreibt. Die Felder sind
// die aus einer echten Zeile (siehe night-kennzahlen.test.mjs); hier zaehlen nur die
// beiden, an denen der Grund haengt.
const resultZeile = (stopReason, isError = false) =>
  `{"type":"result","is_error":${isError},"stop_reason":${JSON.stringify(stopReason)},` +
  `"total_cost_usd":0.5,"duration_api_ms":1000,"num_turns":7,"result":"fertig"}`;

// --- night-25: die Werkzeugsperre ---

test("[night-25] der Runner startet die Session ohne Monitor-Werkzeug und mit gehobenem Bash-Zeitlimit", NUR_POSIX, () => {
  const dir = setupProjekt("night-warte-args-", ["true"]);
  let binDir = null;
  try {
    readyIssue(dir, "Belegt Sperre und Zeitlimit");
    // Der Test-Hook NIGHT_CLAUDE_CMD baut die Argumente nicht — deshalb hier der
    // Produktivzweig ueber eine Fake-CLI im PATH. Fake und Mitschrift liegen ausserhalb
    // des Fixture-Repos, sonst machten sie den Working Tree dirty und der Vorflug
    // beendete den Lauf, bevor eine Session startet.
    binDir = mkdtempSync(join(tmpdir(), "night-warte-bin-"));
    const argLog = join(binDir, "args.txt");
    const envLog = join(binDir, "env.txt");
    writeFileSync(join(binDir, "claude"),
      `#!/bin/sh\nprintf '%s\\n' "$@" >> ${JSON.stringify(argLog)}\n` +
      `printf 'MAX=%s\\nDEFAULT=%s\\n' "$BASH_MAX_TIMEOUT_MS" "$BASH_DEFAULT_TIMEOUT_MS" >> ${JSON.stringify(envLog)}\nexit 0\n`);
    chmodSync(join(binDir, "claude"), 0o755);

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1", "--timeout-min", "40"], {
      PATH: `${binDir}:${process.env.PATH}`,
    });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const args = readFileSync(argLog, "utf-8").split("\n");
    const i = args.indexOf("--disallowedTools");
    assert.ok(i >= 0, `--disallowedTools fehlt: ${args.join(" ")}`);
    assert.equal(args[i + 1], "Monitor", "gesperrt wird genau das Monitor-Werkzeug");

    // Das Rundenzeitlimit ist die Obergrenze: Was laenger braucht, als die Runde hat,
    // ist ohnehin verloren. 40 Minuten sind 2.400.000 ms.
    const umgebung = readFileSync(envLog, "utf-8");
    assert.match(umgebung, /MAX=2400000/, `BASH_MAX_TIMEOUT_MS falsch oder leer: ${umgebung}`);
    assert.match(umgebung, /DEFAULT=2400000/, `BASH_DEFAULT_TIMEOUT_MS falsch oder leer: ${umgebung}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (binDir) rmSync(binDir, { recursive: true, force: true });
  }
});

// --- night-25: die Wartezeit auf die Prozessgruppe ---

test("[night-25] die Vorpruefung startet erst, wenn kein Prozess der Session mehr laeuft", NUR_POSIX, () => {
  // Der buildCheck ist hier der Zeuge: Er laeuft als Vorpruefung des Salvage und haelt
  // fest, ob der Hintergrundprozess der Session da schon fertig war. Faende er ihn noch
  // laufend, schriebe er "verletzung.txt" — genau die Kollision, die bei #900 die
  // Vorpruefung nach 72 Sekunden hat abbrechen lassen, obwohl der volle Lauf Minuten
  // braucht. Ein Zeitstempelvergleich waere dieselbe Aussage, nur flackernd.
  const check = "sh -c 'if [ -f bg-ende.txt ]; then exit 1; else echo zu-frueh > verletzung.txt; exit 1; fi'";
  const dir = setupProjekt("night-warte-gruppe-", [check]);
  try {
    const id = readyIssue(dir, "Laesst einen Hintergrundlauf zurueck");
    // Die Session: macht den Baum dirty, startet einen Hintergrundlauf und endet sofort —
    // das Muster aus #900, nur ohne die 13 Minuten dazwischen.
    const fake = "echo arbeit > arbeit.txt; (sleep 1; echo fertig > bg-ende.txt) & exit 0";

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 1, `harter Stopp erwartet:\n${res.stdout}\n${res.stderr}`);

    assert.ok(existsSync(join(dir, "bg-ende.txt")), "der Hintergrundlauf muss gelaufen sein, sonst prueft der Test nichts");
    assert.ok(
      !existsSync(join(dir, "verletzung.txt")),
      "die Vorpruefung lief, waehrend der Hintergrundlauf der Session noch lief",
    );
    // Wohin die Karte gehoert, entscheidet Issue #404 und nicht dieses Paket — geprueft
    // wird hier nur, dass der harte Stopp sie nicht ins Backlog raeumt.
    assert.notEqual(board(dir, "issue", "get", id).status, "backlog", "ein harter Stopp raeumt die Karte nicht weg");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- night-24: der Grund im Protokoll ---
//
// Bis Issue #668 stand am harten Stopp nur "nicht in In review UND Working Tree dirty".
// Das ist die FOLGE. Wer morgens sichtet, muss unterscheiden koennen, ob die Session
// regulaer endete, ohne fertig zu sein, ob sie am Zeitlimit starb, ob sie abbrach oder ob
// ihr Pflichtcheck rot war — vier Faelle mit vier verschiedenen naechsten Schritten.

test("[night-24] eine regulaer beendete Session ohne Commit wird als solche ausgewiesen", NUR_POSIX, () => {
  const dir = setupProjekt("night-warte-endturn-", ["false"]);
  try {
    readyIssue(dir, "Endet regulaer ohne Commit");
    // Genau das Muster aus #900: Arbeit im Baum, `result` mit end_turn, kein Commit.
    const fake = `echo arbeit > arbeit.txt; echo '${resultZeile("end_turn")}'; exit 0`;

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 1, `harter Stopp erwartet:\n${res.stdout}`);
    assert.match(
      res.stdout,
      /Grund: Session regulaer beendet ohne Commit \(end_turn\)/,
      `der Grund fehlt im Protokoll:\n${res.stdout}`,
    );
    // Der Zustand bleibt daneben stehen — er war nie falsch, nur unvollstaendig.
    assert.match(res.stdout, /nicht in In review UND Working Tree dirty/, "der Zustandstext bleibt erhalten");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-24] eine am Zeitlimit beendete Session bekommt einen anderen Grund", NUR_POSIX, () => {
  const dir = setupProjekt("night-warte-timeout-", ["false"]);
  try {
    readyIssue(dir, "Laeuft in das Zeitlimit");
    // Schreibt zuerst, haengt dann — so ist der Baum dirty UND das Zeitlimit greift.
    const fake = "echo arbeit > arbeit.txt; sleep 30";

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1"], {
      NIGHT_CLAUDE_CMD: fake,
      NIGHT_TIMEOUT_MS: "800",
      NIGHT_KILL_GRACE_MS: "300",
    });
    assert.equal(res.status, 1, `harter Stopp erwartet:\n${res.stdout}`);
    assert.match(res.stdout, /Grund: Session am Zeitlimit beendet/, `der Zeitlimit-Grund fehlt:\n${res.stdout}`);
    assert.doesNotMatch(
      res.stdout,
      /Grund: Session regulaer beendet ohne Commit/,
      "ein Zeitlimit ist kein regulaeres Ende — die beiden Faelle duerfen nicht zusammenfallen",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-24] eine abgebrochene Session wird an is_error erkannt, nicht an stop_reason", NUR_POSIX, () => {
  const dir = setupProjekt("night-warte-error-", ["false"]);
  try {
    readyIssue(dir, "Bricht ab");
    // Exit 0 mit is_error: true — der Infrastruktur-Guard greift hier NICHT (der sieht
    // nur den Exit-Code), und ohne diesen Fall fiele der Abbruch unter "end_turn".
    const fake = `echo arbeit > arbeit.txt; echo '${resultZeile("end_turn", true)}'; exit 0`;

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 1, `harter Stopp erwartet:\n${res.stdout}`);
    assert.match(res.stdout, /Grund: Session mit is_error beendet/, `der Abbruch-Grund fehlt:\n${res.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-24] eine rote Vorpruefung nennt das Kommando und seine Ausgabe", NUR_POSIX, () => {
  // "Salvage nicht moeglich: buildChecks sind rot" sagte bisher nicht, WELCHER Check rot
  // war und warum. Im Protokoll zu #900 steht deshalb kein Wort zur Ursache — und die
  // Vermutung "Postgres-Verbindungslimit" liess sich am Protokoll nicht pruefen.
  const check = "sh -c 'echo VERBINDUNGSLIMIT-ERREICHT; exit 1'";
  const dir = setupProjekt("night-warte-checkrot-", [check]);
  try {
    readyIssue(dir, "Hinterlaesst einen roten Check");
    const fake = `echo arbeit > arbeit.txt; echo '${resultZeile("end_turn")}'; exit 0`;

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 1, `harter Stopp erwartet:\n${res.stdout}`);
    assert.match(
      res.stdout,
      /Grund: Pflichtcheck rot — .*VERBINDUNGSLIMIT|Pflichtcheck rot — sh -c/,
      `das rote Kommando fehlt:\n${res.stdout}`,
    );
    assert.match(res.stdout, /VERBINDUNGSLIMIT-ERREICHT/, `die Ausgabe des roten Checks fehlt:\n${res.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
