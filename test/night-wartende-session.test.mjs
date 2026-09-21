// Die wartende Session (Issue #668).
//
// Ausgangslage, dreimal in zwei Naechten beobachtet (kanban-kit #891, #899, #900): Eine
// Session erledigt ihre Arbeit, startet den Pflichtcheck im Hintergrund, wartet mit dem
// `Monitor`-Werkzeug auf sein Ende — und beendet damit ihren Zug, weil eine headless
// -p-Session keinen Folge-Turn hat. Der Runner sammelt sie ein, findet die Karte nicht in
// In review und den Baum dirty und wertet die Runde als Fehlschlag. Die Arbeit war fertig.
//
// Fuenf Dinge werden hier festgehalten:
//   night-25 — der Runner sperrt der Session das Werkzeug, mit dem sie wartend enden kann,
//              hebt ihr Bash-Zeitlimit auf das Rundenzeitlimit und misst erst, wenn kein
//              Prozess ihrer Gruppe mehr laeuft.
//   night-24 — endet sie dennoch ohne Commit, sagt das Protokoll WARUM, unterscheidbar
//              von Zeitlimit, Abbruch und rotem Pflichtcheck.
//   night-52 — am Schlusstext erkennt der Runner, ob die Sitzung auf eine SELBST
//              angestossene Arbeit gewartet hat; das Warten auf einen Menschen zaehlt nicht.
//   night-53 — der Grund dieses Falls steht in `rundenGrund` hinter dem roten Pflichtcheck
//              und vor dem regulaeren Ende.
//   night-54 — der Vermerk am Paket nennt den Fall, den gekuerzten Schlusstext und die
//              Reste im Arbeitsverzeichnis.
//
// Laeuft komplett lokal: issueTracker "local" in einem Temp-Repo, Session-Fake via
// NIGHT_CLAUDE_CMD; nur der Test der CLI-Argumente faehrt den Produktivzweig ueber eine
// Fake-CLI im PATH, weil der Test-Hook die Argumente gar nicht baut. Die drei neuen
// Aussagen pruefen dagegen die exportierten reinen Funktionen ohne Subprozess — dieselbe
// Linie wie `night-kennzahlen.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { wartendeSession, wartendVermerk, rundenGrund, WARTEND_ANKER } from "../kit/night.mjs";

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

// --- night-52, night-53, night-54: die Bausteine der wartenden Sitzung (Issue #775) ---
//
// Der Wortlaut steht hier ein zweites Mal — absichtlich, wie bei den vier Gruenden
// darueber: Der Test ist die Gegenprobe zur Konstanten. Wer sie umformuliert, aendert
// einen Text, der zugleich in Protokoll, Board-Kommentar und Ergebnisstand steht, und
// soll das an einem roten Test merken.
const WARTEND_WORTLAUT =
  "Grund: Sitzung hat auf eine selbst angestossene Arbeit gewartet und ist ohne Ergebnis beendet worden";

// Wie `resultZeile`, nur mit eigenem Schlusstext — an dem haengt die ganze Erkennung.
const resultZeileMitText = (stopReason, text, isError = false) =>
  `{"type":"result","is_error":${isError},"stop_reason":${JSON.stringify(stopReason)},` +
  `"total_cost_usd":0.5,"duration_api_ms":1000,"num_turns":7,"result":${JSON.stringify(text)}}`;

test("[night-52] wartendeSession erkennt die Wendungen der Musterliste", () => {
  for (const text of [
    "Ich warte auf den Abschluss von mvn verify.",
    "Der Pflichtcheck laeuft noch.",
    "Der Testlauf laeuft im Hintergrund weiter.",
    "Ich melde mich, sobald der Lauf fertig ist.",
    "Das Ergebnis steht noch aus.",
    // Gross-/Kleinschreibung spielt keine Rolle: dieselbe Wendung, anderer Satzanfang.
    "WARTE AUF das Ende des Mutationstests.",
  ]) {
    assert.equal(wartendeSession(text), true, `nicht als wartend erkannt: ${text}`);
  }
});

test("[night-52] wartendeSession wertet das Warten auf einen Menschen nicht als eigenen Fall", () => {
  for (const text of [
    "Ich warte auf deine Antwort zur offenen Frage.",
    "Ich warte auf Rueckmeldung aus dem Team.",
    "Ich warte auf die Freigabe des Vorgehens.",
    "Ich warte auf dein GO.",
    "Ich warte auf Klaerung der offenen Frage.",
    "Ich warte auf das Review durch einen Menschen.",
  ]) {
    assert.equal(wartendeSession(text), false, `Warten auf einen Menschen faelschlich gewertet: ${text}`);
  }
  // Kein Schlusstext, kein Fall — `leseErgebnisText` liefert bei leerem Text `null`.
  assert.equal(wartendeSession(null), false);
  assert.equal(wartendeSession(""), false);
  // Eine Sitzung, die schlicht fertig ist, wartet auf nichts.
  assert.equal(wartendeSession("Issue #775 ist umgesetzt, committet und in In review."), false);
});

test("[night-52] das kurze GO trifft nicht mitten im Wort", () => {
  // Ohne Wortgrenze verschluckte das „GO\" in ALGOL den ganzen Fall: Die Ausnahmeliste hat
  // Vorrang, und der wartende Schlusstext saehe aus wie Warten auf einen Menschen.
  assert.equal(wartendeSession("Der ALGOL-Uebersetzer laeuft noch."), true);
});

test("[night-53] rundenGrund liefert den neuen Grund beim regulaeren Ende einer wartenden Sitzung", () => {
  const res = { stdout: resultZeileMitText("end_turn", "Der Pflichtcheck laeuft noch im Hintergrund.") };
  assert.equal(rundenGrund(res, { zustand: "gruen" }), WARTEND_WORTLAUT);
});

test("[night-53] eine regulaer beendete Sitzung ohne Warten behaelt ihren bisherigen Grund", () => {
  const res = { stdout: resultZeileMitText("end_turn", "Alles erledigt, nichts steht offen.") };
  assert.equal(rundenGrund(res, { zustand: "gruen" }), "Grund: Session regulaer beendet ohne Commit (end_turn)");
});

test("[night-53] Zeitlimit, is_error und roter Pflichtcheck stehen vor dem neuen Grund", () => {
  const wartend = "Der Pflichtcheck laeuft noch im Hintergrund.";
  const stdout = resultZeileMitText("end_turn", wartend);

  assert.equal(
    rundenGrund({ stdout, error: { code: "ETIMEDOUT" } }, { zustand: "gruen" }),
    "Grund: Session am Zeitlimit beendet",
  );
  assert.equal(
    rundenGrund({ stdout: resultZeileMitText("end_turn", wartend, true) }, { zustand: "gruen" }),
    "Grund: Session mit is_error beendet",
  );
  assert.match(
    rundenGrund({ stdout }, { zustand: "rot", rotesKommando: "npm test" }),
    /^Grund: Pflichtcheck rot — npm test \(Session\)$/,
  );
});

test("[night-53] ohne regulaeres Ende bleibt es beim unbekannten Ergebnis", () => {
  // Der Zweig verfeinert `end_turn` und loest ihn nicht ab: Ein anderer stop_reason sagt
  // ueber den Ausgang zu wenig, um den Fall zu behaupten.
  const res = { stdout: resultZeileMitText("max_tokens", "Der Pflichtcheck laeuft noch im Hintergrund.") };
  assert.equal(rundenGrund(res, { zustand: "gruen" }), "Grund: Session ohne auswertbares Ergebnis-Ereignis beendet");
});

test("[night-54] der Vermerk nennt Anker, Fall, gekuerzten Stand und die Reste", () => {
  assert.equal(WARTEND_ANKER, "## Nachtlauf: wartende Sitzung");

  const lang = `Stand: ${"A".repeat(2500)}`;
  const vermerk = wartendVermerk(lang, ["kit/night.mjs", "test/night-wartende-session.test.mjs"]);

  assert.ok(vermerk.startsWith(WARTEND_ANKER), `der Anker fehlt am Anfang:\n${vermerk}`);
  assert.ok(vermerk.includes(WARTEND_WORTLAUT), `der Fall steht nicht im Wortlaut der Konstanten:\n${vermerk}`);
  assert.ok(vermerk.includes(lang.slice(0, 2000)), "der Schlusstext fehlt bis zur Grenze");
  assert.ok(!vermerk.includes(lang.slice(0, 2001)), "der Schlusstext wird nicht auf 2.000 Zeichen gekuerzt");
  assert.match(vermerk, /kit\/night\.mjs/, "die Reste im Arbeitsverzeichnis fehlen");
  assert.match(vermerk, /test\/night-wartende-session\.test\.mjs/, "die Reste im Arbeitsverzeichnis fehlen");
});

test("[night-54] bei leerer Pfadliste entfaellt die Zeile zu den Resten ersatzlos", () => {
  const vermerk = wartendVermerk("Der Pflichtcheck laeuft noch im Hintergrund.");

  assert.ok(vermerk.includes(WARTEND_WORTLAUT));
  assert.ok(vermerk.includes("Der Pflichtcheck laeuft noch im Hintergrund."));
  // „keine Reste\" waere eine Meldung ueber etwas, das es nicht gibt — im
  // Rueckstellungsfall ist der Baum ohnehin sauber.
  assert.doesNotMatch(vermerk, /Rest/i, `der Vermerk meldet die leere Liste:\n${vermerk}`);
  assert.doesNotMatch(vermerk, /Arbeitsverzeichnis/i, `der Vermerk meldet die leere Liste:\n${vermerk}`);
});
