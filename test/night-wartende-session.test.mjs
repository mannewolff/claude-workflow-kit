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
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, existsSync, chmodSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { wartendeSession, wartendVermerk, rundenGrund, WARTEND_ANKER, KETTE_ZUSATZ, REVIEW_REST_ANKER } from "../kit/night.mjs";
// Die Stufen der Nacht-Kette (night-57, night-58) laufen gegen dieselbe Fixture wie die
// uebrigen Ketten-Tests. Als Namensraum eingebunden, weil dieser Datei eigene Helfer
// gleichen Namens (`setupProjekt`, `board`, `run`, `stand`, `NUR_POSIX`) schon gehoeren.
import * as kette from "./helpers/kette-fixture.mjs";

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
  // `checks-summary.json` steht hier, seit ein Test dieser Datei eine erfolgreiche Runde
  // faehrt (night-55): Die Zusammenfassung entsteht im Arbeitsbaum, und ohne die Regel
  // sieht der Rest-Guard sie als liegengebliebenen Rest — dieselbe Linie wie in
  // `night-ergebnisstand.test.mjs`.
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\n.claude/night-run-*.json\n.claude/checks-summary.json\n");
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

// --- night-55: der Rueckstellungsweg bei sauberem Arbeitsbaum (Issue #776) ---
//
// Der erste der drei Auswertungswege. Was sich aendert, ist der TEXT und ein Feld — nicht
// der Weg: `ausgang` bleibt `zurueckgestellt`, die Karte geht nach Backlog, der Lauf laeuft
// weiter. Darueber entscheidet der Zustand des Arbeitsverzeichnisses und nicht der neue
// Fall; ein Test, der das nicht mitprueft, liesse eine stille Verhaltensaenderung durch.

// Der Wortlaut des bisherigen Grundes, ebenfalls ein zweites Mal — aus demselben Grund wie
// WARTEND_WORTLAUT darueber: Der unveraenderte Fall muss ihn behalten.
const DEFERRED_WORTLAUT =
  "Session ohne In-review-Ergebnis beendet — Issue zurueckgestellt, Lauf ging mit dem naechsten Issue weiter.";

const WARTE_SCHLUSSTEXT = "Der Pflichtcheck laeuft noch im Hintergrund, ich melde mich, sobald er durch ist.";

/** Die eine Ergebnisstand-Datei des Laufs — mehr als eine waere hier ein Fehler. */
function stand(dir) {
  const dateien = readdirSync(join(dir, ".claude"))
    .filter((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n))
    .sort();
  assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);
  return JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
}

/** Die Einheit zu einem Issue — der Zugriff ueber die ID, nicht ueber die Position. */
function einheit(dir, id) {
  const s = stand(dir);
  const treffer = s.einheiten.find((e) => String(e.id) === String(id));
  assert.ok(treffer, `keine Einheit fuer Issue #${id}: ${JSON.stringify(s.einheiten)}`);
  return treffer;
}

/** Der Body der Karte — beim lokalen Tracker haengen die Kommentare darin. */
function karte(dir, id) {
  return board(dir, "issue", "get", String(id));
}

test("[night-55] eine wartende Sitzung bei sauberem Baum bekommt eigenen Grund, Vermerk und Feld — der Lauf laeuft weiter", NUR_POSIX, () => {
  const dir = setupProjekt("night-warte-zurueck-", ["true"]);
  try {
    const erstes = readyIssue(dir, "Wartet auf den eigenen Pflichtcheck");
    const zweites = readyIssue(dir, "Kommt nach dem wartenden Paket");
    // Kein Schreibzugriff, kein Commit, kein Move: der Rueckstellungszweig bei sauberem Baum.
    const fake = `echo '${resultZeileMitText("end_turn", WARTE_SCHLUSSTEXT)}'; exit 0`;

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "2"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `der Lauf haette regulaer enden muessen:\n${res.stdout}\n${res.stderr}`);

    // Der Grund im Protokoll — und der Zustandstext bleibt daneben stehen: Er war nie
    // falsch, nur unvollstaendig (dieselbe Linie wie bei night-24).
    assert.ok(res.stdout.includes(WARTEND_WORTLAUT), `der Grund fehlt im Protokoll:\n${res.stdout}`);
    assert.match(res.stdout, /nicht in In review, Tree sauber/, `der Zustandstext ist verschwunden:\n${res.stdout}`);

    // Der Vermerk am Paket: unter dem Anker, mit dem Fall im Wortlaut und dem Stand.
    const body = karte(dir, erstes).body;
    assert.ok(body.includes(WARTEND_ANKER), `der Anker fehlt am Paket:\n${body}`);
    assert.ok(body.includes(WARTEND_WORTLAUT), `der Fall steht nicht im Wortlaut am Paket:\n${body}`);
    assert.ok(body.includes(WARTE_SCHLUSSTEXT), `der zuletzt bekannte Stand fehlt am Paket:\n${body}`);
    assert.ok(!body.includes(DEFERRED_WORTLAUT), `der alte Grund steht noch am Paket:\n${body}`);
    // Ohne Pfadzeile: Der Baum ist in diesem Zweig sauber, und eine Meldung ueber nichts
    // ist keine.
    assert.doesNotMatch(body, /Im Arbeitsverzeichnis/, `der Vermerk meldet Reste, die es nicht gibt:\n${body}`);

    // Weg und Weiterlauf bleiben, wie sie waren.
    assert.equal(karte(dir, erstes).status, "backlog", "die Karte gehoert weiterhin ins Backlog");
    const e = einheit(dir, erstes);
    assert.equal(e.ausgang, "zurueckgestellt", "der Ausgang bleibt die Rueckstellung");
    assert.equal(e.wartendBeendet, true, "das Feld der wartenden Sitzung fehlt an der Einheit");
    // Das neue Feld haengt hinten an — die Feldreihenfolge ist der Vertrag mit den
    // Auswertungen, und die sieben alten Namen behalten ihre Plaetze.
    assert.deepEqual(
      Object.keys(e).slice(0, 7),
      ["id", "titel", "modell", "modellHerkunft", "modellGrund", "stufe", "stufeVerwendet"],
      `die Feldreihenfolge der Einheit hat sich verschoben: ${Object.keys(e).join(", ")}`,
    );

    // Der Weiterlauf, an der zweiten Karte gemessen: Sie wurde gezogen und ebenso behandelt.
    assert.ok(einheit(dir, zweites), "der Lauf hat das zweite Paket nicht mehr gezogen");
    assert.equal(karte(dir, zweites).status, "backlog");
    assert.match(res.stdout, /0 erfolgreich, 2 zurueckgestellt/, `die Zaehlung stimmt nicht:\n${res.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-55] dieselbe Runde ohne wartenden Schlusstext behaelt den bisherigen Grund, ohne Vermerk und ohne Feld", NUR_POSIX, () => {
  const dir = setupProjekt("night-warte-zurueck-alt-", ["true"]);
  try {
    const id = readyIssue(dir, "Endet ohne zu warten");
    const fake = `echo '${resultZeileMitText("end_turn", "Ich komme nicht weiter und hoere hier auf.")}'; exit 0`;

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `der Lauf haette regulaer enden muessen:\n${res.stdout}\n${res.stderr}`);

    const body = karte(dir, id).body;
    assert.ok(body.includes(DEFERRED_WORTLAUT), `der bisherige Grund fehlt am Paket:\n${body}`);
    assert.ok(!body.includes(WARTEND_ANKER), `ohne den Fall gehoert kein Vermerk ans Paket:\n${body}`);
    assert.ok(!res.stdout.includes(WARTEND_WORTLAUT), `ohne den Fall gehoert der Grund nicht ins Protokoll:\n${res.stdout}`);

    const e = einheit(dir, id);
    assert.equal(e.ausgang, "zurueckgestellt");
    // Weg statt `false`: Dieselbe Linie wie bei den nicht gemessenen Feldern des
    // Ergebnisstands — ein `false` behauptete eine Messung, die nicht stattgefunden hat.
    assert.ok(!("wartendBeendet" in e), `das Feld steht da, obwohl der Fall nicht eintrat: ${JSON.stringify(e)}`);
    assert.equal(karte(dir, id).status, "backlog");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- night-56: die beiden Salvage-Fehlschlaege bei unsauberem Arbeitsbaum (Issue #777) ---
//
// Der zweite Auswertungsweg. Der Salvage laeuft unveraendert zuerst, und sein Erfolg
// bleibt ein Erfolg ohne Grund, Vermerk und Feld — die wartende Sitzung wird erst dort
// vermerkt, wo die Runde als Fehlschlag endet: beim nicht moeglichen Salvage (rote
// Vorpruefung) und beim gescheiterten (kein Commit, Board nicht bewegt). Ohne den
// zweiten Fall entstuende der Befund nur fuer die Haelfte der Fehlschlaege: Bei
// `gescheitert` kehrt `behandleDirtyRunde` zurueck, bevor der Fehlschlag-Zweig mit
// `rundenGrund` erreicht ist — genau die Luecke aus dem Plan-Review zu #773.

const NICHT_WARTEND_SCHLUSSTEXT = "Ich komme nicht weiter und hoere hier auf.";

/** Ein Fake, der die regulaere Runde (dirty, eigener Schlusstext) vom Salvage trennt. */
function salvageFake(schlusstext, salvageTeil) {
  return [
    'if [ -n "$NIGHT_SALVAGE" ]; then',
    salvageTeil,
    "else",
    '  echo arbeit > "work-$NIGHT_ISSUE_ID.txt"',
    `  echo '${resultZeileMitText("end_turn", schlusstext)}'`,
    "fi",
  ].join("\n");
}

// Der Salvage-Teil eines erfolgreichen Versuchs: committen, dann das Board bewegen.
const SALVAGE_ERFOLG = [
  '  git add "work-$NIGHT_ISSUE_ID.txt" && git commit -q -m "salvage (Issue #$NIGHT_ISSUE_ID)"',
  '  node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null',
].join("\n");

test("[night-56] wartender Schlusstext, Salvage erfolgreich: der Erfolg bleibt unberuehrt", NUR_POSIX, () => {
  const dir = setupProjekt("night-warte-salvage-erfolg-", ["true"]);
  try {
    const id = readyIssue(dir, "Wartet, der Salvage rettet");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1"], {
      NIGHT_CLAUDE_CMD: salvageFake(WARTE_SCHLUSSTEXT, SALVAGE_ERFOLG),
    });
    assert.equal(res.status, 0, `der Lauf haette regulaer enden muessen:\n${res.stdout}\n${res.stderr}`);

    const e = einheit(dir, id);
    assert.equal(e.ausgang, "erfolg", `der Salvage-Erfolg bleibt ein Erfolg: ${JSON.stringify(e)}`);
    assert.ok(!("wartendBeendet" in e), `ein Erfolg traegt das Feld nicht: ${JSON.stringify(e)}`);
    assert.ok(!karte(dir, id).body.includes(WARTEND_ANKER), "ein gerettetes Paket bekommt keinen Vermerk");
    assert.ok(!res.stdout.includes(WARTEND_WORTLAUT), `der Grund steht im Protokoll einer geretteten Runde:\n${res.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-56] wartender Schlusstext, Salvage nicht moeglich: harter Stopp mit Grund, Vermerk samt Resten und Feld", NUR_POSIX, () => {
  const dir = setupProjekt("night-warte-salvage-rot-", ["false"]);
  try {
    const id = readyIssue(dir, "Wartet, die Vorpruefung ist rot");
    const fake = `echo arbeit > arbeit.txt; echo '${resultZeileMitText("end_turn", WARTE_SCHLUSSTEXT)}'; exit 0`;

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 1, `harter Stopp erwartet:\n${res.stdout}\n${res.stderr}`);

    // Der Grund im Protokoll — der Zustandstext bleibt daneben stehen (Linie von night-24).
    assert.ok(res.stdout.includes(WARTEND_WORTLAUT), `der Grund fehlt im Protokoll:\n${res.stdout}`);
    assert.match(res.stdout, /nicht in In review UND Working Tree dirty/, `der Zustandstext ist verschwunden:\n${res.stdout}`);

    // Der Vermerk am Paket: Anker, Fall, Stand — und die Reste, denn der Baum ist unsauber.
    const body = karte(dir, id).body;
    assert.ok(body.includes(WARTEND_ANKER), `der Anker fehlt am Paket:\n${body}`);
    assert.ok(body.includes(WARTE_SCHLUSSTEXT), `der zuletzt bekannte Stand fehlt am Paket:\n${body}`);
    assert.match(body, /Im Arbeitsverzeichnis/, `die Reste fehlen im Vermerk:\n${body}`);
    assert.match(body, /arbeit\.txt/, `die liegengebliebene Datei fehlt im Vermerk:\n${body}`);

    const e = einheit(dir, id);
    assert.equal(e.ausgang, "harterStopp", `der Ausgang bleibt der harte Stopp: ${JSON.stringify(e)}`);
    assert.equal(e.wartendBeendet, true, "das Feld der wartenden Sitzung fehlt an der Einheit");
    assert.ok(String(e.grund).includes(WARTEND_WORTLAUT), `der Grund fehlt an der Einheit: ${e.grund}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-56] wartender Schlusstext, Salvage gescheitert: der night-27-Grund bleibt und traegt den Warte-Grund vorangestellt", NUR_POSIX, () => {
  const dir = setupProjekt("night-warte-salvage-fehl-", ["true"]);
  try {
    const id = readyIssue(dir, "Wartet, der Salvage tut nichts");
    // Die Salvage-Session tut nichts: kein Commit, kein Board-Zug — night-27, gescheitert.
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1"], {
      NIGHT_CLAUDE_CMD: salvageFake(WARTE_SCHLUSSTEXT, "  :"),
    });
    assert.equal(res.status, 1, `harter Stopp erwartet:\n${res.stdout}\n${res.stderr}`);

    const e = einheit(dir, id);
    assert.equal(e.ausgang, "harterStopp", `der Ausgang bleibt der harte Stopp: ${JSON.stringify(e)}`);
    assert.equal(e.wartendBeendet, true, "das Feld der wartenden Sitzung fehlt an der Einheit");
    // Vorangestellt, nicht ersetzt: Der night-27-Zustand ist die konkretere Auskunft
    // ueber das, was morgens im Arbeitsverzeichnis liegt, und war nie falsch.
    const grund = String(e.grund);
    assert.ok(grund.startsWith(WARTEND_WORTLAUT), `der Warte-Grund steht nicht vorn: ${grund}`);
    assert.match(grund, /SALVAGE-VERSUCH gescheitert — harter Stopp/, `der night-27-Grund fehlt: ${grund}`);
    assert.match(grund, /kein Commit, Board nicht bewegt/, `die night-27-Begruendung fehlt: ${grund}`);

    const body = karte(dir, id).body;
    assert.ok(body.includes(WARTEND_ANKER), `der Anker fehlt am Paket:\n${body}`);
    assert.ok(body.includes(WARTE_SCHLUSSTEXT), `der zuletzt bekannte Stand fehlt am Paket:\n${body}`);
    assert.match(body, /weder committet noch das Board bewegt/, `der Salvage-Kommentar bleibt daneben stehen:\n${body}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-56] ohne wartenden Schlusstext bleibt der Salvage-Erfolg wie heute", NUR_POSIX, () => {
  const dir = setupProjekt("night-warte-salvage-erfolg-alt-", ["true"]);
  try {
    const id = readyIssue(dir, "Gibt auf, der Salvage rettet");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1"], {
      NIGHT_CLAUDE_CMD: salvageFake(NICHT_WARTEND_SCHLUSSTEXT, SALVAGE_ERFOLG),
    });
    assert.equal(res.status, 0, `der Lauf haette regulaer enden muessen:\n${res.stdout}\n${res.stderr}`);

    const e = einheit(dir, id);
    assert.equal(e.ausgang, "erfolg");
    assert.ok(!("wartendBeendet" in e), `das Feld steht da, obwohl der Fall nicht eintrat: ${JSON.stringify(e)}`);
    assert.ok(!karte(dir, id).body.includes(WARTEND_ANKER), "ohne den Fall gehoert kein Vermerk ans Paket");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-56] ohne wartenden Schlusstext behaelt der nicht moegliche Salvage den bisherigen Grund", NUR_POSIX, () => {
  const dir = setupProjekt("night-warte-salvage-rot-alt-", ["false"]);
  try {
    const id = readyIssue(dir, "Gibt auf, die Vorpruefung ist rot");
    const fake = `echo arbeit > arbeit.txt; echo '${resultZeileMitText("end_turn", NICHT_WARTEND_SCHLUSSTEXT)}'; exit 0`;

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 1, `harter Stopp erwartet:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /Grund: Session regulaer beendet ohne Commit \(end_turn\)/, `der bisherige Grund fehlt:\n${res.stdout}`);
    assert.ok(!res.stdout.includes(WARTEND_WORTLAUT), `ohne den Fall gehoert der Grund nicht ins Protokoll:\n${res.stdout}`);
    assert.ok(!karte(dir, id).body.includes(WARTEND_ANKER), "ohne den Fall gehoert kein Vermerk ans Paket");

    const e = einheit(dir, id);
    assert.equal(e.ausgang, "harterStopp");
    assert.ok(!("wartendBeendet" in e), `das Feld steht da, obwohl der Fall nicht eintrat: ${JSON.stringify(e)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-56] ohne wartenden Schlusstext behaelt der gescheiterte Salvage den unveraenderten night-27-Grund", NUR_POSIX, () => {
  const dir = setupProjekt("night-warte-salvage-fehl-alt-", ["true"]);
  try {
    const id = readyIssue(dir, "Gibt auf, der Salvage tut nichts");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1"], {
      NIGHT_CLAUDE_CMD: salvageFake(NICHT_WARTEND_SCHLUSSTEXT, "  :"),
    });
    assert.equal(res.status, 1, `harter Stopp erwartet:\n${res.stdout}\n${res.stderr}`);

    const e = einheit(dir, id);
    assert.equal(e.ausgang, "harterStopp");
    assert.ok(!("wartendBeendet" in e), `das Feld steht da, obwohl der Fall nicht eintrat: ${JSON.stringify(e)}`);
    const grund = String(e.grund);
    assert.ok(grund.startsWith("SALVAGE-VERSUCH gescheitert"), `der night-27-Grund traegt einen Vorspann: ${grund}`);
    assert.ok(!grund.includes(WARTEND_WORTLAUT), `der Warte-Grund steht da, obwohl der Fall nicht eintrat: ${grund}`);
    assert.ok(!karte(dir, id).body.includes(WARTEND_ANKER), "ohne den Fall gehoert kein Vermerk ans Paket");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-55] eine Wartemeldung mitten im Strom vor erfolgreichem Abschluss loest nichts aus", NUR_POSIX, () => {
  // Gelesen wird nur der Schlusstext (night-52). Wer spaeter fertig wird, sagt zum Schluss
  // etwas anderes — und genau das ist hier der Fall: Die Runde schliesst ab.
  const dir = setupProjekt("night-warte-strom-", ["true"]);
  try {
    const id = readyIssue(dir, "Wartet zwischendurch und wird fertig");
    const zwischendurch =
      `{"type":"assistant","message":{"content":[{"type":"text","text":${JSON.stringify(WARTE_SCHLUSSTEXT)}}]}}`;
    const fake = [
      `echo '${zwischendurch}'`,
      `printf '%s' '{"laufen":[{"cmd":"true","ergebnis":"gruen","grund":"beruehrt"}],"ausgelassen":[]}' > .claude/checks-summary.json`,
      'echo arbeit > "work-$NIGHT_ISSUE_ID.txt" && git add "work-$NIGHT_ISSUE_ID.txt"'
        + ' && git commit -q -m "arbeit (Issue #$NIGHT_ISSUE_ID)"',
      'node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null',
      `echo '${resultZeileMitText("end_turn", "Issue umgesetzt, committet und in In review.")}'`,
    ].join("\n");

    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `der Lauf haette regulaer enden muessen:\n${res.stdout}\n${res.stderr}`);

    const e = einheit(dir, id);
    assert.equal(e.ausgang, "erfolg", `die Runde haette ein Erfolg sein muessen: ${JSON.stringify(e)}`);
    assert.ok(!("wartendBeendet" in e), `die Wartemeldung im Strom hat das Feld gesetzt: ${JSON.stringify(e)}`);
    assert.ok(!karte(dir, id).body.includes(WARTEND_ANKER), "ein erfolgreiches Paket bekommt keinen Vermerk");
    assert.ok(!res.stdout.includes(WARTEND_WORTLAUT), `der Grund steht im Protokoll einer erfolgreichen Runde:\n${res.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- night-57, night-58: die wartende Sitzung in den Stufen der Nacht-Kette (Issue #778) ---
//
// Der dritte Auswertungsweg, und der einzige ohne Arbeitspaket: In den Stufen liefert
// `ketteSession` je Stufe einen Ausgang und einen Grund, und der Nachtbericht am Fachplan
// (night-21) traegt beides. Eine wartende Stufen-Session zaehlte bis hierher als `fertig`,
// obwohl sie nichts hinterlassen hat.
//
// Ausgenommen bleibt die Abdeckungs-Stufe: Ihr Schlusstext ist kein Abschlussbericht,
// sondern das Arbeitsergebnis selbst — `stufeAbdeckung` liest ihn als Befundliste ein, und
// bei einem anderen Ausgang als `fertig` faellt der Befund weg. Ein Befundsatz wie
// "Kriterium 3: Ergebnis steht noch aus" traefe die Musterliste und verwuerfe den Befund
// genau dann, wenn er etwas zu sagen hat.

/** Der Schlusstext einer wartenden Stufen-Session — trifft das Muster "laeuft noch". */
const KETTE_WARTE_TEXT = "Der Plan ist geschrieben, die Formpruefung laeuft noch im Hintergrund.";

/** Derselbe Satz ohne den Fall: eine Stufen-Session, die regulaer fertig wird. */
const KETTE_FERTIG_TEXT = "Der Plan ist geschrieben und steht am Board.";

/** Die Einheit der Kette zu ihrem Fachplan. */
function kettenEinheit(dir, F) {
  const treffer = kette.stand(dir).einheiten.find((e) => e.id === F);
  assert.ok(treffer, `keine Einheit fuer Fachplan #${F}`);
  return treffer;
}

test("[night-57] eine wartende Stufen-Session endet abgebrochen, mit Grund, Vermerk am Dokument der Stufe und Feld", kette.NUR_POSIX, () => {
  kette.mitProjekt((dir) => {
    const F = kette.fachplan(dir);
    const env = kette.umgebung(dir, { stufen: { plan: kette.PLAN_ANLEGEN } });
    const res = kette.run(dir, ["--kette"], { ...env, KETTE_RESULT_TEXT: KETTE_WARTE_TEXT });
    assert.equal(res.status, 0, `der Lauf haette regulaer enden muessen:\n${res.stdout}\n${res.stderr}`);

    const e = kettenEinheit(dir, F);
    assert.equal(e.ausgang, "abgebrochen", `die Stufe haette abbrechen muessen: ${JSON.stringify(e)}`);
    assert.equal(e.grund, WARTEND_WORTLAUT, `der Grund der wartenden Sitzung fehlt: ${e.grund}`);
    assert.equal(e.wartendBeendet, true, "das Feld der wartenden Sitzung fehlt an der Ketten-Einheit");

    // Der Vermerk am Dokument der Stufe plan — dem Fachplan; einen Plan gibt es noch nicht.
    const body = kette.board(dir, "issue", "get", F).body;
    assert.ok(body.includes(WARTEND_ANKER), `der Anker fehlt am Fachplan:\n${body}`);
    assert.ok(body.includes(WARTEND_WORTLAUT), `der Fall steht nicht im Wortlaut am Fachplan:\n${body}`);
    assert.ok(body.includes(KETTE_WARTE_TEXT), `der zuletzt bekannte Stand fehlt am Fachplan:\n${body}`);
    // Ohne Pfadzeile: Die Stufen-Session arbeitet im Worktree, und die Reste der
    // Hauptkopie sagten ueber sie nichts.
    assert.doesNotMatch(body, /Im Arbeitsverzeichnis/, `der Vermerk meldet Reste der Hauptkopie:\n${body}`);

    // Der Abbruch haelt die Kette an — keine Stufe danach.
    assert.deepEqual(kette.sessions(env.logPfad).map((s) => s.stufe), ["plan"]);
    assert.ok(res.stdout.includes(WARTEND_WORTLAUT), `der Grund fehlt im Protokoll:\n${res.stdout}`);
  });
});

test("[night-57] der Vermerk einer wartenden Review-Stufe haengt am Plan, nicht am Fachplan", kette.NUR_POSIX, () => {
  kette.mitProjekt((dir) => {
    const F = kette.fachplan(dir);
    // Nur die Review-Session wartet; die Plan-Stufe davor endet regulaer.
    const env = kette.umgebung(dir, {
      stufen: { plan: kette.PLAN_ANLEGEN, review: `KETTE_RESULT_TEXT="${KETTE_WARTE_TEXT}"` },
    });
    const res = kette.run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `der Lauf haette regulaer enden muessen:\n${res.stdout}\n${res.stderr}`);

    const e = kettenEinheit(dir, F);
    assert.equal(e.ausgang, "abgebrochen", `die Stufe haette abbrechen muessen: ${JSON.stringify(e)}`);
    assert.equal(e.grund, WARTEND_WORTLAUT);
    assert.equal(e.wartendBeendet, true);

    const planId = e.stufen.plan.id;
    assert.ok(planId, `ohne Plan laesst sich das Dokument der Stufe nicht pruefen: ${JSON.stringify(e.stufen)}`);
    const planBody = kette.board(dir, "issue", "get", planId).body;
    assert.ok(planBody.includes(WARTEND_ANKER), `der Anker fehlt am Plan:\n${planBody}`);
    assert.ok(planBody.includes(KETTE_WARTE_TEXT), `der zuletzt bekannte Stand fehlt am Plan:\n${planBody}`);
    // Der eigene Vermerk ist kein Reviewer-Befund: Er darf den Vermerk
    // "## Review unvollstaendig" nicht ausloesen (night-19).
    assert.ok(!planBody.includes(REVIEW_REST_ANKER), `der eigene Vermerk gilt als Reviewer-Befund:\n${planBody}`);
    assert.ok(!kette.board(dir, "issue", "get", F).body.includes(WARTEND_ANKER),
      "der Vermerk der Review-Stufe gehoert an den Plan, nicht an den Fachplan");
  });
});

test("[night-57] dieselbe Stufen-Session ohne wartenden Schlusstext endet fertig, ohne Vermerk und ohne Feld", kette.NUR_POSIX, () => {
  kette.mitProjekt((dir) => {
    const F = kette.fachplan(dir);
    const env = kette.umgebung(dir, {
      stufen: { plan: kette.PLAN_ANLEGEN, review: kette.REVIEW_MARKER, pakete: kette.PAKETE_ANLEGEN },
    });
    const res = kette.run(dir, ["--kette"], { ...env, KETTE_RESULT_TEXT: KETTE_FERTIG_TEXT });
    assert.equal(res.status, 0, `der Lauf haette regulaer enden muessen:\n${res.stdout}\n${res.stderr}`);

    const e = kettenEinheit(dir, F);
    assert.equal(e.ausgang, "fertig", `die Kette haette durchlaufen muessen: ${e.grund}`);
    // Weg statt `false`, dieselbe Linie wie bei night-55.
    assert.ok(!("wartendBeendet" in e), `das Feld steht da, obwohl der Fall nicht eintrat: ${JSON.stringify(e)}`);
    assert.ok(!kette.board(dir, "issue", "get", F).body.includes(WARTEND_ANKER),
      "ohne den Fall gehoert kein Vermerk an den Fachplan");
    assert.ok(!kette.board(dir, "issue", "get", e.stufen.plan.id).body.includes(WARTEND_ANKER),
      "ohne den Fall gehoert kein Vermerk an den Plan");
    assert.ok(!res.stdout.includes(WARTEND_WORTLAUT), `ohne den Fall gehoert der Grund nicht ins Protokoll:\n${res.stdout}`);
  });
});

test("[night-57] die Abdeckungs-Stufe bleibt fertig und behaelt ihren Befund, auch wenn er eine Wendung der Musterliste traegt", kette.NUR_POSIX, () => {
  kette.mitProjekt((dir) => {
    const F = kette.fachplan(dir);
    // Ein echter Befundsatz, der die Musterliste trifft — genau der Fall, den die
    // Ausnahme schuetzt: Bei einem anderen Ausgang als `fertig` fiele er weg.
    const befund = "### Ohne Paket Kriterium 3: Ergebnis steht noch aus.";
    const env = kette.umgebung(dir, {
      stufen: {
        plan: kette.PLAN_ANLEGEN,
        review: kette.REVIEW_MARKER,
        pakete: kette.PAKETE_ANLEGEN,
        abdeckung: `KETTE_RESULT_TEXT="${befund}"`,
      },
    });
    const res = kette.run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `der Lauf haette regulaer enden muessen:\n${res.stdout}\n${res.stderr}`);

    const e = kettenEinheit(dir, F);
    assert.equal(e.ausgang, "fertig", `die Abdeckung ist eine Auskunft, kein Tor: ${e.grund}`);
    assert.equal(e.stufen.abdeckung.text, befund, "der Befund der Abdeckung ist verloren gegangen");
    assert.ok(!("wartendBeendet" in e), `die Ausnahme greift nicht: ${JSON.stringify(e)}`);
    assert.ok(!kette.board(dir, "issue", "get", F).body.includes(WARTEND_ANKER),
      "die Abdeckungs-Stufe hinterlaesst keinen Vermerk");
  });
});

test("[night-58] der Zusatz der Stufen-Sessions nennt die Regel, der Prompt der Implementierungs-Runde nicht", kette.NUR_POSIX, () => {
  // Die Regel selbst — der Wortlaut steht hier ein zweites Mal, wie bei WARTEND_WORTLAUT:
  // Wer den Zusatz umformuliert, soll es an einem roten Test merken.
  assert.match(KETTE_ZUSATZ, /Beende deine Arbeit nicht, solange eine von dir angestossene lange Arbeit laeuft/);
  assert.match(KETTE_ZUSATZ, /Warte auf ihr Ergebnis oder brich sie ab und melde den Abbruch als Fehlschlag/);
  // Der bisherige Satz bleibt daneben stehen.
  assert.match(KETTE_ZUSATZ, /Dieser Lauf ist unbeaufsichtigt/);

  // Am Prompt einer Stufen-Session gemessen, nicht nur an der Konstanten.
  kette.mitProjekt((dir) => {
    kette.fachplan(dir);
    const env = kette.umgebung(dir, {
      stufen: { plan: String.raw`printf "%s" "$NIGHT_PROMPT" > "$KETTE_LOG.prompt"` },
    });
    assert.equal(kette.run(dir, ["--kette"], env).status, 0);
    const prompt = readFileSync(`${env.logPfad}.prompt`, "utf-8");
    assert.match(prompt, /^\/techplan #0001/, `der Auftrag fehlt im Prompt:\n${prompt}`);
    assert.ok(prompt.includes(KETTE_ZUSATZ), `der Zusatz fehlt am Prompt der Stufe:\n${prompt}`);
  });

  // Die Implementierungs-Runde bekommt ihn ausdruecklich nicht — ihre Anweisung steht im
  // Skill, und zwei Orte fuer dieselbe Regel liefen auseinander.
  const dir = setupProjekt("night-warte-zusatz-", ["true"]);
  // Die Mitschrift liegt ausserhalb des Fixture-Repos: im Repo machte sie den Working
  // Tree dirty, und der Lauf fiele in den Dirty-Zweig statt in die Rueckstellung.
  const ausserhalb = mkdtempSync(join(tmpdir(), "night-warte-prompt-"));
  try {
    const id = readyIssue(dir, "Belegt den blossen Prompt");
    const mitschrift = join(ausserhalb, "prompt.txt");
    const fake = `printf '%s' "$NIGHT_PROMPT" > ${JSON.stringify(mitschrift)}; `
      + `echo '${resultZeile("end_turn")}'; exit 0`;
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--max", "1"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `der Lauf haette regulaer enden muessen:\n${res.stdout}\n${res.stderr}`);
    assert.equal(readFileSync(mitschrift, "utf-8"), `/implement-next #${id}`,
      "der Prompt der Implementierungs-Runde traegt mehr als den Auftrag");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(ausserhalb, { recursive: true, force: true });
  }
});
